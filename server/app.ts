import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z, ZodError } from 'zod';
import { env } from './env';
import { HttpError, type AppEnv } from './http';
import * as auth from './services/auth';
import * as orders from './services/orders';
import * as messages from './services/messages';
import * as presence from './services/presence';
import * as places from './services/places';
import * as epflMenus from './services/epflMenus';
import * as entra from './services/entra';
import * as stripe from './services/stripe';
import * as payments from './services/payments';
import { getUser, isAdmin, publicUser, toMe, updateProfile } from './services/users';
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from '../shared/pricing';
import { CUSTOM_BUDGET_MAX_CENTS, CUSTOM_BUDGET_MIN_CENTS, CUSTOM_TEXT_MAX, SPOT_BY_ID } from '../shared/catalog';
import type { AuthOptions, Conversation } from '../shared/types';

const latLng = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };

const schemas = {
  email: z.object({ email: z.string().max(120) }),
  credentials: z.object({ email: z.string().max(120), password: z.string().min(1, 'Entre ton mot de passe.').max(200) }),
  profile: z.object({
    firstName: z.string().trim().min(1).max(40),
    lastName: z.string().trim().max(60),
    section: z.string().trim().max(40).nullable(),
  }),
  order: z.object({
    spotId: z.string(),
    items: z.array(z.object({ itemId: z.string().max(64), qty: z.number().int().min(1).max(12) })).max(20),
    custom: z
      .object({
        text: z.string().trim().min(3, 'Décris ta demande en quelques mots.').max(CUSTOM_TEXT_MAX),
        budgetCents: z.number().int().min(CUSTOM_BUDGET_MIN_CENTS).max(CUSTOM_BUDGET_MAX_CENTS),
      })
      .nullish(),
    dropoff: z.object({ ...latLng, label: z.string().trim().min(1).max(60), note: z.string().trim().max(140) }),
    tipCents: z.number().int().min(TIP_MIN_CENTS).max(TIP_MAX_CENTS),
  }),
  pickup: z.object({ actualItemsCents: z.number().int().positive() }),
  rate: z.object({ stars: z.number().int().min(1).max(5) }),
  message: z.object({ body: z.string().trim().min(1).max(500) }),
  topup: z.object({ amountCents: z.number().int() }),
  withdrawal: z.object({ amountCents: z.number().int().positive(), phone: z.string().max(40) }),
  reject: z.object({ reason: z.string().trim().min(3, 'Explique le refus en quelques mots.').max(200) }),
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

  /* Sonde de santé pour l'hébergeur (Render, Docker…). */
  api.get('/health', (c) => c.json({ ok: true }));

  /* ── Authentification ─────────────────────────────────────────────── */

  const signIn = (c: Context, { user, token }: auth.SignedIn) => {
    setCookie(c, auth.SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: env.production,
      path: '/',
      maxAge: auth.SESSION_TTL_MS / 1000,
    });
    return toMe(user);
  };

  /* L'écran de connexion demande d'abord si l'adresse a un compte. */
  api.post('/auth/check', async (c) => {
    const { email } = await body(c, schemas.email);
    return c.json(auth.accountExists(email));
  });

  api.post('/auth/login', async (c) => {
    const { email, password } = await body(c, schemas.credentials);
    return c.json(signIn(c, await auth.login(email, password)));
  });

  api.post('/auth/register', async (c) => {
    const { email, password } = await body(c, schemas.credentials);
    return c.json(signIn(c, await auth.register(email, password)), 201);
  });

  /* ── Connexion EPFL (Entra ID) : aller-retour chez Microsoft, puis session Rush ── */

  const EPFL_COOKIE = 'rush_epfl';
  const EPFL_PATH = '/api/auth/epfl';
  // Derrière le proxy de l'hébergeur, l'URL reçue est en http : on prend l'adresse publique.
  const epflCallback = (c: Context) => `${env.publicUrl || new URL(c.req.url).origin}${EPFL_PATH}/callback`;

  api.get('/auth/options', (c) => c.json<AuthOptions>({ epfl: entra.epflEnabled() }));

  api.get('/auth/epfl', (c) => {
    try {
      const { url, state } = entra.beginLogin(epflCallback(c), { next: c.req.query('next'), loginHint: c.req.query('login_hint') });
      setCookie(c, EPFL_COOKIE, entra.encodeState(state), {
        httpOnly: true,
        sameSite: 'Lax',
        secure: env.production,
        path: EPFL_PATH,
        maxAge: 600,
      });
      return c.redirect(url, 302);
    } catch (err) {
      if (err instanceof entra.EpflLoginError) return c.redirect(`/?epfl=${err.code}`, 302);
      throw err;
    }
  });

  api.get('/auth/epfl/callback', async (c) => {
    const saved = entra.decodeState(getCookie(c, EPFL_COOKIE));
    deleteCookie(c, EPFL_COOKIE, { path: EPFL_PATH });
    try {
      const profile = await entra.completeLogin(c.req.query(), saved, epflCallback(c));
      signIn(c, auth.signInWithEpfl(profile));
      return c.redirect(entra.safeNext(saved?.next), 302);
    } catch (err) {
      const code = err instanceof entra.EpflLoginError ? err.code : err instanceof HttpError ? 'account' : 'failed';
      console.warn(`[epfl] connexion refusée (${code}) : ${(err as Error).message}`);
      return c.redirect(`/?epfl=${code}`, 302);
    }
  });

  api.post('/auth/logout', (c) => {
    auth.destroySession(getCookie(c, auth.SESSION_COOKIE));
    deleteCookie(c, auth.SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  /* ── Menus du jour et photos des spots : données publiques, sans session ── */

  const spotParam = (c: Context<AppEnv>) => {
    const spot = SPOT_BY_ID.get(c.req.param('id') ?? '');
    if (!spot) throw new HttpError(404, 'Spot inconnu.');
    return spot;
  };

  api.get('/spots/:id/menu', async (c) => c.json(await epflMenus.spotMenu(spotParam(c))));
  api.get('/spots/:id/media', (c) => c.json(places.placeMedia(spotParam(c).id)));

  /* Webhook Stripe : authentifié par sa signature, pas par une session. */
  api.post('/stripe/webhook', async (c) => {
    const event = stripe.verifyWebhook(await c.req.text(), c.req.header('stripe-signature'));
    return c.json({ received: true, outcome: payments.handleStripeEvent(event) });
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
  api.post('/orders', async (c) => {
    const input = await body(c, schemas.order);
    const spot = SPOT_BY_ID.get(input.spotId);
    // Les prix viennent toujours du serveur : offre du jour EPFL ou carte officielle.
    const menu = spot ? (await epflMenus.spotMenu(spot)).sections : [];
    return c.json(orders.createOrder(me(c).id, input, new Date(), menu), 201);
  });
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

  api.get('/wallet', (c) => c.json(payments.walletView(me(c).id)));

  /* Recharge : lien de paiement Stripe prérempli, puis crédit par le webhook. */
  api.post('/topups', async (c) => {
    const { amountCents } = await body(c, schemas.topup);
    return c.json({ url: stripe.topupUrl(me(c), amountCents) });
  });
  api.get('/topups/:sessionId', (c) => c.json(payments.topupStatus(me(c).id, c.req.param('sessionId'))));

  /* Retrait : demandé ici, envoyé par TWINT par l'équipe Rush. */
  api.post('/withdrawals', async (c) => {
    const { amountCents, phone } = await body(c, schemas.withdrawal);
    return c.json(payments.requestWithdrawal(me(c).id, amountCents, phone), 201);
  });
  api.post('/withdrawals/:id/cancel', (c) => c.json(payments.cancelWithdrawal(me(c).id, c.req.param('id'))));

  /* ── Équipe Rush ──────────────────────────────────────────────────── */

  const owner = (c: Context<AppEnv>) => {
    if (!isAdmin(me(c))) throw new HttpError(403, 'Réservé à l’équipe Rush.');
    return me(c);
  };

  api.get('/admin/withdrawals', (c) => {
    owner(c);
    return c.json(payments.ownerOverview());
  });
  api.post('/admin/withdrawals/:id/paid', (c) => c.json(payments.markPaid(owner(c).id, c.req.param('id'))));
  api.post('/admin/withdrawals/:id/reject', async (c) => {
    const admin = owner(c);
    const { reason } = await body(c, schemas.reject);
    return c.json(payments.reject(admin.id, c.req.param('id'), reason));
  });

  // Route d'API inconnue : 404 JSON plutôt que la page de l'app.
  api.all('*', (c) => c.json({ error: 'Introuvable.' }, 404));

  app.route('/api', api);
  return app;
}
