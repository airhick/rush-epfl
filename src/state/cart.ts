import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CUSTOM_ITEM_ID, SPOT_BY_ID, type MenuItem } from '../../shared/catalog';

export interface CartLine {
  itemId: string;
  name: string;
  qty: number;
  /** Montant réservé par article (prix publié le plus élevé), recalculé par le serveur. */
  priceCents: number;
  custom?: boolean;
}

export interface CustomRequest {
  text: string;
  budgetCents: number;
}

interface CartState {
  spotId: string | null;
  /** Jour de la demande : les plats du jour EPFL ne valent que ce jour-là. */
  day: string | null;
  lines: Record<string, CartLine>;
  custom: CustomRequest | null;
  tipCents: number | null;
  add: (spotId: string, item: MenuItem) => void;
  setQty: (itemId: string, qty: number) => void;
  setCustom: (spotId: string, custom: CustomRequest | null) => void;
  setTip: (cents: number | null) => void;
  clear: () => void;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
const EMPTY = { spotId: null, day: null, lines: {}, custom: null, tipCents: null };
const isEmpty = (lines: Record<string, CartLine>, custom: CustomRequest | null) => Object.keys(lines).length === 0 && !custom;

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      ...EMPTY,
      add: (spotId, item) =>
        set((s) => {
          const same = s.spotId === spotId;
          const lines = same ? { ...s.lines } : {};
          const qty = Math.min(12, (lines[item.id]?.qty ?? 0) + 1);
          lines[item.id] = { itemId: item.id, name: item.name, qty, priceCents: item.priceCents };
          return { spotId, day: today(), lines, custom: same ? s.custom : null, tipCents: same ? s.tipCents : null };
        }),
      setQty: (itemId, qty) =>
        set((s) => {
          const lines = { ...s.lines };
          if (qty <= 0) delete lines[itemId];
          else if (lines[itemId]) lines[itemId] = { ...lines[itemId], qty: Math.min(12, qty) };
          return isEmpty(lines, s.custom) ? EMPTY : { lines };
        }),
      setCustom: (spotId, custom) =>
        set((s) => {
          const same = s.spotId === spotId;
          const lines = same ? s.lines : {};
          if (isEmpty(lines, custom)) return EMPTY;
          return { spotId, day: today(), lines, custom, tipCents: same ? s.tipCents : null };
        }),
      setTip: (tipCents) => set({ tipCents }),
      clear: () => set(EMPTY),
    }),
    {
      name: 'rush.cart',
      version: 2,
      // Ancien format (quantités seules) : on repart d'un panier vide.
      migrate: () => EMPTY,
      // Les plats du jour d'hier ne sont plus servis : on ne garde que la carte fixe.
      onRehydrateStorage: () => (state) => {
        if (!state || !state.day || state.day === today()) return;
        const lines = Object.fromEntries(Object.entries(state.lines).filter(([id]) => !id.startsWith('e-')));
        useCart.setState(isEmpty(lines, state.custom) ? EMPTY : { lines, day: today() });
      },
    },
  ),
);

/** Vue dérivée du panier : articles, puis la demande libre éventuelle. */
export function useCartSummary() {
  const { spotId, lines, custom } = useCart();
  const spot = spotId ? SPOT_BY_ID.get(spotId) : undefined;
  const items: CartLine[] = spot ? Object.values(lines) : [];
  if (spot && custom) items.push({ itemId: CUSTOM_ITEM_ID, name: custom.text, qty: 1, priceCents: custom.budgetCents, custom: true });
  const count = items.reduce((n, i) => n + i.qty, 0);
  const subtotalCents = items.reduce((s, i) => s + i.qty * i.priceCents, 0);
  return { spot, items, count, subtotalCents };
}
