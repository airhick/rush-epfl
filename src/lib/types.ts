import type { Dropoff } from '../../shared/types';

export interface CreateOrderInput {
  spotId: string;
  items: { itemId: string; qty: number }[];
  custom?: { text: string; budgetCents: number } | null;
  dropoff: Dropoff;
  /** Coup de pouce facultatif ; le tarif est calculé par le serveur. */
  bonusCents: number;
}
