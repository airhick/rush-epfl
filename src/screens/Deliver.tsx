import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Bike, ChevronRight, LocateFixed, Route, Wallet } from 'lucide-react';
import { nearestBuilding, spotOf } from '../../shared/catalog';
import { formatDistance, walkingMinutes, type LatLng } from '../../shared/geo';
import { formatCHF } from '../../shared/money';
import { NEARBY_RADIUS_M, rank, type CourierState, type Match } from '../../shared/matching';
import type { Order, Presence, RouteStop } from '../../shared/types';
import { useAccept, useOpenOrders, usePresence, useSetPresence, useWallet, walkingRoute } from '../lib/queries';
import { plural, timeAgo } from '../lib/format';
import { useGeo } from '../state/location';
import { useLayout } from '../state/ui';
import { arc, useMapScene, useScene, type RouteLine } from '../state/scene';
import { ActiveOrders } from '../features/ActiveOrders';
import { RoutePlanner } from '../features/RoutePlanner';
import { Screen } from '../ui/Screen';
import { Avatar, Button, cx, Empty, Rating, SpotBadge, Switch } from '../ui/primitives';

const DEFAULT_PRESENCE: Presence = { available: true, stops: [], path: null };

export function Deliver() {
  const navigate = useNavigate();
  const geo = useGeo();
  const { data: presence } = usePresence();
  const setPresence = useSetPresence();
  const { data: open, isLoading } = useOpenOrders();
  const { data: wallet } = useWallet();
  const accept = useAccept();
  const [selected, setSelected] = useState<string | null>(null);
  const [planner, setPlanner] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<RouteStop[]>([]);
  const [saving, setSaving] = useState(false);
  const [alerts, setAlerts] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));

  const p = presence ?? DEFAULT_PRESENCE;
  const live = geo.status === 'live';
  const courier = useMemo<CourierState>(
    () => ({ position: live ? geo.position : null, stops: p.stops, path: p.path }),
    [live, geo.position, p.stops, p.path],
  );

  // Même algorithme que le serveur : gain par minute de marche ajoutée à ton trajet.
  const ranked = useMemo(
    () =>
      rank(
        courier,
        (open ?? []).map((order) => ({
          order,
          pickup: spotOf(order.spotId),
          dropoff: order.dropoff,
          rewardCents: order.rewardCents,
          createdAt: order.createdAt,
        })),
      ),
    [courier, open],
  );

  useEffect(() => {
    useScene.getState().setHandlers({ onRequestClick: (id) => setSelected((cur) => (cur === id ? null : id)) });
    return () => useScene.getState().setHandlers({ onRequestClick: null });
  }, []);

  /* Placement d'une étape sur la carte : la feuille se replie, un toucher sur la carte ajoute le point. */
  useEffect(() => {
    if (!picking) return;
    const layout = useLayout.getState();
    const before = layout.snap;
    layout.setSnap('peek');
    useScene.getState().setHandlers({
      onMapClick: (pt: LatLng) => {
        setDraft((d) => [...d, { ...pt, label: `Près de ${nearestBuilding(pt).name}`, spotId: null }]);
        setPicking(false);
        setPlanner(true);
      },
    });
    return () => {
      useScene.getState().setHandlers({ onMapClick: null });
      useLayout.getState().setSnap(before);
    };
  }, [picking]);

  const myRoute: LatLng[] = p.path ?? (p.stops.length ? [...(live ? [geo.position] : []), ...p.stops] : []);
  const shownStops = planner || picking ? draft : p.stops;

  useMapScene(() => {
    const routes: RouteLine[] = ranked.map(({ job }) => ({
      id: job.order.id,
      points: arc(job.pickup, job.dropoff),
      style: job.order.id === selected ? 'active' : 'ghost',
    }));
    if (myRoute.length > 1 && !planner && !picking) routes.unshift({ id: 'my-route', points: myRoute, style: 'approach' });
    const sel = ranked.find((r) => r.job.order.id === selected)?.job;
    const from = live ? [geo.position] : [];
    return {
      cameraKey: picking ? 'deliver-picking' : sel ? `deliver-${sel.order.id}` : `deliver-${shownStops.length}-${ranked.length > 0}`,
      camera: picking
        ? { kind: 'overview' }
        : sel
          ? { kind: 'fit', points: [sel.pickup, sel.dropoff, ...from], maxZoom: 17.2 }
          : ranked.length || shownStops.length
            ? { kind: 'fit', points: [...from, ...shownStops, ...ranked.slice(0, 6).flatMap((r) => [r.job.pickup, r.job.dropoff])] }
            : { kind: 'overview' },
      focusSpotIds: [...new Set(ranked.map((r) => r.job.order.spotId).concat(shownStops.flatMap((s) => (s.spotId ? [s.spotId] : []))))],
      highlightSpotId: sel?.order.spotId ?? null,
      routes: selected ? [...routes.filter((r) => r.id !== selected), ...routes.filter((r) => r.id === selected)] : routes,
      requests: ranked.map(({ job }) => ({
        id: job.order.id,
        lat: job.dropoff.lat,
        lng: job.dropoff.lng,
        label: formatCHF(job.rewardCents, { bare: true }),
        selected: job.order.id === selected,
      })),
      stops: shownStops,
    };
  }, [ranked, selected, shownStops, myRoute.length, planner, picking, live]);

  const openPlanner = () => {
    setDraft(p.stops);
    setPlanner(true);
  };

  const saveRoute = async (stops: RouteStop[]) => {
    setSaving(true);
    try {
      const points = [...(live ? [geo.position] : []), ...stops];
      // Le tracé à pied est un plus : sans lui, on garde des lignes droites entre les étapes.
      const route = points.length > 1 ? await walkingRoute(points).catch(() => null) : null;
      setPresence.mutate({ ...p, available: true, stops, path: route?.path ?? null });
      setPlanner(false);
    } finally {
      setSaving(false);
    }
  };

  const askAlerts = async () => {
    if (typeof Notification === 'undefined') return;
    setAlerts(await Notification.requestPermission());
  };

  return (
    <Screen title="Livrer" subtitle="Rends service sur ton chemin et gagne quelques francs." navTitle="Livrer">
      <ActiveOrders role="courier" />

      <div className={cx('availability', p.available && 'is-on')}>
        <div className="availability__head">
          <span className="availability__icon">
            <Bike size={20} />
          </span>
          <span className="availability__text">
            <strong>{p.available ? 'Tu reçois les courses' : 'Tu ne reçois pas de courses'}</strong>
            <span>
              {p.available
                ? `En direct dès que tu es à moins de ${NEARBY_RADIUS_M} m d’un spot avec une demande, ou qu’elle tombe sur ton trajet.`
                : 'Réactive-toi pour être prévenu·e des demandes autour de toi.'}
            </span>
          </span>
          <Switch checked={p.available} label="Disponible" onChange={(v) => setPresence.mutate({ ...p, available: v })} />
        </div>
        <div className="availability__rows">
          <div className="availability__row">
            <LocateFixed size={16} />
            <span>Ma position</span>
            <strong className={cx(!live && 'muted')}>
              {live ? 'Localisée' : geo.status === 'denied' ? 'Refusée' : geo.status === 'off-campus' ? 'Hors campus' : 'En attente'}
            </strong>
          </div>
          <button className="availability__row" onClick={openPlanner}>
            <Route size={16} />
            <span>Mon trajet</span>
            <strong>{p.stops.length ? p.stops.map((s) => s.label).join(' → ') : 'Indiquer où je vais'}</strong>
            <ChevronRight size={16} className="muted" />
          </button>
          {alerts === 'default' && (
            <button className="availability__row" onClick={askAlerts}>
              <Bell size={16} />
              <span>Alertes hors de l’app</span>
              <strong>Activer</strong>
              <ChevronRight size={16} className="muted" />
            </button>
          )}
        </div>
      </div>
      {!live && p.available && p.stops.length === 0 && (
        <p className="group-hint">
          Sans ta position ni ton trajet, Rush ne peut pas te proposer les courses proches : autorise la localisation ou indique ton trajet.
        </p>
      )}

      {wallet && wallet.earnedThisMonthCents > 0 && (
        <p className="earned-line">
          <Wallet size={14} /> {formatCHF(wallet.earnedThisMonthCents)} reçus ce mois-ci grâce à tes livraisons
        </p>
      )}

      <section className="section">
        <div className="section__head">
          <h2>{ranked.length ? plural(ranked.length, 'demande ouverte', 'demandes ouvertes') : 'Demandes'}</h2>
          {ranked.length > 1 && <span className="muted small">{p.stops.length ? 'selon ton trajet' : 'les plus rentables d’abord'}</span>}
        </div>

        {!isLoading && ranked.length === 0 && (
          <Empty
            icon={<Bike size={26} />}
            title="Aucune demande pour l’instant"
            body="Pas besoin de rester ici : une nouvelle demande près de toi ou sur ton trajet s’affiche en direct, où que tu sois dans l’app."
          />
        )}

        <div className="requests">
          {ranked.map(({ job, match }) => (
            <RequestCard
              key={job.order.id}
              order={job.order}
              match={match}
              hasRoute={p.stops.length > 0}
              selected={selected === job.order.id}
              onSelect={() => setSelected(selected === job.order.id ? null : job.order.id)}
              accepting={accept.isPending && accept.variables === job.order.id}
              onAccept={() => accept.mutate(job.order.id, { onSuccess: (o) => navigate(`/orders/${o.id}`) })}
            />
          ))}
        </div>
        {accept.error && <p className="form-error">{(accept.error as Error).message}</p>}
      </section>

      <RoutePlanner
        open={planner}
        onClose={() => setPlanner(false)}
        draft={draft}
        setDraft={setDraft}
        from={geo.position}
        saving={saving}
        onSave={() => saveRoute(draft)}
        onClear={
          p.stops.length
            ? () => {
                setPresence.mutate({ ...p, stops: [], path: null });
                setPlanner(false);
              }
            : null
        }
        onPickOnMap={() => {
          setPlanner(false);
          setPicking(true);
        }}
      />

      {createPortal(
        <div className="pick-banner-wrap">
          <AnimatePresence>
            {picking && (
              <motion.div
                className="pick-banner"
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
              >
                <span>Touche la carte là où tu vas, à peu près.</span>
                <button
                  className="link"
                  onClick={() => {
                    setPicking(false);
                    setPlanner(true);
                  }}
                >
                  Annuler
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </Screen>
  );
}

function RequestCard({
  order,
  match,
  hasRoute,
  selected,
  onSelect,
  onAccept,
  accepting,
}: {
  order: Order;
  match: Match | null;
  hasRoute: boolean;
  selected: boolean;
  onSelect: () => void;
  onAccept: () => void;
  accepting: boolean;
}) {
  const spot = spotOf(order.spotId);
  const count = order.items.reduce((n, i) => n + i.qty, 0);

  return (
    <motion.div layout className={cx('request', selected && 'is-selected')}>
      <button className="request__main" onClick={onSelect}>
        <SpotBadge spot={spot} size={44} radius={12} />
        <span className="request__text">
          <span className="request__route">
            {spot.name} <span className="request__arrow">→</span> {order.dropoff.label}
          </span>
          <span className="request__meta">
            {plural(count, 'article', 'articles')} · jusqu’à {formatCHF(order.itemsCents)} à avancer
          </span>
          <span className="request__chips">
            {match?.reason === 'nearby' && <span className="pill pill--green">À {formatDistance(match.toPickupM)} de toi</span>}
            {match && match.reason !== 'nearby' && match.onTheWay && <span className="pill pill--green">Sur ton chemin</span>}
            {match && match.reason !== 'nearby' && !match.onTheWay && (
              <span className="pill">
                {hasRoute ? `+${formatDistance(match.extraM)} de détour` : `${walkingMinutes(match.extraM)} min de marche`}
              </span>
            )}
            {order.bonusCents > 0 && <span className="pill pill--orange">Coup de pouce</span>}
            <span className="request__age">{timeAgo(order.createdAt)}</span>
          </span>
        </span>
        <span className="request__tip">
          <strong>{formatCHF(order.rewardCents, { bare: true })}</strong>
          <span>CHF</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            className="request__detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="request__who">
              <Avatar user={order.requester} size={30} />
              <span>
                <strong>
                  {order.requester.firstName} {order.requester.lastInitial}
                </strong>
                <Rating user={order.requester} compact />
              </span>
            </div>
            <ul className="request__items">
              {order.items.map((i) => (
                <li key={i.id}>
                  <span>{i.custom ? `Demande libre : ${i.name}` : `${i.qty}× ${i.name}`}</span>
                  <span>
                    {i.custom && 'max. '}
                    {formatCHF(i.priceCents * i.qty)}
                  </span>
                </li>
              ))}
            </ul>
            {match && (
              <p className="request__note">
                {formatDistance(match.toPickupM)} jusqu’à {spot.name}, puis {formatDistance(match.deliveryM)} jusqu’à {order.dropoff.label}.
                Tu avances l’achat et tu es remboursé·e avec ta rémunération dès que {order.requester.firstName} confirme.
              </p>
            )}
            <Button block loading={accepting} onClick={onAccept}>
              Accepter · +{formatCHF(order.rewardCents)}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
