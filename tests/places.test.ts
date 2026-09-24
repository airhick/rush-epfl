import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as PlacesModule from '../server/services/places';
import { SPOT_BY_ID } from '../shared/catalog';

let places: typeof PlacesModule;
const gina = SPOT_BY_ID.get('gina')!;

beforeAll(async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  places = await import('../server/services/places');
});

afterEach(() => vi.unstubAllGlobals());

function mockGoogle(handler: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(handler(url, init)), { status: 200 });
    }),
  );
  return calls;
}

describe('photos et avis Google (API Places)', () => {
  it('trouve le lieu près du spot, et crédite photos et avis', async () => {
    const calls = mockGoogle((url) =>
      url.endsWith(':searchText')
        ? { places: [{ id: 'far', location: { latitude: 46.53, longitude: 6.6 } }, { id: 'gina-id', location: { latitude: gina.lat, longitude: gina.lng } }] }
        : {
            rating: 4.3,
            userRatingCount: 212,
            googleMapsUri: 'https://maps.google.com/?cid=1',
            photos: [{ name: 'places/gina-id/photos/p1', widthPx: 800, heightPx: 600, authorAttributions: [{ displayName: 'Ana', uri: 'https://maps.google.com/ana' }] }],
            reviews: [{ rating: 5, text: { text: 'Très bonnes pizzas' }, relativePublishTimeDescription: 'il y a 2 semaines', authorAttribution: { displayName: 'Marc' } }],
          },
    );
    const place = await places.googlePlace(gina);
    expect(place.available).toBe(true);
    if (!place.available) return;
    expect(place.rating).toBe(4.3);
    expect(place.photos[0].attributions).toEqual([{ name: 'Ana', url: 'https://maps.google.com/ana' }]);
    expect(place.reviews[0]).toMatchObject({ rating: 5, text: 'Très bonnes pizzas', author: { name: 'Marc' } });
    // Le lieu lointain est écarté au profit de celui qui correspond au spot.
    expect(calls[1].url).toContain('/places/gina-id');
    expect((calls[0].init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
  });

  it('ne relaie que les photos du lieu associé au spot', async () => {
    mockGoogle(() => ({ photoUri: 'https://lh3.googleusercontent.com/x' }));
    await expect(places.googlePhotoUrl(gina, 'places/gina-id/photos/p1', 800)).resolves.toBe('https://lh3.googleusercontent.com/x');
    await expect(places.googlePhotoUrl(gina, 'places/autre/photos/p1', 800)).rejects.toThrow('Photo introuvable');
    await expect(places.googlePhotoUrl(gina, 'places/gina-id/photos/../../x', 800)).rejects.toThrow('Photo introuvable');
  });

  it('signale un lieu introuvable plutôt que d’afficher celui d’un autre commerce', async () => {
    mockGoogle(() => ({ places: [{ id: 'loin', location: { latitude: 46.55, longitude: 6.65 } }] }));
    const place = await places.googlePlace(SPOT_BY_ID.get('migros-epfl')!);
    expect(place).toEqual({ available: false, reason: 'not-found' });
  });
});
