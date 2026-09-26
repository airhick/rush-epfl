import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db';
import { env } from '../server/env';
import { createApp } from '../server/app';
import { HttpError } from '../server/http';
import { createUser, balanceOf } from '../server/services/users';
import { record } from '../server/services/ledger';
import { register, SESSION_COOKIE } from '../server/services/auth';
import { signPayload, topupUrl, verifyWebhook } from '../server/services/stripe';
import * as payments from '../server/services/payments';
import { formatPhone, normalizeTwintPhone } from '../shared/payments';

const SECRET = 'whsec_test_secret';
env.stripeWebhookSecret = SECRET;
env.stripeTopupUrl = 'https://buy.stripe.com/test_rush';

let n = 0;
const user = () => createUser(`pay.user${++n}@epfl.ch`);
const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof HttpError ? err.status : 'other';
  }
  return null;
};

function sessionEvent(overrides: Record<string, unknown> = {}, type = 'checkout.session.completed') {
  return {
    id: `evt_${++n}`,
    type,
    data: {
      object: {
        id: `cs_live_${n}`,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        amount_total: 2000,
        currency: 'chf',
        client_reference_id: null,
        customer_details: { email: null },
        payment_intent: `pi_${n}`,
        metadata: { rush: 'topup' },
        ...overrides,
      },
    },
  };
}

beforeEach(() => {
  db.exec(
    'DELETE FROM withdrawals; DELETE FROM topups; DELETE FROM messages; DELETE FROM transactions; DELETE FROM orders; DELETE FROM presence; DELETE FROM sessions; DELETE FROM credentials; DELETE FROM users;',
  );
  env.adminEmails = [];
});

describe('webhook Stripe', () => {
  it('n’accepte que les évènements signés récemment avec le secret', () => {
    const payload = JSON.stringify(sessionEvent());
    expect(verifyWebhook(payload, signPayload(payload, SECRET)).type).toBe('checkout.session.completed');
    expect(status(() => verifyWebhook(payload, signPayload(payload, 'whsec_autre')))).toBe(400);
    expect(status(() => verifyWebhook(payload.replace('2000', '9000'), signPayload(payload, SECRET)))).toBe(400);
    expect(status(() => verifyWebhook(payload, signPayload(payload, SECRET, Math.floor(Date.now() / 1000) - 3600)))).toBe(400);
    expect(status(() => verifyWebhook(payload, undefined))).toBe(400);
    expect(status(() => verifyWebhook(payload, signPayload(payload, SECRET), ''))).toBe(503);
  });

  it('crédite une seule fois le compte qui a payé', () => {
    const alice = user();
    const event = sessionEvent({ client_reference_id: alice.id, amount_total: 1250 });
    expect(payments.handleStripeEvent(event)).toBe('credited');
    expect(payments.handleStripeEvent(event)).toBe('duplicate');
    expect(balanceOf(alice.id)).toBe(1250);
    expect(payments.topupStatus(alice.id, event.data.object.id)).toEqual({ status: 'credited', amountCents: 1250 });
    // Un autre compte ne voit pas le paiement d'Alice.
    expect(payments.topupStatus(user().id, event.data.object.id).status).toBe('pending');
  });

  it('attend la confirmation d’un paiement différé', () => {
    const alice = user();
    const pending = sessionEvent({ client_reference_id: alice.id, payment_status: 'unpaid' });
    expect(payments.handleStripeEvent(pending)).toBe('waiting');
    expect(balanceOf(alice.id)).toBe(0);
    const paid = { ...pending, type: 'checkout.session.async_payment_succeeded', data: { object: { ...pending.data.object, payment_status: 'paid' } } };
    expect(payments.handleStripeEvent(paid)).toBe('credited');
    expect(balanceOf(alice.id)).toBe(2000);
  });

  it('ignore les autres paiements du compte Stripe et garde ceux sans compte Rush', () => {
    const alice = user();
    expect(payments.handleStripeEvent(sessionEvent({ client_reference_id: alice.id, metadata: {} }))).toBe('ignored');
    expect(payments.handleStripeEvent({ id: 'evt', type: 'payment_intent.succeeded', data: { object: {} } })).toBe('ignored');
    expect(balanceOf(alice.id)).toBe(0);

    // Référence perdue mais même adresse : on retrouve le compte.
    expect(payments.handleStripeEvent(sessionEvent({ customer_details: { email: alice.email.toUpperCase() } }))).toBe('credited');
    expect(balanceOf(alice.id)).toBe(2000);

    // Aucun compte, ou une autre devise : l'équipe le voit pour rembourser ou rattacher.
    expect(payments.handleStripeEvent(sessionEvent({ customer_details: { email: 'inconnu@epfl.ch' } }))).toBe('unmatched');
    expect(payments.handleStripeEvent(sessionEvent({ client_reference_id: alice.id, currency: 'eur' }))).toBe('unmatched');
    expect(balanceOf(alice.id)).toBe(2000);
    expect(payments.ownerOverview().unmatchedTopups.map((t) => t.email)).toContain('inconnu@epfl.ch');
  });

  it('prépare le lien de paiement avec le compte et le montant choisi', () => {
    const alice = user();
    const url = new URL(topupUrl(alice, 1500));
    expect(url.origin + url.pathname).toBe('https://buy.stripe.com/test_rush');
    expect(url.searchParams.get('client_reference_id')).toBe(alice.id);
    expect(url.searchParams.get('prefilled_amount')).toBe('1500');
    expect(url.searchParams.get('locked_prefilled_email')).toBe(alice.email);
    expect(status(() => topupUrl(alice, 99))).toBe(422);
    expect(status(() => topupUrl(alice, 10_001))).toBe(422);
    expect(status(() => topupUrl(alice, 100))).toBe(null);
    expect(status(() => topupUrl(alice, 10_000))).toBe(null);
  });
});

describe('retraits TWINT', () => {
  it('reconnaît les numéros de mobile suisses', () => {
    expect(normalizeTwintPhone('079 123 45 67')).toBe('+41791234567');
    expect(normalizeTwintPhone('+41 76 555 12 34')).toBe('+41765551234');
    expect(normalizeTwintPhone('0041-78-111-22-33')).toBe('+41781112233');
    expect(normalizeTwintPhone('021 693 11 11')).toBeNull();
    expect(normalizeTwintPhone('+33 6 12 34 56 78')).toBeNull();
    expect(formatPhone('+41791234567')).toBe('079 123 45 67');
  });

  it('débite le solde tout de suite, sans le crédit offert', () => {
    const bob = user();
    record(bob.id, 'bonus', 100, 'Crédit offert');
    record(bob.id, 'payout', 1500, 'Livraison · Test');
    expect(payments.withdrawable(bob.id)).toBe(1500);
    expect(status(() => payments.requestWithdrawal(bob.id, 1600, '079 123 45 67'))).toBe(402);
    expect(status(() => payments.requestWithdrawal(bob.id, 1000, '021 693 11 11'))).toBe(422);

    const w = payments.requestWithdrawal(bob.id, 1000, '079 123 45 67');
    expect(w).toMatchObject({ status: 'pending', amountCents: 1000, phone: '+41791234567' });
    expect(balanceOf(bob.id)).toBe(600);
    // Une seule demande à la fois.
    expect(status(() => payments.requestWithdrawal(bob.id, 100, '079 123 45 67'))).toBe(409);
  });

  it('rend le montant si la demande est annulée ou refusée, pas si elle est payée', () => {
    const bob = user();
    const admin = user();
    record(bob.id, 'topup', 3000, 'Recharge · Test');

    const first = payments.requestWithdrawal(bob.id, 1000, '0791234567');
    expect(status(() => payments.cancelWithdrawal(admin.id, first.id))).toBe(404);
    expect(payments.cancelWithdrawal(bob.id, first.id).status).toBe('cancelled');
    expect(balanceOf(bob.id)).toBe(3000);
    expect(status(() => payments.cancelWithdrawal(bob.id, first.id))).toBe(409);

    const second = payments.requestWithdrawal(bob.id, 1200, '0791234567');
    expect(payments.reject(admin.id, second.id, 'Numéro sans TWINT').note).toBe('Numéro sans TWINT');
    expect(balanceOf(bob.id)).toBe(3000);

    const third = payments.requestWithdrawal(bob.id, 2500, '0791234567');
    const overview = payments.ownerOverview();
    expect(overview.pending).toHaveLength(1);
    expect(overview.pending[0].stats).toEqual({ topupsCents: 3000, earnedCents: 0, balanceCents: 500 });
    expect(payments.markPaid(admin.id, third.id).status).toBe('paid');
    expect(balanceOf(bob.id)).toBe(500);
    expect(status(() => payments.cancelWithdrawal(bob.id, third.id))).toBe(409);
    expect(payments.walletView(bob.id).withdrawals.map((w) => w.status)).toEqual(['paid', 'rejected', 'cancelled']);
  });
});

describe('API', () => {
  const app = createApp();
  const cookie = (token: string) => ({ cookie: `${SESSION_COOKIE}=${token}` });

  it('crédite par le webhook signé et refuse une signature fausse', async () => {
    const alice = user();
    const payload = JSON.stringify(sessionEvent({ client_reference_id: alice.id, amount_total: 700 }));
    const post = (signature: string) =>
      app.request('/api/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signature, 'content-type': 'application/json' } });

    expect((await post(signPayload(payload, 'whsec_faux'))).status).toBe(400);
    expect(balanceOf(alice.id)).toBe(0);
    const res = await post(signPayload(payload, SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: 'credited' });
    expect(balanceOf(alice.id)).toBe(700);
  });

  it('réserve la vue des retraits à l’équipe Rush', async () => {
    const member = await register('membre.rush@epfl.ch', 'motdepasse1');
    expect((await app.request('/api/admin/withdrawals', { headers: cookie(member.token) })).status).toBe(403);

    env.adminEmails = ['owner@example.com'];
    const owner = await register('owner@example.com', 'motdepasse1');
    const res = await app.request('/api/admin/withdrawals', { headers: cookie(owner.token) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pending: [], recent: [], unmatchedTopups: [] });
    const me = (await (await app.request('/api/me', { headers: cookie(owner.token) })).json()) as { isAdmin: boolean };
    expect(me.isAdmin).toBe(true);
  });
});
