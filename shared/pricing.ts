import { walkingDistance, walkingMinutes, formatDistance, type LatLng } from './geo';
import { ceilTo, clamp, roundTo } from './money';
import { zurichNow } from './hours';

/**
 * Marge ajoutée à l'estimation des articles au moment de la réservation.
 * Les prix affichés sont indicatifs : le rusher saisit le montant réel du
 * ticket, et tout ce qui n'est pas utilisé revient au demandeur.
 */
export const PRICE_MARGIN_RATE = 0.1;

export const TIP_MIN_CENTS = 100;
export const TIP_MAX_CENTS = 2000;
export const TIP_STEP_CENTS = 50;

const BASE_CENTS = 150;
const PER_300M_CENTS = 100;
const PER_EXTRA_ITEM_CENTS = 30;
const RUSH_HOUR_CENTS = 50;

export interface TipFactor {
  label: string;
  detail: string;
  cents: number;
}

export interface TipSuggestion {
  suggestedCents: number;
  options: { id: 'min' | 'suggested' | 'generous'; label: string; cents: number }[];
  factors: TipFactor[];
  distanceM: number;
  minutes: number;
}

/** Midi (11h45–13h30) : les files sont longues, le temps du rusher vaut plus. */
export function isRushHour(date = new Date()): boolean {
  const { day, minutes } = zurichNow(date);
  return day >= 1 && day <= 5 && minutes >= 11 * 60 + 45 && minutes <= 13 * 60 + 30;
}

/**
 * Pourboire suggéré pour une livraison. La formule est volontairement
 * simple et explicable : elle est affichée ligne par ligne à l'utilisateur.
 */
export function suggestTip(input: {
  spot: LatLng;
  dropoff: LatLng;
  itemCount: number;
  date?: Date;
}): TipSuggestion {
  const distanceM = walkingDistance(input.spot, input.dropoff);
  const minutes = walkingMinutes(distanceM);
  const extraItems = clamp(input.itemCount - 1, 0, 6);

  const factors: TipFactor[] = [{ label: 'Prise en charge', detail: 'Achat et attente au spot', cents: BASE_CENTS }];

  const distanceCents = roundTo((distanceM / 300) * PER_300M_CENTS, 10);
  factors.push({
    label: 'Trajet',
    detail: `${formatDistance(distanceM)} · ${minutes} min à pied`,
    cents: distanceCents,
  });

  if (extraItems > 0) {
    factors.push({
      label: 'Articles',
      detail: `${input.itemCount} articles à porter`,
      cents: extraItems * PER_EXTRA_ITEM_CENTS,
    });
  }

  if (isRushHour(input.date)) {
    factors.push({ label: 'Heure de pointe', detail: 'Files d’attente à midi', cents: RUSH_HOUR_CENTS });
  }

  const raw = factors.reduce((sum, f) => sum + f.cents, 0);
  const suggestedCents = clamp(roundTo(raw, TIP_STEP_CENTS), 150, 900);

  return {
    suggestedCents,
    distanceM,
    minutes,
    factors,
    options: [
      { id: 'min', label: 'Minimum', cents: Math.max(TIP_MIN_CENTS, suggestedCents - 50) },
      { id: 'suggested', label: 'Suggéré', cents: suggestedCents },
      { id: 'generous', label: 'Généreux', cents: suggestedCents + 100 },
    ],
  };
}

export interface HoldBreakdown {
  itemsCents: number;
  marginCents: number;
  tipCents: number;
  holdCents: number;
}

/** Montant bloqué sur le solde du demandeur à la publication de la demande. */
export function computeHold(itemsCents: number, tipCents: number): HoldBreakdown {
  const marginCents = ceilTo(Math.round(itemsCents * PRICE_MARGIN_RATE), 10);
  return { itemsCents, marginCents, tipCents, holdCents: itemsCents + marginCents + tipCents };
}

/** Répartition finale une fois la commande confirmée. */
export function settle(order: { holdCents: number; tipCents: number; actualItemsCents: number }) {
  const courierCents = order.actualItemsCents + order.tipCents;
  const refundCents = order.holdCents - courierCents;
  return { courierCents, refundCents };
}

/** Plafond que le rusher peut déclarer pour le ticket de caisse. */
export function maxActualItems(order: { holdCents: number; tipCents: number }): number {
  return order.holdCents - order.tipCents;
}

export function describeTip(cents: number, suggestion: TipSuggestion): string {
  if (cents > suggestion.suggestedCents) return 'Au-dessus du suggéré : ta demande ressort en premier.';
  if (cents < suggestion.suggestedCents) return 'En dessous du suggéré : l’attente peut être plus longue.';
  return `Juste pour ${formatDistance(suggestion.distanceM)} de trajet et l’attente au spot.`;
}

