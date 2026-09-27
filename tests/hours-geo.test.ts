import { describe, expect, it } from 'vitest';
import { openStatus, week } from '../shared/hours';
import { detourMeters, haversine, isOnCampus, EPFL_CENTER } from '../shared/geo';

const weekdays = week.weekdays(['07:30', '16:00']);
// Les dates sont en UTC ; Zurich est à UTC+2 en septembre.
const at = (iso: string) => new Date(iso);

describe('horaires (fuseau Europe/Zurich)', () => {
  it('ouvert en journée un jour de semaine', () => {
    const s = openStatus(weekdays, at('2026-09-24T08:00:00Z'));
    expect(s.open).toBe(true);
    expect(s.label).toBe("Ouvert · jusqu'à 16h00");
  });

  it('signale la fermeture imminente', () => {
    expect(openStatus(weekdays, at('2026-09-24T13:45:00Z')).closingSoon).toBe(true);
  });

  it('annonce la prochaine ouverture', () => {
    expect(openStatus(weekdays, at('2026-09-24T04:00:00Z')).label).toBe('Fermé · ouvre à 07h30');
    expect(openStatus(weekdays, at('2026-09-24T18:00:00Z')).label).toBe('Fermé · ouvre demain à 07h30');
    // Vendredi soir → lundi.
    expect(openStatus(weekdays, at('2026-09-25T18:00:00Z')).label).toBe('Fermé · ouvre lun. à 07h30');
  });

  it('gère les spots ouverts 24h/24', () => {
    expect(openStatus(week.everyday(['00:00', '24:00']), at('2026-09-27T01:00:00Z')).label).toBe('Ouvert 24h/24');
  });
});

describe('géographie', () => {
  it('calcule des distances plausibles', () => {
    const d = haversine({ lat: 46.5184, lng: 6.5683 }, { lat: 46.5233, lng: 6.5634 });
    expect(d).toBeGreaterThan(600);
    expect(d).toBeLessThan(700);
  });

  it('ne compte presque aucun détour quand la livraison est sur le chemin', () => {
    const from = { lat: 46.518, lng: 6.562 };
    const destination = { lat: 46.518, lng: 6.57 };
    const onPath = detourMeters({ from, spot: from, dropoff: { lat: 46.518, lng: 6.566 }, destination });
    const offPath = detourMeters({ from, spot: from, dropoff: { lat: 46.522, lng: 6.566 }, destination });
    expect(onPath).toBeLessThan(5);
    expect(offPath).toBeGreaterThan(400);
  });

  it('reconnaît le campus', () => {
    expect(isOnCampus(EPFL_CENTER)).toBe(true);
    expect(isOnCampus({ lat: 46.2044, lng: 6.1432 })).toBe(false);
  });
});
