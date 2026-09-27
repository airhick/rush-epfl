import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db';
import { env } from '../server/env';
import { HttpError } from '../server/http';
import { createUser } from '../server/services/users';
import { record } from '../server/services/ledger';
import * as orders from '../server/services/orders';
import * as dispatch from '../server/services/dispatch';
import { addMessage } from '../server/services/messages';
import { getPresence, ROUTE_TTL_MS, setPresence } from '../server/services/presence';
import { hasPush, notify, setPushSender, subscribe, type Subscription } from '../server/services/push';
import '../server/services/notifications';
import { SPOT_BY_ID } from '../shared/catalog';
import type { PushMessage } from '../shared/types';

env.vapidPublicKey = 'BPublicKeyForTests';
env.vapidPrivateKey = 'privateKeyForTests';

const NOON = new Date('2026-01-15T11:00:00Z');
const gina = SPOT_BY_ID.get('gina')!;
const CO = { lat: 46.5201, lng: 6.5652 };

let sent: { endpoint: string; message: PushMessage; ttl?: number }[] = [];
let failWith: number | null = null;
setPushSender(async (sub, payload, options) => {
  if (failWith) throw Object.assign(new Error('refusé'), { statusCode: failWith });
  sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload), ttl: options.TTL });
});

let n = 0;
const device = (id = ++n): Subscription => ({ endpoint: `https://fcm.googleapis.com/fcm/send/appareil-${id}`, keys: { p256dh: 'BCléPubliqueDuNavigateur', auth: 'secretAuth' } });
const person = (withPush = true) => {
  const u = createUser(`push.user${++n}@epfl.ch`);
  if (withPush) subscribe(u.id, device());
  return u;
};
const to = (userId: string) => {
  const endpoints = new Set(db.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ?').all(userId).map((r) => (r as { endpoint: string }).endpoint));
  return sent.filter((s) => endpoints.has(s.endpoint)).map((s) => s.message);
};
const request = (requesterId: string) => {
  record(requesterId, 'bonus', 3000, 'Test');
  return orders.createOrder(
    requesterId,
    { spotId: 'gina', items: [], custom: { text: 'Une margherita', budgetCents: 1400 }, dropoff: { ...CO, label: 'CO', note: '' } },
    NOON,
  );
};

beforeEach(() => {
  db.exec('DELETE FROM push_subscriptions; DELETE FROM messages; DELETE FROM transactions; DELETE FROM orders; DELETE FROM presence; DELETE FROM users;');
  sent = [];
  failWith = null;
  dispatch.setTransport({ online: () => [], send: () => undefined });
});

describe('notifications push', () => {
  it('n’accepte que les services push des navigateurs', () => {
    const u = person(false);
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/push', 'https://127.0.0.1/push', 'pas une url']) {
      expect(() => subscribe(u.id, { ...device(), endpoint })).toThrow(HttpError);
    }
    for (const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/QK1', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
      subscribe(u.id, { ...device(), endpoint });
    }
    expect(hasPush(u.id)).toBe(true);
  });

  it('envoie à tous les appareils du compte et oublie ceux qui ont révoqué l’abonnement', async () => {
    const u = person();
    subscribe(u.id, device());
    const message: PushMessage = { title: 'Test', body: 'Corps', url: '/', tag: 't', kind: 'order' };
    expect(await notify(u.id, message)).toBe(2);
    failWith = 410;
    expect(await notify(u.id, message)).toBe(0);
    expect(hasPush(u.id)).toBe(false);
  });

  it('prévient le demandeur à chaque étape, et le rusher quand il est payé', async () => {
    const alice = person();
    const bob = person();
    const order = request(alice.id);
    orders.accept(order.id, bob.id);
    orders.pickUp(order.id, bob.id, 1250);
    orders.markDelivered(order.id, bob.id);
    orders.confirm(order.id, alice.id);
    await new Promise((r) => setTimeout(r, 10));
    expect(to(alice.id).map((m) => m.title)).toEqual([
      expect.stringContaining('a accepté ta demande'),
      expect.stringContaining('a tes articles'),
      expect.stringContaining('est arrivé·e'),
    ]);
    expect(to(alice.id)[0]).toMatchObject({ url: `/orders/${order.id}`, kind: 'order' });
    expect(to(bob.id).at(-1)).toMatchObject({ title: 'Livraison confirmée', body: expect.stringContaining('14.00') });
  });

  it('transmet les messages à l’autre participant, regroupés par conversation', async () => {
    const alice = person();
    const bob = person();
    const order = request(alice.id);
    orders.accept(order.id, bob.id);
    sent = [];
    addMessage(order.id, bob.id, 'Il n’y a plus de margherita, une regina ?');
    await new Promise((r) => setTimeout(r, 10));
    expect(to(alice.id)).toEqual([
      { title: expect.any(String), body: 'Il n’y a plus de margherita, une regina ?', url: `/messages/${order.id}`, tag: `chat-${order.id}`, kind: 'message' },
    ]);
    expect(to(bob.id)).toHaveLength(0);
  });

  it('propose la course par push à un rusher qui a l’app fermée, s’il est sur le chemin', async () => {
    const alice = person();
    const eva = person();
    setPresence(eva.id, {
      available: true,
      stops: [
        { lat: gina.lat, lng: gina.lng, label: 'Gina', spotId: 'gina' },
        { ...CO, label: 'CO', spotId: null },
      ],
      path: null,
    });
    const farAway = person();
    const order = request(alice.id);
    await new Promise((r) => setTimeout(r, 10));
    expect(order.offeredTo).toBe(1);
    const [offer] = to(eva.id);
    expect(offer).toMatchObject({ kind: 'offer', url: `/orders/${order.id}`, title: 'Nouvelle course · +CHF 1.50' });
    expect(offer.body).toContain(`${gina.name} → CO · sur ton trajet`);
    expect(sent.find((s) => s.message.kind === 'offer')?.ttl).toBe(600);
    expect(to(farAway.id)).toHaveLength(0);
  });

  it('oublie un trajet de plus de 4 heures', () => {
    const u = person(false);
    setPresence(u.id, { available: true, stops: [{ lat: gina.lat, lng: gina.lng, label: 'Gina', spotId: 'gina' }], path: null });
    expect(getPresence(u.id).stops).toHaveLength(1);
    expect(getPresence(u.id, Date.now() + ROUTE_TTL_MS + 1000).stops).toHaveLength(0);
  });
});
