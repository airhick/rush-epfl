import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z, ZodError } from 'zod';
import { env } from './env';
import { HttpError, type AppEnv } from './http';
import * as auth from './services/auth';
import * as orders from './services/orders';
import * as messages from './services/messages';
import * as ledger from './services/ledger';
import * as presence from './services/presence';
import { getUser, publicUser, toMe, updateProfile } from './services/users';
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from '../shared/pricing';
import type { Conversation } from '../shared/types';

const latLng = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };

const schemas = {
  email: z.object({ email: z.string().max(120) }),
  verify: z.object({ email: z.string().max(120), code: z.string().regex(/^\s*\d{6}\s*$/, 'Le code fait 6 chiffres.') }),
  profile: z.object({
    firstName: z.string().trim().min(1).max(40),
    lastName: z.string().trim().max(60),
    section: z.string().trim().max(40).nullable(),
  }),
  order: z.object({
    spotId: z.string(),
    items: z.array(z.object({ itemId: z.string(), qty: z.number().int().min(1).max(12) })).min(1).max(20),
    dropoff: z.object({ ...latLng, label: z.string().trim().min(1).max(60), note: z.string().trim().max(140) }),
    tipCents: z.number().int().min(TIP_MIN_CENTS).max(TIP_MAX_CENTS),
  }),
  pickup: z.object({ actualItemsCents: z.number().int().positive() }),
  rate: z.object({ stars: z.number().int().min(1).max(5) }),
  message: z.object({ body: z.string().trim().min(1).max(500) }),
  topup: z.object({
    amountCents: z.number().int().min(500).max(20_000),
    method: z.enum(['twint', 'card', 'camipro']),
  }),
  presence: z.object({
    available: z.boolean(),
    spotId: z.string().nullable(),
    destination: z.object({ ...latLng, label: z.string().max(60) }).nullable(),
  }),
};

async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => {
    throw new HttpError(400, 'Requête invalide.');
  });
  return schema.parse(json);
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: err.issues[0]?.message ?? 'Données invalides.' }, 422);
    console.error(err);
    return c.json({ error: 'Une erreur inattendue est survenue.' }, 500);
  });

  const api = new Hono<AppEnv>();

  /* ── Authentification ─────────────────────────────────────────────── */

  api.post('/auth/request', async (c) => {
    const { email } = await body(c, schemas.email);
    const result = await auth.requestCode(email);
    return c.json({ ok: true, ...result });
  });

  api.post('/auth/verify', async (c) => {
    const { email, code } = await body(c, schemas.verify);
    const { user, token } = auth.verifyCode(email, code);
    setCookie(c, auth.SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: env.production,
      path: '/',
      maxAge: auth.SESSION_TTL_MS / 1000,
    });
    return c.json(toMe(user));
  });

  api.post('/auth/logout', (c) => {
    auth.destroySession(getCookie(c, auth.SESSION_COOKIE));
    deleteCookie(c, auth.SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  /* Tout ce qui suit exige une session. */
  api.use('*', async (c, next) => {
    const user = auth.userFromToken(getCookie(c, auth.SESSION_COOKIE));
    if (!user) throw new HttpError(401, 'Connecte-toi pour continuer.');
    c.set('user', user);
    await next();
  });

  const me = (c: Context<AppEnv>) => c.get('user');

  /* ── Profil ───────────────────────────────────────────────────────── */

  api.get('/me', (c) => c.json(toMe(me(c))));

  api.patch('/me', async (c) => {
    const patch = await body(c, schemas.profile);
    updateProfile(me(c).id, patch);
    return c.json(toMe(getUser(me(c).id)!));
  });

  api.get('/users/:id', (c) => c.json(publicUser(c.req.param('id'))));

  /* ── Activité des spots et présence des rushers ───────────────────── */

  api.get('/activity', (c) => c.json(presence.activity()));
  api.get('/presence', (c) => c.json(presence.getPresence(me(c).id)));
  api.put('/presence', async (c) => c.json(presence.setPresence(me(c).id, await body(c, schemas.presence))));

  /* ── Commandes ────────────────────────────────────────────────────── */

  api.get('/orders', (c) => c.json(orders.listMine(me(c).id)));
  api.get('/orders/open', (c) => c.json(orders.listOpen(me(c).id)));
  api.post('/orders', async (c) => c.json(orders.createOrder(me(c).id, await body(c, schemas.order)), 201));
  api.get('/orders/:id', (c) => c.json(orders.orderFor(c.req.param('id'), me(c).id)));

  api.post('/orders/:id/accept', (c) => c.json(orders.accept(c.req.param('id'), me(c).id)));
  api.post('/orders/:id/release', (c) => c.json(orders.release(c.req.param('id'), me(c).id)));
  api.post('/orders/:id/pickup', async (c) => {
    const { actualItemsCents } = await body(c, schemas.pickup);
    return c.json(orders.pickUp(c.req.param('id'), me(c).id, actualItemsCents));
  });
  api.post('/orders/:id/deliver', (c) => c.json(orders.markDelivered(c.req.param('id'), me(c).id)));
  api.post('/orders/:id/confirm', (c) => c.json(orders.confirm(c.req.param('id'), me(c).id)));
  api.post('/orders/:id/cancel', (c) => c.json(orders.cancel(c.req.param('id'), me(c).id)));
  api.post('/orders/:id/rate', async (c) => {
    const { stars } = await body(c, schemas.rate);
    return c.json(orders.rate(c.req.param('id'), me(c).id, stars));
  });

  /* ── Messagerie ───────────────────────────────────────────────────── */

  const participantOrder = (c: Context<AppEnv>) => {
    const order = orders.orderFor(c.req.param('id')!, me(c).id);
    if (!order.myRole) throw new HttpError(403, 'Cette conversation ne te concerne pas.');
    return order;
  };

  api.get('/orders/:id/messages', (c) => {
    const order = participantOrder(c);
    return c.json(messages.listMessages(order.id));
  });

  api.post('/orders/:id/messages', async (c) => {
    const order = participantOrder(c);
    if (!order.courier) throw new HttpError(409, 'La conversation s’ouvre dès qu’un rusher accepte.');
    const { body: text } = await body(c, schemas.message);
    return c.json(messages.addMessage(order.id, me(c).id, text), 201);
  });

  api.post('/orders/:id/read', (c) => {
    const order = participantOrder(c);
    messages.markRead(order.id, me(c).id);
    return c.json({ ok: true });
  });

  api.get('/conversations', (c) => {
    const userId = me(c).id;
    const list: Conversation[] = orders
      .listMine(userId)
      .filter((o) => o.courier)
      .map((order) => ({
        order,
        other: order.myRole === 'requester' ? order.courier : order.requester,
        lastMessage: messages.lastMessage(order.id),
        unread: messages.unreadCount(order.id, userId),
      }))
      .sort((a, b) => (b.lastMessage?.createdAt ?? b.order.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.order.createdAt));
    return c.json(list);
  });

  /* ── Solde ────────────────────────────────────────────────────────── */

  api.get('/wallet', (c) => c.json(ledger.wallet(me(c).id)));
  api.post('/wallet/topup', async (c) => {
    const { amountCents, method } = await body(c, schemas.topup);
    ledger.topUp(me(c).id, amountCents, method);
    return c.json(ledger.wallet(me(c).id));
  });

  app.route('/api', api);
  return app;
}
