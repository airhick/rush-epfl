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
      if (s.rating) expect(s.rating.url, s.id).toMatch(/^https:\/\//);
    }
  });

  it('reste sur le campus EPFL et son Quartier Nord', () => {
    for (const p of [...SPOTS, ...BUILDINGS]) expect(haversine(p, EPFL_CENTER), p.id).toBeLessThan(800);
  });

  it('a des menus non vides et des prix positifs', () => {
    for (const s of SPOTS) {
      const items = s.menu.flatMap((m) => m.items);
      expect(items.length, s.id).toBeGreaterThan(0);
      for (const i of items) expect(i.priceCents, i.id).toBeGreaterThan(0);
    }
  });

  it('résiste aux commandes d’un spot retiré', () => {
    expect(spotOf('esplanade').name).toBe('Spot retiré');
  });
});
