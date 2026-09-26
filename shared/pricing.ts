/**
 * Tarif de livraison : CHF 0.50 par tranche de CHF 5 commencée, calculé sur le
 * montant maximum des articles (prix publié le plus élevé, ou budget d'une
 * demande libre). Tout va au rusher : Rush ne prend rien.
 *
 *   CHF 3.50 → 0.50 · CHF 10.00 → 1.00 · CHF 12.50 → 1.50 · CHF 23.00 → 2.50
 */
export const FEE_SLICE_CENTS = 500;
export const FEE_PER_SLICE_CENTS = 50;

/** Coup de pouce facultatif du demandeur, en plus du tarif, pour être pris plus vite. */
export const BONUS_OPTIONS_CENTS = [0, 50, 100, 200] as const;
export const BONUS_MAX_CENTS = 1000;

export function deliveryFee(itemsCents: number): number {
  return Math.max(1, Math.ceil(itemsCents / FEE_SLICE_CENTS)) * FEE_PER_SLICE_CENTS;
}

export interface HoldBreakdown {
  itemsCents: number;
  feeCents: number;
  bonusCents: number;
  /** Ce que touche le rusher en plus du remboursement des articles. */
  rewardCents: number;
  holdCents: number;
}

/**
 * Montant bloqué sur le solde du demandeur à la publication : articles au prix
 * maximum, plus la rémunération du rusher. Pas de marge : le ticket réel ne
 * peut pas dépasser le prix publié le plus élevé ni le budget fixé.
 */
export function computeHold(itemsCents: number, bonusCents = 0): HoldBreakdown {
  const feeCents = deliveryFee(itemsCents);
  const rewardCents = feeCents + bonusCents;
  return { itemsCents, feeCents, bonusCents, rewardCents, holdCents: itemsCents + rewardCents };
}

/** Répartition finale une fois la commande confirmée. */
export function settle(order: { holdCents: number; rewardCents: number; actualItemsCents: number }) {
  const courierCents = order.actualItemsCents + order.rewardCents;
  const refundCents = order.holdCents - courierCents;
  return { courierCents, refundCents };
}

/** Plafond que le rusher peut déclarer pour le ticket de caisse. */
export function maxActualItems(order: { holdCents: number; rewardCents: number }): number {
  return order.holdCents - order.rewardCents;
}

/** « 2 tranches de CHF 5 » : l'explication affichée sous le tarif. */
export function feeSlices(itemsCents: number): number {
  return deliveryFee(itemsCents) / FEE_PER_SLICE_CENTS;
}
