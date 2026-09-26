import { randomBytes } from 'node:crypto';

const production = process.env.NODE_ENV === 'production';

const list = (raw: string) =>
  raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

export const env = {
  production,
  port: Number(process.env.PORT ?? process.env.RUSH_API_PORT ?? 8787),
  dbPath: process.env.RUSH_DB ?? 'data/rush.db',
  /** Rushers simulés qui acceptent, livrent et répondent : pratique pour tester seul. */
  demo: process.env.RUSH_DEMO === '1',
  /**
   * Clé du cookie de compte (chiffré) qui garde la connexion et permet de recréer le compte
   * si la base a été vidée. Doit rester la même d'un démarrage à l'autre : sans elle en
   * production, ce cookie est désactivé.
   */
  cookieSecret: process.env.RUSH_COOKIE_SECRET ?? (production ? '' : randomBytes(32).toString('hex')),
  /** Crédit offert à chaque nouveau compte, en centimes (CHF 1.00 par défaut). */
  welcomeBonusCents: Math.max(0, Math.round(Number(process.env.RUSH_WELCOME_BONUS_CENTS ?? 100)) || 0),
  /** Domaines autorisés à se connecter. */
  allowedDomains: list(process.env.RUSH_ALLOWED_DOMAINS ?? 'epfl.ch'),
  /** Adresses de l'équipe Rush : elles traitent les retraits (et peuvent se connecter hors @epfl.ch). */
  adminEmails: list(process.env.RUSH_ADMIN_EMAILS ?? ''),
  /** Lien de paiement Stripe « montant libre » (https://buy.stripe.com/…) pour recharger le solde. */
  stripeTopupUrl: process.env.STRIPE_TOPUP_URL ?? '',
  /** Secret de signature du webhook Stripe (whsec_…) : seul un évènement signé crédite un solde. */
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  /** Sujet ntfy.sh facultatif : notification sur téléphone à chaque demande de retrait. */
  ntfyTopic: process.env.RUSH_NTFY_TOPIC ?? '',
  /**
   * Connexion EPFL (Microsoft Entra ID, OpenID Connect). Application enregistrée sur app-portal.epfl.ch :
   * sans identifiant ni secret, seule la connexion par mot de passe est proposée.
   */
  entraClientId: process.env.ENTRA_CLIENT_ID ?? '',
  entraClientSecret: process.env.ENTRA_CLIENT_SECRET ?? '',
  /** Annuaire EPFL : seuls ses comptes peuvent se connecter. */
  entraTenantId: process.env.ENTRA_TENANT_ID ?? 'f6c2556a-c4fb-4ab1-a2c7-9e220df11c43',
  /** Adresse publique de l'app (fournie par Render), pour les liens des notifications. */
  publicUrl: (process.env.RUSH_PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? '').replace(/\/$/, ''),
};
