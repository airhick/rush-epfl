import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type {
  AuthOptions,
  Conversation,
  Me,
  Message,
  Order,
  OwnerOverview,
  PlaceMedia,
  PlaceResult,
  Presence,
  SpotActivity,
  SpotMenu,
  TopupStatus,
  WalletView,
  Withdrawal,
  WalkingRoute,
} from '../../shared/types';
import type { LatLng } from '../../shared/geo';
import type { CreateOrderInput } from './types';
import { useOffers } from '../state/offers';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

export const keys = {
  me: ['me'] as const,
  activity: ['activity'] as const,
  orders: ['orders'] as const,
  openOrders: ['orders', 'open'] as const,
  order: (id: string) => ['order', id] as const,
  messages: (orderId: string) => ['messages', orderId] as const,
  conversations: ['conversations'] as const,
  wallet: ['wallet'] as const,
  presence: ['presence'] as const,
  owner: ['owner', 'withdrawals'] as const,
};

/** Ce que l'écran de connexion propose (connexion EPFL active ou non). */
export const useAuthOptions = () =>
  useQuery({ queryKey: ['auth', 'options'], queryFn: () => api<AuthOptions>('/auth/options'), staleTime: Infinity });

export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api<Me>('/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });

/** Menu du jour d'un spot : offre EPFL lue en direct par le serveur, puis carte fixe. */
export const useSpotMenu = (spotId: string | undefined) =>
  useQuery({
    queryKey: ['menu', spotId ?? ''] as const,
    queryFn: () => api<SpotMenu>(`/spots/${spotId}/menu`),
    enabled: Boolean(spotId),
    staleTime: 5 * 60_000,
  });

/** Photos et avis Google Maps d'un spot (relevé crédité, sans clé d'API). */
export const usePlaceMedia = (spotId: string | undefined) =>
  useQuery({
    queryKey: ['media', spotId ?? ''] as const,
    queryFn: () => api<PlaceMedia | null>(`/spots/${spotId}/media`),
    enabled: Boolean(spotId),
    staleTime: Infinity,
  });

export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: () => api<SpotActivity[]>('/activity') });
export const useMyOrders = () => useQuery({ queryKey: keys.orders, queryFn: () => api<Order[]>('/orders') });
export const useOpenOrders = () =>
  useQuery({ queryKey: keys.openOrders, queryFn: () => api<Order[]>('/orders/open'), refetchInterval: 60_000 });
export const useOrder = (id: string | undefined) =>
  useQuery({ queryKey: keys.order(id ?? ''), queryFn: () => api<Order>(`/orders/${id}`), enabled: Boolean(id) });
export const useMessages = (orderId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.messages(orderId ?? ''),
    queryFn: () => api<Message[]>(`/orders/${orderId}/messages`),
    enabled: Boolean(orderId) && enabled,
  });
export const useConversations = () =>
  useQuery({ queryKey: keys.conversations, queryFn: () => api<Conversation[]>('/conversations') });
export const useWallet = () => useQuery({ queryKey: keys.wallet, queryFn: () => api<WalletView>('/wallet') });
export const usePresence = () => useQuery({ queryKey: keys.presence, queryFn: () => api<Presence>('/presence') });

/** Met à jour une commande partout où elle apparaît dans le cache. */
export function applyOrder(qc: QueryClient, order: Order) {
  qc.setQueryData(keys.order(order.id), order);
  qc.setQueryData<Order[]>(keys.orders, (list) => {
    if (!list) return list;
    const i = list.findIndex((o) => o.id === order.id);
    if (i === -1) return order.myRole ? [order, ...list] : list;
    if (!order.myRole) return list.filter((o) => o.id !== order.id);
    const next = list.slice();
    next[i] = order;
    return next;
  });
  qc.setQueryData<Order[]>(keys.openOrders, (list) => {
    if (!list) return list;
    return order.status === 'open' ? list : list.filter((o) => o.id !== order.id);
  });
}

type OrderAction = 'accept' | 'release' | 'deliver' | 'confirm' | 'cancel';

export function useOrderAction(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: OrderAction) => api<Order>(`/orders/${orderId}/${action}`, { method: 'POST' }),
    onSuccess: (order) => {
      applyOrder(qc, order);
      qc.invalidateQueries({ queryKey: keys.conversations });
      qc.invalidateQueries({ queryKey: keys.wallet });
      qc.invalidateQueries({ queryKey: keys.me });
      qc.invalidateQueries({ queryKey: keys.activity });
    },
  });
}

export function useAccept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api<Order>(`/orders/${orderId}/accept`, { method: 'POST' }),
    // Acceptée depuis la liste ou la carte : l'offre en direct correspondante ne doit pas dire « déjà prise ».
    onMutate: (orderId) => useOffers.getState().setAccepting(orderId, true),
    onSuccess: (order) => {
      applyOrder(qc, order);
      qc.invalidateQueries({ queryKey: keys.conversations });
      // Après les rappels de l'écran (navigation), on range l'offre.
      window.setTimeout(() => useOffers.getState().dismiss(order.id), 0);
    },
    onError: (_err, orderId) => {
      qc.invalidateQueries({ queryKey: keys.openOrders });
      useOffers.getState().setAccepting(orderId, false);
      useOffers.getState().close(orderId);
    },
  });
}

export function usePickup(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actualItemsCents: number) => api<Order>(`/orders/${orderId}/pickup`, { body: { actualItemsCents } }),
    onSuccess: (order) => applyOrder(qc, order),
  });
}

export function useRate(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stars: number) => api<Order>(`/orders/${orderId}/rate`, { body: { stars } }),
    onSuccess: (order) => applyOrder(qc, order),
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrderInput) => api<Order>('/orders', { body: input }),
    onSuccess: (order) => {
      applyOrder(qc, order);
      qc.invalidateQueries({ queryKey: keys.wallet });
      qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useSendMessage(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api<Message>(`/orders/${orderId}/messages`, { body: { body } }),
    onSuccess: (message) => {
      qc.setQueryData<Message[]>(keys.messages(orderId), (list) =>
        list && !list.some((m) => m.id === message.id) ? [...list, message] : list,
      );
      qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

export function useMarkRead(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/orders/${orderId}/read`, { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData<Conversation[]>(keys.conversations, (list) =>
        list?.map((c) => (c.order.id === orderId ? { ...c, unread: 0 } : c)),
      );
    },
  });
}

/** Petit moteur de recherche de lieux : spots, bâtiments, adresses autour de l'EPFL. */
export const usePlaceSearch = (query: string) =>
  useQuery({
    queryKey: ['places', query.trim().toLowerCase()],
    queryFn: () => api<PlaceResult[]>(`/places/search?q=${encodeURIComponent(query.trim())}`),
    enabled: query.trim().length >= 2,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });

/** Itinéraire à pied passant par ces points (lignes droites si le service ne répond pas). */
export const walkingRoute = (points: LatLng[]) => api<WalkingRoute>('/places/route', { body: { points } });

export function useSetPresence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Presence) => api<Presence>('/presence', { method: 'PUT', body: p }),
    onMutate: (p) => qc.setQueryData(keys.presence, p),
    onSuccess: (p) => {
      qc.setQueryData(keys.presence, p);
      qc.invalidateQueries({ queryKey: keys.activity });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { firstName: string; lastName: string; section: string | null }) =>
      api<Me>('/me', { method: 'PATCH', body: p }),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      // D'abord « personne n'est connecté », pour que l'app passe à l'écran de connexion.
      // Un qc.clear() avant laissait l'app accrochée à l'ancien compte.
      qc.setQueryData(keys.me, null);
      // Puis on oublie les données du compte (les écrans qui les lisaient se démontent).
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'auth' });
    },
  });
}

/* ── Recharges et retraits ───────────────────────────────────────────── */

/** Ouvre le lien de paiement Stripe prérempli ; le retour se fait sur /wallet. */
export function useStartTopup() {
  return useMutation({
    mutationFn: (amountCents: number) => api<{ url: string }>('/topups', { body: { amountCents } }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

/** Au retour de Stripe : interroge le serveur jusqu'à ce que le webhook ait crédité le solde. */
export const useTopupStatus = (sessionId: string | null) =>
  useQuery({
    queryKey: ['topup', sessionId ?? ''] as const,
    queryFn: () => api<TopupStatus>(`/topups/${encodeURIComponent(sessionId!)}`),
    enabled: Boolean(sessionId),
    refetchInterval: (q) => (q.state.data?.status === 'credited' || q.state.dataUpdateCount > 40 ? false : 1500),
    staleTime: 0,
  });

function useWalletMutation<TInput>(fn: (input: TInput) => Promise<Withdrawal>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.wallet });
      qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export const useRequestWithdrawal = () =>
  useWalletMutation((input: { amountCents: number; phone: string }) => api<Withdrawal>('/withdrawals', { body: input }));

export const useCancelWithdrawal = () =>
  useWalletMutation((id: string) => api<Withdrawal>(`/withdrawals/${id}/cancel`, { method: 'POST' }));

/* ── Équipe Rush ─────────────────────────────────────────────────────── */

export const useOwnerOverview = (enabled = true) =>
  useQuery({ queryKey: keys.owner, queryFn: () => api<OwnerOverview>('/admin/withdrawals'), enabled, refetchInterval: 60_000 });

export function useOwnerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string; action: 'paid' } | { id: string; action: 'reject'; reason: string }) =>
      api<Withdrawal>(`/admin/withdrawals/${a.id}/${a.action}`, a.action === 'reject' ? { body: { reason: a.reason } } : { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.owner }),
    onError: () => qc.invalidateQueries({ queryKey: keys.owner }),
  });
}
