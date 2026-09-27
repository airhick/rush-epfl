import { BUILDINGS, SPOTS } from '../../shared/catalog';
import { EPFL_CENTER, walkingDistance, walkingMinutes, type LatLng } from '../../shared/geo';
import type { PlaceResult, WalkingRoute } from '../../shared/types';

/*
 * Recherche de lieux et itinéraire à pied pour le trajet des rushers.
 * Le campus d'abord (spots et bâtiments, sans réseau), puis les adresses
 * autour de l'EPFL via Photon (OpenStreetMap). L'itinéraire vient d'OSRM
 * (profil piéton d'OpenStreetMap). Si l'un de ces services ne répond pas,
 * on retombe sur le campus seul et des lignes droites : le trajet sert à
 * trouver des courses « à peu près sur le chemin », pas à guider au mètre.
 */

const PHOTON = 'https://photon.komoot.io/api/';
const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
/** Ouest lausannois : EPFL, UNIL, Écublens, Renens, Lausanne. */
const BBOX = '6.45,46.47,6.72,46.58';
const HEADERS = { 'user-agent': 'Rush-EPFL/1.0 (livraison entre membres de l’EPFL)' };
const TIMEOUT_MS = 3500;
const CACHE_MS = 60 * 60_000;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Petit cache mémoire borné, pour ne pas solliciter les services publics à chaque frappe. */
function cache<T>(max = 400) {
  const map = new Map<string, { at: number; value: T }>();
  return {
    get: (k: string) => {
      const hit = map.get(k);
      return hit && Date.now() - hit.at < CACHE_MS ? hit.value : undefined;
    },
    set: (k: string, value: T) => {
      if (map.size >= max) map.delete(map.keys().next().value!);
      map.set(k, { at: Date.now(), value });
    },
  };
}

const searchCache = cache<PlaceResult[]>();
const routeCache = cache<WalkingRoute>();

/** Spots et bâtiments du campus dont le nom (ou l'indication) contient la recherche. */
export function searchCampus(query: string): PlaceResult[] {
  const q = fold(query);
  if (!q) return [];
  const score = (name: string, extra: string) => {
    const n = fold(name);
    if (n === q) return 3;
    if (n.startsWith(q)) return 2;
    return n.includes(q) || fold(extra).includes(q) ? 1 : 0;
  };
  const spots = SPOTS.map((s) => ({ s, k: score(s.name, `${s.place} ${s.tagline}`) }))
    .filter((x) => x.k > 0)
    .map(({ s, k }) => ({ k, r: { id: `spot:${s.id}`, label: s.name, detail: s.place, kind: 'spot' as const, spotId: s.id, lat: s.lat, lng: s.lng } }));
  const buildings = BUILDINGS.map((b) => ({ b, k: score(b.name, b.hint) }))
    .filter((x) => x.k > 0)
    .map(({ b, k }) => ({ k, r: { id: `building:${b.id}`, label: b.name, detail: b.hint, kind: 'building' as const, spotId: null, lat: b.lat, lng: b.lng } }));
  return [...spots, ...buildings]
    .sort((a, b) => b.k - a.k)
    .slice(0, 6)
    .map((x) => x.r);
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    district?: string;
  };
}

async function searchAddresses(query: string): Promise<PlaceResult[]> {
  const url = `${PHOTON}?${new URLSearchParams({ q: query, lat: String(EPFL_CENTER.lat), lon: String(EPFL_CENTER.lng), limit: '6', lang: 'fr', bbox: BBOX })}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const { features } = (await res.json()) as { features: PhotonFeature[] };
  return features.map((f) => {
    const p = f.properties;
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const label = p.name ?? (street || p.city || 'Adresse');
    const detail = [p.name ? street : '', [p.postcode, p.city ?? p.district].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const [lng, lat] = f.geometry.coordinates;
    return { id: `osm:${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lng}`}`, label, detail, kind: 'address' as const, spotId: null, lat, lng };
  });
}

export async function search(query: string): Promise<PlaceResult[]> {
  const q = query.trim().slice(0, 80);
  if (!q) return [];
  const key = fold(q);
  const cached = searchCache.get(key);
  if (cached) return cached;
  const campus = searchCampus(q);
  let addresses: PlaceResult[] = [];
  if (q.length >= 3) {
    try {
      addresses = await searchAddresses(q);
    } catch (err) {
      console.warn(`[lieux] recherche d’adresse indisponible : ${(err as Error).message}`);
    }
  }
  // Une adresse à quelques mètres d'un spot ou d'un bâtiment déjà listé fait doublon.
  const results = [...campus, ...addresses.filter((a) => !campus.some((c) => walkingDistance(a, c) < 40))].slice(0, 8);
  searchCache.set(key, results);
  return results;
}

const straight = (points: LatLng[]): WalkingRoute => {
  const meters = points.slice(1).reduce((sum, p, i) => sum + walkingDistance(points[i], p), 0);
  return { path: null, meters: Math.round(meters), minutes: walkingMinutes(meters) };
};

/** Itinéraire à pied passant par les points dans l'ordre ; lignes droites si le service ne répond pas. */
export async function walkingRoute(points: LatLng[]): Promise<WalkingRoute> {
  const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const cached = routeCache.get(coords);
  if (cached) return cached;
  try {
    const res = await fetch(`${OSRM_FOOT}${coords}?overview=full&geometries=geojson`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = (await res.json()) as { code: string; routes?: { distance: number; geometry: { coordinates: [number, number][] } }[] };
    const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
    if (!route) throw new Error(`OSRM ${data.code}`);
    const result: WalkingRoute = {
      path: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      meters: Math.round(route.distance),
      minutes: walkingMinutes(route.distance),
    };
    routeCache.set(coords, result);
    return result;
  } catch (err) {
    console.warn(`[lieux] itinéraire à pied indisponible : ${(err as Error).message}`);
    return straight(points);
  }
}
