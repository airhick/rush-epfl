import { haversine, walkingDistance, type LatLng } from './geo';

/*
 * Qui reçoit quelle course, et dans quel ordre.
 *
 * Une course, c'est « passer au spot, puis au point de livraison ». Pour un
 * rusher, on mesure la marche qu'elle AJOUTE à ce qu'il allait faire :
 *
 *   - avec un trajet déclaré (« je mange au FoodLab, puis je vais au BC ») :
 *     on insère spot puis livraison à la meilleure place du trajet (insertion
 *     la moins chère, le spot toujours avant la livraison) et on compte les
 *     mètres en plus. Une course FoodLab → BC ne coûte alors presque rien ;
 *   - sans trajet : la marche jusqu'au spot, puis jusqu'à la livraison.
 *
 * Offre en direct (notification) si le rusher est à moins de 100 m du spot, ou
 * si le spot est à moins de 100 m de son trajet et que le détour reste court.
 * Classement : rémunération par minute de marche ajoutée (+3 min pour l'achat
 * au comptoir), pour que « sur mon chemin » passe avant « mieux payé mais loin ».
 */

/** Un rusher à moins de 100 m du spot reçoit la course en direct. */
export const NEARBY_RADIUS_M = 100;
/** Un spot à moins de 100 m du trajet déclaré est sur le chemin… */
export const ROUTE_CORRIDOR_M = 100;
/** … tant que la course n'ajoute pas plus de 400 m de marche. */
export const MAX_ROUTE_DETOUR_M = 400;
/** En dessous de ce détour, la course est affichée « sur ton chemin ». */
export const ON_THE_WAY_M = 150;
/** Durée d'affichage d'une offre en direct avant qu'elle ne se range dans la liste. */
export const OFFER_TTL_MS = 45_000;

const WALK_M_PER_MIN = 80;
const PURCHASE_MIN = 3;
const M_PER_DEG = 111_320;

export interface CourierState {
  /** Position GPS récente, si connue. */
  position: LatLng | null;
  /** Étapes du trajet déclaré, dans l'ordre. */
  stops: LatLng[];
  /** Tracé à pied du trajet, s'il a été calculé. */
  path?: LatLng[] | null;
}

export interface Job {
  pickup: LatLng;
  dropoff: LatLng;
  rewardCents: number;
}

export interface Match {
  /** Pourquoi la course est proposée en direct ; null : visible dans la liste seulement. */
  reason: 'nearby' | 'route' | null;
  toPickupM: number;
  deliveryM: number;
  /** Marche ajoutée au trajet déclaré, ou marche totale sans trajet. */
  extraM: number;
  onTheWay: boolean;
  /** Plus c'est haut, plus la course vaut le coup pour ce rusher. */
  score: number;
}

/** Distance (m) d'un point à un segment, en projection locale : exacte à l'échelle d'un campus. */
export function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lng - p.lng) * k * M_PER_DEG;
  const ay = (a.lat - p.lat) * M_PER_DEG;
  const bx = (b.lng - p.lng) * k * M_PER_DEG;
  const by = (b.lat - p.lat) * M_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanceToPath(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversine(p, path[0]);
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) best = Math.min(best, distanceToSegment(p, path[i], path[i + 1]));
  return best;
}

/**
 * Marche ajoutée en insérant « spot puis livraison » dans le trajet `waypoints`
 * (le premier point est le départ). On essaie toutes les places, spot avant
 * livraison, et on garde la moins chère. Le trajet n'a pas de retour : insérer
 * après la dernière étape coûte simplement l'aller.
 */
export function insertionDetour(waypoints: LatLng[], pickup: LatLng, dropoff: LatLng): number {
  const d = walkingDistance;
  const last = waypoints.length - 1;
  if (last < 0) return Infinity;
  // Coût d'insertion d'un point entre l'étape i et la suivante.
  const between = (i: number, p: LatLng) =>
    i < last ? d(waypoints[i], p) + d(p, waypoints[i + 1]) - d(waypoints[i], waypoints[i + 1]) : d(waypoints[i], p);

  let best = Infinity;
  for (let i = 0; i <= last; i++) {
    // Spot et livraison à la suite, entre l'étape i et la suivante.
    const next = i < last ? waypoints[i + 1] : null;
    const together = d(waypoints[i], pickup) + d(pickup, dropoff) + (next ? d(dropoff, next) - d(waypoints[i], next) : 0);
    best = Math.min(best, together);
    // Spot après l'étape i, livraison plus loin après l'étape j.
    for (let j = i + 1; j <= last; j++) best = Math.min(best, between(i, pickup) + between(j, dropoff));
  }
  return Math.max(0, best);
}

export function evaluate(courier: CourierState, job: Job): Match | null {
  const waypoints = courier.position ? [courier.position, ...courier.stops] : courier.stops;
  const start = waypoints[0];
  if (!start) return null;

  const hasRoute = courier.stops.length > 0;
  const toPickupM = walkingDistance(start, job.pickup);
  const deliveryM = walkingDistance(job.pickup, job.dropoff);
  const extraM = hasRoute ? insertionDetour(waypoints, job.pickup, job.dropoff) : toPickupM + deliveryM;

  const nearby = courier.position !== null && haversine(courier.position, job.pickup) <= NEARBY_RADIUS_M;
  const path = courier.path && courier.path.length > 1 ? courier.path : waypoints;
  const onRoute = hasRoute && extraM <= MAX_ROUTE_DETOUR_M && distanceToPath(job.pickup, path) <= ROUTE_CORRIDOR_M;

  return {
    reason: nearby ? 'nearby' : onRoute ? 'route' : null,
    toPickupM,
    deliveryM,
    extraM,
    onTheWay: hasRoute && extraM <= ON_THE_WAY_M,
    score: job.rewardCents / (extraM / WALK_M_PER_MIN + PURCHASE_MIN),
  };
}

/** Classe des courses pour un rusher : meilleur rapport gain / marche ajoutée d'abord, puis la plus ancienne. */
export function rank<T extends Job & { createdAt: string }>(courier: CourierState, jobs: T[]): { job: T; match: Match | null }[] {
  return jobs
    .map((job) => ({ job, match: evaluate(courier, job) }))
    .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0) || a.job.createdAt.localeCompare(b.job.createdAt));
}
