import { describe, expect, it } from 'vitest';
import { BUILDINGS, SPOTS, spotOf } from '../shared/catalog';
import { EPFL_CENTER, haversine } from '../shared/geo';

describe('catalogue', () => {
  it('a des identifiants d’articles uniques', () => {
    const ids = SPOTS.flatMap((s) => s.menu.flatMap((m) => m.items.map((i) => i.id)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(SPOTS.map((s) => s.id)).size).toBe(SPOTS.length);
  });

  it('crédite une source pour chaque spot', () => {
    for (const s of SPOTS) {
      expect(s.sources.length, s.id).toBeGreaterThan(0);
      for (const src of s.sources) expect(src.url, s.id).toMatch(/^https:\/\//);
      if (s.cover) expect(s.cover.url, s.id).toMatch(/^https:\/\//);
    }
  });

  it('reste sur le campus EPFL et son Quartier Nord', () => {
    for (const p of [...SPOTS, ...BUILDINGS]) expect(haversine(p, EPFL_CENTER), p.id).toBeLessThan(800);
  });

  it('n’a que des prix exacts sur ses cartes fixes', () => {
    for (const s of SPOTS) {
      for (const i of s.menu.flatMap((m) => m.items)) {
        expect(i.priceCents, i.id).toBeGreaterThan(0);
        expect(i.priceCents % 5, i.id).toBe(0);
      }
    }
  });

  it('a des horaires pour chaque spot', () => {
    for (const s of SPOTS) expect(s.hours.flat().length, s.id).toBeGreaterThan(0);
  });

  it('résiste aux commandes d’un spot retiré', () => {
    expect(spotOf('esplanade').name).toBe('Spot retiré');
  });
});
