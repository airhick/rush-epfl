import {
  Beer,
  Coffee,
  Croissant,
  Hamburger,
  Pizza,
  Salad,
  Sandwich,
  ShoppingBasket,
  Truck,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import type { SpotGlyph } from '../../shared/catalog';

/** Pictogrammes classiques, toujours en blanc sur fond noir. */
export const GLYPHS: Record<SpotGlyph, LucideIcon> = {
  utensils: Utensils,
  coffee: Coffee,
  sandwich: Sandwich,
  beer: Beer,
  truck: Truck,
  basket: ShoppingBasket,
  pizza: Pizza,
  burger: Hamburger,
  salad: Salad,
  croissant: Croissant,
};

/** Taille d'une photo Google (les URL du relevé n'ont pas de suffixe de taille). */
export function photoUrl(url: string, width: number, height = Math.round(width * 0.66)): string {
  return url.includes('googleusercontent.com') ? `${url}=w${width}-h${height}-k-no` : url;
}
