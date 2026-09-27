import webpush from 'web-push';
import { all, one, run } from '../db';
import { env } from '../env';
import { HttpError } from '../http';
import { isActive } from '../realtime';
import type { PushMessage } from '../../shared/types';

/*
 * Notifications push (Web Push, clés VAPID) : elles arrivent même app fermée,
 * via le service worker (public/sw.js). On ne les envoie qu'aux personnes qui
 * n'ont pas l'app à l'écran : sinon l'app affiche déjà la course ou le toast.
 */

export const pushEnabled = () => Boolean(env.vapidPublicKey && env.vapidPrivateKey);

let configured = false;
function configure() {
  if (configured || !pushEnabled()) return;
  // L'adresse de l'app sert de contact pour les services push (Google, Mozilla, Apple).
  webpush.setVapidDetails(env.publicUrl || 'https://rush-epfl.onrender.com', env.vapidPublicKey, env.vapidPrivateKey);
  configured = true;
}

/** Seuls les services push des navigateurs : le serveur ne contacte jamais une adresse choisie par le client. */
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscribe(userId: string, sub: Subscription) {
  let url: URL;
  try {
    url = new URL(sub.endpoint);
  } catch {
    throw new HttpError(422, 'Abonnement invalide.');
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((h) => h.test(url.hostname))) {
    throw new HttpError(422, 'Service de notification non reconnu.');
  }
  // Un navigateur = un endpoint : s'il change de compte, l'abonnement suit le compte connecté.
  run(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    sub.endpoint,
    userId,
    sub.keys.p256dh,
    sub.keys.auth,
    Date.now(),
  );
}

export function unsubscribe(userId: string, endpoint: string) {
  run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', endpoint, userId);
}

export const hasPush = (userId: string) => Boolean(one('SELECT 1 AS x FROM push_subscriptions WHERE user_id = ?', userId));

/** Comptes joignables par push, même sans l'app ouverte. */
export const usersWithPush = () => all<{ user_id: string }>('SELECT DISTINCT user_id FROM push_subscriptions').map((r) => r.user_id);

type Sender = (sub: Subscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;
let sender: Sender = (sub, payload, options) => {
  configure();
  return webpush.sendNotification(sub, payload, options);
};
/** Pour les tests : capture les envois au lieu de contacter les services push. */
export function setPushSender(s: Sender) {
  sender = s;
}

/**
 * Envoie une notification à tous les appareils d'un compte, sauf s'il a l'app
 * à l'écran (`force` pour envoyer quand même). Ne jette jamais : une
 * notification ratée ne doit pas faire échouer l'action qui l'a déclenchée.
 */
export async function notify(userId: string, message: PushMessage, opts: { ttlSeconds?: number; force?: boolean } = {}): Promise<number> {
  if (!pushEnabled() || (!opts.force && isActive(userId))) return 0;
  const subs = all<{ endpoint: string; p256dh: string; auth: string }>('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(message), {
          TTL: opts.ttlSeconds ?? 6 * 3600,
          urgency: message.kind === 'offer' || message.kind === 'message' ? 'high' : 'normal',
          topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
        });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // Abonnement expiré ou révoqué par la personne : on l'oublie.
        if (status === 404 || status === 410) run('DELETE FROM push_subscriptions WHERE endpoint = ?', s.endpoint);
        else console.warn(`[push] envoi raté (${status ?? 'réseau'}) : ${(err as Error).message}`);
      }
    }),
  );
  return sent;
}
