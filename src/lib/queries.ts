import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type {
  Conversation,
  Me,
  Message,
  Order,
  PlaceMedia,
  Presence,
  SpotActivity,
  SpotMenu,
  Wallet,
} from '../../shared/types';
import type { CreateOrderInput } from './types';

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
};

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
export const useWallet = () => useQuery({ queryKey: keys.wallet, queryFn: () => api<Wallet>('/wallet') });
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
    onSuccess: (order) => {
      applyOrder(qc, order);
      qc.invalidateQueries({ queryKey: keys.conversations });
    },
    onError: () => qc.invalidateQueries({ queryKey: keys.openOrders }),
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
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  });
}
