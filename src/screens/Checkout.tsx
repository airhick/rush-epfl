import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bike, ChevronDown, MapPin, Plus, ShoppingBag, Wallet } from 'lucide-react';
import { nearestBuilding } from '../../shared/catalog';
import { openStatus } from '../../shared/hours';
import { walkingDistance, walkingMinutes } from '../../shared/geo';
import { BONUS_OPTIONS_CENTS, computeHold, FEE_PER_SLICE_CENTS, FEE_SLICE_CENTS, feeSlices } from '../../shared/pricing';
import { clamp, formatCHF } from '../../shared/money';
import { TOPUP_MAX_CENTS, TOPUP_MIN_CENTS } from '../../shared/payments';
import { useCreateOrder, useMe, useWallet } from '../lib/queries';
import { plural } from '../lib/format';
import { useCart, useCartSummary } from '../state/cart';
import { useDropoff } from '../state/location';
import { arc, useMapScene, useScene } from '../state/scene';
import { DropoffSheet } from '../features/DropoffPicker';
import { TopupSheet } from '../features/Money';
import { Screen } from '../ui/Screen';
import { Button, Chip, cx, Empty, Group, SpotBadge, Stepper } from '../ui/primitives';

export function Checkout() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const cart = useCart();
  const { spot, items, count, subtotalCents } = useCartSummary();
  const dropoff = useDropoff();
  const create = useCreateOrder();
  const [dropoffOpen, setDropoffOpen] = useState(false);
  const [topup, setTopup] = useState(false);
  const { data: wallet } = useWallet();

  const minutes = useMemo(
    () => (spot ? walkingMinutes(walkingDistance(spot, dropoff)) : 0),
    [spot, dropoff.lat, dropoff.lng], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Même calcul que le serveur, qui refait le sien à la publication.
  const hold = computeHold(subtotalCents, cart.bonusCents);
  const balance = me?.balanceCents ?? 0;
  const missing = Math.max(0, hold.holdCents - balance);
  // Recharge proposée : ce qui manque, arrondi au franc, dans les limites de Stripe.
  const topupCents = clamp(Math.ceil(missing / 100) * 100, TOPUP_MIN_CENTS, TOPUP_MAX_CENTS);
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

  const submit = () =>
    create.mutate(
      {
        spotId: spot.id,
        items: items.filter((i) => !i.custom).map((i) => ({ itemId: i.itemId, qty: i.qty })),
        custom: cart.custom,
        dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label, note: dropoff.note },
        bonusCents: cart.bonusCents,
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
          {missing > 0 && wallet?.topupsEnabled ? (
            <Button block icon={<Plus size={18} strokeWidth={2.4} />} onClick={() => setTopup(true)}>
              Recharger {formatCHF(topupCents)}
            </Button>
          ) : missing > 0 ? (
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
              {`${minutes} min à pied depuis ${spot.name}`}
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
        {items.map((i) =>
          i.custom ? (
            <div key={i.itemId} className="cart-line cart-line--custom">
              <span className="cart-line__name">
                <span className="cart-line__kicker">Demande libre</span>
                {i.name}
              </span>
              <span className="cart-line__price">max. {formatCHF(i.priceCents)}</span>
              <button className="link" onClick={() => cart.setCustom(spot.id, null)}>
                Retirer
              </button>
            </div>
          ) : (
            <div key={i.itemId} className="cart-line">
              <span className="cart-line__name">{i.name}</span>
              <span className="cart-line__price">{formatCHF(i.priceCents * i.qty)}</span>
              <Stepper compact value={i.qty} onChange={(n) => cart.setQty(i.itemId, n)} />
            </div>
          ),
        )}
        <button className="cart-add" onClick={() => navigate(`/spot/${spot.id}`)}>
          <Plus size={16} strokeWidth={2.6} /> Ajouter des articles
        </button>
      </Group>

      <Group header="Rémunération du rusher" footer="Tout va au rusher : Rush ne prend aucune commission.">
        <div className="fee-line">
          <span>
            <strong>Livraison</strong>
            <span>
              {formatCHF(FEE_PER_SLICE_CENTS)} par tranche de CHF {FEE_SLICE_CENTS / 100} ·{' '}
              {plural(feeSlices(subtotalCents), 'tranche', 'tranches')}
            </span>
          </span>
          <strong>{formatCHF(hold.feeCents)}</strong>
        </div>
        <div className="bonus-picker">
          <span>
            <strong>Coup de pouce</strong>
            <span>Facultatif, pour que ta demande parte plus vite.</span>
          </span>
          <div className="chip-wrap">
            {BONUS_OPTIONS_CENTS.map((c) => (
              <Chip key={c} active={cart.bonusCents === c} onClick={() => cart.setBonus(c)}>
                {c === 0 ? 'Aucun' : `+${formatCHF(c, { bare: true })}`}
              </Chip>
            ))}
          </div>
        </div>
      </Group>

      <Group
        header="Paiement"
        footer="Rush réserve le prix publié le plus élevé (tarif visiteur pour les menus EPFL) et le budget de ta demande libre, plus la livraison. Ton rusher avance l’achat et déclare le ticket exact : ce qui n’est pas dépensé t’est rendu à la livraison."
      >
        <div className="summary">
          <div className="summary__line">
            <span>Articles · montant maximum</span>
            <span>{formatCHF(hold.itemsCents)}</span>
          </div>
          <div className="summary__line">
            <span>Livraison</span>
            <span>{formatCHF(hold.feeCents)}</span>
          </div>
          {hold.bonusCents > 0 && (
            <div className="summary__line">
              <span>Coup de pouce</span>
              <span>{formatCHF(hold.bonusCents)}</span>
            </div>
          )}
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
      <TopupSheet open={topup} onClose={() => setTopup(false)} initialCents={topupCents} />
    </Screen>
  );
}
