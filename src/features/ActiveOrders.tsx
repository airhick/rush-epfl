import { useNavigate } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { spotOf } from '../../shared/catalog';
import { ACTIVE_STATUSES, type Order } from '../../shared/types';
import { useMyOrders } from '../lib/queries';
import { SpotBadge } from '../ui/primitives';
import { ProgressBar, statusLine } from './orderStatus';

/** Bandeau des commandes en cours, en tête de l'accueil et du fil rusher. */
export function ActiveOrders({ role }: { role?: Order['myRole'] }) {
  const { data } = useMyOrders();
  const navigate = useNavigate();
  const active = (data ?? []).filter((o) => ACTIVE_STATUSES.includes(o.status) && (!role || o.myRole === role));
  if (active.length === 0) return null;

  return (
    <div className="active-orders">
      {active.map((o) => {
        const spot = spotOf(o.spotId);
        const line = statusLine(o);
        return (
          <button key={o.id} className="active-order" onClick={() => navigate(`/orders/${o.id}`)}>
            <SpotBadge spot={spot} size={40} />
            <span className="active-order__text">
              <strong>{line.title}</strong>
              <span>
                {spot.name} → {o.dropoff.label}
              </span>
              <ProgressBar order={o} />
            </span>
            <ChevronRight size={18} className="muted" />
          </button>
        );
      })}
    </div>
  );
}
