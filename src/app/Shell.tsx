import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router';
import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { Bike, Box, Compass, LocateFixed, MessageCircle, Wallet as WalletIcon } from 'lucide-react';
import { MapView } from '../map/MapView';
import { getMap } from '../map/instance';
import { useConversations, useMe, useMyOrders } from '../lib/queries';
import { useIsDesktop } from '../lib/useMedia';
import { useLayout, useToasts, type SheetSnap } from '../state/ui';
import { useGeo } from '../state/location';
import { formatCHF } from '../../shared/money';
import { ACTIVE_STATUSES } from '../../shared/types';
import { Avatar, cx } from '../ui/primitives';
import { Logo } from '../ui/Logo';

/** Position par défaut de la feuille mobile selon l'écran. */
function defaultSnap(path: string): SheetSnap {
  if (path === '/' || path.startsWith('/deliver') || /^\/orders\/[^/]+$/.test(path)) return 'half';
  if (path === '/checkout') return 'half';
  return 'full';
}

export function Shell({ children, chrome = true }: { children?: ReactNode; chrome?: boolean }) {
  const desktop = useIsDesktop();
  return (
    <div className={cx('app', desktop ? 'app--desktop' : 'app--mobile')}>
      <MapView />
      {desktop ? <DesktopPanel chrome={chrome}>{children}</DesktopPanel> : <MobileSheet chrome={chrome}>{children}</MobileSheet>}
      {chrome && <MapChrome />}
      <Toasts />
    </div>
  );
}

/* ── Contenu animé entre les routes ──────────────────────────────────── */

function Frozen({ children }: { children: ReactNode }) {
  const [frozen] = useState(children);
  return <>{frozen}</>;
}

function AnimatedOutlet() {
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={location.pathname}
        className="route"
        initial={{ opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10, transition: { duration: 0.14 } }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        <Frozen>{outlet}</Frozen>
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Bureau : panneau flottant à gauche ──────────────────────────────── */

function DesktopPanel({ children, chrome }: { children?: ReactNode; chrome: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const setInsets = useLayout((s) => s.setInsets);

  useLayoutEffect(() => {
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      setInsets({ top: 0, right: 64, bottom: 0, left: r ? r.right : 0 });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [setInsets]);

  return (
    <aside ref={ref} className="panel">
      <div className="panel__content">{children ?? <AnimatedOutlet />}</div>
      {chrome && <TabBar />}
    </aside>
  );
}

/* ── Mobile : feuille à trois crans ──────────────────────────────────── */

function snapTop(snap: SheetSnap, vh: number) {
  // Plein écran : la feuille recouvre les contrôles, comme une carte iOS.
  if (snap === 'full') return 10;
  if (snap === 'half') return Math.round(vh * 0.44);
  return vh - 196;
}

function MobileSheet({ children, chrome }: { children?: ReactNode; chrome: boolean }) {
  const location = useLocation();
  const { snap, setSnap, setInsets } = useLayout();
  const [vh, setVh] = useState(() => window.innerHeight);
  const top = useMotionValue(snapTop(snap, vh));
  const start = useRef(0);

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setSnap(chrome ? defaultSnap(location.pathname) : 'half');
  }, [location.pathname, chrome, setSnap]);

  useEffect(() => {
    // Connexion : la feuille laisse juste un aperçu de la carte au-dessus du formulaire.
    const target = chrome ? snapTop(snap, vh) : Math.round(vh * 0.14);
    const controls = animate(top, target, { type: 'spring', stiffness: 380, damping: 40 });
    setInsets({ top: 56, right: 0, bottom: vh - target, left: 0 });
    return () => controls.stop();
  }, [snap, vh, top, setInsets, chrome]);

  const settle = (velocity: number) => {
    const projected = top.get() + velocity * 0.18;
    const snaps: SheetSnap[] = ['full', 'half', 'peek'];
    const best = snaps.reduce((a, b) => (Math.abs(snapTop(b, vh) - projected) < Math.abs(snapTop(a, vh) - projected) ? b : a));
    if (best === snap) animate(top, snapTop(best, vh), { type: 'spring', stiffness: 380, damping: 40 });
    else setSnap(best);
  };

  return (
    <motion.div className={cx('sheet', !chrome && 'sheet--bare')} style={{ top }}>
      <motion.div
        className="sheet__grabber"
        onPanStart={() => (start.current = top.get())}
        onPan={(_, info) => top.set(Math.max(40, start.current + info.offset.y))}
        onPanEnd={(_, info) => settle(info.velocity.y)}
        onClick={() => setSnap(snap === 'full' ? 'half' : 'full')}
      >
        <span />
      </motion.div>
      <div className="sheet__content">{children ?? <AnimatedOutlet />}</div>
      {chrome && <TabBar />}
    </motion.div>
  );
}

/* ── Barre d'onglets ─────────────────────────────────────────────────── */

function TabBar() {
  const { data: conversations } = useConversations();
  const { data: orders } = useMyOrders();
  const unread = conversations?.reduce((n, c) => n + c.unread, 0) ?? 0;
  const active = orders?.filter((o) => ACTIVE_STATUSES.includes(o.status)).length ?? 0;

  const tabs = [
    { to: '/', label: 'Explorer', icon: Compass, end: true },
    { to: '/deliver', label: 'Livrer', icon: Bike },
    { to: '/orders', label: 'Activité', icon: Box, badge: active > 0 ? active : null },
    { to: '/messages', label: 'Messages', icon: MessageCircle, badge: unread > 0 ? unread : null },
    { to: '/wallet', label: 'Solde', icon: WalletIcon },
  ];

  return (
    <nav className="tabbar" aria-label="Navigation principale">
      {tabs.map(({ to, label, icon: Icon, end, badge }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('tabbar__item', isActive && 'is-active')}>
          <span className="tabbar__icon">
            <Icon size={23} strokeWidth={1.9} />
            {badge && <span className="tabbar__badge">{badge}</span>}
          </span>
          <span className="tabbar__label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/* ── Contrôles flottants sur la carte ────────────────────────────────── */

function MapChrome() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const geo = useGeo();
  const [pitched, setPitched] = useState(false);

  const locate = () => {
    geo.start();
    const map = getMap();
    const p = useGeo.getState().position;
    map?.flyTo({ center: [p.lng, p.lat], zoom: 17, duration: 800 });
  };

  const toggle3d = () => {
    const map = getMap();
    if (!map) return;
    const next = !pitched;
    setPitched(next);
    map.easeTo({ pitch: next ? 55 : 0, bearing: next ? -18 : 0, zoom: Math.max(map.getZoom(), next ? 16.6 : map.getZoom()), duration: 900 });
  };

  if (!me) return null;
  return (
    <>
      {!desktop && (
        <div className="chrome chrome--brand">
          <Logo size={20} />
        </div>
      )}
      <div className="chrome chrome--account">
        <button className="balance-pill" onClick={() => navigate('/wallet')}>
          <WalletIcon size={15} strokeWidth={2.2} />
          {formatCHF(me.balanceCents)}
        </button>
        <button className="avatar-btn" onClick={() => navigate('/profile')} aria-label="Profil">
          <Avatar user={me} size={36} />
        </button>
      </div>
      <div className="chrome chrome--controls">
        <button onClick={locate} aria-label="Ma position" className={cx(geo.status === 'live' && 'is-live')}>
          <LocateFixed size={19} strokeWidth={2} />
        </button>
        <span className="chrome__divider" />
        <button onClick={toggle3d} aria-label="Vue 3D" className="chrome__3d">
          {pitched ? '2D' : '3D'}
        </button>
      </div>
    </>
  );
}

/* ── Notifications ───────────────────────────────────────────────────── */

function Toasts() {
  const { toasts, dismiss } = useToasts();
  const navigate = useNavigate();
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            className={cx('toast', t.tone && `toast--${t.tone}`)}
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={() => {
              dismiss(t.id);
              if (t.href) navigate(t.href);
            }}
          >
            <span className="toast__icon">
              <Logo mark size={18} />
            </span>
            <span className="toast__text">
              <strong>{t.title}</strong>
              {t.body && <span>{t.body}</span>}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
