/**
 * Entrées et sorties d'argent réel. Les recharges passent par un lien de
 * paiement Stripe (montant choisi par l'utilisateur) ; les retraits sont
 * demandés dans l'app et envoyés à la main par TWINT par l'équipe Rush.
 */

export const TOPUP_MIN_CENTS = 100;
export const TOPUP_MAX_CENTS = 10_000;
export const TOPUP_PRESETS_CENTS = [500, 1000, 2000, 5000];

export const WITHDRAW_MIN_CENTS = 100;

/**
 * Numéro TWINT : un mobile suisse (07x). Accepte « 079 123 45 67 »,
 * « +41 79 123 45 67 » ou « 0041791234567 » et rend « +41791234567 ».
 */
export function normalizeTwintPhone(raw: string): string | null {
  const compact = raw.replace(/[\s.\-/()]/g, '');
  const match = /^(?:\+41|0041|0)(7[5-9]\d{7})$/.exec(compact);
  return match ? `+41${match[1]}` : null;
}

/** +41791234567 → 079 123 45 67 */
export function formatPhone(e164: string): string {
  const local = `0${e164.replace(/^\+41/, '')}`;
  return local.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4');
}
