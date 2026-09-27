import { randomUUID } from 'node:crypto';
import { all, nowIso, one, run } from '../db';
import { sendTo } from '../realtime';
import { bus } from './bus';
import type { Message } from '../../shared/types';

interface MessageRow {
  id: string;
  order_id: string;
  sender_id: string | null;
  body: string;
  kind: 'text' | 'system';
  created_at: string;
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  orderId: r.order_id,
  senderId: r.sender_id,
  body: r.body,
  kind: r.kind,
  createdAt: r.created_at,
});

function participants(orderId: string): string[] {
  const row = one<{ requester_id: string; courier_id: string | null }>(
    'SELECT requester_id, courier_id FROM orders WHERE id = ?',
    orderId,
  );
  if (!row) return [];
  return [row.requester_id, row.courier_id].filter((id): id is string => Boolean(id));
}

export function addMessage(orderId: string, senderId: string | null, body: string, kind: Message['kind'] = 'text') {
  const row: MessageRow = {
    id: randomUUID(),
    order_id: orderId,
    sender_id: senderId,
    body,
    kind,
    created_at: nowIso(),
  };
  run(
    'INSERT INTO messages (id, order_id, sender_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id,
    row.order_id,
    row.sender_id,
    row.body,
    row.kind,
    row.created_at,
  );
  // L'expéditeur a forcément lu la conversation jusqu'à son propre message.
  if (senderId) markRead(orderId, senderId);

  const message = toMessage(row);
  for (const userId of participants(orderId)) sendTo(userId, { type: 'message.created', message });
  bus.emit('message.created', message);
  return message;
}

export const systemMessage = (orderId: string, body: string) => addMessage(orderId, null, body, 'system');

export function listMessages(orderId: string): Message[] {
  return all<MessageRow>('SELECT * FROM messages WHERE order_id = ? ORDER BY created_at, rowid', orderId).map(toMessage);
}

export function markRead(orderId: string, userId: string) {
  run(
    `INSERT INTO reads (order_id, user_id, last_read_at) VALUES (?, ?, ?)
     ON CONFLICT (order_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    orderId,
    userId,
    nowIso(),
  );
}

export function lastMessage(orderId: string): Message | null {
  const row = one<MessageRow>('SELECT * FROM messages WHERE order_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', orderId);
  return row ? toMessage(row) : null;
}

export function unreadCount(orderId: string, userId: string): number {
  return one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages m
     WHERE m.order_id = ?1 AND m.kind = 'text' AND m.sender_id IS NOT ?2
       AND m.created_at > COALESCE((SELECT last_read_at FROM reads WHERE order_id = ?1 AND user_id = ?2), '')`,
    orderId,
    userId,
  )!.n;
}
