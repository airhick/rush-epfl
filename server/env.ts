const production = process.env.NODE_ENV === 'production';

export const env = {
  production,
  port: Number(process.env.PORT ?? process.env.RUSH_API_PORT ?? 8787),
  dbPath: process.env.RUSH_DB ?? 'data/rush.db',
  /** Rushers simulés qui acceptent, livrent et répondent : pratique pour tester seul. */
  demo: process.env.RUSH_DEMO === '1',
  /** Crédit offert à chaque nouveau compte, en centimes (CHF 1.00 par défaut). */
  welcomeBonusCents: Math.max(0, Math.round(Number(process.env.RUSH_WELCOME_BONUS_CENTS ?? 100)) || 0),
  /** Envoi des codes par l'API HTTP de Brevo (à privilégier : Render gratuit bloque le SMTP). */
  brevoApiKey: process.env.BREVO_API_KEY ?? null,
  /** Sans Brevo ni SMTP, le code de connexion est affiché dans la console du serveur. */
  smtpUrl: process.env.SMTP_URL ?? null,
  /** Clé Google Maps Platform (Places API New) : photos et avis Google des spots. */
  googleMapsKey: process.env.GOOGLE_MAPS_API_KEY ?? null,
  /** Expéditeur ; avec Brevo, une adresse validée dans le compte Brevo. */
  mailFrom: process.env.MAIL_FROM ?? 'Rush <no-reply@rush.epfl.ch>',
  mailFromSet: Boolean(process.env.MAIL_FROM),
  /** Domaines autorisés à se connecter. */
  allowedDomains: (process.env.RUSH_ALLOWED_DOMAINS ?? 'epfl.ch')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
};
