import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../server/db';
import { env } from '../server/env';
import { createApp } from '../server/app';
import { record } from '../server/services/ledger';
import * as orders from '../server/services/orders';
import * as dispatch from '../server/services/dispatch';
import { handleStripeEvent, ownerOverview, requestWithdrawal } from '../server/services/payments';
import { signPayload, topupUrl, verifyAnyWebhook } from '../server/services/stripe';
import { balanceOf, createUser, getUser } from '../server/services/users';
import { startTestRushers, testAccount } from '../server/services/testMode';
import type { Me, Offer, Order } from '../shared/types';

env.adminCode = 'code-secret-equipe';
env.stripeTopupUrl = 'https://buy.stripe.com/live_rush';
env.stripeWebhookSecret = 'whsec_live';
env.stripeTestTopupUrl = 'https://buy.stripe.com/test_rush';
env.stripeTestWebhookSecret = 'whsec_test';

const app = createApp();
const NOON = new Date('2026-01-15T11:00:00Z');
const CO = { lat: 46.5201, lng: 6.5652, label: 'CO', note: '' };
const pizza = { spotId: 'gina', items: [], custom: { text: 'Une margherita', budgetCents: 1400 }, dropoff: CO };

/** Navigateur minimal : garde les cookies posés par chaque réponse. */
class Browser {
  jar = new Map<string, string>();
  async call<T = unknown>(path: string, body?: unknown, method?: string): Promise<{ status: number; json: T }> {
    const res = await app.request(`/api${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json', cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (/max-age=0/i.test(line) || !pair.slice(i + 1)) this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { status: res.status, json: (await res.json().catch(() => null)) as T };
  }
}

async function signedUp(email: string) {
  const b = new Browser();
  await b.call('/auth/register', { email, password: 'motdepasse1' });
  return b;
}

let n = 0;
beforeEach(() => {
  db.exec(
    'DELETE FROM test_accounts; DELETE FROM admin_grants; DELETE FROM withdrawals; DELETE FROM topups; DELETE FROM reads; DELETE FROM messages; DELETE FROM transactions; DELETE FROM orders; DELETE FROM presence; DELETE FROM sessions; DELETE FROM credentials; DELETE FROM users;',
  );
  dispatch.setTransport({ online: () => [], send: () => undefined });
});
afterEach(() => vi.useRealTimers());

describe('accès équipe par code secret', () => {
  it('rejoint l’équipe avec le bon code, et bloque après 5 essais ratés', async () => {
    const eric = await signedUp(`eric${++n}@epfl.ch`);
    expect((await eric.call('/admin/withdrawals')).status).toBe(403);
    expect((await eric.call('/admin/unlock', { code: 'mauvais' })).status).toBe(422);
    const ok = await eric.call<Me>('/admin/unlock', { code: 'code-secret-equipe' });
    expect(ok.json.isAdmin).toBe(true);
    expect((await eric.call('/admin/withdrawals')).status).toBe(200);

    const other = await signedUp(`autre${++n}@epfl.ch`);
    for (let i = 0; i < 5; i++) await other.call('/admin/unlock', { code: `essai-${i}` });
    expect((await other.call('/admin/unlock', { code: 'code-secret-equipe' })).status).toBe(429);
  });
});

describe('mode test', () => {
  async function admin() {
    const b = await signedUp(`admin${++n}@epfl.ch`);
    await b.call('/admin/unlock', { code: 'code-secret-equipe' });
    const me = (await b.call<Me>('/me')).json;
    return { b, me };
  }

  it('passe sur un compte de test puis revient au vrai compte, sans le perdre', async () => {
    const { b, me } = await admin();
    const test = await b.call<Me>('/admin/test/enter', { role: 'buyer' });
    expect(test.json).toMatchObject({ test: { role: 'buyer', autoRusher: true, stripe: true }, isAdmin: false });
    expect(test.json.id).not.toBe(me.id);
    expect((await b.call<Me>('/me')).json.id).toBe(test.json.id);

    const rusher = await b.call<Me>('/test/switch', { role: 'rusher' });
    expect(rusher.json.test?.role).toBe('rusher');

    const back = await b.call<Me>('/test/exit', {});
    expect(back.json.id).toBe(me.id);
    expect((await b.call<Me>('/me')).json).toMatchObject({ id: me.id, test: null, isAdmin: true });
    // Un vrai compte n'a pas accès aux commandes du mode test.
    expect((await b.call('/test/credit', {})).status).toBe(403);
  });

  it('sépare complètement les commandes de test et les vraies', async () => {
    const { me } = await admin();
    const buyer = testAccount(me.id, 'buyer');
    const rusher = testAccount(me.id, 'rusher');
    const real = createUser(`vrai${++n}@epfl.ch`);
    const realRusher = createUser(`vrai.rusher${++n}@epfl.ch`);
    record(buyer.id, 'topup', 3000, 'Test');
    record(real.id, 'topup', 3000, 'Test');

    const testOrder = orders.createOrder(buyer.id, pizza, NOON);
    const realOrder = orders.createOrder(real.id, pizza, NOON);
    expect(orders.listOpen(rusher.id).map((o) => o.id)).toEqual([testOrder.id]);
    expect(orders.listOpen(realRusher.id).map((o) => o.id)).toEqual([realOrder.id]);
    expect(() => orders.accept(testOrder.id, realRusher.id)).toThrow('Commande introuvable');
    expect(() => orders.accept(realOrder.id, rusher.id)).toThrow('Commande introuvable');
    expect(() => orders.orderFor(testOrder.id, realRusher.id)).toThrow();

    // Offres en direct : jamais d'un monde à l'autre.
    const sent: Offer[] = [];
    dispatch.setTransport({ online: () => [rusher.id, realRusher.id], send: (_u, e) => e.type === 'offer' && sent.push(e.offer) });
    dispatch.updatePosition(rusher.id, 46.5227, 6.56545, Date.now() + 60_000);
    dispatch.updatePosition(realRusher.id, 46.5227, 6.56545, Date.now() + 60_000);
    expect(sent.map((o) => o.orderId).sort()).toEqual([realOrder.id, testOrder.id].sort());
    expect(dispatch.offerFor(orders.getRow(testOrder.id), realRusher.id)).toBeNull();
  });

  it('paie par l’environnement de test Stripe, qui ne crédite jamais un vrai compte', () => {
    const owner = createUser(`owner${++n}@epfl.ch`);
    db.prepare('INSERT INTO admin_grants (user_id, granted_at) VALUES (?, ?)').run(owner.id, Date.now());
    const buyer = testAccount(owner.id, 'buyer');
    const real = createUser(`vrai${++n}@epfl.ch`);
    expect(new URL(topupUrl(buyer, 1500)).origin + new URL(topupUrl(buyer, 1500)).pathname).toBe('https://buy.stripe.com/test_rush');
    expect(new URL(topupUrl(real, 1500)).pathname).toBe('/live_rush');

    const session = (ref: string, id: string) => ({
      id: `evt_${id}`,
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: {
          id,
          object: 'checkout.session',
          mode: 'payment',
          payment_status: 'paid',
          amount_total: 2000,
          currency: 'chf',
          client_reference_id: ref,
          metadata: { rush: 'topup' },
        },
      },
    });
    // Signé avec le secret de test : reconnu comme test.
    const payload = JSON.stringify(session(buyer.id, 'cs_test_1'));
    const { event, test } = verifyAnyWebhook(payload, signPayload(payload, 'whsec_test'));
    expect(test).toBe(true);
    expect(handleStripeEvent(event, test)).toBe('credited');
    expect(balanceOf(buyer.id)).toBe(2000);
    // Paiement de test avec la référence d'un vrai compte : rien.
    expect(handleStripeEvent(session(real.id, 'cs_test_2'), true)).toBe('unmatched');
    expect(balanceOf(real.id)).toBe(0);
    // Paiement réel vers un compte de test : rien non plus.
    expect(handleStripeEvent({ ...session(buyer.id, 'cs_live_3'), livemode: true }, false)).toBe('unmatched');
    // Un évènement réel signé avec le secret de test est refusé.
    const liar = JSON.stringify({ ...session(buyer.id, 'cs_live_4'), livemode: true });
    expect(() => verifyAnyWebhook(liar, signPayload(liar, 'whsec_test'))).toThrow();
  });

  it('crédite du solde fictif, livre avec un rusher de test automatique, et remet tout à zéro', async () => {
    const { b } = await admin();
    const me = (await b.call<Me>('/admin/test/enter', { role: 'buyer' })).json;
    expect((await b.call<Me>('/test/credit', {})).json.balanceCents).toBe(2000);

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    startTestRushers();
    const order = orders.createOrder(me.id, pizza, NOON);
    vi.advanceTimersByTime(12_000);
    const accepted = orders.getRow(order.id);
    expect(accepted.status).toBe('accepted');
    expect(getUser(accepted.courier_id!)).toMatchObject({ is_test: 1, is_bot: 1 });

    // Rusher automatique coupé : la demande attend un vrai testeur.
    await b.call('/test/auto-rusher', { on: false });
    record(me.id, 'topup', 3000, 'Test');
    const waiting = orders.createOrder(me.id, pizza, NOON);
    vi.advanceTimersByTime(12_000);
    expect(orders.getRow(waiting.id).status).toBe('open');
    vi.useRealTimers();

    // Un retrait de test apparaît chez l'équipe, marqué comme tel.
    requestWithdrawal(me.id, 500, '079 123 45 67');
    expect(ownerOverview().pending[0].user.test).toBe(true);

    const reset = await b.call<Me>('/test/reset', {});
    expect(reset.json.balanceCents).toBe(0);
    expect((await b.call<Order[]>('/orders')).json).toEqual([]);
    expect(ownerOverview().pending).toHaveLength(0);
  });
});
