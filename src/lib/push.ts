import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/*
 * Notifications push : le service worker (public/sw.js) les reçoit même app
 * fermée. Sur iPhone, Safari ne les autorise que pour une app ajoutée à
 * l'écran d'accueil (iOS 16.4 et plus).
 */

export type PushState =
  /** Navigateur sans notifications push. */
  | 'unsupported'
  /** iPhone/iPad dans Safari : il faut d'abord ajouter Rush à l'écran d'accueil. */
  | 'install'
  /** Le serveur n'a pas de clés VAPID. */
  | 'unavailable'
  /** Refusées dans les réglages du navigateur. */
  | 'denied'
  | 'off'
  | 'on';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[push] service worker', err));
}

let keyCache: Promise<string | null> | null = null;
const serverKey = () => (keyCache ??= api<{ publicKey: string | null }>('/push/key').then((r) => r.publicKey).catch(() => null));

function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !standalone()) return 'install';
  if (!supported()) return 'unsupported';
  if (!(await serverKey())) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** À appeler depuis un geste de l'utilisateur (bouton) : Safari l'exige pour la demande d'autorisation. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIos() ? 'install' : 'unsupported';
  const key = await serverKey();
  if (!key) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  // Le service push du navigateur peut ne jamais répondre (réseau, navigateur sans service push) : on n'attend pas indéfiniment.
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), 15_000));
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) }), timeout]));
  await api('/push/subscribe', { body: sub.toJSON() });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const sub = supported() ? await currentSubscription() : null;
  if (sub) {
    await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}

/**
 * Au démarrage (connecté) : si les notifications sont autorisées, on redonne
 * l'abonnement au serveur, qui a pu l'oublier ou le lier à un autre compte.
 */
export async function syncPush() {
  if (!supported() || Notification.permission !== 'granted' || !(await serverKey())) return;
  const sub = await currentSubscription();
  if (sub) await api('/push/subscribe', { body: sub.toJSON() }).catch(() => undefined);
}

/** À la déconnexion : cet appareil ne reçoit plus les notifications de ce compte. */
export async function forgetPushForAccount() {
  if (!supported()) return;
  const sub = await currentSubscription().catch(() => null);
  if (sub) await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => undefined);
}

export function usePush() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    pushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(async (fn: () => Promise<PushState>) => {
    setBusy(true);
    setFailed(false);
    try {
      setState(await fn());
    } catch (err) {
      console.warn('[push]', err);
      setFailed(true);
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, failed, enable: () => run(enablePush), disable: () => run(disablePush) };
}

/** Ce qu'on dit à la personne selon l'état des notifications. */
export const PUSH_HINT: Record<PushState, string> = {
  on: 'Courses proches, rusher trouvé, messages : même app fermée.',
  off: 'Courses proches, rusher trouvé, messages : même app fermée.',
  denied: 'Bloquées dans les réglages du navigateur pour ce site.',
  install: 'Sur iPhone : Partager → « Sur l’écran d’accueil », puis ouvre Rush depuis l’icône.',
  unsupported: 'Ce navigateur ne reçoit pas les notifications push.',
  unavailable: 'Pas encore disponibles sur ce serveur.',
};

export const PUSH_FAILED = 'Le navigateur n’a pas pu s’abonner aux notifications. Réessaie, ou essaie un autre navigateur.';
