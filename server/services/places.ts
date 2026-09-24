import { env } from '../env';
import { HttpError } from '../http';
import { haversine } from '../../shared/geo';
import type { Spot } from '../../shared/catalog';
import type { GoogleAttribution, GooglePlaceResult } from '../../shared/types';

/**
 * Photos et avis Google Maps via l'API Places (New), sous la licence de
 * Google : on affiche les attributions exigées (Google Maps, auteurs) et on
 * ne stocke rien d'autre que les identifiants de lieu, seules données que
 * les conditions de Google permettent de conserver.
 */

const API = 'https://places.googleapis.com/v1';
const DETAILS_FIELDS = 'id,rating,userRatingCount,googleMapsUri,reviews,photos';
/** Au-delà, le lieu trouvé n'est probablement pas le bon spot. */
const MAX_MATCH_DISTANCE_M = 350;

const placeIds = new Map<string, string | null>();
const inflight = new Map<string, Promise<GooglePlaceResult>>();

async function google<T>(path: string, init: RequestInit & { fieldMask?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'X-Goog-Api-Key': env.googleMapsKey!,
      'content-type': 'application/json',
      ...(init.fieldMask ? { 'X-Goog-FieldMask': init.fieldMask } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Google Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function placeIdFor(spot: Spot): Promise<string | null> {
  if (placeIds.has(spot.id)) return placeIds.get(spot.id)!;
  const { places = [] } = await google<{
    places?: { id: string; location?: { latitude: number; longitude: number } }[];
  }>('/places:searchText', {
    method: 'POST',
    fieldMask: 'places.id,places.location',
    body: JSON.stringify({
      textQuery: `${spot.name}, EPFL, Ecublens`,
      languageCode: 'fr',
      maxResultCount: 3,
      locationBias: { circle: { center: { latitude: spot.lat, longitude: spot.lng }, radius: 300 } },
    }),
  });
  const match = places.find(
    (p) => p.location && haversine(spot, { lat: p.location.latitude, lng: p.location.longitude }) <= MAX_MATCH_DISTANCE_M,
  );
  placeIds.set(spot.id, match?.id ?? null);
  return match?.id ?? null;
}

interface RawAuthor {
  displayName?: string;
  uri?: string;
  photoUri?: string;
}

const attribution = (a: RawAuthor = {}): GoogleAttribution => ({
  name: a.displayName ?? 'Contributeur Google Maps',
  url: a.uri ?? null,
});

async function fetchPlace(spot: Spot): Promise<GooglePlaceResult> {
  if (!env.googleMapsKey) return { available: false, reason: 'not-configured' };
  try {
    const id = await placeIdFor(spot);
    if (!id) return { available: false, reason: 'not-found' };
    const place = await google<{
      rating?: number;
      userRatingCount?: number;
      googleMapsUri?: string;
      photos?: { name: string; widthPx: number; heightPx: number; authorAttributions?: RawAuthor[] }[];
      reviews?: {
        rating?: number;
        text?: { text?: string };
        originalText?: { text?: string };
        relativePublishTimeDescription?: string;
        authorAttribution?: RawAuthor;
      }[];
    }>(`/places/${encodeURIComponent(id)}?languageCode=fr`, { fieldMask: DETAILS_FIELDS });

    return {
      available: true,
      rating: place.rating ?? null,
      ratingCount: place.userRatingCount ?? 0,
      mapsUrl: place.googleMapsUri ?? null,
      photos: (place.photos ?? []).slice(0, 8).map((p) => ({
        name: p.name,
        width: p.widthPx,
        height: p.heightPx,
        attributions: (p.authorAttributions ?? []).map(attribution),
      })),
      reviews: (place.reviews ?? []).slice(0, 5).map((r) => ({
        author: { ...attribution(r.authorAttribution), photoUrl: r.authorAttribution?.photoUri ?? null },
        rating: r.rating ?? 0,
        text: r.text?.text ?? r.originalText?.text ?? '',
        when: r.relativePublishTimeDescription ?? '',
      })),
    };
  } catch (err) {
    console.error('[places]', err instanceof Error ? err.message : err);
    return { available: false, reason: 'error' };
  }
}

/** Détails Google d'un spot ; les requêtes simultanées pour un même spot sont regroupées. */
export function googlePlace(spot: Spot): Promise<GooglePlaceResult> {
  let pending = inflight.get(spot.id);
  if (!pending) {
    pending = fetchPlace(spot).finally(() => inflight.delete(spot.id));
    inflight.set(spot.id, pending);
  }
  return pending;
}

/**
 * URL publique d'une photo Google. La clé reste côté serveur : on ne
 * relaie que les photos du lieu associé au spot, pas n'importe quelle ressource.
 */
export async function googlePhotoUrl(spot: Spot, name: string, maxWidth: number): Promise<string> {
  if (!env.googleMapsKey) throw new HttpError(404, 'Photos Google non configurées.');
  const id = placeIds.get(spot.id) ?? (await placeIdFor(spot));
  if (!id || !name.startsWith(`places/${id}/photos/`) || !/^[\w/-]+$/.test(name)) {
    throw new HttpError(404, 'Photo introuvable.');
  }
  const width = Math.min(1600, Math.max(200, Math.round(maxWidth) || 800));
  const { photoUri } = await google<{ photoUri: string }>(`/${name}/media?maxWidthPx=${width}&skipHttpRedirect=true`);
  return photoUri;
}
