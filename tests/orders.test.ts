import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db';
import { HttpError } from '../server/http';
import { createUser, balanceOf, heldOf } from '../server/services/users';
import { record, wallet } from '../server/services/ledger';
import * as orders from '../server/services/orders';
import { listMessages } from '../server/services/messages';
import { accountExists, login, normalizeEmail, register } from '../server/services/auth';
import { env } from '../server/env';

// Holy Cow! ouvre tous les jours de 11h à 23h : on fixe l'heure à midi pour ne pas dépendre de l'horloge.
const SPOT = 'holy-cow-epfl';
const NOON = new Date('2026-01-15T11:00:00Z');
const dropoff = { lat: 46.5201, lng: 6.5652, label: 'CO', note: 'Hall' };

let n = 0;
const user = () => createUser(`test.user${++n}@epfl.ch`);
const fund = (userId: string, cents: number) => record(userId, 'bonus', cents, 'Test');
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof HttpError ? err.status : 'other';
  }
  return null;
};

beforeEach(() => {
  db.exec('DELETE FROM messages; DELETE FROM transactions; DELETE FROM orders; DELETE FROM presence; DELETE FROM sessions; DELETE FROM credentials; DELETE FROM users;');
});

describe('cycle de vie d’une commande', () => {
  it('réserve, règle le rusher et rend le reste', () => {
    const alice = user();
    const bob = user();
    fund(alice.id, 2000);

    const order = orders.createOrder(alice.id, {
      spotId: SPOT,
      items: [
        { itemId: 'hc-soda', qty: 2 },
        { itemId: 'hc-frites', qty: 1 },
      ],
      dropoff,
      tipCents: 250,
    }, NOON);
    expect(order.itemsCents).toBe(1490);
    expect(order.holdCents).toBe(1490 + 150 + 250);
    expect(balanceOf(alice.id)).toBe(2000 - order.holdCents);
    expect(heldOf(alice.id)).toBe(order.holdCents);

    orders.accept(order.id, bob.id);
    orders.pickUp(order.id, bob.id, 1450);
    orders.markDelivered(order.id, bob.id);
    const done = orders.confirm(order.id, alice.id);

    expect(done.status).toBe('completed');
    expect(balanceOf(bob.id)).toBe(1450 + 250);
    expect(balanceOf(alice.id)).toBe(2000 - 1450 - 250);
    expect(heldOf(alice.id)).toBe(0);
    expect(wallet(bob.id).earnedThisMonthCents).toBe(1700);
    expect(listMessages(order.id).filter((m) => m.kind === 'system')).toHaveLength(4);
  });

  it('refuse une demande sans solde suffisant, sans rien écrire', () => {
    const alice = user();
    fund(alice.id, 500);
    const status = code(() =>
      orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'hc-holycow', qty: 1 }], dropoff, tipCents: 200 }, NOON),
    );
    expect(status).toBe(402);
    expect(orders.listMine(alice.id)).toHaveLength(0);
    expect(balanceOf(alice.id)).toBe(500);
  });

  it('ignore les prix envoyés par le client et recalcule depuis le catalogue', () => {
    const alice = user();
    fund(alice.id, 2000);
    const status = code(() =>
      orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'mig-banane', qty: 1 }], dropoff, tipCents: 200 }, NOON),
    );
    expect(status).toBe(422);
  });

  it('empêche de livrer sa propre demande et de dépasser le montant réservé', () => {
    const alice = user();
    const bob = user();
    fund(alice.id, 2000);
    const order = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'hc-soda', qty: 1 }], dropoff, tipCents: 200 }, NOON);
    expect(code(() => orders.accept(order.id, alice.id))).toBe(403);
    orders.accept(order.id, bob.id);
    expect(code(() => orders.accept(order.id, user().id))).toBe(409);
    expect(code(() => orders.pickUp(order.id, bob.id, order.holdCents))).toBe(422);
  });

  it('rembourse intégralement une annulation et une expiration', () => {
    const alice = user();
    fund(alice.id, 2000);
    const a = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'hc-soda', qty: 1 }], dropoff, tipCents: 150 }, NOON);
    orders.cancel(a.id, alice.id);
    expect(balanceOf(alice.id)).toBe(2000);

    const b = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'hc-soda', qty: 1 }], dropoff, tipCents: 150 }, NOON);
    orders.sweep(Date.now() + orders.OPEN_TTL_MS + 1000);
    expect(orders.orderFor(b.id, alice.id).status).toBe('cancelled');
    expect(balanceOf(alice.id)).toBe(2000);
  });

  it('remet la demande dans le fil quand le rusher se désiste', () => {
    const alice = user();
    const bob = user();
    fund(alice.id, 2000);
    const order = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'hc-soda', qty: 1 }], dropoff, tipCents: 150 }, NOON);
    orders.accept(order.id, bob.id);
    orders.release(order.id, bob.id);
    expect(orders.listOpen(bob.id).map((o) => o.id)).toContain(order.id);
  });

  it('cache la note de livraison aux non-participants', () => {
    const alice = user();
    const carol = user();
    fund(alice.id, 2000);
    const order = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'hc-soda', qty: 1 }], dropoff, tipCents: 150 }, NOON);
    expect(orders.orderFor(order.id, carol.id).dropoff.note).toBe('');
    expect(orders.orderFor(order.id, alice.id).dropoff.note).toBe('Hall');
  });
});

describe('authentification', () => {
  it('crée le compte avec un mot de passe, puis s’y connecte', async () => {
    expect(accountExists('new.person@epfl.ch').exists).toBe(false);
    const { user: created } = await register('New.Person@epfl.ch', 'croissant-42');
    expect(accountExists('new.person@epfl.ch')).toEqual({ email: 'new.person@epfl.ch', exists: true });

    const { user: again, token } = await login('new.person@epfl.ch', 'croissant-42');
    expect(again.id).toBe(created.id);
    expect(token).toMatch(/^[\w-]{40,}$/);

    // Le mot de passe n'est jamais stocké en clair.
    const row = db.prepare('SELECT password_hash FROM credentials WHERE user_id = ?').get(created.id) as { password_hash: string };
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain('croissant');
  });

  it('refuse un mauvais mot de passe, un doublon et un mot de passe trop court', async () => {
    await register('ada.lovelace@epfl.ch', 'machine-analytique');
    await expect(login('ada.lovelace@epfl.ch', 'mauvais')).rejects.toMatchObject({ status: 422 });
    await expect(login('inconnu@epfl.ch', 'peu-importe')).rejects.toMatchObject({ status: 422 });
    await expect(register('ada.lovelace@epfl.ch', 'autre-mot-de-passe')).rejects.toMatchObject({ status: 409 });
    await expect(register('court@epfl.ch', '1234567')).rejects.toMatchObject({ status: 422 });
    expect(accountExists('court@epfl.ch').exists).toBe(false);
  });

  it('bloque l’adresse après trop d’essais ratés', async () => {
    await register('grace.hopper@epfl.ch', 'cobol-forever');
    for (let i = 0; i < 8; i++) await expect(login('grace.hopper@epfl.ch', `essai-${i}`)).rejects.toMatchObject({ status: 422 });
    await expect(login('grace.hopper@epfl.ch', 'cobol-forever')).rejects.toMatchObject({ status: 429 });
  });

  it('offre le crédit de bienvenue une seule fois, à la création du compte', async () => {
    const { user: first } = await register('bonus.once@epfl.ch', 'un-seul-bonus');
    expect(env.welcomeBonusCents).toBe(100);
    expect(balanceOf(first.id)).toBe(100);
    expect(wallet(first.id).transactions.map((t) => t.kind)).toEqual(['bonus']);

    await login('bonus.once@epfl.ch', 'un-seul-bonus');
    expect(balanceOf(first.id)).toBe(100);
  });

  it('passe par l’API : vérifie l’adresse, crée le compte et pose le cookie', async () => {
    const app = (await import('../server/app')).createApp();
    const post = (path: string, body: object, cookie = '') =>
      app.request(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

    expect(await (await post('/auth/check', { email: 'api.user@epfl.ch' })).json()).toEqual({ email: 'api.user@epfl.ch', exists: false });
    expect((await post('/auth/check', { email: 'api.user@gmail.com' })).status).toBe(422);

    const res = await post('/auth/register', { email: 'api.user@epfl.ch', password: 'rush-rush-rush' });
    expect(res.status).toBe(201);
    const me = (await res.json()) as { email: string; balanceCents: number; passwordHash?: string };
    expect(me.email).toBe('api.user@epfl.ch');
    expect(me).not.toHaveProperty('passwordHash');
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toMatch(/^rush_session=/);

    // Plus de recharge : le solde ne se crédite pas depuis l'API.
    const topup = await post('/wallet/topup', { amountCents: 5000, method: 'twint' }, cookie);
    expect(topup.status).toBe(404);
    expect(me.balanceCents).toBe(env.welcomeBonusCents);
  });

  it('n’accepte que les adresses EPFL', () => {
    expect(normalizeEmail(' Eric.Aellen@EPFL.ch ')).toBe('eric.aellen@epfl.ch');
    expect(code(() => normalizeEmail('someone@gmail.com'))).toBe(422);
    expect(code(() => normalizeEmail('evil@epfl.ch.attacker.com'))).toBe(422);
  });
});
