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
  marginCents: number;
  tipCents: number;
  suggestedTipCents: number;
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
  user: { id: string; firstName: string; lastName: string; email: string; section: string | null };
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

export interface Presence {
  available: boolean;
  spotId: string | null;
  destination: (LatLng & { label: string }) | null;
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
  | { type: 'toast'; title: string; body?: string; orderId?: string; href?: string };

export type ClientEvent =
  | { type: 'typing'; orderId: string }
  | { type: 'location'; orderId: string; lat: number; lng: number };
