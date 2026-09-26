import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientEvent, ServerEvent } from '../shared/types';

const sockets = new Map<string, Set<WebSocket>>();
const wss = new WebSocketServer({ noServer: true });

type ClientHandler = (userId: string, event: ClientEvent) => void;
let onClientEvent: ClientHandler = () => {};

export function handleClientEvents(handler: ClientHandler) {
  onClientEvent = handler;
}

export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, userId: string) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    let set = sockets.get(userId);
    if (!set) sockets.set(userId, (set = new Set()));
    set.add(ws);

    // Ping régulier : certains proxys coupent les WebSockets silencieuses.
    const heartbeat = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 25_000);

    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(String(raw)) as ClientEvent;
        if (event && typeof event.type === 'string') onClientEvent(userId, event);
      } catch {
        // Message mal formé : ignoré.
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      set!.delete(ws);
      if (set!.size === 0) sockets.delete(userId);
    });
  });
}

export function sendTo(userId: string, event: ServerEvent) {
  const set = sockets.get(userId);
  if (!set) return;
  const payload = JSON.stringify(event);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(payload);
}

export function broadcast(event: ServerEvent) {
  const payload = JSON.stringify(event);
  for (const set of sockets.values()) for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(payload);
}

export function isOnline(userId: string) {
  return sockets.has(userId);
}

/** Comptes avec l'app ouverte en ce moment (au moins une WebSocket). */
export function onlineUsers(): string[] {
  return [...sockets.keys()];
}
