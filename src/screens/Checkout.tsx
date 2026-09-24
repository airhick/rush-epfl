import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Bike, ChevronDown, Info, MapPin, Minus, Plus, ShoppingBag, Wallet } from 'lucide-react';
import { nearestBuilding } from '../../shared/catalog';
import { openStatus } from '../../shared/hours';
import { computeHold, describeTip, suggestTip, TIP_MAX_CENTS, TIP_MIN_CENTS, TIP_STEP_CENTS } from '../../shared/pricing';
import { formatCHF } from '../../shared/money';
import { useCreateOrder, useMe } from '../lib/queries';
import { plural } from '../lib/format';
import { useCart, useCartSummary } from '../state/cart';
import { useDropoff } from '../state/location';
import { arc, useMapScene, useScene } from '../state/scene';
import { DropoffSheet } from '../features/DropoffPicker';
import { Screen } from '../ui/Screen';
import { Button, cx, Empty, Group, SpotBadge, Stepper } from '../ui/primitives';

export function Checkout() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const cart = useCart();
  const { spot, items, count, subtotalCents } = useCartSummary();
  const dropoff = useDropoff();
  const create = useCreateOrder();
  const [dropoffOpen, setDropoffOpen] = useState(false);
  const [why, setWhy] = useState(false);

  const suggestion = useMemo(
    () => (spot ? suggestTip({ spot, dropoff, itemCount: count }) : null),
    [spot, dropoff.lat, dropoff.lng, count], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const tipCents = cart.tipCents ?? suggestion?.suggestedCents ?? 0;
  const hold = computeHold(subtotalCents, tipCents);
  const balance = me?.balanceCents ?? 0;
  const missing = Math.max(0, hold.holdCents - balance);
  const open = spot ? openStatus(spot.hours).open : false;

  // L'épingle de livraison se déplace directement sur la carte.
  useEffect(() => {
    useScene.getState().setHandlers({
      onDropoffMove: (p) => useDropoff.getState().set({ ...p, label: nearestBuilding(p).name, source: 'pin' }),
    });
    return () => useScene.getState().setHandlers({ onDropoffMove: null });
  }, []);

  useMapScene(
    () =>
      spot
        ? {
            cameraKey: `checkout-${spot.id}-${dropoff.source === 'pin' ? 'pin' : `${dropoff.lat},${dropoff.lng}`}`,
            camera: { kind: 'fit', points: [spot, dropoff], maxZoom: 17.4 },
            highlightSpotId: spot.id,
            focusSpotIds: [spot.id],
            dropoff: { ...dropoff, label: dropoff.label, draggable: true },
            routes: [{ id: 'leg', points: arc(spot, dropoff), style: 'active' }],
          }
        : { cameraKey: 'overview', camera: { kind: 'overview' } },
    [spot?.id, dropoff.lat, dropoff.lng, dropoff.label, dropoff.source],
  );

  if (!spot || count === 0) {
    return (
      <Screen back="/" title="Ta demande">
        <Empty
          icon={<ShoppingBag size={26} />}
          title="Ton panier est vide"
          body="Choisis un spot et ajoute ce que tu veux qu’on te ramène."
          action={
            <Button size="md" onClick={() => navigate('/')}>
              Explorer les spots
            </Button>
          }
        />
      </Screen>
    );
  }

  const setTip = (cents: number) => cart.setTip(Math.min(TIP_MAX_CENTS, Math.max(TIP_MIN_CENTS, cents)));

  const submit = () =>
    create.mutate(
      {
        spotId: spot.id,
        items: items.map((i) => ({ itemId: i.itemId, qty: i.qty })),
        dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label, note: dropoff.note },
        tipCents,
      },
      {
        onSuccess: (order) => {
          cart.clear();
          navigate(`/orders/${order.id}`, { replace: true });
        },
      },
    );

  return (
    <Screen
      back={`/spot/${spot.id}`}
      title="Ta demande"
      subtitle={
        <span className="checkout-sub">
          <SpotBadge spot={spot} size={20} radius={6} /> {spot.name}
        </span>
      }
      footer={
        <>
          {create.error && <p className="form-error">{(create.error as Error).message}</p>}
          {missing > 0 ? (
            <Button block icon={<Bike size={18} />} onClick={() => navigate('/deliver')}>
              Gagner {formatCHF(missing)} en livrant
            </Button>
          ) : (
            <Button block loading={create.isPending} disabled={!open} onClick={submit}>
              {open ? `Publier la demande · ${formatCHF(hold.holdCents)}` : `${spot.name} est fermé`}
            </Button>
          )}
        </>
      }
    >
      <Group header="Livraison">
        <button className="dropoff-card" onClick={() => setDropoffOpen(true)}>
          <span className="dropoff-card__pin">
            <MapPin size={18} strokeWidth={2.4} />
          </span>
          <span className="dropoff-card__text">
            <strong>{dropoff.label}</strong>
            <span>
              {dropoff.source === 'pin' ? 'Épingle placée sur la carte' : dropoff.source === 'auto' ? 'Ta position' : 'Entrée du bâtiment'}
              {' · '}
              {suggestion && `${suggestion.minutes} min à pied depuis ${spot.name}`}
            </span>
          </span>
          <ChevronDown size={18} className="muted" />
        </button>
        <label className="note-field">
          <input
            placeholder="Salle, étage, signe distinctif…"
            value={dropoff.note}
            maxLength={140}
            onChange={(e) => dropoff.set({ note: e.target.value })}
          />
        </label>
      </Group>
      <p className="group-hint">Glisse l’épingle noire sur la carte pour être précis. La note n’est visible que par ton rusher.</p>

      <Group header={plural(count, 'article', 'articles')}>
        {items.map((i) => (
          <div key={i.itemId} className="cart-line">
            <span className="cart-line__name">{i.name}</span>
            <span className="cart-line__price">{formatCHF(i.priceCents * i.qty)}</span>
            <Stepper compact value={i.qty} onChange={(n) => cart.setQty(i.itemId, n)} />
          </div>
        ))}
        <button className="cart-add" onClick={() => navigate(`/spot/${spot.id}`)}>
          <Plus size={16} strokeWidth={2.6} /> Ajouter des articles
        </button>
      </Group>

      {suggestion && (
        <Group header="Pourboire du rusher">
          <div className="tip-options">
            {suggestion.options.map((o) => (
              <button key={o.id} className={cx('tip-option', tipCents === o.cents && 'is-active')} onClick={() => cart.setTip(o.cents)}>
                <span className="tip-option__amount">{formatCHF(o.cents, { bare: true })}</span>
                <span className="tip-option__label">{o.label}</span>
                {o.id === 'suggested' && <span className="tip-option__badge">Recommandé</span>}
              </button>
            ))}
          </div>
          <div className="tip-custom">
            <span>Autre montant</span>
            <div className="tip-custom__ctrl">
              <button onClick={() => setTip(tipCents - TIP_STEP_CENTS)} disabled={tipCents <= TIP_MIN_CENTS} aria-label="Moins">
                <Minus size={16} strokeWidth={2.6} />
              </button>
              <strong>{formatCHF(tipCents)}</strong>
              <button onClick={() => setTip(tipCents + TIP_STEP_CENTS)} disabled={tipCents >= TIP_MAX_CENTS} aria-label="Plus">
                <Plus size={16} strokeWidth={2.6} />
              </button>
            </div>
          </div>
          <button className="tip-why" onClick={() => setWhy(!why)}>
            <Info size={15} />
            <span>{describeTip(tipCents, suggestion)}</span>
            <ChevronDown size={15} className={cx('tip-why__chevron', why && 'is-open')} />
          </button>
          <AnimatePresence initial={false}>
            {why && (
              <motion.div
                className="tip-factors"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                {suggestion.factors.map((f) => (
                  <div key={f.label} className="tip-factor">
                    <span>
                      <strong>{f.label}</strong>
                      <span>{f.detail}</span>
                    </span>
                    <span>{formatCHF(f.cents, { sign: true })}</span>
                  </div>
                ))}
                <div className="tip-factor tip-factor--total">
                  <span>
                    <strong>Suggéré</strong>
                    <span>Arrondi aux 50 centimes</span>
                  </span>
                  <span>{formatCHF(suggestion.suggestedCents)}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Group>
      )}

      <Group
        header="Paiement"
        footer="Le montant est réservé sur ton solde. Ton rusher avance l’achat et déclare le ticket exact : ce qui n’est pas dépensé t’est rendu à la livraison."
      >
        <div className="summary">
          <div className="summary__line">
            <span>Articles (prix indicatifs)</span>
            <span>{formatCHF(hold.itemsCents)}</span>
          </div>
          <div className="summary__line">
            <span>
              Marge de variation de prix <span className="muted">+10 %</span>
            </span>
            <span>{formatCHF(hold.marginCents)}</span>
          </div>
          <div className="summary__line">
            <span>Pourboire</span>
            <span>{formatCHF(hold.tipCents)}</span>
          </div>
          <div className="summary__line summary__line--total">
            <span>Réservé maintenant</span>
            <span>{formatCHF(hold.holdCents)}</span>
          </div>
        </div>
        <div className={cx('balance-line', missing > 0 && 'is-short')}>
          <span className="balance-line__icon">
            <Wallet size={16} />
          </span>
          <span className="balance-line__text">
            <strong>Solde Rush</strong>
            <span>
              {formatCHF(balance)} disponible
              {missing === 0 && ` · ${formatCHF(balance - hold.holdCents)} après réservation`}
            </span>
          </span>
          {missing > 0 && (
            <button className="link" onClick={() => navigate('/deliver')}>
              Gagner du solde
            </button>
          )}
        </div>
      </Group>

      <DropoffSheet open={dropoffOpen} onClose={() => setDropoffOpen(false)} />
    </Screen>
  );
}
