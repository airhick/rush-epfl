import type { Dropoff } from '../../shared/types';

export interface CreateOrderInput {
  spotId: string;
  items: { itemId: string; qty: number }[];
  custom?: { text: string; budgetCents: number } | null;
  dropoff: Dropoff;
  tipCents: number;
}
