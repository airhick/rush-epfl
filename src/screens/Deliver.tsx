import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Bike, Building2, ChevronRight, Flag, MapPin, Navigation, Wallet } from 'lucide-react';
import { BUILDINGS, SPOTS, SPOT_BY_ID, spotOf } from '../../shared/catalog';
import { detourMeters, formatDistance, walkingDistance, type LatLng } from '../../shared/geo';
import { openStatus } from '../../shared/hours';
import { formatCHF } from '../../shared/money';
import type { Order, Presence } from '../../shared/types';
import { useAccept, useOpenOrders, usePresence, useSetPresence, useWallet } from '../lib/queries';
import { plural, timeAgo } from '../lib/format';
import { useGeo } from '../state/location';
import { arc, useMapScene, useScene, type RouteLine } from '../state/scene';
import { ActiveOrders } from '../features/ActiveOrders';
import { Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { Avatar, Button, cx, Empty, Group, IconTile, Rating, Row, SpotBadge, Switch } from '../ui/primitives';

const ON_THE_WAY_M = 150;

interface Ranked {
  order: Order;
  detour: number;
  score: number;
}

export function Deliver() {
  const navigate = useNavigate();
  const geo = useGeo();
  const { data: presence } = usePresence();
  const setPresence = useSetPresence();
  const { data: open, isLoading } = useOpenOrders();
  const { data: wallet } = useWallet();
  const accept = useAccept();
  const [selected, setSelected] = useState<string | null>(null);
  const [picker, setPicker] = useState<'spot' | 'dest' | null>(null);

  const p: Presence = presence ?? { available: false, spotId: null, destination: null };
  const here = p.spotId ? SPOT_BY_ID.get(p.spotId) : undefined;
  const from: LatLng = here ?? geo.position;

  const ranked = useMemo<Ranked[]>(() => {
    return (open ?? [])
      .map((order) => {
        const spot = spotOf(order.spotId);
        const detour = detourMeters({ from, spot, dropoff: order.dropoff, destination: p.destination });
        // Un pourboire au-dessus du suggéré fait remonter la demande (+0.50 ≈ 100 m de détour en moins).
        const bonus = ((order.tipCents - order.suggestedTipCents) / 50) * 100;
        const sameSpot = order.spotId === p.spotId ? 250 : 0;
        return { order, detour, score: detour - bonus - sameSpot };
      })
      .sort((a, b) => a.score - b.score);
  }, [open, from.lat, from.lng, p.destination, p.spotId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    useScene.getState().setHandlers({ onRequestClick: (id) => setSelected((cur) => (cur === id ? null : id)) });
    return () => useScene.getState().setHandlers({ onRequestClick: null });
  }, []);

  useMapScene(() => {
    const routes: RouteLine[] = ranked.map(({ order }) => {
      const spot = spotOf(order.spotId);
      return { id: order.id, points: arc(spot, order.dropoff), style: order.id === selected ? 'active' : 'ghost' };
    });
    const sel = ranked.find((r) => r.order.id === selected);
    const selSpot = sel ? spotOf(sel.order.spotId) : null;
    return {
      cameraKey: sel ? `deliver-${sel.order.id}` : `deliver-${p.spotId ?? 'me'}-${ranked.length > 0}`,
      camera: sel
        ? { kind: 'fit', points: [selSpot!, sel.order.dropoff, ...(p.destination ? [p.destination] : [])], maxZoom: 17.2 }
        : ranked.length
          ? { kind: 'fit', points: [from, ...ranked.slice(0, 6).flatMap((r) => [spotOf(r.order.spotId), r.order.dropoff])] }
          : { kind: 'overview' },
      focusSpotIds: [...new Set(ranked.map((r) => r.order.spotId).concat(p.spotId ? [p.spotId] : []))],
      highlightSpotId: selSpot?.id ?? p.spotId,
      routes: selected ? [...routes.filter((r) => r.id !== selected), ...routes.filter((r) => r.id === selected)] : routes,
      requests: ranked.map(({ order }) => ({
        id: order.id,
        lat: order.dropoff.lat,
        lng: order.dropoff.lng,
        label: formatCHF(order.tipCents, { bare: true }),
        selected: order.id === selected,
      })),
      destination: p.destination,
    };
  }, [ranked, selected, p.destination?.lat, p.spotId]);

  const update = (patch: Partial<Presence>) => setPresence.mutate({ ...p, ...patch });

  const nearestOpen = useMemo(() => {
    const list = SPOTS.filter((s) => openStatus(s.hours).open)
      .map((s) => ({ s, d: walkingDistance(geo.position, s) }))
      .sort((a, b) => a.d - b.d);
    return list[0]?.d < 120 ? list[0].s : undefined;
  }, [geo.position]);

  return (
    <Screen title="Livrer" subtitle="Rends service sur ton chemin et gagne un pourboire." navTitle="Livrer">
      <ActiveOrders role="courier" />

      <div className={cx('availability', p.available && 'is-on')}>
        <div className="availability__head">
          <span className="availability__icon">
            <Bike size={20} />
          </span>
          <span className="availability__text">
            <strong>{p.available ? 'Tu es visible' : 'Disponibilité'}</strong>
            <span>{p.available ? 'Les demandes autour de toi te sont signalées.' : 'Signale où tu es pour recevoir des demandes.'}</span>
          </span>
          <Switch
            checked={p.available}
            label="Disponible"
            onChange={(v) => update({ available: v, spotId: v ? (p.spotId ?? nearestOpen?.id ?? null) : p.spotId })}
          />
        </div>
        <div className="availability__rows">
          <button className="availability__row" onClick={() => setPicker('spot')}>
            <MapPin size={16} />
            <span>Je suis à</span>
            <strong>{here?.name ?? 'Choisir un spot'}</strong>
            <ChevronRight size={16} className="muted" />
          </button>
          <button className="availability__row" onClick={() => setPicker('dest')}>
            <Flag size={16} />
            <span>Je vais vers</span>
            <strong>{p.destination?.label ?? 'Pas de destination'}</strong>
            <ChevronRight size={16} className="muted" />
          </button>
        </div>
      </div>

      {wallet && wallet.earnedThisMonthCents > 0 && (
        <p className="earned-line">
          <Wallet size={14} /> {formatCHF(wallet.earnedThisMonthCents)} reçus ce mois-ci grâce à tes livraisons
        </p>
      )}

      <section className="section">
        <div className="section__head">
          <h2>{ranked.length ? plural(ranked.length, 'demande ouverte', 'demandes ouvertes') : 'Demandes'}</h2>
          {p.destination && <span className="muted small">triées selon ton trajet</span>}
        </div>

        {!isLoading && ranked.length === 0 && (
          <Empty
            icon={<Bike size={26} />}
            title="Aucune demande pour l’instant"
            body="Reste disponible : tu verras les nouvelles demandes apparaître ici en direct."
          />
        )}

        <div className="requests">
          {ranked.map(({ order, detour }) => (
            <RequestCard
              key={order.id}
              order={order}
              detour={detour}
              hasDestination={Boolean(p.destination)}
              selected={selected === order.id}
              onSelect={() => setSelected(selected === order.id ? null : order.id)}
              accepting={accept.isPending && accept.variables === order.id}
              onAccept={() => accept.mutate(order.id, { onSuccess: (o) => navigate(`/orders/${o.id}`) })}
            />
          ))}
        </div>
        {accept.error && <p className="form-error">{(accept.error as Error).message}</p>}
      </section>

      <Sheet open={picker === 'spot'} onClose={() => setPicker(null)} title="Où es-tu ?">
        <Group>
          <Row
            onClick={() => {
              update({ spotId: null });
              setPicker(null);
            }}
            leading={
              <IconTile color="var(--fill-2)">
                <Navigation size={15} color="var(--label)" />
              </IconTile>
            }
            title="En chemin, pas dans un spot"
          />
        </Group>
        <Group header="Spots ouverts">
          {SPOTS.filter((s) => openStatus(s.hours).open)
            .map((s) => ({ s, d: walkingDistance(geo.position, s) }))
            .sort((a, b) => a.d - b.d)
            .map(({ s, d }) => (
              <Row
                key={s.id}
                onClick={() => {
                  update({ spotId: s.id, available: true });
                  setPicker(null);
                }}
                leading={<SpotBadge spot={s} size={30} radius={8} />}
                title={s.name}
                subtitle={s.place}
                trailing={p.spotId === s.id ? <MapPin size={16} color="var(--blue)" /> : <span className="muted">{formatDistance(d)}</span>}
              />
            ))}
        </Group>
      </Sheet>

      <Sheet open={picker === 'dest'} onClose={() => setPicker(null)} title="Où vas-tu ensuite ?">
        <p className="sheet-note sheet-note--top">Rush met en avant les demandes qui te font faire le moins de détour.</p>
        <Group>
          <Row
            onClick={() => {
              update({ destination: null });
              setPicker(null);
            }}
            leading={
              <IconTile color="var(--fill-2)">
                <Flag size={15} color="var(--label)" />
              </IconTile>
            }
            title="Pas de destination précise"
          />
        </Group>
        <Group header="Bâtiments">
          {BUILDINGS.map((b) => (
            <Row
              key={b.id}
              onClick={() => {
                update({ destination: { lat: b.lat, lng: b.lng, label: b.name } });
                setPicker(null);
              }}
              leading={
                <IconTile color="var(--fill-2)">
                  <Building2 size={15} color="var(--label)" />
                </IconTile>
              }
              title={b.name}
              subtitle={b.hint}
              trailing={p.destination?.label === b.name ? <Flag size={16} color="var(--blue)" /> : undefined}
            />
          ))}
        </Group>
      </Sheet>
    </Screen>
  );
}

function RequestCard({
  order,
  detour,
  hasDestination,
  selected,
  onSelect,
  onAccept,
  accepting,
}: {
  order: Order;
  detour: number;
  hasDestination: boolean;
  selected: boolean;
  onSelect: () => void;
  onAccept: () => void;
  accepting: boolean;
}) {
  const spot = spotOf(order.spotId);
  const count = order.items.reduce((n, i) => n + i.qty, 0);
  const onTheWay = hasDestination && detour < ON_THE_WAY_M;
  const generous = order.tipCents > order.suggestedTipCents;

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
            {onTheWay ? (
              <span className="pill pill--green">Sur ton chemin</span>
            ) : (
              <span className="pill">{hasDestination ? `+${formatDistance(detour)} de détour` : `${formatDistance(detour)} de marche`}</span>
            )}
            {generous && <span className="pill pill--orange">Pourboire+</span>}
            <span className="request__age">{timeAgo(order.createdAt)}</span>
          </span>
        </span>
        <span className="request__tip">
          <strong>{formatCHF(order.tipCents, { bare: true })}</strong>
          <span>CHF</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {selected && (
          <motion.div className="request__detail" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
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
            <p className="request__note">
              Tu avances l’achat, tu déclares le ticket, et tu es remboursé·e avec le pourboire dès que {order.requester.firstName} confirme.
            </p>
            <Button block loading={accepting} onClick={onAccept}>
              Accepter · +{formatCHF(order.tipCents)}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
