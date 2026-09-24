import { describe, expect, it } from 'vitest';
import { computeHold, maxActualItems, settle, suggestTip } from '../shared/pricing';
import { SPOT_BY_ID, BUILDINGS } from '../shared/catalog';

const spot = SPOT_BY_ID.get('foodlab')!;
const near = { lat: spot.lat + 0.0005, lng: spot.lng };
const far = BUILDINGS.find((b) => b.id === 'STCC')!;
// Jeudi 24 septembre 2026, 10:00 à Zurich : hors heure de pointe.
const morning = new Date('2026-09-24T08:00:00Z');
const noon = new Date('2026-09-24T10:30:00Z');

describe('pourboire suggéré', () => {
  it('est arrondi aux 50 centimes et borné', () => {
    const s = suggestTip({ spot, dropoff: near, itemCount: 1, date: morning });
    expect(s.suggestedCents % 50).toBe(0);
    expect(s.suggestedCents).toBeGreaterThanOrEqual(150);
    expect(s.suggestedCents).toBeLessThanOrEqual(900);
  });

  it('augmente avec la distance, le nombre d’articles et l’heure de pointe', () => {
    const base = suggestTip({ spot, dropoff: near, itemCount: 1, date: morning }).suggestedCents;
    expect(suggestTip({ spot, dropoff: far, itemCount: 1, date: morning }).suggestedCents).toBeGreaterThan(base);
    expect(suggestTip({ spot, dropoff: near, itemCount: 5, date: morning }).suggestedCents).toBeGreaterThan(base);
    const lunch = suggestTip({ spot, dropoff: near, itemCount: 1, date: noon });
    expect(lunch.factors.map((f) => f.label)).toContain('Heure de pointe');
  });

  it('propose trois options ordonnées', () => {
    const s = suggestTip({ spot, dropoff: far, itemCount: 2, date: morning });
    const [min, suggested, generous] = s.options.map((o) => o.cents);
    expect(min).toBeLessThanOrEqual(suggested);
    expect(generous).toBeGreaterThan(suggested);
  });
});

describe('réservation et règlement', () => {
  it('réserve articles + 10 % + pourboire', () => {
    expect(computeHold(1250, 300)).toEqual({ itemsCents: 1250, marginCents: 130, tipCents: 300, holdCents: 1680 });
  });

  it('répartit exactement le montant réservé', () => {
    const hold = computeHold(1110, 300);
    const order = { holdCents: hold.holdCents, tipCents: 300, actualItemsCents: 1080 };
    const { courierCents, refundCents } = settle(order);
    expect(courierCents).toBe(1380);
    expect(courierCents + refundCents).toBe(hold.holdCents);
  });

  it('plafonne le ticket au montant réservé hors pourboire', () => {
    expect(maxActualItems({ holdCents: 1680, tipCents: 300 })).toBe(1380);
  });
});
