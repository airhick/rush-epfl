import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db';
import { HttpError } from '../server/http';
import { createUser, balanceOf, heldOf } from '../server/services/users';
import { topUp, wallet } from '../server/services/ledger';
import * as orders from '../server/services/orders';
import { listMessages } from '../server/services/messages';
import { normalizeEmail } from '../server/services/auth';

// Distributeurs ouverts 24h/24 : les tests ne dépendent pas de l'heure.
const SPOT = 'vending-inf';
const dropoff = { lat: 46.5201, lng: 6.5652, label: 'CO', note: 'Hall' };

let n = 0;
const user = () => createUser(`test.user${++n}@epfl.ch`);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof HttpError ? err.status : 'other';
  }
  return null;
};

beforeEach(() => {
  db.exec('DELETE FROM messages; DELETE FROM transactions; DELETE FROM orders; DELETE FROM presence; DELETE FROM users;');
});

describe('cycle de vie d’une commande', () => {
  it('réserve, règle le rusher et rend le reste', () => {
    const alice = user();
    const bob = user();
    topUp(alice.id, 2000, 'twint');

    const order = orders.createOrder(alice.id, {
      spotId: SPOT,
      items: [
        { itemId: 'ven-redbull', qty: 2 },
        { itemId: 'ven-chips', qty: 1 },
      ],
      dropoff,
      tipCents: 250,
    });
    expect(order.itemsCents).toBe(820);
    expect(order.holdCents).toBe(820 + 90 + 250);
    expect(balanceOf(alice.id)).toBe(2000 - order.holdCents);
    expect(heldOf(alice.id)).toBe(order.holdCents);

    orders.accept(order.id, bob.id);
    orders.pickUp(order.id, bob.id, 800);
    orders.markDelivered(order.id, bob.id);
    const done = orders.confirm(order.id, alice.id);

    expect(done.status).toBe('completed');
    expect(balanceOf(bob.id)).toBe(800 + 250);
    expect(balanceOf(alice.id)).toBe(2000 - 800 - 250);
    expect(heldOf(alice.id)).toBe(0);
    expect(wallet(bob.id).earnedThisMonthCents).toBe(1050);
    expect(listMessages(order.id).filter((m) => m.kind === 'system')).toHaveLength(4);
  });

  it('refuse une demande sans solde suffisant, sans rien écrire', () => {
    const alice = user();
    topUp(alice.id, 500, 'card');
    const status = code(() =>
      orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'ven-sandwich', qty: 1 }], dropoff, tipCents: 200 }),
    );
    expect(status).toBe(402);
    expect(orders.listMine(alice.id)).toHaveLength(0);
    expect(balanceOf(alice.id)).toBe(500);
  });

  it('ignore les prix envoyés par le client et recalcule depuis le catalogue', () => {
    const alice = user();
    topUp(alice.id, 2000, 'twint');
    const status = code(() =>
      orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'esp-viande', qty: 1 }], dropoff, tipCents: 200 }),
    );
    expect(status).toBe(422);
  });

  it('empêche de livrer sa propre demande et de dépasser le montant réservé', () => {
    const alice = user();
    const bob = user();
    topUp(alice.id, 2000, 'twint');
    const order = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'ven-coca', qty: 1 }], dropoff, tipCents: 200 });
    expect(code(() => orders.accept(order.id, alice.id))).toBe(403);
    orders.accept(order.id, bob.id);
    expect(code(() => orders.accept(order.id, user().id))).toBe(409);
    expect(code(() => orders.pickUp(order.id, bob.id, order.holdCents))).toBe(422);
  });

  it('rembourse intégralement une annulation et une expiration', () => {
    const alice = user();
    topUp(alice.id, 2000, 'twint');
    const a = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'ven-eau', qty: 1 }], dropoff, tipCents: 150 });
    orders.cancel(a.id, alice.id);
    expect(balanceOf(alice.id)).toBe(2000);

    const b = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'ven-eau', qty: 1 }], dropoff, tipCents: 150 });
    orders.sweep(Date.now() + orders.OPEN_TTL_MS + 1000);
    expect(orders.orderFor(b.id, alice.id).status).toBe('cancelled');
    expect(balanceOf(alice.id)).toBe(2000);
  });

  it('remet la demande dans le fil quand le rusher se désiste', () => {
    const alice = user();
    const bob = user();
    topUp(alice.id, 2000, 'twint');
    const order = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'ven-eau', qty: 1 }], dropoff, tipCents: 150 });
    orders.accept(order.id, bob.id);
    orders.release(order.id, bob.id);
    expect(orders.listOpen(bob.id).map((o) => o.id)).toContain(order.id);
  });

  it('cache la note de livraison aux non-participants', () => {
    const alice = user();
    const carol = user();
    topUp(alice.id, 2000, 'twint');
    const order = orders.createOrder(alice.id, { spotId: SPOT, items: [{ itemId: 'ven-eau', qty: 1 }], dropoff, tipCents: 150 });
    expect(orders.orderFor(order.id, carol.id).dropoff.note).toBe('');
    expect(orders.orderFor(order.id, alice.id).dropoff.note).toBe('Hall');
  });
});

describe('authentification', () => {
  it('n’accepte que les adresses EPFL', () => {
    expect(normalizeEmail(' Eric.Aellen@EPFL.ch ')).toBe('eric.aellen@epfl.ch');
    expect(code(() => normalizeEmail('someone@gmail.com'))).toBe(422);
    expect(code(() => normalizeEmail('evil@epfl.ch.attacker.com'))).toBe(422);
  });
});
