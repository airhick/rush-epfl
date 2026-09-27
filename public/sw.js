/*
 * Rush · service worker des notifications push.
 * Il reçoit les notifications même quand l'app est fermée, les affiche, et
 * ouvre la bonne page au toucher. Pas de cache hors ligne : l'app reste servie
 * normalement par le serveur.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Rush', body: event.data ? event.data.text() : '' };
  }
  const offer = data.kind === 'offer';
  event.waitUntil(
    self.registration.showNotification(data.title || 'Rush', {
      body: data.body || '',
      tag: data.tag || undefined,
      // Même tag (une course, une conversation) : la nouvelle remplace l'ancienne mais sonne quand même.
      renotify: Boolean(data.tag),
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      vibrate: offer ? [120, 60, 120, 60, 120] : [90, 60, 90],
      // Une course reste affichée jusqu'à ce qu'on la regarde.
      requireInteraction: offer,
      timestamp: Date.now(),
      data: { url: data.url || '/' },
      actions: offer ? [{ action: 'open', title: 'Voir la course' }] : [],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        // L'app est déjà ouverte : elle change de page sans se recharger.
        open.postMessage({ type: 'navigate', url });
        return open.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});

/* Le navigateur a renouvelé l'abonnement : on le redonne au serveur. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('/api/push/key', { credentials: 'same-origin' });
      const { publicKey } = await res.json();
      if (!publicKey) return;
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(publicKey.length / 4) * 4, '=')), (c) =>
        c.charCodeAt(0),
      );
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
    })(),
  );
});
