import type { Dropoff } from '../../shared/types';

export interface CreateOrderInput {
  spotId: string;
  items: { itemId: string; qty: number }[];
  dropoff: Dropoff;
  tipCents: number;
}
