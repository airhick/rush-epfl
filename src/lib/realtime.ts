import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { applyOrder, keys } from './queries';
import { toast, useTyping } from '../state/ui';
import { useOffers } from '../state/offers';
import { useGeo } from '../state/location';
import { SPOT_BY_ID } from '../../shared/catalog';
import { haversine, type LatLng } from '../../shared/geo';
import type { ClientEvent, Me, Message, Order, Presence, ServerEvent } from '../../shared/types';

let socket: WebSocket | null = null;
const queue: ClientEvent[] = [];

export function sendEvent(event: ClientEvent) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  // Hors ligne : on ne garde que la dernière position de chaque sorte, envoyée à la reconnexion.
  else if (event.type === 'location' || event.type === 'position') {
    const i = queue.findIndex((e) => e.type === event.type);
    if (i >= 0) queue.splice(i, 1);
    queue.push(event);
  }
}

/** Écran actuellement ouvert, pour ne pas notifier une conversation déjà visible. */
let activeChat: string | null = null;
export const setActiveChat = (orderId: string | null) => {
  activeChat = orderId;
};

function describeTransition(prev: Order | undefined, order: Order): { title: string; body?: string } | null {
  if (prev?.status === order.status) return null;
  const spot = SPOT_BY_ID.get(order.spotId)?.name ?? 'le spot';
  const courier = order.courier?.firstName;
  if (order.myRole === 'requester') {
    switch (order.status) {
      case 'accepted':
        return { title: `${courier} a accepté ta demande`, body: `Direction ${spot}.` };
      case 'picked_up':
        return { title: `${courier} a tes articles`, body: 'En route vers toi.' };
      case 'delivered':
        return { title: `${courier} est arrivé·e`, body: 'Confirme la réception pour le/la payer.' };
      case 'open':
        return prev ? { title: 'Ton rusher s’est désisté', body: 'Ta demande est de nouveau visible.' } : null;
      default:
        return null;
    }
  }
  if (order.myRole === 'courier' && order.status === 'completed') {
    return { title: 'Livraison confirmée', body: `${order.requester.firstName} a bien reçu sa commande.` };
  }
  return null;
}

/** Connexion WebSocket unique, reconnectée avec un backoff exponentiel. */
export function useRealtime(me: Me | null | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!me) return;
    let closed = false;
    let retry = 0;
    let timer: number | undefined;

    const handle = (event: ServerEvent) => {
      switch (event.type) {
        case 'order.updated': {
          const prev = qc.getQueryData<Order>(keys.order(event.order.id));
          const change = describeTransition(prev, event.order);
          applyOrder(qc, event.order);
          if (change) toast({ ...change, href: `/orders/${event.order.id}` });
          qc.invalidateQueries({ queryKey: keys.conversations });
          break;
        }
        case 'order.opened':
          qc.invalidateQueries({ queryKey: keys.openOrders });
          break;
        case 'order.closed':
          qc.invalidateQueries({ queryKey: keys.openOrders });
          useOffers.getState().close(event.orderId);
          break;
        case 'offer':
          useOffers.getState().push(event.offer);
          qc.invalidateQueries({ queryKey: keys.openOrders });
          break;
        case 'activity.updated':
          qc.invalidateQueries({ queryKey: keys.activity });
          break;
        case 'wallet.updated':
          qc.invalidateQueries({ queryKey: keys.wallet });
          qc.invalidateQueries({ queryKey: keys.me });
          break;
        case 'message.created': {
          const m = event.message;
          qc.setQueryData<Message[]>(keys.messages(m.orderId), (list) =>
            list && !list.some((x) => x.id === m.id) ? [...list, m] : list,
          );
          qc.invalidateQueries({ queryKey: keys.conversations });
          if (m.senderId !== me.id) useTyping.getState().clear(m.orderId);
          if (m.kind === 'text' && m.senderId !== me.id && activeChat !== m.orderId) {
            const order = qc.getQueryData<Order>(keys.order(m.orderId));
            const sender = order?.courier?.id === m.senderId ? order?.courier : order?.requester;
            toast({ title: sender?.firstName ?? 'Nouveau message', body: m.body, href: `/messages/${m.orderId}` });
          }
          break;
        }
        case 'typing':
          useTyping.getState().mark(event.orderId);
          break;
        case 'courier.location':
          qc.setQueryData<Order>(keys.order(event.orderId), (o) =>
            o ? { ...o, courierLocation: { lat: event.lat, lng: event.lng, at: event.at } } : o,
          );
          break;
        case 'withdrawals.updated':
          qc.invalidateQueries({ queryKey: keys.owner });
          break;
        case 'toast':
          toast({ title: event.title, body: event.body, href: event.href ?? (event.orderId ? `/orders/${event.orderId}` : undefined) });
          break;
      }
    };

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      socket = ws;
      ws.onopen = () => {
        retry = 0;
        for (const e of queue.splice(0)) ws.send(JSON.stringify(e));
        // Le serveur a pu redémarrer : il a oublié où l'on est.
        beacon.resend();
        // Rattrape ce qui a pu se passer pendant la coupure.
        qc.invalidateQueries();
      };
      ws.onmessage = (msg) => {
        try {
          handle(JSON.parse(msg.data) as ServerEvent);
        } catch {
          // Évènement illisible : ignoré.
        }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        if (closed) return;
        timer = window.setTimeout(connect, Math.min(15_000, 800 * 2 ** retry++));
      };
    };

    connect();
    const stopBeacon = beacon.start(() => qc.getQueryData<Presence>(keys.presence)?.available !== false);
    return () => {
      stopBeacon();
      closed = true;
      window.clearTimeout(timer);
      socket?.close();
      socket = null;
    };
  }, [me?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps
}

/*
 * Position de l'appareil vers le serveur, pour recevoir les courses proches.
 * Seulement la position réelle (GPS sur le campus), et seulement si l'on est
 * disponible. Au plus un envoi par 15 m parcourus, et un rappel par minute
 * pour que le serveur sache qu'on est toujours là.
 */
const BEACON_MOVE_M = 15;
const BEACON_EVERY_MS = 60_000;

const beacon = (() => {
  let last: (LatLng & { at: number }) | null = null;
  let isAvailable = () => true;

  const send = (p: LatLng, force = false) => {
    if (!isAvailable()) return;
    if (!force && last && haversine(last, p) < BEACON_MOVE_M && Date.now() - last.at < BEACON_EVERY_MS) return;
    last = { ...p, at: Date.now() };
    sendEvent({ type: 'position', lat: p.lat, lng: p.lng });
  };
  const current = () => {
    const geo = useGeo.getState();
    return geo.status === 'live' ? geo.position : null;
  };

  return {
    start(available: () => boolean) {
      isAvailable = available;
      const unsubscribe = useGeo.subscribe((geo) => geo.status === 'live' && send(geo.position));
      const timer = window.setInterval(() => {
        const p = current();
        if (p) send(p, true);
      }, BEACON_EVERY_MS);
      const p = current();
      if (p) send(p, true);
      return () => {
        unsubscribe();
        window.clearInterval(timer);
        last = null;
      };
    },
    resend() {
      const p = current();
      if (p) send(p, true);
    },
  };
})();
