import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SPOT_BY_ID, findItem } from '../../shared/catalog';

interface CartState {
  spotId: string | null;
  lines: Record<string, number>;
  tipCents: number | null;
  add: (spotId: string, itemId: string) => void;
  setQty: (itemId: string, qty: number) => void;
  setTip: (cents: number | null) => void;
  clear: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      spotId: null,
      lines: {},
      tipCents: null,
      add: (spotId, itemId) =>
        set((s) => {
          const lines = s.spotId === spotId ? { ...s.lines } : {};
          lines[itemId] = Math.min(12, (lines[itemId] ?? 0) + 1);
          return { spotId, lines, tipCents: s.spotId === spotId ? s.tipCents : null };
        }),
      setQty: (itemId, qty) =>
        set((s) => {
          const lines = { ...s.lines };
          if (qty <= 0) delete lines[itemId];
          else lines[itemId] = Math.min(12, qty);
          return Object.keys(lines).length ? { lines } : { lines, spotId: null, tipCents: null };
        }),
      setTip: (tipCents) => set({ tipCents }),
      clear: () => set({ spotId: null, lines: {}, tipCents: null }),
    }),
    { name: 'rush.cart' },
  ),
);

export interface CartLine {
  itemId: string;
  name: string;
  qty: number;
  priceCents: number;
}

/** Vue dérivée du panier, toujours recalculée depuis le catalogue. */
export function useCartSummary() {
  const { spotId, lines } = useCart();
  const spot = spotId ? SPOT_BY_ID.get(spotId) : undefined;
  const items: CartLine[] = [];
  if (spot) {
    for (const [itemId, qty] of Object.entries(lines)) {
      const item = findItem(spot, itemId);
      if (item) items.push({ itemId, name: item.name, qty, priceCents: item.priceCents });
    }
  }
  const count = items.reduce((n, i) => n + i.qty, 0);
  const subtotalCents = items.reduce((s, i) => s + i.qty * i.priceCents, 0);
  return { spot, items, count, subtotalCents };
}
