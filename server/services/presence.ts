import { all, nowIso, one, run } from '../db';
import { broadcast } from '../realtime';
import { publicUser } from './users';
import { SPOT_BY_ID } from '../../shared/catalog';
import type { LatLng } from '../../shared/geo';
import type { Presence, RouteStop, SpotActivity } from '../../shared/types';

/** Au-delà, un rusher qui n'a pas rafraîchi sa présence n'est plus affiché. */
const PRESENCE_TTL_MS = 90 * 60_000;
export const MAX_STOPS = 5;
const MAX_PATH_POINTS = 400;

interface PresenceRow {
  user_id: string;
  available: number;
  spot_id: string | null;
  route_json: string | null;
  updated_at: string;
}

/** Tout le monde peut livrer : sans réglage, on est disponible et sans trajet. */
const DEFAULT: Presence = { available: true, stops: [], path: null };

function parseRoute(json: string | null): Pick<Presence, 'stops' | 'path'> {
  if (!json) return { stops: [], path: null };
  try {
    const route = JSON.parse(json) as Pick<Presence, 'stops' | 'path'>;
    return { stops: route.stops ?? [], path: route.path ?? null };
  } catch {
    return { stops: [], path: null };
  }
}

export function getPresence(userId: string): Presence {
  const row = one<PresenceRow>('SELECT * FROM presence WHERE user_id = ?', userId);
  if (!row) return DEFAULT;
  return { available: row.available === 1, ...parseRoute(row.route_json) };
}

const round = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });

/** Nettoie le trajet reçu : étapes bornées, spot vérifié, tracé allégé. */
function cleanRoute(p: Presence): Pick<Presence, 'stops' | 'path'> {
  const stops: RouteStop[] = p.stops.slice(0, MAX_STOPS).map((s) => {
    const spot = s.spotId ? SPOT_BY_ID.get(s.spotId) : undefined;
    return spot
      ? { lat: spot.lat, lng: spot.lng, label: spot.name, spotId: spot.id }
      : { ...round(s), label: s.label.trim().slice(0, 60) || 'Étape', spotId: null };
  });
  let path = p.path && stops.length > 0 ? p.path.map(round) : null;
  // Un tracé trop détaillé : on garde un point sur n, extrémités comprises.
  if (path && path.length > MAX_PATH_POINTS) {
    const step = Math.ceil(path.length / MAX_PATH_POINTS);
    path = path.filter((_, i) => i % step === 0 || i === path!.length - 1);
  }
  return { stops, path: path && path.length > 1 ? path : null };
}

export function setPresence(userId: string, p: Presence): Presence {
  const route = cleanRoute(p);
  // Le premier spot du trajet : là où l'on mange, affiché sur la carte des spots.
  const spotId = route.stops.find((s) => s.spotId)?.spotId ?? null;
  run(
    `INSERT INTO presence (user_id, available, spot_id, route_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       available = excluded.available, spot_id = excluded.spot_id, route_json = excluded.route_json,
       updated_at = excluded.updated_at`,
    userId,
    p.available ? 1 : 0,
    spotId,
    route.stops.length ? JSON.stringify(route) : null,
    nowIso(),
  );
  broadcast({ type: 'activity.updated' });
  return getPresence(userId);
}

export function activity(): SpotActivity[] {
  const since = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
  const present = all<{ user_id: string; spot_id: string }>(
    'SELECT user_id, spot_id FROM presence WHERE available = 1 AND spot_id IS NOT NULL AND updated_at > ? ORDER BY updated_at DESC',
    since,
  );
  const open = all<{ spot_id: string; n: number }>(
    "SELECT spot_id, COUNT(*) AS n FROM orders WHERE status = 'open' GROUP BY spot_id",
  );

  const bySpot = new Map<string, SpotActivity>();
  const entry = (spotId: string) => {
    let e = bySpot.get(spotId);
    if (!e) bySpot.set(spotId, (e = { spotId, rushers: [], openRequests: 0 }));
    return e;
  };
  for (const p of present) entry(p.spot_id).rushers.push(publicUser(p.user_id));
  for (const o of open) entry(o.spot_id).openRequests = o.n;
  return [...bySpot.values()];
}
