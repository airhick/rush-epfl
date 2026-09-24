const production = process.env.NODE_ENV === 'production';

export const env = {
  production,
  port: Number(process.env.PORT ?? process.env.RUSH_API_PORT ?? 8787),
  dbPath: process.env.RUSH_DB ?? 'data/rush.db',
  /** Rushers simulés qui acceptent, livrent et répondent : pratique pour tester seul. */
  demo: process.env.RUSH_DEMO === '1',
  /** Crédit offert à chaque nouveau compte, en centimes (CHF 1.00 par défaut). */
  welcomeBonusCents: Math.max(0, Math.round(Number(process.env.RUSH_WELCOME_BONUS_CENTS ?? 100)) || 0),
  /** Clé Google Maps Platform (Places API New) : photos et avis Google des spots. */
  googleMapsKey: process.env.GOOGLE_MAPS_API_KEY ?? null,
  /** Domaines autorisés à se connecter. */
  allowedDomains: (process.env.RUSH_ALLOWED_DOMAINS ?? 'epfl.ch')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
};
