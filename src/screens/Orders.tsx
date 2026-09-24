import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Box } from 'lucide-react';
import { spotOf } from '../../shared/catalog';
import { formatCHF } from '../../shared/money';
import { ACTIVE_STATUSES, type Order } from '../../shared/types';
import { useMyOrders } from '../lib/queries';
import { shortDate } from '../lib/format';
import { useMapScene } from '../state/scene';
import { ProgressBar, statusLine } from '../features/orderStatus';
import { Screen } from '../ui/Screen';
import { Button, cx, Empty, Segmented, Skeleton, SpotBadge } from '../ui/primitives';

export function Orders() {
  const { data, isLoading } = useMyOrders();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'requester' | 'courier'>('requester');

  useMapScene(() => ({ cameraKey: 'overview', camera: { kind: 'overview' } }), []);

  const list = (data ?? []).filter((o) => o.myRole === tab);
  const active = list.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const past = list.filter((o) => !ACTIVE_STATUSES.includes(o.status));

  return (
    <Screen title="Activité" navTitle="Activité">
      <div className="pad-x">
        <Segmented
          id="orders"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'requester', label: 'Mes demandes' },
            { value: 'courier', label: 'Mes livraisons' },
          ]}
        />
      </div>

      {isLoading && (
        <div className="pad-x stack">
          <Skeleton h={72} r={16} />
          <Skeleton h={72} r={16} />
        </div>
      )}

      {!isLoading && list.length === 0 && (
        <Empty
          icon={<Box size={26} />}
          title={tab === 'requester' ? 'Aucune demande' : 'Aucune livraison'}
          body={tab === 'requester' ? 'Commande depuis n’importe quel spot du campus.' : 'Passe dans l’onglet Livrer pour rendre service.'}
          action={
            <Button size="md" variant="secondary" onClick={() => navigate(tab === 'requester' ? '/' : '/deliver')}>
              {tab === 'requester' ? 'Explorer les spots' : 'Voir les demandes'}
            </Button>
          }
        />
      )}

      {active.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>En cours</h2>
          </div>
          <div className="order-list">
            {active.map((o) => (
              <OrderRow key={o.id} order={o} onClick={() => navigate(`/orders/${o.id}`)} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>Historique</h2>
          </div>
          <div className="order-list">
            {past.map((o) => (
              <OrderRow key={o.id} order={o} onClick={() => navigate(`/orders/${o.id}`)} />
            ))}
          </div>
        </section>
      )}
    </Screen>
  );
}

function OrderRow({ order, onClick }: { order: Order; onClick: () => void }) {
  const spot = spotOf(order.spotId);
  const line = statusLine(order);
  const active = ACTIVE_STATUSES.includes(order.status);
  const amount =
    order.myRole === 'courier'
      ? order.status === 'completed'
        ? formatCHF((order.actualItemsCents ?? order.itemsCents) + order.tipCents, { sign: true })
        : formatCHF(order.tipCents, { sign: true })
      : order.status === 'completed'
        ? formatCHF(-((order.actualItemsCents ?? order.itemsCents) + order.tipCents))
        : order.status === 'cancelled'
          ? formatCHF(0)
          : formatCHF(-order.holdCents);

  return (
    <button className={cx('order-row', order.status === 'cancelled' && 'is-cancelled')} onClick={onClick}>
      <SpotBadge spot={spot} size={46} radius={12} />
      <span className="order-row__text">
        <strong>
          {spot.name} → {order.dropoff.label}
        </strong>
        <span>
          {line.title} · {shortDate(order.completedAt ?? order.cancelledAt ?? order.createdAt)}
        </span>
        {active && <ProgressBar order={order} />}
      </span>
      <span className={cx('order-row__amount', order.myRole === 'courier' && order.status === 'completed' && 'text-green')}>{amount}</span>
    </button>
  );
}
