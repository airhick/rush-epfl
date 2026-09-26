import { all, one } from '../db';
import { onlineUsers, sendTo } from '../realtime';
import { bus } from './bus';
import { countActive, MAX_ACTIVE_AS_COURIER, toOrder, type OrderRow } from './orders';
import { forgetOffers, markOffered, wasOffered } from './offerLog';
import { getPresence } from './presence';
import { publicUser } from './users';
import { SPOT_BY_ID } from '../../shared/catalog';
import { haversine, walkingMinutes, type LatLng } from '../../shared/geo';
import { evaluate, type CourierState } from '../../shared/matching';
import type { Offer, OrderItem, ServerEvent } from '../../shared/types';

/*
 * Offres en direct, façon Uber. Une demande est proposée aux rushers connectés
 * qui passent à côté du spot (ou dont le trajet y passe), dès sa publication,
 * puis à ceux qui s'en approchent ensuite. La position ne sert qu'à ça : elle
 * reste en mémoire, n'est jamais écrite en base ni montrée à qui que ce soit.
 */

/** Une position plus vieille ne compte plus : le rusher a pu partir. */
const POSITION_TTL_MS = 10 * 60_000;
/** On ne refait pas le calcul à chaque pas : 15 m ou 10 s suffisent. */
const RECHECK_MOVE_M = 15;
const RECHECK_EVERY_MS = 10_000;

const positions = new Map<string, LatLng & { at: number }>();
const lastCheck = new Map<string, LatLng & { at: number }>();

/** Envoi et liste des connectés : remplaçables dans les tests. */
let transport = { online: onlineUsers, send: sendTo };
export function setTransport(t: { online: () => string[]; send: (userId: string, event: ServerEvent) => void }) {
  transport = t;
}

export function courierState(userId: string, now = Date.now()): CourierState | null {
  const presence = getPresence(userId);
  if (!presence.available) return null;
  const pos = positions.get(userId);
  const position = pos && now - pos.at < POSITION_TTL_MS ? { lat: pos.lat, lng: pos.lng } : null;
  return { position, stops: presence.stops, path: presence.path };
}

/** L'offre telle que ce rusher la voit (distances depuis sa position), ou null si elle ne le concerne pas. */
export function offerFor(row: OrderRow, userId: string): Offer | null {
  if (row.status !== 'open' || row.requester_id === userId) return null;
  const spot = SPOT_BY_ID.get(row.spot_id);
  const courier = courierState(userId);
  if (!spot || !courier) return null;
  const dropoff = { lat: row.dropoff_lat, lng: row.dropoff_lng };
  const match = evaluate(courier, { pickup: spot, dropoff, rewardCents: row.tip_cents });
  if (!match?.reason) return null;
  if (countActive(userId, 'courier') >= MAX_ACTIVE_AS_COURIER) return null;
  return {
    orderId: row.id,
    spotId: row.spot_id,
    items: JSON.parse(row.items_json) as OrderItem[],
    advanceCents: row.items_cents,
    rewardCents: row.tip_cents,
    pickup: { meters: Math.round(match.toPickupM), minutes: walkingMinutes(match.toPickupM) },
    delivery: { ...dropoff, label: row.dropoff_label, meters: Math.round(match.deliveryM), minutes: walkingMinutes(match.deliveryM) },
    detourMeters: courier.stops.length ? Math.round(match.extraM) : null,
    reason: match.reason,
    requester: publicUser(row.requester_id),
    createdAt: row.created_at,
  };
}

function offer(row: OrderRow, userId: string): boolean {
  if (wasOffered(row.id, userId)) return false;
  const o = offerFor(row, userId);
  if (!o) return false;
  markOffered(row.id, userId);
  transport.send(userId, { type: 'offer', offer: o });
  return true;
}

/** Le demandeur voit combien de rushers ont été prévenus. */
function tellRequester(row: OrderRow) {
  transport.send(row.requester_id, { type: 'order.updated', order: toOrder(row, row.requester_id) });
}

/** Demande publiée (ou de nouveau ouverte) : offre à tous les rushers connectés concernés. */
export function dispatchOrder(orderId: string): number {
  const row = one<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
  if (!row || row.status !== 'open') return 0;
  let sent = 0;
  for (const userId of transport.online()) if (offer(row, userId)) sent++;
  if (sent) tellRequester(row);
  return sent;
}

/** Le rusher a bougé, changé de trajet ou s'est rendu disponible : les demandes ouvertes qui lui vont maintenant. */
export function recheck(userId: string): number {
  let sent = 0;
  for (const row of all<OrderRow>("SELECT * FROM orders WHERE status = 'open' AND requester_id != ? ORDER BY created_at", userId)) {
    if (offer(row, userId)) {
      sent++;
      tellRequester(row);
    }
  }
  return sent;
}

export function updatePosition(userId: string, lat: number, lng: number, now = Date.now()) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  const here = { lat, lng, at: now };
  positions.set(userId, here);
  const prev = lastCheck.get(userId);
  if (prev && now - prev.at < RECHECK_EVERY_MS && haversine(prev, here) < RECHECK_MOVE_M) return;
  lastCheck.set(userId, here);
  recheck(userId);
}

export function forgetPosition(userId: string) {
  positions.delete(userId);
  lastCheck.delete(userId);
}

bus.on('order.created', (id) => void dispatchOrder(id));
bus.on('order.released', (id) => {
  // De nouveau ouverte : on la repropose à tous les rushers concernés.
  forgetOffers(id);
  dispatchOrder(id);
});
for (const event of ['order.accepted', 'order.cancelled'] as const) bus.on(event, (id) => forgetOffers(id));
