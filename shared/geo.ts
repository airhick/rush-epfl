export interface LatLng {
  lat: number;
  lng: number;
}

/** Centre de gravité du campus (entre l'Esplanade et le Rolex Learning Center). */
export const EPFL_CENTER: LatLng = { lat: 46.5195, lng: 6.5662 };

/** Au-delà de ce rayon, on considère que la personne n'est pas sur le campus. */
export const CAMPUS_RADIUS_M = 2500;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distance orthodromique en mètres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Sur le campus, les chemins piétons ne sont jamais en ligne droite
 * (bâtiments, escaliers, passerelles). Un facteur de 1.25 colle bien
 * aux temps de marche réels entre deux bâtiments.
 */
const WALK_FACTOR = 1.25;
const WALK_SPEED_M_PER_MIN = 80;

export function walkingDistance(a: LatLng, b: LatLng): number {
  return haversine(a, b) * WALK_FACTOR;
}

export function walkingMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / WALK_SPEED_M_PER_MIN));
}

/**
 * Détour (en mètres de marche) qu'un rusher fait en prenant une commande.
 *
 *   sans commande : position → destination
 *   avec commande : position → spot → point de livraison → destination
 *
 * Sans destination déclarée, on compte l'aller simple position → spot →
 * livraison, ce qui correspond à « je suis au spot et je te l'amène ».
 */
export function detourMeters(opts: {
  from: LatLng;
  spot: LatLng;
  dropoff: LatLng;
  destination?: LatLng | null;
}): number {
  const { from, spot, dropoff, destination } = opts;
  const toSpot = walkingDistance(from, spot);
  const leg = walkingDistance(spot, dropoff);
  if (!destination) return toSpot + leg;
  const direct = walkingDistance(from, destination);
  const withOrder = toSpot + leg + walkingDistance(dropoff, destination);
  return Math.max(0, withOrder - direct);
}

export function isOnCampus(p: LatLng): boolean {
  return haversine(p, EPFL_CENTER) <= CAMPUS_RADIUS_M;
}

/** Interpolation linéaire, utilisée pour les positions simulées des rushers de démo. */
export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
