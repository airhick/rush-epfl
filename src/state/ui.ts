import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePref = 'system' | 'light' | 'dark';

interface PrefsState {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
}

export const usePrefs = create<PrefsState>()(
  persist((set) => ({ theme: 'system', setTheme: (theme) => set({ theme }) }), { name: 'rush.prefs' }),
);

export type SheetSnap = 'peek' | 'half' | 'full';

interface LayoutState {
  /** Marges occupées par le panneau, pour cadrer la carte dans la zone visible. */
  insets: { top: number; right: number; bottom: number; left: number };
  snap: SheetSnap;
  setInsets: (i: LayoutState['insets']) => void;
  setSnap: (s: SheetSnap) => void;
}

export const useLayout = create<LayoutState>((set) => ({
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  snap: 'half',
  setInsets: (insets) => set({ insets }),
  setSnap: (snap) => set({ snap }),
}));

export interface Toast {
  id: number;
  title: string;
  body?: string;
  href?: string;
  tone?: 'default' | 'success' | 'error';
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextToast = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextToast++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), 4800);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (t: Omit<Toast, 'id'>) => useToasts.getState().push(t);

interface TypingState {
  typing: Record<string, number>;
  mark: (orderId: string) => void;
  clear: (orderId: string) => void;
}

/** Indicateur « est en train d'écrire », valable quelques secondes. */
export const useTyping = create<TypingState>((set) => ({
  typing: {},
  mark: (orderId) => {
    const until = Date.now() + 3500;
    set((s) => ({ typing: { ...s.typing, [orderId]: until } }));
    setTimeout(() => set((s) => (s.typing[orderId] === until ? { typing: { ...s.typing, [orderId]: 0 } } : s)), 3600);
  },
  clear: (orderId) => set((s) => ({ typing: { ...s.typing, [orderId]: 0 } })),
}));
