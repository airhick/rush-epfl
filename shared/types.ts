import type { LatLng } from './geo';

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
}

export interface OrderItem {
  id: string;
  name: string;
  qty: number;
  priceCents: number;
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

export type TxKind = 'bonus' | 'hold' | 'refund' | 'payout' | 'release';

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

export interface Presence {
  available: boolean;
  spotId: string | null;
  destination: (LatLng & { label: string }) | null;
}

/** Photos et avis Google Maps d'un spot (API Google Places, attributions incluses). */
export interface GooglePlace {
  available: true;
  rating: number | null;
  ratingCount: number;
  mapsUrl: string | null;
  photos: GooglePhoto[];
  reviews: GoogleReview[];
}

export interface GoogleAttribution {
  name: string;
  url: string | null;
}

export interface GooglePhoto {
  /** Nom de ressource Google, à repasser tel quel au proxy photo du serveur. */
  name: string;
  width: number;
  height: number;
  attributions: GoogleAttribution[];
}

export interface GoogleReview {
  author: GoogleAttribution & { photoUrl: string | null };
  rating: number;
  text: string;
  when: string;
}

export type GooglePlaceResult = GooglePlace | { available: false; reason: 'not-configured' | 'not-found' | 'error' };

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
  | { type: 'toast'; title: string; body?: string; orderId?: string };

export type ClientEvent =
  | { type: 'typing'; orderId: string }
  | { type: 'location'; orderId: string; lat: number; lng: number };
