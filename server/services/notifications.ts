import { one } from '../db';
import { bus } from './bus';
import type { OrderRow } from './orders';
import { notify } from './push';
import { getUser } from './users';
import { SPOT_BY_ID } from '../../shared/catalog';
import { formatCHF } from '../../shared/money';
import type { PushMessage } from '../../shared/types';

/*
 * Notifications push des étapes d'une commande et des messages, pour ceux qui
 * n'ont pas l'app à l'écran (les autres voient déjà le toast dans l'app).
 * Les courses proposées aux rushers partent de services/dispatch.ts.
 */

const spotName = (row: OrderRow) => SPOT_BY_ID.get(row.spot_id)?.name ?? 'le spot';
const firstName = (userId: string | null, fallback: string) => (userId && getUser(userId)?.first_name) || fallback;

type OrderEvent = 'order.accepted' | 'order.picked_up' | 'order.delivered' | 'order.released' | 'order.completed' | 'order.cancelled';

function onOrder(event: OrderEvent, build: (row: OrderRow) => { to: string | null; title: string; body: string } | null) {
  bus.on(event, (orderId) => {
    try {
      const row = one<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
      const n = row && build(row);
      if (!n?.to) return;
      const message: PushMessage = { title: n.title, body: n.body, url: `/orders/${orderId}`, tag: `order-${orderId}`, kind: 'order' };
      void notify(n.to, message);
    } catch (err) {
      console.warn(`[push] ${event} : ${(err as Error).message}`);
    }
  });
}

onOrder('order.accepted', (row) => ({
  to: row.requester_id,
  title: `${firstName(row.courier_id, 'Un rusher')} a accepté ta demande`,
  body: `Direction ${spotName(row)}.`,
}));

onOrder('order.picked_up', (row) => ({
  to: row.requester_id,
  title: `${firstName(row.courier_id, 'Ton rusher')} a tes articles`,
  body: `Ticket de ${formatCHF(row.actual_items_cents ?? row.items_cents)} · en route vers ${row.dropoff_label}.`,
}));

onOrder('order.delivered', (row) => ({
  to: row.requester_id,
  title: `${firstName(row.courier_id, 'Ton rusher')} est arrivé·e`,
  body: `Au point de livraison (${row.dropoff_label}). Confirme la réception pour le/la payer.`,
}));

onOrder('order.released', (row) => ({
  to: row.requester_id,
  title: 'Ton rusher s’est désisté',
  body: 'Ta demande est de nouveau proposée aux rushers proches.',
}));

onOrder('order.completed', (row) => ({
  to: row.courier_id,
  title: 'Livraison confirmée',
  body: `${formatCHF((row.actual_items_cents ?? row.items_cents) + row.tip_cents)} crédités sur ton solde.`,
}));

onOrder('order.cancelled', (row) =>
  row.cancel_reason === 'expired'
    ? { to: row.requester_id, title: 'Demande expirée', body: `Personne n’a pu passer par ${spotName(row)}. Le montant t’a été rendu.` }
    : null,
);

bus.on('message.created', (m) => {
  if (m.kind !== 'text' || !m.senderId) return;
  try {
    const row = one<OrderRow>('SELECT * FROM orders WHERE id = ?', m.orderId);
    if (!row) return;
    const to = row.requester_id === m.senderId ? row.courier_id : row.requester_id;
    if (!to) return;
    // Même tag par conversation : les messages d'une même commande se remplacent au lieu de s'empiler.
    void notify(to, {
      title: firstName(m.senderId, 'Nouveau message'),
      body: m.body.slice(0, 180),
      url: `/messages/${m.orderId}`,
      tag: `chat-${m.orderId}`,
      kind: 'message',
    });
  } catch (err) {
    console.warn(`[push] message : ${(err as Error).message}`);
  }
});
