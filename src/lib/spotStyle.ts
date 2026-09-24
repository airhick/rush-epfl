import {
  Beer,
  Coffee,
  Croissant,
  CupSoda,
  Hamburger,
  IceCreamCone,
  Pizza,
  Salad,
  Sandwich,
  ShoppingBasket,
  Truck,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { SpotGlyph, SpotKind } from '../../shared/catalog';

export const GLYPHS: Record<SpotGlyph, LucideIcon> = {
  utensils: UtensilsCrossed,
  coffee: Coffee,
  sandwich: Sandwich,
  beer: Beer,
  truck: Truck,
  basket: ShoppingBasket,
  soda: CupSoda,
  pizza: Pizza,
  burger: Hamburger,
  icecream: IceCreamCone,
  salad: Salad,
  croissant: Croissant,
};

/** Une teinte par famille, comme les catégories de lieux d'Apple Plans. */
export const KIND_TINT: Record<SpotKind, [string, string]> = {
  restaurant: ['#FF9F0A', '#FF7A00'],
  cafe: ['#B98B63', '#8E6240'],
  cafeteria: ['#32ADE6', '#0A84C9'],
  bar: ['#BF5AF2', '#8E3FD6'],
  foodtruck: ['#FF5E57', '#E5304A'],
  grocery: ['#34C759', '#1FA44A'],
  vending: ['#6E6CF0', '#4845C7'],
};

export const tintGradient = (kind: SpotKind, angle = 150) => {
  const [a, b] = KIND_TINT[kind];
  return `linear-gradient(${angle}deg, ${a}, ${b})`;
};
