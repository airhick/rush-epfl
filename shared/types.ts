import type { LatLng } from './geo';
import type { MenuSection } from './catalog';

export type OrderStatus = 'open' | 'accepted' | 'picked_up' | 'delivered' | 'completed' | 'cancelled';
export type Role = 'requester' | 'courier';

export const ACTIVE_STATUSES: OrderStatus[] = ['open', 'accepted', 'picked_up', 'delivered'];

export interface PublicUser {
  id: string;
  firstName: string;
  lastInitial: string;
  hue: number;
  section: string | null;
  rating: number | null;
  ratingCount: number;
  deliveries: number;
}

export interface Me extends PublicUser {
  email: string;
  lastName: string;
  balanceCents: number;
  heldCents: number;
  onboarded: boolean;
  /** Membre de l'équipe Rush : voit et traite les demandes de retrait. */
  isAdmin: boolean;
  /** Compte ouvert avec la connexion EPFL (adresse prouvée par l'annuaire). */
  epfl: boolean;
}

/** Ce que l'écran de connexion propose. */
export interface AuthOptions {
  epfl: boolean;
}

export interface OrderItem {
  id: string;
  name: string;
  qty: number;
  priceCents: number;
  /** Demande libre : `priceCents` est le budget plafond fixé par le demandeur. */
  custom?: boolean;
}

export interface Dropoff extends LatLng {
  label: string;
  note: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  spotId: string;
  items: OrderItem[];
  itemsCents: number;
  /** Tarif : CHF 0.50 par tranche de CHF 5 d'articles. */
  feeCents: number;
  /** Coup de pouce facultatif du demandeur. */
  bonusCents: number;
  /** Ce que touche le rusher en plus du remboursement des articles (tarif + coup de pouce). */
  rewardCents: number;
  holdCents: number;
  actualItemsCents: number | null;
  dropoff: Dropoff;
  requester: PublicUser;
  courier: PublicUser | null;
  courierLocation: (LatLng & { at: string }) | null;
  createdAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  myRole: Role | null;
  myRating: number | null;
  /** Demande ouverte, vue par le demandeur : nombre de rushers proches prévenus en direct. */
  offeredTo: number | null;
}

export interface Message {
  id: string;
  orderId: string;
  senderId: string | null;
  body: string;
  kind: 'text' | 'system';
  createdAt: string;
}

export interface Conversation {
  order: Order;
  other: PublicUser | null;
  lastMessage: Message | null;
  unread: number;
}

export type TxKind = 'bonus' | 'hold' | 'refund' | 'payout' | 'release' | 'topup' | 'withdrawal' | 'withdrawal_refund';

export interface Transaction {
  id: string;
  kind: TxKind;
  amountCents: number;
  label: string;
  orderId: string | null;
  createdAt: string;
}

export interface Wallet {
  balanceCents: number;
  heldCents: number;
  earnedThisMonthCents: number;
  spentThisMonthCents: number;
  transactions: Transaction[];
}

export type WithdrawalStatus = 'pending' | 'paid' | 'cancelled' | 'rejected';

/** Demande de retrait : le montant quitte le solde tout de suite, l'équipe l'envoie par TWINT. */
export interface Withdrawal {
  id: string;
  amountCents: number;
  phone: string;
  status: WithdrawalStatus;
  note: string | null;
  createdAt: string;
  processedAt: string | null;
}

/** Solde, avec ce qui peut en sortir et entrer. */
export interface WalletView extends Wallet {
  /** Le crédit offert à l'inscription reste dans l'app : il ne se retire pas. */
  withdrawableCents: number;
  topupsEnabled: boolean;
  withdrawals: Withdrawal[];
}

export interface TopupStatus {
  status: 'credited' | 'pending';
  amountCents: number | null;
}

/** Vue de l'équipe Rush : retraits à envoyer par TWINT et paiements Stripe à rattacher. */
export interface OwnerWithdrawal extends Withdrawal {
  user: { id: string; firstName: string; lastName: string; email: string; section: string | null; epfl: boolean };
  /** Contexte pour juger la demande : d'où vient l'argent de ce compte. */
  stats: { topupsCents: number; earnedCents: number; balanceCents: number };
}

export interface UnmatchedTopup {
  sessionId: string;
  amountCents: number;
  currency: string;
  email: string | null;
  createdAt: string;
}

export interface OwnerOverview {
  pending: OwnerWithdrawal[];
  recent: OwnerWithdrawal[];
  unmatchedTopups: UnmatchedTopup[];
}

/** Une étape du trajet d'un rusher : un spot où il mange, un bâtiment, une adresse ou un point sur la carte. */
export interface RouteStop extends LatLng {
  label: string;
  spotId: string | null;
}

export interface Presence {
  /** Disponible pour livrer : activé par défaut, tout le monde peut commander et livrer. */
  available: boolean;
  /** Mon trajet, dans l'ordre : « je mange ici, puis je vais là ». */
  stops: RouteStop[];
  /** Tracé à pied entre les étapes, s'il a pu être calculé (sinon lignes droites). */
  path: LatLng[] | null;
}

/** Résultat du petit moteur de recherche de lieux. */
export interface PlaceResult extends LatLng {
  id: string;
  label: string;
  detail: string;
  kind: 'spot' | 'building' | 'address';
  spotId: string | null;
}

/** Itinéraire à pied du trajet : tracé réel, ou null (lignes droites) si le service n'a pas répondu. */
export interface WalkingRoute {
  path: LatLng[] | null;
  meters: number;
  minutes: number;
}

/** Course proposée en direct à un rusher proche, façon Uber. */
export interface Offer {
  orderId: string;
  spotId: string;
  items: OrderItem[];
  /** Montant maximum que le rusher avance, remboursé à la livraison. */
  advanceCents: number;
  rewardCents: number;
  /** De la position du rusher au spot. */
  pickup: { meters: number; minutes: number };
  /** Du spot au point de livraison. */
  delivery: { meters: number; minutes: number; label: string } & LatLng;
  /** Mètres de marche ajoutés à son trajet déclaré (null sans trajet). */
  detourMeters: number | null;
  reason: 'nearby' | 'route';
  requester: PublicUser;
  createdAt: string;
}

export type DailyStatus = 'ok' | 'empty' | 'unavailable';

/** Menu d'un spot : offre du jour EPFL (lue en direct) puis carte fixe officielle. */
export interface SpotMenu {
  sections: MenuSection[];
  daily: { date: string; status: DailyStatus; sourceUrl: string; fetchedAt: string | null } | null;
}

/** Photos et avis Google Maps d'un spot, relevés une fois et crédités à leurs auteurs. */
export interface PlaceMedia {
  name: string;
  mapsUrl: string;
  rating: number | null;
  ratingCount: number;
  fetchedAt: string;
  photos: PlacePhoto[];
  reviews: PlaceReview[];
}

export interface PlacePhoto {
  url: string;
  author: string;
  authorUrl: string | null;
}

export interface PlaceReview {
  author: string;
  authorUrl: string | null;
  rating: number;
  text: string;
  /** Langue d'origine quand le texte affiché est la traduction de Google. */
  translatedFrom?: string;
  date: string;
  url: string | null;
}

/** Rushers disponibles, agrégés par spot pour la carte et les fiches. */
export interface SpotActivity {
  spotId: string;
  rushers: PublicUser[];
  openRequests: number;
}

export type ServerEvent =
  | { type: 'order.updated'; order: Order }
  | { type: 'order.opened'; orderId: string }
  | { type: 'order.closed'; orderId: string }
  | { type: 'message.created'; message: Message }
  | { type: 'typing'; orderId: string; userId: string }
  | { type: 'wallet.updated' }
  | { type: 'activity.updated' }
  | { type: 'courier.location'; orderId: string; lat: number; lng: number; at: string }
  | { type: 'withdrawals.updated' }
  | { type: 'toast'; title: string; body?: string; orderId?: string; href?: string }
  | { type: 'offer'; offer: Offer };

export type ClientEvent =
  | { type: 'typing'; orderId: string }
  | { type: 'location'; orderId: string; lat: number; lng: number }
  /** Position de l'appareil, pour les courses proches ; jamais montrée aux autres. */
  | { type: 'position'; lat: number; lng: number };
