const production = process.env.NODE_ENV === 'production';

export const env = {
  production,
  port: Number(process.env.PORT ?? process.env.RUSH_API_PORT ?? 8787),
  dbPath: process.env.RUSH_DB ?? 'data/rush.db',
  /** Rushers simulés qui acceptent, livrent et répondent : pratique pour tester seul. */
  demo: process.env.RUSH_DEMO === '1',
  /** Sans SMTP, le code de connexion est affiché dans la console du serveur. */
  smtpUrl: process.env.SMTP_URL ?? null,
  mailFrom: process.env.MAIL_FROM ?? 'Rush <no-reply@rush.epfl.ch>',
  /** Domaines autorisés à se connecter. */
  allowedDomains: (process.env.RUSH_ALLOWED_DOMAINS ?? 'epfl.ch')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
};
