/**
 * Mode démo : une poignée de rushers simulés rendent l'app vivante quand on
 * la teste seul. Ils publient des demandes, acceptent les tiennes, se
 * déplacent sur la carte et répondent dans la messagerie.
 *
 * Activé uniquement avec RUSH_DEMO=1 (c'est le cas de `npm run dev`).
 * Les comptes utilisent le domaine réservé `.invalid` et ne peuvent donc
 * jamais entrer en collision avec une vraie adresse EPFL.
 */
import { randomUUID } from 'node:crypto';
import { all, one, run } from '../db';
import { HttpError } from '../http';
import { sendTo } from '../realtime';
import { bus } from '../services/bus';
import { record } from '../services/ledger';
import { addMessage } from '../services/messages';
import * as orders from '../services/orders';
import { setPresence } from '../services/presence';
import { balanceOf, bots, createUser, getUser, invalidatePublicUser, type UserRow } from '../services/users';
import { BUILDINGS, CUSTOM_ITEM_ID, SPOTS, SPOT_BY_ID, spotOf, type Spot, type SpotKind } from '../../shared/catalog';
import { openStatus } from '../../shared/hours';
import { haversine, lerp, type LatLng } from '../../shared/geo';
import { computeHold, suggestTip } from '../../shared/pricing';
import { roundTo } from '../../shared/money';

const PEOPLE = [
  ['Léa', 'Favre', 'IN'],
  ['Noah', 'Rochat', 'ME'],
  ['Camille', 'Dubois', 'AR'],
  ['Yanis', 'Haddad', 'SC'],
  ['Sofia', 'Rossi', 'SV'],
  ['Luca', 'Meier', 'GC'],
  ['Inès', 'Morel', 'MA'],
  ['Mathis', 'Girard', 'EL'],
] as const;

const NOTES = [
  'Salle INF 119, je suis au fond',
  'Devant l’entrée principale',
  '2e étage, open space côté lac',
  'Je suis sur les marches, veste verte',
  'Hall d’entrée, près des casiers',
  'Salle de TP, frappe fort 🙂',
  '',
];

const REPLIES = ['Parfait 👍', 'Top, merci !', 'Ça marche !', 'Super, à tout de suite', 'Oki merci 🙏'];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const isBot = (id: string | null) => Boolean(id && getUser(id)?.is_bot);

/** Exécute plus tard en ignorant les conflits : l'utilisateur a pu agir entre-temps. */
function later(ms: number, fn: () => void) {
  setTimeout(() => {
    try {
      fn();
    } catch (err) {
      if (!(err instanceof HttpError)) console.error('[demo]', err);
    }
  }, ms);
}

function say(orderId: string, botId: string, body: string, delay: number) {
  later(delay, () => {
    const row = orders.getRow(orderId);
    const other = row.requester_id === botId ? row.courier_id : row.requester_id;
    if (other) sendTo(other, { type: 'typing', orderId, userId: botId });
  });
  later(delay + 1400, () => addMessage(orderId, botId, body));
}

function ensureBots(): UserRow[] {
  const existing = bots();
  if (existing.length >= PEOPLE.length) return existing;
  const created = PEOPLE.map(([first, last, section]) => {
    const email = `${first.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${last.toLowerCase()}@rush.invalid`;
    return existing.find((b) => b.email === email) ?? createUser(email, { first, last, section, bot: true });
  });
  seedHistory(created);
  return created;
}

/** Les rushers simulés passent par des demandes libres : aucun prix n'est inventé. */
const BOT_REQUESTS: Record<SpotKind, string[]> = {
  restaurant: ['Le menu du jour', 'Le plat végétarien du jour', 'Une pizza margherita'],
  cafeteria: ['Un sandwich et une eau plate', 'Une salade', 'Le menu du jour'],
  cafe: ['Un café et un croissant', 'Un thé et un muffin'],
  bar: ['Le kit étudiant', 'Un café'],
  foodtruck: ['Un wrap', 'Un burger végétarien'],
  grocery: ['Une bouteille d’eau et des fruits', 'Des chips et un soda'],
};

const botRequest = (spot: Spot) => ({ text: pick(BOT_REQUESTS[spot.kind]), budgetCents: pick([600, 800, 1000, 1200, 1500]) });

/** Quelques livraisons passées entre rushers simulés, pour des notes crédibles. */
function seedHistory(people: UserRow[]) {
  const spots = SPOTS.filter((s) => s.area === 'EPFL');
  for (const courier of people) {
    const count = Math.floor(rand(4, 16));
    for (let i = 0; i < count; i++) {
      const requester = pick(people.filter((p) => p.id !== courier.id));
      const spot = pick(spots);
      const request = botRequest(spot);
      const menuItem = { id: CUSTOM_ITEM_ID, name: request.text, qty: 1, priceCents: request.budgetCents, custom: true };
      const dest = pick(BUILDINGS);
      const tip = suggestTip({ spot, dropoff: dest, itemCount: 1 }).suggestedCents;
      const hold = computeHold(menuItem.priceCents, tip);
      const at = new Date(Date.now() - rand(1, 30) * 86_400_000).toISOString();
      run(
        `INSERT INTO orders (id, requester_id, courier_id, spot_id, items_json, items_cents, margin_cents, tip_cents,
           suggested_tip_cents, hold_cents, actual_items_cents, dropoff_lat, dropoff_lng, dropoff_label, dropoff_note,
           status, created_at, accepted_at, picked_up_at, delivered_at, completed_at, rating_for_courier, rating_for_requester)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'completed', ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        requester.id,
        courier.id,
        spot.id,
        JSON.stringify([menuItem]),
        menuItem.priceCents,
        hold.marginCents,
        tip,
        tip,
        hold.holdCents,
        menuItem.priceCents,
        dest.lat,
        dest.lng,
        dest.name,
        at,
        at,
        at,
        at,
        at,
        Math.random() < 0.85 ? 5 : 4,
        Math.random() < 0.9 ? 5 : 4,
      );
    }
  }
  people.forEach((p) => invalidatePublicUser(p.id));
}

/** Les rushers simulés ont besoin de solde pour publier leurs demandes. */
function fundBots(people: UserRow[]) {
  for (const b of people) if (balanceOf(b.id) < 10_000) record(b.id, 'bonus', 20_000, 'Crédit démo');
}

const openSpots = () => SPOTS.filter((s) => s.area === 'EPFL' && openStatus(s.hours).open);

function shufflePresence(people: UserRow[]) {
  const spots = openSpots();
  for (const b of people) {
    const busy = orders.countActive(b.id, 'courier') > 0;
    const available = !busy && spots.length > 0 && Math.random() < 0.7;
    const dest = pick(BUILDINGS);
    setPresence(b.id, {
      available,
      spotId: available ? pick(spots).id : null,
      destination: available ? { lat: dest.lat, lng: dest.lng, label: dest.name } : null,
    });
  }
}

function postBotRequest(people: UserRow[]) {
  const spots = openSpots();
  if (spots.length === 0) return;
  const requester = pick(people.filter((p) => orders.countActive(p.id, 'requester') < 2));
  if (!requester) return;
  const spot = pick(spots);
  const candidates = BUILDINGS.filter((b) => {
    const d = haversine(spot, b);
    return d > 120 && d < 900;
  });
  const dest = pick(candidates.length ? candidates : BUILDINGS);
  const suggestion = suggestTip({ spot, dropoff: dest, itemCount: 1 });
  const tipCents = Math.max(100, suggestion.suggestedCents + pick([-50, 0, 0, 50, 100]));
  // Légère dispersion autour du bâtiment pour que les épingles ne se superposent pas.
  const jitter = { lat: dest.lat + rand(-0.00012, 0.00012), lng: dest.lng + rand(-0.00018, 0.00018) };
  orders.createOrder(requester.id, {
    spotId: spot.id,
    items: [],
    custom: botRequest(spot),
    dropoff: { ...jitter, label: dest.name, note: pick(NOTES) },
    tipCents,
  });
}

/* ── Scénarios ───────────────────────────────────────────────────────── */

function courierFor(order: orders.OrderRow, people: UserRow[]): UserRow | undefined {
  const free = people.filter((p) => p.id !== order.requester_id && orders.countActive(p.id, 'courier') === 0);
  const atSpot = all<{ user_id: string }>('SELECT user_id FROM presence WHERE spot_id = ? AND available = 1', order.spot_id).map(
    (r) => r.user_id,
  );
  return free.find((p) => atSpot.includes(p.id)) ?? (free.length ? pick(free) : undefined);
}

/** Petit arc entre deux points, pour un déplacement moins robotique qu'une ligne droite. */
function walkPath(from: LatLng, to: LatLng, steps: number): LatLng[] {
  const bend = rand(-0.18, 0.18);
  const mid = lerp(from, to, 0.5);
  const ctrl = { lat: mid.lat + (to.lng - from.lng) * bend * 0.7, lng: mid.lng - (to.lat - from.lat) * bend * 1.4 };
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const a = lerp(from, ctrl, t);
    const b = lerp(ctrl, to, t);
    return lerp(a, b, t);
  });
}

function walk(orderId: string, botId: string, path: LatLng[], stepMs: number, done: () => void) {
  path.forEach((p, i) => later(i * stepMs, () => orders.updateCourierLocation(orderId, botId, p.lat, p.lng)));
  later(path.length * stepMs, done);
}

function botDeliversForHuman(orderId: string, people: UserRow[]) {
  later(rand(6000, 10000), () => {
    const row = orders.getRow(orderId);
    if (row.status !== 'open') return;
    const bot = courierFor(row, people);
    if (!bot) return;
    orders.accept(orderId, bot.id);

    const spot = spotOf(row.spot_id);
    const presence = one<{ spot_id: string | null }>('SELECT spot_id FROM presence WHERE user_id = ?', bot.id);
    const alreadyThere = presence?.spot_id === spot.id;
    setPresence(bot.id, { available: false, spotId: spot.id, destination: null });

    say(orderId, bot.id, alreadyThere ? `Hello ! Je suis déjà à ${spot.name}, je m’en occupe 👌` : `Hello ! Je passe par ${spot.name}, je m’en occupe.`, 1500);

    const start = alreadyThere ? spot : { lat: spot.lat + rand(-0.0012, 0.0012), lng: spot.lng + rand(-0.0016, 0.0016) };
    const toSpot = walkPath(start, spot, alreadyThere ? 2 : 10);
    walk(orderId, bot.id, toSpot, 1500, () => {
      if (Math.random() < 0.6) say(orderId, bot.id, 'Petite file, j’en ai pour 2 minutes.', 800);
      later(14000, () => {
        const current = orders.getRow(orderId);
        if (current.status !== 'accepted' || current.courier_id !== bot.id) return;
        // Le montant réservé est un plafond (prix visiteur, budget) : le ticket est souvent plus bas.
        const ticket = roundTo(current.items_cents * rand(0.75, 1), 10);
        const max = current.hold_cents - current.tip_cents;
        orders.pickUp(orderId, bot.id, Math.min(max, Math.max(50, ticket)));
        const dropoff = { lat: current.dropoff_lat, lng: current.dropoff_lng };
        const steps = Math.max(12, Math.round(haversine(spot, dropoff) / 25));
        walk(orderId, bot.id, walkPath(spot, dropoff, steps), 1500, () => {
          const arrived = orders.getRow(orderId);
          if (arrived.status !== 'picked_up') return;
          orders.markDelivered(orderId, bot.id);
          say(orderId, bot.id, arrived.dropoff_note ? 'Je suis là 👋 Je monte !' : 'Je suis devant 👋', 400);
        });
      });
    });
  });
}

export function startDemo() {
  const people = ensureBots();
  const botIds = new Set(people.map((p) => p.id));
  fundBots(people);
  shufflePresence(people);

  const keepFeedAlive = () => {
    const open = one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM orders WHERE status = 'open' AND requester_id IN (${people.map(() => '?').join(',')})`,
      ...people.map((p) => p.id),
    )!.n;
    if (open < 4) postBotRequest(people);
  };
  for (let i = 0; i < 4; i++) keepFeedAlive();
  setInterval(() => {
    fundBots(people);
    keepFeedAlive();
  }, 45_000);
  setInterval(() => shufflePresence(people), 5 * 60_000);

  bus.on('order.created', (orderId) => {
    const row = orders.getRow(orderId);
    if (!botIds.has(row.requester_id)) botDeliversForHuman(orderId, people);
  });

  bus.on('order.accepted', (orderId) => {
    const row = orders.getRow(orderId);
    if (botIds.has(row.requester_id) && !botIds.has(row.courier_id!)) {
      say(orderId, row.requester_id, row.dropoff_note ? `Merci beaucoup !! ${row.dropoff_note}` : 'Merci beaucoup, trop sympa 🙏', 2500);
    }
  });

  bus.on('order.picked_up', (orderId) => {
    const row = orders.getRow(orderId);
    if (botIds.has(row.requester_id) && !botIds.has(row.courier_id!)) say(orderId, row.requester_id, 'Parfait, à tout de suite !', 2500);
  });

  bus.on('order.delivered', (orderId) => {
    const row = orders.getRow(orderId);
    if (!botIds.has(row.requester_id)) return;
    later(4000, () => {
      orders.confirm(orderId, row.requester_id);
      addMessage(orderId, row.requester_id, 'Bien reçu, merci beaucoup 🙌');
    });
    later(6000, () => orders.rate(orderId, row.requester_id, Math.random() < 0.8 ? 5 : 4));
  });

  bus.on('order.completed', (orderId) => {
    const row = orders.getRow(orderId);
    if (row.courier_id && botIds.has(row.courier_id) && !botIds.has(row.requester_id)) {
      later(3000, () => orders.rate(orderId, row.courier_id!, 5));
      later(5000, () => shufflePresence([getUser(row.courier_id!)!]));
    }
  });

  bus.on('message.created', (message) => {
    if (!message.senderId || botIds.has(message.senderId) || message.kind !== 'text') return;
    const row = orders.getRow(message.orderId);
    const bot = [row.requester_id, row.courier_id].find((id) => id && botIds.has(id));
    if (!bot || !isBot(bot)) return;
    const text = message.body.toLowerCase();
    const courierWhere =
      row.status === 'delivered'
        ? `Je suis devant ${row.dropoff_label}, à l’entrée !`
        : row.status === 'picked_up'
          ? 'J’arrive, je suis à deux minutes !'
          : `Encore à ${SPOT_BY_ID.get(row.spot_id)?.name ?? 'au spot'}, je fais la queue.`;
    const reply = /où|ou es|where/.test(text)
      ? row.courier_id === bot
        ? courierWhere
        : `Je suis à ${row.dropoff_label}${row.dropoff_note ? ` · ${row.dropoff_note}` : ''}`
      : /merci|thanks/.test(text)
        ? 'Avec plaisir 😊'
        : /\?/.test(text)
          ? 'Oui pas de souci !'
          : pick(REPLIES);
    say(message.orderId, bot, reply, 900);
  });
}
