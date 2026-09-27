import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../server/db';
import { createUser } from '../server/services/users';
import { record } from '../server/services/ledger';
import * as orders from '../server/services/orders';
import * as dispatch from '../server/services/dispatch';
import { setPresence } from '../server/services/presence';
import { BUILDINGS, SPOT_BY_ID } from '../shared/catalog';
import { haversine, type LatLng } from '../shared/geo';
import { distanceToPath, evaluate, insertionDetour, rank } from '../shared/matching';
import type { Offer, ServerEvent } from '../shared/types';

const building = (id: string) => BUILDINGS.find((b) => b.id === id)!;
const foodlab = SPOT_BY_ID.get('foodlab')!;
const BC = building('BC');
const CE = building('CE');
const STCC = building('STCC');
/** Un point à `m` mètres au nord de `p`. */
const north = (p: LatLng, m: number): LatLng => ({ lat: p.lat + m / 111_320, lng: p.lng });

describe('algorithme de matching', () => {
  it('mesure la distance d’un point à un trajet', () => {
    expect(distanceToPath(north(BC, 30), [BC, CE])).toBeGreaterThan(25);
    expect(distanceToPath(north(BC, 30), [BC, CE])).toBeLessThan(35);
    expect(distanceToPath(CE, [BC, CE])).toBeLessThan(1);
  });

  it('ne compte presque rien pour une course qui suit le trajet', () => {
    // « Je mange au FoodLab, puis je vais au BC » : la course FoodLab → BC est gratuite en marche.
    expect(insertionDetour([foodlab, BC], foodlab, north(BC, 10))).toBeLessThan(20);
    // Livrer au CE, de l'autre côté : c'est un vrai détour.
    expect(insertionDetour([foodlab, BC], foodlab, CE)).toBeGreaterThan(300);
    // Le spot passe toujours avant la livraison, même si l'inverse coûterait moins.
    expect(insertionDetour([BC, foodlab], foodlab, BC)).toBeGreaterThan(400);
  });

  it('propose en direct à moins de 100 m du spot', () => {
    const job = { pickup: foodlab, dropoff: BC, rewardCents: 100 };
    expect(evaluate({ position: north(foodlab, 60), stops: [] }, job)?.reason).toBe('nearby');
    expect(evaluate({ position: north(foodlab, 160), stops: [] }, job)?.reason).toBeNull();
    // Sans position ni trajet, on ne peut rien proposer.
    expect(evaluate({ position: null, stops: [] }, job)).toBeNull();
  });

  it('propose aussi quand le spot est sur le trajet déclaré et que le détour reste court', () => {
    const route = { position: STCC, stops: [foodlab, BC] };
    const onTheWay = evaluate(route, { pickup: foodlab, dropoff: north(BC, 20), rewardCents: 100 })!;
    expect(onTheWay).toMatchObject({ reason: 'route', onTheWay: true });
    // Le spot est sur le chemin, mais la livraison emmène loin : pas de notification.
    expect(evaluate(route, { pickup: foodlab, dropoff: STCC, rewardCents: 100 })?.reason).toBeNull();
  });

  it('classe d’abord ce qui rapporte le plus par minute de marche ajoutée', () => {
    const courier = { position: foodlab, stops: [BC] };
    const jobs = [
      { id: 'loin-mieux-paye', pickup: foodlab, dropoff: STCC, rewardCents: 250, createdAt: '2026-09-26T10:00:00Z' },
      { id: 'sur-le-chemin', pickup: foodlab, dropoff: north(BC, 15), rewardCents: 100, createdAt: '2026-09-26T10:05:00Z' },
    ];
    expect(rank(courier, jobs).map((r) => r.job.id)).toEqual(['sur-le-chemin', 'loin-mieux-paye']);
  });
});

describe('offres en direct', () => {
  // Gina sert le jeudi midi.
  const NOON = new Date('2026-01-15T11:00:00Z');
  const gina = SPOT_BY_ID.get('gina')!;
  const CO = building('CO');
  let online: string[] = [];
  let sent: { userId: string; event: ServerEvent }[] = [];
  const offersTo = (userId: string) =>
    sent.filter((s) => s.userId === userId && s.event.type === 'offer').map((s) => (s.event as { offer: Offer }).offer);

  let n = 0;
  const person = (at?: LatLng) => {
    const u = createUser(`offre.user${++n}@epfl.ch`);
    online.push(u.id);
    if (at) dispatch.updatePosition(u.id, at.lat, at.lng);
    return u;
  };
  const request = (requesterId: string) => {
    record(requesterId, 'bonus', 3000, 'Test');
    return orders.createOrder(
      requesterId,
      { spotId: 'gina', items: [], custom: { text: 'Une pizza margherita', budgetCents: 1400 }, dropoff: { ...CO, label: 'CO', note: '' } },
      NOON,
    );
  };

  beforeEach(() => {
    db.exec('DELETE FROM messages; DELETE FROM transactions; DELETE FROM orders; DELETE FROM presence; DELETE FROM sessions; DELETE FROM credentials; DELETE FROM users;');
    online = [];
    sent = [];
    dispatch.setTransport({ online: () => online, send: (userId, event) => sent.push({ userId, event }) });
  });

  it('prévient les rushers connectés à moins de 100 m du spot, avec tarif, contenu, trajet et livraison', () => {
    const alice = person();
    const bob = person(north(gina, 40));
    const carla = person(north(gina, 400));
    const dan = createUser('offre.hors-ligne@epfl.ch');
    dispatch.updatePosition(dan.id, gina.lat, gina.lng);

    const order = request(alice.id);
    expect(order.offeredTo).toBe(1);
    const [offer] = offersTo(bob.id);
    expect(offer).toMatchObject({
      orderId: order.id,
      reason: 'nearby',
      rewardCents: 150,
      advanceCents: 1400,
      items: [{ name: 'Une pizza margherita' }],
      delivery: { label: 'CO' },
      detourMeters: null,
    });
    expect(offer.pickup.meters).toBeLessThan(60);
    expect(offer.delivery.meters).toBeGreaterThan(200);
    expect(offersTo(carla.id)).toHaveLength(0);
    expect(offersTo(dan.id)).toHaveLength(0);
    expect(offersTo(alice.id)).toHaveLength(0);
  });

  it('prévient celui qui arrive près du spot plus tard, une seule fois', () => {
    const alice = person();
    const carla = person(north(gina, 400));
    const order = request(alice.id);
    expect(offersTo(carla.id)).toHaveLength(0);

    dispatch.updatePosition(carla.id, north(gina, 30).lat, gina.lng, Date.now() + 20_000);
    expect(offersTo(carla.id).map((o) => o.orderId)).toEqual([order.id]);
    // Le demandeur voit le nouveau compte.
    const update = sent.filter((s) => s.userId === alice.id && s.event.type === 'order.updated').at(-1)!.event;
    expect(update).toMatchObject({ order: { offeredTo: 1 } });

    dispatch.updatePosition(carla.id, gina.lat, gina.lng, Date.now() + 40_000);
    expect(offersTo(carla.id)).toHaveLength(1);
  });

  it('prévient les rushers dont le trajet passe par le spot', () => {
    const alice = person();
    const eva = person();
    setPresence(eva.id, {
      available: true,
      stops: [
        { lat: gina.lat, lng: gina.lng, label: 'Gina', spotId: 'gina' },
        { lat: CO.lat, lng: CO.lng, label: 'CO', spotId: null },
      ],
      path: null,
    });
    request(alice.id);
    const [offer] = offersTo(eva.id);
    expect(offer).toMatchObject({ reason: 'route' });
    expect(offer.detourMeters).toBeLessThan(50);
  });

  it('ne dérange pas qui s’est rendu indisponible ou livre déjà deux commandes', () => {
    const alice = person();
    const bob = person(north(gina, 20));
    setPresence(bob.id, { available: false, stops: [], path: null });
    request(alice.id);
    expect(offersTo(bob.id)).toHaveLength(0);

    const busy = person(north(gina, 20));
    const other = person();
    for (let i = 0; i < 2; i++) orders.accept(request(other.id).id, busy.id);
    sent = [];
    request(alice.id);
    expect(offersTo(busy.id)).toHaveLength(0);
  });

  it('repropose une demande de nouveau ouverte après un désistement', () => {
    const alice = person();
    const bob = person(north(gina, 20));
    const carla = person(north(gina, 50));
    const order = request(alice.id);
    orders.accept(order.id, bob.id);
    sent = [];
    orders.release(order.id, bob.id);
    expect(offersTo(carla.id).map((o) => o.orderId)).toEqual([order.id]);
    expect(haversine(gina, offersTo(carla.id)[0].delivery)).toBeGreaterThan(200);
  });
});
