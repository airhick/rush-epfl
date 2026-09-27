import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import { HttpError } from '../http';
import type { UserRow } from './users';
import { TOPUP_MAX_CENTS, TOPUP_MIN_CENTS } from '../../shared/payments';

/**
 * Stripe sans SDK ni clé secrète : le serveur n'appelle jamais l'API.
 * Les recharges passent par un lien de paiement « montant libre » créé une
 * fois dans Stripe, et seuls les webhooks signés avec le secret du point de
 * terminaison peuvent créditer un solde.
 */

/** Recharges ouvertes : lien réel pour les vrais comptes, lien de l'environnement de test Stripe pour le mode test. */
export const topupsEnabled = (test = false) =>
  test ? Boolean(env.stripeTestTopupUrl && env.stripeTestWebhookSecret) : Boolean(env.stripeTopupUrl && env.stripeWebhookSecret);

/** Lien de paiement personnalisé : compte, adresse et montant préremplis. */
export function topupUrl(user: Pick<UserRow, 'id' | 'email' | 'is_test'>, amountCents: number): string {
  const test = user.is_test === 1;
  if (!topupsEnabled(test)) {
    throw new HttpError(503, test ? 'Le paiement de test Stripe n’est pas encore configuré : utilise « + CHF 20 fictifs ».' : 'Les recharges ne sont pas encore ouvertes.');
  }
  if (!Number.isInteger(amountCents) || amountCents < TOPUP_MIN_CENTS || amountCents > TOPUP_MAX_CENTS) {
    throw new HttpError(422, 'Choisis un montant entre CHF 1 et CHF 100.');
  }
  const url = new URL(test ? env.stripeTestTopupUrl : env.stripeTopupUrl);
  // Stripe relie le paiement au compte grâce à client_reference_id (lettres, chiffres, tirets).
  url.searchParams.set('client_reference_id', user.id);
  url.searchParams.set('prefilled_amount', String(amountCents));
  // Les comptes de test ont une adresse en .invalid, que Stripe refuserait : le testeur tape la sienne.
  if (!test) url.searchParams.set('locked_prefilled_email', user.email);
  url.searchParams.set('locale', 'fr');
  return url.toString();
}

export interface StripeEvent {
  id: string;
  type: string;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
}

const TOLERANCE_S = 300;

/**
 * Vérifie l'en-tête Stripe-Signature (HMAC-SHA256 de « t.payload ») comme
 * le SDK officiel : horodatage récent et au moins une signature v1 valide.
 */
export function verifyWebhook(payload: string, header: string | undefined, secret = env.stripeWebhookSecret, now = Date.now()): StripeEvent {
  if (!secret) throw new HttpError(503, 'Webhook Stripe non configuré.');
  if (!header) throw new HttpError(400, 'Signature Stripe manquante.');

  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't') timestamp = value;
    else if (key === 'v1' && value) signatures.push(value);
  }
  const seconds = Number(timestamp);
  if (!timestamp || !Number.isFinite(seconds) || signatures.length === 0) throw new HttpError(400, 'Signature Stripe illisible.');
  if (Math.abs(now / 1000 - seconds) > TOLERANCE_S) throw new HttpError(400, 'Signature Stripe expirée.');

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest();
  const valid = signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) throw new HttpError(400, 'Signature Stripe invalide.');

  try {
    return JSON.parse(payload) as StripeEvent;
  } catch {
    throw new HttpError(400, 'Évènement Stripe illisible.');
  }
}

/**
 * Webhook réel ou de test : chaque environnement Stripe signe avec son propre
 * secret. Un évènement signé par le secret de test doit être un évènement de
 * test (livemode false), et inversement.
 */
export function verifyAnyWebhook(payload: string, header: string | undefined): { event: StripeEvent; test: boolean } {
  const attempts: [string, boolean][] = [
    [env.stripeWebhookSecret, false],
    [env.stripeTestWebhookSecret, true],
  ];
  let lastError: unknown = new HttpError(503, 'Webhook Stripe non configuré.');
  for (const [secret, test] of attempts) {
    if (!secret) continue;
    try {
      const event = verifyWebhook(payload, header, secret);
      if (event.livemode !== undefined && event.livemode === test) throw new HttpError(400, 'Environnement Stripe incohérent.');
      return { event, test };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** Signe un évènement comme Stripe (tests et essais en local). */
export function signPayload(payload: string, secret: string, seconds = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${seconds}.${payload}`).digest('hex');
  return `t=${seconds},v1=${sig}`;
}
