import { useNavigate } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { SPOT_BY_ID } from '../../shared/catalog';
import { useConversations } from '../lib/queries';
import { shortDate } from '../lib/format';
import { useMapScene } from '../state/scene';
import { useTyping } from '../state/ui';
import { statusLine } from '../features/orderStatus';
import { Screen } from '../ui/Screen';
import { Avatar, cx, Empty, Skeleton } from '../ui/primitives';

export function Messages() {
  const { data, isLoading } = useConversations();
  const navigate = useNavigate();
  const typing = useTyping((s) => s.typing);

  useMapScene(() => ({ cameraKey: 'overview', camera: { kind: 'overview' } }), []);

  return (
    <Screen title="Messages" navTitle="Messages">
      {isLoading && (
        <div className="pad-x stack">
          <Skeleton h={64} r={14} />
          <Skeleton h={64} r={14} />
        </div>
      )}
      {!isLoading && (data ?? []).length === 0 && (
        <Empty
          icon={<MessageCircle size={26} />}
          title="Pas encore de conversation"
          body="Une conversation s’ouvre automatiquement dès qu’un rusher accepte une demande."
        />
      )}
      <div className="inbox">
        {data?.map(({ order, other, lastMessage, unread }) => {
          if (!other) return null;
          const spot = SPOT_BY_ID.get(order.spotId)!;
          const isTyping = (typing[order.id] ?? 0) > Date.now();
          const preview = isTyping
            ? 'écrit…'
            : lastMessage
              ? `${lastMessage.kind === 'system' ? '' : lastMessage.senderId === other.id ? '' : 'Toi : '}${lastMessage.body}`
              : 'Dis bonjour 👋';
          return (
            <button key={order.id} className={cx('inbox__row', unread > 0 && 'is-unread')} onClick={() => navigate(`/messages/${order.id}`)}>
              <Avatar user={other} size={50} />
              <span className="inbox__text">
                <span className="inbox__top">
                  <strong>
                    {other.firstName} {other.lastInitial}
                  </strong>
                  <span className="inbox__time">{shortDate(lastMessage?.createdAt ?? order.createdAt)}</span>
                </span>
                <span className="inbox__context">
                  {order.myRole === 'courier' ? 'Tu livres' : 'Livre pour toi'} · {spot.name} → {order.dropoff.label} · {statusLine(order).title}
                </span>
                <span className="inbox__bottom">
                  <span className={cx('inbox__preview', isTyping && 'is-typing')}>{preview}</span>
                  {unread > 0 && <span className="inbox__badge">{unread}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Screen>
  );
}
