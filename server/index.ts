import { existsSync, readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { env } from './env';
import { createApp } from './app';
import { handleClientEvents, sendTo, upgrade } from './realtime';
import { SESSION_COOKIE, purgeExpired, userFromToken } from './services/auth';
import { orderFor, sweep, updateCourierLocation } from './services/orders';
import { startDemo } from './demo/bots';

const app = createApp();

// En production, le serveur sert aussi l'app compilée (SPA).
if (env.production && existsSync('dist/index.html')) {
  const indexHtml = readFileSync('dist/index.html', 'utf8');
  app.use('/assets/*', serveStatic({ root: './dist' }));
  app.use('*', serveStatic({ root: './dist' }));
  app.get('*', (c) => c.html(indexHtml));
}

handleClientEvents((userId, event) => {
  if (event.type === 'location') {
    updateCourierLocation(event.orderId, userId, event.lat, event.lng);
  } else if (event.type === 'typing') {
    try {
      const order = orderFor(event.orderId, userId);
      const other = order.myRole === 'requester' ? order.courier?.id : order.requester.id;
      if (order.myRole && other) sendTo(other, { type: 'typing', orderId: order.id, userId });
    } catch {
      // Commande inconnue ou non autorisée : on ignore l'indicateur de saisie.
    }
  }
});

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`\n  Rush API · http://localhost:${info.port}${env.demo ? '  (mode démo : rushers simulés actifs)' : ''}\n`);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  const token = parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE];
  const user = userFromToken(token);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  upgrade(req, socket, head, user.id);
});

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

setInterval(() => {
  try {
    sweep();
    purgeExpired();
  } catch (err) {
    console.error('sweep', err);
  }
}, 30_000);

if (env.demo) startDemo();
