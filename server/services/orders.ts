import { randomUUID } from 'node:crypto';
import { all, nowIso, one, run, transaction } from '../db';
import { HttpError } from '../http';
import { broadcast, sendTo } from '../realtime';
import { bus } from './bus';
import { debit, record } from './ledger';
import { systemMessage } from './messages';
import { getUser, invalidatePublicUser, publicUser } from './users';
import { CUSTOM_ITEM_ID, SPOT_BY_ID, findItem, isOrderable, type MenuSection } from '../../shared/catalog';
import { openStatus } from '../../shared/hours';
import { BONUS_MAX_CENTS, computeHold, maxActualItems, settle } from '../../shared/pricing';
import { offeredCount } from './offerLog';
import { formatCHF } from '../../shared/money';
import { ACTIVE_STATUSES, type Dropoff, type Order, type OrderItem, type OrderStatus } from '../../shared/types';

export interface OrderRow {
  id: string;
  requester_id: string;
  courier_id: string | null;
  spot_id: string;
  items_json: string;
  items_cents: number;
  /** Ancienne marge de sécurité, toujours 0 désormais. */
  margin_cents: number;
  /** Rémunération du rusher : tarif + coup de pouce. */
  tip_cents: number;
  /** Tarif seul (CHF 0.50 par tranche de CHF 5). */
  suggested_tip_cents: number;
  hold_cents: number;
  actual_items_cents: number | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_label: string;
  dropoff_note: string;
  status: OrderStatus;
  courier_lat: number | null;
  courier_lng: number | null;
  courier_loc_at: string | null;
  created_at: string;
  accepted_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  rating_for_courier: number | null;
  rating_for_requester: number | null;
}

/** Une demande sans rusher expire après ce délai et le montant est rendu. */
export const OPEN_TTL_MS = 40 * 60_000;
/** Sans confirmation du demandeur, une livraison est validée automatiquement. */
export const DELIVERED_TTL_MS = 15 * 60_000;
const MAX_ACTIVE_AS_REQUESTER = 3;
export const MAX_ACTIVE_AS_COURIER = 2;

const spotName = (row: OrderRow) => SPOT_BY_ID.get(row.spot_id)?.name ?? 'Spot';
const firstName = (userId: string) => getUser(userId)?.first_name ?? 'Quelqu’un';

export function getRow(id: string): OrderRow {
  const row = one<OrderRow>('SELECT * FROM orders WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Commande introuvable.');
  return row;
}

export function toOrder(row: OrderRow, viewerId: string): Order {
  const myRole = row.requester_id === viewerId ? 'requester' : row.courier_id === viewerId ? 'courier' : null;
  const participant = myRole !== null;
  return {
    id: row.id,
    status: row.status,
    spotId: row.spot_id,
    items: JSON.parse(row.items_json) as OrderItem[],
    itemsCents: row.items_cents,
    // Anciennes commandes (pourboire libre) : jamais de coup de pouce négatif.
    feeCents: row.tip_cents - Math.max(0, row.tip_cents - row.suggested_tip_cents),
    bonusCents: Math.max(0, row.tip_cents - row.suggested_tip_cents),
    rewardCents: row.tip_cents,
    holdCents: row.hold_cents,
    actualItemsCents: row.actual_items_cents,
    dropoff: {
      lat: row.dropoff_lat,
      lng: row.dropoff_lng,
      label: row.dropoff_label,
      // La salle ou l'étage ne sont partagés qu'avec le rusher qui a accepté.
      note: participant ? row.dropoff_note : '',
    },
    requester: publicUser(row.requester_id),
    courier: row.courier_id ? publicUser(row.courier_id) : null,
    courierLocation:
      participant && row.courier_lat !== null && row.courier_lng !== null && row.courier_loc_at
        ? { lat: row.courier_lat, lng: row.courier_lng, at: row.courier_loc_at }
        : null,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    myRole,
    myRating: myRole === 'requester' ? row.rating_for_courier : myRole === 'courier' ? row.rating_for_requester : null,
    offeredTo: myRole === 'requester' && row.status === 'open' ? offeredCount(row.id) : null,
  };
}

export function orderFor(id: string, viewerId: string): Order {
  const row = getRow(id);
  const participant = row.requester_id === viewerId || row.courier_id === viewerId;
  if (!participant && row.status !== 'open') throw new HttpError(403, 'Cette commande ne te concerne pas.');
  return toOrder(row, viewerId);
}

export function listMine(userId: string): Order[] {
  return all<OrderRow>(
    `SELECT * FROM orders WHERE requester_id = ?1 OR courier_id = ?1
     ORDER BY CASE WHEN status IN ('open','accepted','picked_up','delivered') THEN 0 ELSE 1 END, created_at DESC
     LIMIT 60`,
    userId,
  ).map((r) => toOrder(r, userId));
}

export function listOpen(viewerId: string): Order[] {
  return all<OrderRow>("SELECT * FROM orders WHERE status = 'open' AND requester_id != ? ORDER BY created_at DESC", viewerId).map(
    (r) => toOrder(r, viewerId),
  );
}

export function countActive(userId: string, role: 'requester' | 'courier'): number {
  const col = role === 'requester' ? 'requester_id' : 'courier_id';
  const statuses = role === 'requester' ? ACTIVE_STATUSES : ACTIVE_STATUSES.filter((s) => s !== 'open');
  return one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM orders WHERE ${col} = ? AND status IN (${statuses.map(() => '?').join(',')})`,
    userId,
    ...statuses,
  )!.n;
}

/** Pousse l'état à jour aux deux participants et prévient le fil des rushers si besoin. */
function publish(row: OrderRow, feedChanged: 'opened' | 'closed' | null = null) {
  for (const userId of [row.requester_id, row.courier_id]) {
    if (userId) sendTo(userId, { type: 'order.updated', order: toOrder(row, userId) });
  }
  if (feedChanged === 'opened') broadcast({ type: 'order.opened', orderId: row.id });
  if (feedChanged === 'closed') broadcast({ type: 'order.closed', orderId: row.id });
  if (feedChanged) broadcast({ type: 'activity.updated' });
}

function walletChanged(...userIds: (string | null)[]) {
  for (const id of userIds) if (id) sendTo(id, { type: 'wallet.updated' });
}

function expectStatus(row: OrderRow, ...allowed: OrderStatus[]) {
  if (!allowed.includes(row.status)) {
    throw new HttpError(409, 'Cette commande a changé entre-temps. Actualise pour voir son état.');
  }
}

export interface CreateOrderInput {
  spotId: string;
  items: { itemId: string; qty: number }[];
  /** Demande libre : texte et budget plafond (bornés par la validation de l'API). */
  custom?: { text: string; budgetCents: number } | null;
  dropoff: Dropoff;
  /** Coup de pouce facultatif, en plus du tarif calculé ici. */
  bonusCents?: number;
}

/**
 * `menu` est le menu du jour résolu côté serveur (offre EPFL + carte fixe) :
 * les prix ne viennent jamais du navigateur.
 */
export function createOrder(requesterId: string, input: CreateOrderInput, now = new Date(), menu?: MenuSection[]): Order {
  const spot = SPOT_BY_ID.get(input.spotId);
  if (!spot) throw new HttpError(404, 'Spot inconnu.');
  if (!openStatus(spot.hours, now).open) throw new HttpError(422, `${spot.name} est fermé pour le moment.`);
  const sections = menu ?? spot.menu;

  const merged = new Map<string, number>();
  for (const { itemId, qty } of input.items) merged.set(itemId, (merged.get(itemId) ?? 0) + qty);

  const items: OrderItem[] = [];
  for (const [itemId, qty] of merged) {
    const item = findItem(sections, itemId);
    if (!item) throw new HttpError(422, 'Un plat n’est plus au menu du jour. Retire-le de ta demande.');
    if (!isOrderable(item)) throw new HttpError(422, `${item.name} n’a pas de prix fixe : passe par une demande libre.`);
    items.push({ id: item.id, name: item.name, qty, priceCents: item.priceCents });
  }
  if (input.custom) {
    items.push({ id: CUSTOM_ITEM_ID, name: input.custom.text.trim(), qty: 1, priceCents: input.custom.budgetCents, custom: true });
  }
  const itemCount = items.reduce((n, i) => n + i.qty, 0);
  if (itemCount === 0) throw new HttpError(422, 'Ton panier est vide.');
  if (itemCount > 12) throw new HttpError(422, 'Pas plus de 12 articles par demande : pense au rusher !');

  const bonusCents = Math.round(input.bonusCents ?? 0);
  if (!(bonusCents >= 0 && bonusCents <= BONUS_MAX_CENTS)) {
    throw new HttpError(422, 'Le coup de pouce doit être compris entre CHF 0 et CHF 10.');
  }

  // Le tarif est toujours calculé ici, jamais repris du navigateur.
  const itemsCents = items.reduce((s, i) => s + i.priceCents * i.qty, 0);
  const hold = computeHold(itemsCents, bonusCents);
  const id = randomUUID();

  const row = transaction(() => {
    if (countActive(requesterId, 'requester') >= MAX_ACTIVE_AS_REQUESTER) {
      throw new HttpError(429, 'Tu as déjà 3 demandes en cours.');
    }
    run(
      `INSERT INTO orders (id, requester_id, spot_id, items_json, items_cents, margin_cents, tip_cents, suggested_tip_cents,
         hold_cents, dropoff_lat, dropoff_lng, dropoff_label, dropoff_note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      id,
      requesterId,
      spot.id,
      JSON.stringify(items),
      itemsCents,
      0,
      hold.rewardCents,
      hold.feeCents,
      hold.holdCents,
      input.dropoff.lat,
      input.dropoff.lng,
      input.dropoff.label.slice(0, 60),
      input.dropoff.note.slice(0, 140),
      now.toISOString(),
    );
    debit(requesterId, 'hold', hold.holdCents, `Réservation · ${spot.name}`, id);
    return getRow(id);
  });

  publish(row, 'opened');
  walletChanged(requesterId);
  bus.emit('order.created', id);
  return toOrder(row, requesterId);
}

export function accept(orderId: string, courierId: string): Order {
  const row = transaction(() => {
    const row = getRow(orderId);
    if (row.requester_id === courierId) throw new HttpError(403, 'Tu ne peux pas livrer ta propre demande.');
    expectStatus(row, 'open');
    if (countActive(courierId, 'courier') >= MAX_ACTIVE_AS_COURIER) {
      throw new HttpError(429, 'Termine tes livraisons en cours avant d’en prendre une autre.');
    }
    run("UPDATE orders SET status = 'accepted', courier_id = ?, accepted_at = ? WHERE id = ?", courierId, nowIso(), orderId);
    return getRow(orderId);
  });
  systemMessage(orderId, `${firstName(courierId)} a accepté la demande et s’occupe de ${spotName(row)}.`);
  publish(row, 'closed');
  bus.emit('order.accepted', orderId);
  return toOrder(row, courierId);
}

/** Le rusher se désiste avant l'achat : la demande retourne dans le fil. */
export function release(orderId: string, courierId: string): Order {
  const before = getRow(orderId);
  if (before.courier_id !== courierId) throw new HttpError(403, 'Tu ne livres pas cette commande.');
  expectStatus(before, 'accepted');
  run(
    "UPDATE orders SET status = 'open', courier_id = NULL, accepted_at = NULL, courier_lat = NULL, courier_lng = NULL, courier_loc_at = NULL WHERE id = ?",
    orderId,
  );
  const row = getRow(orderId);
  systemMessage(orderId, `${firstName(courierId)} s’est désisté·e. Ta demande est de nouveau visible par les rushers.`);
  publish(row, 'opened');
  // L'ancien rusher n'est plus participant : on lui envoie une dernière mise à jour.
  sendTo(courierId, { type: 'order.updated', order: toOrder(row, courierId) });
  bus.emit('order.released', orderId);
  return toOrder(row, courierId);
}

export function pickUp(orderId: string, courierId: string, actualItemsCents: number): Order {
  const before = getRow(orderId);
  if (before.courier_id !== courierId) throw new HttpError(403, 'Tu ne livres pas cette commande.');
  expectStatus(before, 'accepted');
  const max = maxActualItems({ holdCents: before.hold_cents, rewardCents: before.tip_cents });
  if (!Number.isInteger(actualItemsCents) || actualItemsCents <= 0) throw new HttpError(422, 'Montant du ticket invalide.');
  if (actualItemsCents > max) {
    throw new HttpError(422, `Le ticket dépasse le montant réservé (max ${formatCHF(max)}). Écris au demandeur.`);
  }
  run("UPDATE orders SET status = 'picked_up', actual_items_cents = ?, picked_up_at = ? WHERE id = ?", actualItemsCents, nowIso(), orderId);
  const row = getRow(orderId);
  systemMessage(orderId, `Articles achetés · ticket de ${formatCHF(actualItemsCents)}. En route !`);
  publish(row);
  bus.emit('order.picked_up', orderId);
  return toOrder(row, courierId);
}

export function markDelivered(orderId: string, courierId: string): Order {
  const before = getRow(orderId);
  if (before.courier_id !== courierId) throw new HttpError(403, 'Tu ne livres pas cette commande.');
  expectStatus(before, 'picked_up');
  run("UPDATE orders SET status = 'delivered', delivered_at = ? WHERE id = ?", nowIso(), orderId);
  const row = getRow(orderId);
  systemMessage(orderId, `${firstName(courierId)} est arrivé·e au point de livraison.`);
  publish(row);
  bus.emit('order.delivered', orderId);
  return toOrder(row, courierId);
}

/** Le demandeur confirme la réception : on règle le rusher et on rend le reste. */
export function confirm(orderId: string, requesterId: string, auto = false): Order {
  const row = transaction(() => {
    const row = getRow(orderId);
    if (row.requester_id !== requesterId) throw new HttpError(403, 'Seul le demandeur peut confirmer la réception.');
    expectStatus(row, 'delivered');
    const { courierCents, refundCents } = settle({
      holdCents: row.hold_cents,
      rewardCents: row.tip_cents,
      actualItemsCents: row.actual_items_cents ?? row.items_cents,
    });
    const spot = spotName(row);
    record(row.courier_id!, 'payout', courierCents, `Livraison · ${spot}`, orderId);
    record(requesterId, 'refund', refundCents, `Non utilisé · ${spot}`, orderId);
    run("UPDATE orders SET status = 'completed', completed_at = ? WHERE id = ?", nowIso(), orderId);
    return getRow(orderId);
  });
  invalidatePublicUser(row.courier_id!);
  const paid = formatCHF((row.actual_items_cents ?? row.items_cents) + row.tip_cents);
  systemMessage(
    orderId,
    auto
      ? `Livraison validée automatiquement. ${paid} versés à ${firstName(row.courier_id!)}.`
      : `Réception confirmée. ${paid} versés à ${firstName(row.courier_id!)}.`,
  );
  publish(row);
  walletChanged(row.requester_id, row.courier_id);
  bus.emit('order.completed', orderId);
  return toOrder(row, requesterId);
}

export function cancel(orderId: string, requesterId: string, reason: 'requester' | 'expired' = 'requester'): Order {
  const row = transaction(() => {
    const row = getRow(orderId);
    if (row.requester_id !== requesterId) throw new HttpError(403, 'Seul le demandeur peut annuler.');
    if (row.status !== 'open') {
      throw new HttpError(409, 'Un rusher a déjà accepté. Écris-lui pour qu’il se désiste avant d’annuler.');
    }
    record(requesterId, 'release', row.hold_cents, `Annulation · ${spotName(row)}`, orderId);
    run("UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE id = ?", nowIso(), reason, orderId);
    return getRow(orderId);
  });
  publish(row, 'closed');
  walletChanged(requesterId);
  bus.emit('order.cancelled', orderId);
  return toOrder(row, requesterId);
}

export function rate(orderId: string, userId: string, stars: number): Order {
  const row = getRow(orderId);
  expectStatus(row, 'completed');
  if (row.requester_id === userId) {
    if (row.rating_for_courier !== null) throw new HttpError(409, 'Tu as déjà noté cette livraison.');
    run('UPDATE orders SET rating_for_courier = ? WHERE id = ?', stars, orderId);
    invalidatePublicUser(row.courier_id!);
  } else if (row.courier_id === userId) {
    if (row.rating_for_requester !== null) throw new HttpError(409, 'Tu as déjà noté cette livraison.');
    run('UPDATE orders SET rating_for_requester = ? WHERE id = ?', stars, orderId);
    invalidatePublicUser(row.requester_id);
  } else {
    throw new HttpError(403, 'Cette commande ne te concerne pas.');
  }
  const updated = getRow(orderId);
  publish(updated);
  return toOrder(updated, userId);
}

export function updateCourierLocation(orderId: string, courierId: string, lat: number, lng: number) {
  const row = one<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
  if (!row || row.courier_id !== courierId || !['accepted', 'picked_up'].includes(row.status)) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const at = nowIso();
  run('UPDATE orders SET courier_lat = ?, courier_lng = ?, courier_loc_at = ? WHERE id = ?', lat, lng, at, orderId);
  sendTo(row.requester_id, { type: 'courier.location', orderId, lat, lng, at });
}

/** Expire les demandes oubliées et valide les livraisons non confirmées. */
export function sweep(now = Date.now()) {
  const openBefore = new Date(now - OPEN_TTL_MS).toISOString();
  for (const row of all<OrderRow>("SELECT * FROM orders WHERE status = 'open' AND created_at < ?", openBefore)) {
    cancel(row.id, row.requester_id, 'expired');
    sendTo(row.requester_id, {
      type: 'toast',
      title: 'Demande expirée',
      body: `Personne n’a pu passer par ${spotName(row)}. Le montant t’a été rendu.`,
      orderId: row.id,
    });
  }
  const deliveredBefore = new Date(now - DELIVERED_TTL_MS).toISOString();
  for (const row of all<OrderRow>("SELECT * FROM orders WHERE status = 'delivered' AND delivered_at < ?", deliveredBefore)) {
    confirm(row.id, row.requester_id, true);
  }
}
