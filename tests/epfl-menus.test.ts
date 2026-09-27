import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeEntities, parseOffers, sectionsFor, setFetcher, spotMenu, zurichDate } from '../server/services/epflMenus';
import { SPOT_BY_ID } from '../shared/catalog';

// Extrait réel de la page « Offre du jour » de l'EPFL (24 septembre 2026).
const HTML = readFileSync(new URL('./fixtures/epfl-offre-du-jour.html', import.meta.url), 'utf8');
const offers = parseOffers(HTML);
const byName = (name: string) => offers.find((o) => o.item.name === name)!;

describe('offre du jour EPFL', () => {
  it('lit les quatre prix publiés et réserve le plus élevé', () => {
    const saucisse = byName('Saucisse à rôtir jus aux oignons confits');
    expect(saucisse.restaurant).toBe('Alpine');
    expect(saucisse.item.description).toBe('Ecrasée pommes de terre aux herbes et petits légumes');
    expect(saucisse.item.tiers).toEqual({ student: 860, campus: 1100, doctoral: 990, visitor: 1240 });
    expect(saucisse.item.priceCents).toBe(1240);
  });

  it('lit un prix unique, un prix au poids et l’absence de prix sans rien inventer', () => {
    expect(byName('Kit étudiant').item).toMatchObject({ priceCents: 700 });
    expect(byName('Kit étudiant').item.tiers).toBeUndefined();
    const buffet = byName('Buffet chaud du moment:');
    expect(buffet.item).toMatchObject({ priceCents: 0, per100gCents: 290 });
    expect(byName('Viennoiseries').item.priceCents).toBe(0);
    expect(byName('Grande Frites (sans sauce)').item.priceCents).toBe(0);
  });

  it('garde régime, allergènes, service du soir et accompagnements', () => {
    expect(byName('Pizza 3 fromages').item.tags).toEqual(['vege']);
    expect(byName("Nugget's").service).toBe('dinner');
    const ravioli = offers.filter((o) => o.item.name === 'Ravioli au fromage');
    // Deux lignes identiques ne comptent qu'une fois ; le menu avec accompagnements reste à part.
    expect(ravioli).toHaveLength(2);
    expect(ravioli.map((r) => r.item.description)).toContain('Sauce au potimarron, Fruits frais au choix, Salade verte');
  });

  it('range les offres par comptoir du spot', () => {
    const foodlab = sectionsFor(SPOT_BY_ID.get('foodlab')!, offers);
    expect(foodlab.map((s) => s.title)).toEqual(['Alpine', 'Native · végétal', 'Ginko', 'Ce soir · Native · végétal']);
    expect(foodlab[0].items).toHaveLength(3);
    // Microcity (Neuchâtel) n'est rattaché à aucun spot du campus.
    const all = [...SPOT_BY_ID.values()].flatMap((s) => sectionsFor(s, offers)).flatMap((s) => s.items);
    expect(all.some((i) => i.name.startsWith('Tortelloni ricotta'))).toBe(false);
  });

  it('décode les entités HTML comme le texte brut', () => {
    expect(decodeEntities('R&#xf6;sti &amp; caf&eacute; &#233;t&#xE9;')).toBe('Rösti & café été');
  });
});

describe('menu d’un spot', () => {
  const noon = new Date('2026-09-24T10:00:00Z');
  let calls: string[] = [];
  beforeEach(() => {
    calls = [];
    setFetcher(async (url) => {
      calls.push(url);
      return HTML;
    });
  });

  it('demande la page du jour à Lausanne et met en cache', async () => {
    const menu = await spotMenu(SPOT_BY_ID.get('satellite')!, noon);
    await spotMenu(SPOT_BY_ID.get('foodlab')!, noon);
    expect(calls).toEqual([`https://www.epfl.ch/campus/restaurants-shops-hotels/fr/offre-du-jour-de-tous-les-points-de-restauration/?date=2026-09-24`]);
    expect(menu.daily?.status).toBe('ok');
    expect(menu.sections[0].items.map((i) => i.name)).toContain('Kit étudiant');
    expect(zurichDate(new Date('2026-09-24T22:30:00Z'))).toBe('2026-09-25');
  });

  it('signale une page indisponible sans inventer de menu', async () => {
    setFetcher(async () => {
      throw new Error('réseau');
    });
    const menu = await spotMenu(SPOT_BY_ID.get('piano')!, noon);
    expect(menu.daily?.status).toBe('unavailable');
    expect(menu.sections).toEqual([]);
  });

  it('garde la carte fixe officielle sous l’offre du jour', async () => {
    const menu = await spotMenu(SPOT_BY_ID.get('gina')!, noon);
    expect(menu.daily?.status).toBe('empty');
    expect(menu.sections[0].title).toBe('Pizzas');
  });

  it('sert la carte fixe des spots hors EPFL sans appel réseau', async () => {
    const menu = await spotMenu(SPOT_BY_ID.get('holy-cow-epfl')!, noon);
    expect(menu).toEqual({ sections: [], daily: null });
    expect(calls).toHaveLength(0);
  });
});
