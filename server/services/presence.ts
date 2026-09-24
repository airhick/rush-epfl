import { all, nowIso, one, run } from '../db';
import { broadcast } from '../realtime';
import { publicUser } from './users';
import { SPOT_BY_ID } from '../../shared/catalog';
import type { Presence, SpotActivity } from '../../shared/types';

/** Au-delà, un rusher qui n'a pas rafraîchi sa présence n'est plus affiché. */
const PRESENCE_TTL_MS = 90 * 60_000;

interface PresenceRow {
  user_id: string;
  available: number;
  spot_id: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  dest_label: string | null;
  updated_at: string;
}

export function getPresence(userId: string): Presence {
  const row = one<PresenceRow>('SELECT * FROM presence WHERE user_id = ?', userId);
  if (!row) return { available: false, spotId: null, destination: null };
  return {
    available: row.available === 1,
    spotId: row.spot_id,
    destination:
      row.dest_lat !== null && row.dest_lng !== null
        ? { lat: row.dest_lat, lng: row.dest_lng, label: row.dest_label ?? '' }
        : null,
  };
}

export function setPresence(userId: string, p: Presence) {
  const spotId = p.spotId && SPOT_BY_ID.has(p.spotId) ? p.spotId : null;
  run(
    `INSERT INTO presence (user_id, available, spot_id, dest_lat, dest_lng, dest_label, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       available = excluded.available, spot_id = excluded.spot_id, dest_lat = excluded.dest_lat,
       dest_lng = excluded.dest_lng, dest_label = excluded.dest_label, updated_at = excluded.updated_at`,
    userId,
    p.available ? 1 : 0,
    spotId,
    p.destination?.lat ?? null,
    p.destination?.lng ?? null,
    p.destination?.label?.slice(0, 60) ?? null,
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
