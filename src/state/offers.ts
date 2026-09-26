import { create } from 'zustand';
import { SPOT_BY_ID } from '../../shared/catalog';
import { formatDistance } from '../../shared/geo';
import { formatCHF } from '../../shared/money';
import type { Offer } from '../../shared/types';

export interface LiveOffer {
  offer: Offer;
  receivedAt: number;
  /** Prise par quelqu'un d'autre pendant qu'elle était affichée. */
  taken: boolean;
  /** Acceptation en cours de notre côté : sa fermeture ne vient pas d'un autre rusher. */
  accepting: boolean;
}

interface OfferState {
  offers: LiveOffer[];
  push: (offer: Offer) => void;
  setAccepting: (orderId: string, accepting: boolean) => void;
  /** La demande n'est plus ouverte (prise, annulée) : on le montre un instant puis on la retire. */
  close: (orderId: string) => void;
  dismiss: (orderId: string) => void;
}

/** Courses proposées en direct, affichées une à une comme une course Uber. */
export const useOffers = create<OfferState>((set, get) => ({
  offers: [],
  push: (offer) => {
    if (get().offers.some((o) => o.offer.orderId === offer.orderId)) return;
    set((s) => ({ offers: [...s.offers, { offer, receivedAt: Date.now(), taken: false, accepting: false }] }));
    alertUser(offer);
  },
  setAccepting: (orderId, accepting) =>
    set((s) => ({ offers: s.offers.map((o) => (o.offer.orderId === orderId ? { ...o, accepting } : o)) })),
  close: (orderId) => {
    const entry = get().offers.find((o) => o.offer.orderId === orderId);
    if (!entry || entry.accepting) return;
    set((s) => ({ offers: s.offers.map((o) => (o.offer.orderId === orderId ? { ...o, taken: true } : o)) }));
    window.setTimeout(() => get().dismiss(orderId), 1800);
  },
  dismiss: (orderId) => set((s) => ({ offers: s.offers.filter((o) => o.offer.orderId !== orderId) })),
}));

export const offerHeadline = (offer: Offer) =>
  offer.reason === 'nearby' ? `À ${formatDistance(offer.pickup.meters)} de toi` : 'Sur ton trajet';

/** Vibration, et notification système si l'app est en arrière-plan et que la personne l'a autorisée. */
function alertUser(offer: Offer) {
  try {
    navigator.vibrate?.([90, 60, 90]);
  } catch {
    // Pas de vibreur : tant pis.
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
  const spot = SPOT_BY_ID.get(offer.spotId)?.name ?? 'Spot';
  try {
    const n = new Notification(`Nouvelle course · +${formatCHF(offer.rewardCents)}`, {
      body: `${spot} → ${offer.delivery.label} · ${offerHeadline(offer).toLowerCase()}`,
      tag: `offer-${offer.orderId}`,
      icon: '/favicon.svg',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Certains navigateurs mobiles n'autorisent les notifications que via un service worker.
  }
}
