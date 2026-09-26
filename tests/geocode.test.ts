import { afterEach, describe, expect, it, vi } from 'vitest';
import { search, searchCampus, walkingRoute } from '../server/services/geocode';
import { SPOT_BY_ID } from '../shared/catalog';

afterEach(() => vi.unstubAllGlobals());

describe('recherche de lieux', () => {
  it('trouve les spots et bâtiments du campus sans réseau', () => {
    expect(searchCampus('foodl')[0]).toMatchObject({ kind: 'spot', spotId: 'foodlab', label: 'FoodLab' });
    expect(searchCampus('bc').some((r) => r.kind === 'building' && r.label === 'BC')).toBe(true);
    // Accents et majuscules ignorés.
    expect(searchCampus('ROLEX').some((r) => r.label === 'RLC')).toBe(true);
  });

  it('ajoute les adresses autour de l’EPFL, et se contente du campus si le service ne répond pas', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('photon.komoot.io');
      expect(url).toContain('bbox=');
      return Response.json({
        features: [
          { geometry: { coordinates: [6.5751, 46.5206] }, properties: { osm_type: 'W', osm_id: 1, name: 'Unithèque', city: 'Chavannes-près-Renens', postcode: '1022' } },
          { geometry: { coordinates: [6.5845, 46.5302] }, properties: { osm_type: 'N', osm_id: 2, street: 'Avenue du Tir-Fédéral', housenumber: '12', city: 'Écublens' } },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await search('unith');
    expect(results.map((r) => r.label)).toEqual(['Unithèque', 'Avenue du Tir-Fédéral 12']);
    expect(results[0]).toMatchObject({ kind: 'address', detail: '1022 Chavannes-près-Renens', lat: 46.5206, lng: 6.5751 });

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('hors ligne'))));
    expect((await search('satel')).map((r) => r.spotId)).toContain('satellite');
  });
});

describe('itinéraire à pied', () => {
  const a = SPOT_BY_ID.get('foodlab')!;
  const b = { lat: 46.51855, lng: 6.5616 };

  it('reprend le tracé piéton d’OpenStreetMap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toContain('routed-foot');
        return Response.json({ code: 'Ok', routes: [{ distance: 612, geometry: { coordinates: [[a.lng, a.lat], [6.564, 46.519], [b.lng, b.lat]] } }] });
      }),
    );
    const route = await walkingRoute([a, b]);
    expect(route).toMatchObject({ meters: 612, minutes: 8 });
    expect(route.path).toHaveLength(3);
  });

  it('trace des lignes droites si le service ne répond pas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const route = await walkingRoute([a, { lat: 46.5184, lng: 6.5683 }]);
    expect(route.path).toBeNull();
    expect(route.meters).toBeGreaterThan(100);
  });
});
