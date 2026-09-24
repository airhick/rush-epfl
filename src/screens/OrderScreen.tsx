import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Check, MessageCircle, Navigation, Receipt, Store } from 'lucide-react';
import { spotOf } from '../../shared/catalog';
import { walkingDistance, walkingMinutes, formatDistance, type LatLng } from '../../shared/geo';
import { maxActualItems, settle } from '../../shared/pricing';
import { formatCHF } from '../../shared/money';
import type { Order, PublicUser } from '../../shared/types';
import { useAccept, useConversations, useMe, useOrder, useOrderAction, usePickup, useRate } from '../lib/queries';
import { clock, plural, timeAgo } from '../lib/format';
import { sendEvent } from '../lib/realtime';
import { useGeo } from '../state/location';
import { arc, useMapScene, type RouteLine } from '../state/scene';
import { ProgressBar, STEP_LABELS, stepIndex, statusLine } from '../features/orderStatus';
import { Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { Avatar, Button, cx, Empty, Group, Rating, SpotBadge, Spinner, StarsInput } from '../ui/primitives';

export function OrderScreen() {
  const { id } = useParams();
  const { data: order, error, isLoading } = useOrder(id);
  const { data: me } = useMe();

  if (isLoading) {
    return (
      <Screen back="/orders">
        <div className="center-pad">
          <Spinner size={22} />
        </div>
      </Screen>
    );
  }
  if (!order || !me) {
    return (
      <Screen back="/orders" title="Commande">
        <Empty icon={<Receipt size={26} />} title="Commande indisponible" body={(error as Error | null)?.message} />
      </Screen>
    );
  }
  return <OrderView order={order} />;
}

function OrderView({ order }: { order: Order }) {
  const navigate = useNavigate();
  const spot = spotOf(order.spotId);
  const action = useOrderAction(order.id);
  const accept = useAccept();
  const [pickupOpen, setPickupOpen] = useState(false);
  const geo = useGeo();
  const role = order.myRole;
  const line = statusLine(order);
  const isCourier = role === 'courier';
  const other: PublicUser | null = role === 'requester' ? order.courier : role === 'courier' ? order.requester : order.requester;
  const { data: conversations } = useConversations();
  const unread = conversations?.find((c) => c.order.id === order.id)?.unread ?? 0;
  const live = order.courierLocation && !isCourier ? order.courierLocation : null;

  // Le rusher partage sa position tant qu'il est en course.
  useEffect(() => {
    if (!isCourier || !['accepted', 'picked_up'].includes(order.status)) return;
    geo.start();
    let last = 0;
    return useGeo.subscribe((g) => {
      if (g.status !== 'live' || Date.now() - last < 3000) return;
      last = Date.now();
      sendEvent({ type: 'location', orderId: order.id, lat: g.position.lat, lng: g.position.lng });
    });
  }, [isCourier, order.status, order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useMapScene(() => {
    const routes: RouteLine[] = [];
    const from: LatLng = live && order.status === 'picked_up' ? live : spot;
    const done = order.status === 'completed' || order.status === 'cancelled';
    routes.push({ id: 'leg', points: arc(from, order.dropoff), style: done ? 'ghost' : 'active' });
    if (live && order.status === 'accepted') routes.push({ id: 'approach', points: arc(live, spot, 0.12, 24), style: 'approach' });
    const points: LatLng[] = [spot, order.dropoff];
    if (live) points.push(live);
    return {
      cameraKey: `order-${order.id}-${order.status}`,
      camera: { kind: 'fit', points, maxZoom: 17.4 },
      highlightSpotId: spot.id,
      focusSpotIds: [spot.id],
      routes,
      dropoff: { ...order.dropoff, label: role === 'requester' ? 'Toi' : `${order.requester.firstName} · ${order.dropoff.label}` },
      courier: live && order.courier ? { ...live, user: order.courier } : null,
    };
  }, [order.id, order.status, live?.lat, live?.lng, role]);

  const eta = useMemo(() => {
    if (order.status !== 'picked_up') return null;
    const from = live ?? spot;
    const minutes = walkingMinutes(walkingDistance(from, order.dropoff));
    return { minutes, at: clock(new Date(Date.now() + minutes * 60_000)) };
  }, [order.status, live, spot, order.dropoff]);

  const idx = stepIndex(order);
  const actualOrEstimate = order.actualItemsCents ?? order.itemsCents;
  const { courierCents, refundCents } = settle({ holdCents: order.holdCents, tipCents: order.tipCents, actualItemsCents: actualOrEstimate });

  return (
    <Screen
      back={role ? '/orders' : '/deliver'}
      navTitle={line.title}
      footer={
        <Actions
          order={order}
          role={role}
          busy={action.isPending || accept.isPending}
          error={(action.error ?? accept.error) as Error | null}
          onAction={(a) => action.mutate(a)}
          onAccept={() => accept.mutate(order.id)}
          onPickup={() => setPickupOpen(true)}
        />
      }
    >
      <div className="order-status">
        <motion.h1 key={line.title} className="title1" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {line.title}
        </motion.h1>
        <p className="order-status__detail">{eta ? `Arrivée vers ${eta.at} · environ ${eta.minutes} min` : line.detail}</p>
        {order.status !== 'cancelled' && (
          <>
            <ProgressBar order={order} />
            <div className="progress-labels">
              {STEP_LABELS.map((l, i) => (
                <span key={l} className={cx(i <= idx && 'is-done')}>
                  {l}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {order.status === 'open' && role === 'requester' && <SearchingPulse />}

      {other && (role !== 'requester' || order.courier) && (
        <div className="person-card">
          <Avatar user={other} size={52} />
          <div className="person-card__text">
            <strong>
              {other.firstName} {other.lastInitial}
            </strong>
            <span>
              <Rating user={other} compact />
              {other.section && ` · ${other.section}`}
              {isCourier || !role ? ' · demandeur·euse' : ` · ${plural(other.deliveries, 'livraison', 'livraisons')}`}
            </span>
          </div>
          {role && order.courier && (
            <button className="round-btn" onClick={() => navigate(`/messages/${order.id}`)} aria-label="Messages">
              <MessageCircle size={20} />
              {unread > 0 && <span className="round-btn__badge">{unread}</span>}
            </button>
          )}
        </div>
      )}

      {order.status === 'completed' && role && order.myRating === null && other && <RateBlock order={order} other={other} />}

      <Group header="Trajet">
        <div className="route-card">
          <div className="route-card__stop">
            <SpotBadge spot={spot} size={34} radius={10} />
            <span>
              <strong>{spot.name}</strong>
              <span>{spot.place}</span>
            </span>
          </div>
          <div className="route-card__line">
            <span />
            <em>
              {formatDistance(walkingDistance(spot, order.dropoff))} · {walkingMinutes(walkingDistance(spot, order.dropoff))} min à pied
            </em>
          </div>
          <div className="route-card__stop">
            <span className="route-card__drop">
              <Navigation size={15} strokeWidth={2.6} />
            </span>
            <span>
              <strong>{order.dropoff.label}</strong>
              <span>{order.dropoff.note || (role ? 'Pas de précision' : 'Précisions visibles après acceptation')}</span>
            </span>
          </div>
        </div>
      </Group>

      <Group header={plural(order.items.reduce((n, i) => n + i.qty, 0), 'article', 'articles')}>
        {order.items.map((i) => (
          <div key={i.id} className="item-line">
            <span className="item-line__qty">{i.custom ? '·' : `${i.qty}×`}</span>
            <span className="item-line__name">{i.custom ? `Demande libre : ${i.name}` : i.name}</span>
            <span className="item-line__price">
              {i.custom && 'max. '}
              {formatCHF(i.priceCents * i.qty)}
            </span>
          </div>
        ))}
      </Group>

      <Group header="Montants">
        <div className="summary">
          {isCourier || !role ? (
            <>
              <div className="summary__line">
                <span>{order.actualItemsCents !== null ? 'Ticket déclaré' : 'Tu avances (estimation)'}</span>
                <span>{formatCHF(actualOrEstimate)}</span>
              </div>
              <div className="summary__line">
                <span>Pourboire</span>
                <span className="text-green">{formatCHF(order.tipCents, { sign: true })}</span>
              </div>
              <div className="summary__line summary__line--total">
                <span>{order.status === 'completed' ? 'Crédité sur ton solde' : 'Crédité à la confirmation'}</span>
                <span>{formatCHF(courierCents)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="summary__line">
                <span>Réservé sur ton solde</span>
                <span>{formatCHF(order.holdCents)}</span>
              </div>
              {order.actualItemsCents !== null && (
                <div className="summary__line">
                  <span>Ticket déclaré par {order.courier?.firstName}</span>
                  <span>{formatCHF(order.actualItemsCents)}</span>
                </div>
              )}
              <div className="summary__line">
                <span>Pourboire</span>
                <span>{formatCHF(order.tipCents)}</span>
              </div>
              {order.status === 'cancelled' ? (
                <div className="summary__line summary__line--total">
                  <span>Rendu sur ton solde</span>
                  <span className="text-green">{formatCHF(order.holdCents, { sign: true })}</span>
                </div>
              ) : (
                <div className="summary__line summary__line--total">
                  <span>{order.status === 'completed' ? 'Rendu sur ton solde' : 'Te sera rendu (estimation)'}</span>
                  <span className="text-green">{formatCHF(refundCents, { sign: true })}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Group>

      <p className="footnote">
        Publiée {timeAgo(order.createdAt)} · #{order.id.slice(0, 6).toUpperCase()}
      </p>

      {isCourier && <PickupSheet open={pickupOpen} onClose={() => setPickupOpen(false)} order={order} />}
    </Screen>
  );
}

function SearchingPulse() {
  return (
    <div className="searching">
      <span className="searching__ring" />
      <span className="searching__ring searching__ring--2" />
      <span className="searching__dot" />
      <p>Les rushers autour du spot reçoivent ta demande.</p>
    </div>
  );
}

function Actions({
  order,
  role,
  busy,
  error,
  onAction,
  onAccept,
  onPickup,
}: {
  order: Order;
  role: Order['myRole'];
  busy: boolean;
  error: Error | null;
  onAction: (a: 'release' | 'deliver' | 'confirm' | 'cancel') => void;
  onAccept: () => void;
  onPickup: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const err = error && <p className="form-error">{error.message}</p>;

  if (!role && order.status === 'open') {
    return (
      <>
        {err}
        <Button block loading={busy} onClick={onAccept}>
          Accepter · +{formatCHF(order.tipCents)}
        </Button>
      </>
    );
  }

  if (role === 'requester') {
    if (order.status === 'open') {
      return (
        <>
          {err}
          <Button block variant="secondary" loading={busy} onClick={() => setConfirmCancel(true)}>
            Annuler la demande
          </Button>
          <Sheet open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Annuler la demande ?">
            <p className="sheet-text">Les {formatCHF(order.holdCents)} réservés seront immédiatement rendus sur ton solde.</p>
            <div className="sheet-actions">
              <Button
                block
                variant="danger"
                onClick={() => {
                  setConfirmCancel(false);
                  onAction('cancel');
                }}
              >
                Annuler la demande
              </Button>
              <Button block variant="secondary" onClick={() => setConfirmCancel(false)}>
                Continuer d’attendre
              </Button>
            </div>
          </Sheet>
        </>
      );
    }
    if (order.status === 'delivered') {
      return (
        <>
          {err}
          <Button block variant="success" loading={busy} icon={<Check size={19} strokeWidth={2.8} />} onClick={() => onAction('confirm')}>
            J’ai reçu ma commande
          </Button>
        </>
      );
    }
    return null;
  }

  if (role === 'courier') {
    if (order.status === 'accepted') {
      return (
        <>
          {err}
          <Button block icon={<Store size={18} />} onClick={onPickup}>
            J’ai les articles
          </Button>
          <Button block variant="ghost" size="md" loading={busy} onClick={() => onAction('release')}>
            Me désister
          </Button>
        </>
      );
    }
    if (order.status === 'picked_up') {
      return (
        <>
          {err}
          <Button block loading={busy} icon={<Navigation size={18} />} onClick={() => onAction('deliver')}>
            Je suis arrivé·e
          </Button>
        </>
      );
    }
  }
  return null;
}

function PickupSheet({ open, onClose, order }: { open: boolean; onClose: () => void; order: Order }) {
  const pickup = usePickup(order.id);
  const max = maxActualItems(order);
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const cents = Math.round(Number(value.replace(',', '.')) * 100);
  const valid = Number.isFinite(cents) && cents > 0 && cents <= max;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Montant du ticket"
      footer={
        <Button
          block
          disabled={!valid}
          loading={pickup.isPending}
          onClick={() => pickup.mutate(cents, { onSuccess: onClose })}
        >
          Confirmer l’achat
        </Button>
      }
    >
      <div className="pickup-amount">
        <span>CHF</span>
        <input
          inputMode="decimal"
          value={value}
          style={{ width: `${Math.max(2, value.length) * 0.62 + 0.2}em` }}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="0.00"
          aria-label="Montant payé"
        />
      </div>
      <p className={cx('pickup-hint', !valid && 'is-error')}>
        Prix publiés {formatCHF(order.itemsCents)} (tarif le plus élevé) · maximum {formatCHF(max)}
      </p>

      <Group header="À récupérer">
        {order.items.map((i) => (
          <button key={i.id} className={cx('check-line', checked[i.id] && 'is-checked')} onClick={() => setChecked({ ...checked, [i.id]: !checked[i.id] })}>
            <span className="check-line__box">{checked[i.id] && <Check size={14} strokeWidth={3} />}</span>
            <span>{i.custom ? `Demande libre : ${i.name} (budget max. ${formatCHF(i.priceCents)})` : `${i.qty}× ${i.name}`}</span>
          </button>
        ))}
      </Group>
      {pickup.error && <p className="form-error">{(pickup.error as Error).message}</p>}
      <p className="sheet-note">Garde ton ticket : {order.requester.firstName} voit le montant déclaré.</p>
    </Sheet>
  );
}

function RateBlock({ order, other }: { order: Order; other: PublicUser }) {
  const rate = useRate(order.id);
  const [stars, setStars] = useState(0);
  return (
    <AnimatePresence>
      <motion.div className="rate-block" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <strong>Comment s’est passé l’échange avec {other.firstName} ?</strong>
        <StarsInput
          value={stars}
          onChange={(n) => {
            setStars(n);
            rate.mutate(n);
          }}
        />
        {rate.isSuccess && <span className="muted small">Merci, c’est noté.</span>}
      </motion.div>
    </AnimatePresence>
  );
}
