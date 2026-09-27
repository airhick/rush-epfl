import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { MapPin, X } from 'lucide-react';
import { spotOf } from '../../shared/catalog';
import { formatDistance } from '../../shared/geo';
import { formatCHF } from '../../shared/money';
import { OFFER_TTL_MS } from '../../shared/matching';
import { useAccept } from '../lib/queries';
import { offerHeadline, useOffers, type LiveOffer } from '../state/offers';
import { Avatar, Button, cx, Rating, SpotBadge } from '../ui/primitives';

/** Une course proposée en direct, par-dessus n'importe quel écran : gain, contenu, trajet jusqu'au spot et livraison. */
export function OfferLayer() {
  const offers = useOffers((s) => s.offers);
  const current = offers[0];
  return (
    <div className="offer-layer" aria-live="assertive">
      <AnimatePresence>
        {current && <OfferCard key={current.offer.orderId} entry={current} waiting={offers.length - 1} />}
      </AnimatePresence>
    </div>
  );
}

function OfferCard({ entry, waiting }: { entry: LiveOffer; waiting: number }) {
  const { offer, receivedAt, taken } = entry;
  const dismiss = useOffers((s) => s.dismiss);
  const accept = useAccept();
  const navigate = useNavigate();
  const spot = spotOf(offer.spotId);
  const [left, setLeft] = useState(() => Math.max(0, OFFER_TTL_MS - (Date.now() - receivedAt)));

  // Compte à rebours : l'offre se range ensuite dans l'onglet Livrer.
  useEffect(() => {
    if (taken) return;
    const timer = window.setInterval(() => {
      const rest = Math.max(0, OFFER_TTL_MS - (Date.now() - receivedAt));
      setLeft(rest);
      if (rest === 0) dismiss(offer.orderId);
    }, 250);
    return () => window.clearInterval(timer);
  }, [taken, receivedAt, offer.orderId, dismiss]);

  const items = offer.items.map((i) => (i.custom ? i.name : `${i.qty}× ${i.name}`)).join(' · ');

  return (
    <motion.section
      className={cx('offer-card', taken && 'is-taken')}
      initial={{ opacity: 0, y: 40, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 30, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
    >
      <header className="offer-card__head">
        <span className="offer-card__kicker">
          <span className="offer-card__live" />
          {taken ? 'Déjà prise par quelqu’un d’autre' : `Nouvelle course · ${offerHeadline(offer)}`}
        </span>
        <button className="offer-card__close" onClick={() => dismiss(offer.orderId)} aria-label="Ignorer">
          <X size={18} strokeWidth={2.4} />
        </button>
      </header>

      <div className="offer-card__reward">
        <strong>+{formatCHF(offer.rewardCents)}</strong>
        <span>
          {offer.detourMeters !== null
            ? offer.detourMeters < 60
              ? 'Presque sans détour'
              : `+${formatDistance(offer.detourMeters)} de marche sur ton trajet`
            : `${offer.pickup.minutes + offer.delivery.minutes} min de marche en tout`}
        </span>
      </div>

      <ol className="offer-card__route">
        <li>
          <SpotBadge spot={spot} size={34} radius={10} />
          <span>
            <strong>{spot.name}</strong>
            <span>
              Récupérer · {formatDistance(offer.pickup.meters)} · {offer.pickup.minutes} min
            </span>
          </span>
        </li>
        <li>
          <span className="offer-card__pin">
            <MapPin size={17} strokeWidth={2.4} />
          </span>
          <span>
            <strong>{offer.delivery.label}</strong>
            <span>
              Livrer · {formatDistance(offer.delivery.meters)} · {offer.delivery.minutes} min depuis {spot.name}
            </span>
          </span>
        </li>
      </ol>

      <p className="offer-card__items">
        <span>{items}</span>
        <span>Tu avances jusqu’à {formatCHF(offer.advanceCents)}, remboursé·e à la livraison.</span>
      </p>

      <div className="offer-card__who">
        <Avatar user={offer.requester} size={26} />
        <span>
          {offer.requester.firstName} {offer.requester.lastInitial}
        </span>
        <Rating user={offer.requester} compact />
        {waiting > 0 && <span className="offer-card__more">+{waiting} autre{waiting > 1 ? 's' : ''}</span>}
      </div>

      {accept.error && <p className="form-error">{(accept.error as Error).message}</p>}
      <div className="offer-card__actions">
        <Button variant="secondary" onClick={() => dismiss(offer.orderId)} disabled={accept.isPending}>
          Ignorer
        </Button>
        <Button
          loading={accept.isPending}
          disabled={taken}
          onClick={() =>
            accept.mutate(offer.orderId, { onSuccess: (order) => navigate(`/orders/${order.id}`) })
          }
        >
          Accepter
        </Button>
      </div>
      {!taken && (
        <span className="offer-card__timer" style={{ transform: `scaleX(${left / OFFER_TTL_MS})` }} aria-hidden />
      )}
    </motion.section>
  );
}
