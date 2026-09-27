import { EventEmitter } from 'node:events';
import type { Message } from '../../shared/types';

/**
 * Bus interne des évènements métier. Les routes n'en dépendent pas :
 * il sert aux effets de bord (rushers de démo, futures notifications push).
 */
type BusEvents = {
  'order.created': [orderId: string];
  'order.accepted': [orderId: string];
  'order.released': [orderId: string];
  'order.picked_up': [orderId: string];
  'order.delivered': [orderId: string];
  'order.completed': [orderId: string];
  'order.cancelled': [orderId: string];
  'message.created': [message: Message];
};

export const bus = new EventEmitter<BusEvents>();
