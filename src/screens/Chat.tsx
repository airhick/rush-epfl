import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Receipt } from 'lucide-react';
import { SPOT_BY_ID } from '../../shared/catalog';
import type { Message, Order } from '../../shared/types';
import { useMarkRead, useMe, useMessages, useOrder, useSendMessage } from '../lib/queries';
import { clock, dayLabel } from '../lib/format';
import { sendEvent, setActiveChat } from '../lib/realtime';
import { useMapScene, arc } from '../state/scene';
import { useTyping } from '../state/ui';
import { ProgressBar, statusLine } from '../features/orderStatus';
import { Screen } from '../ui/Screen';
import { Avatar, cx, Empty, Spinner } from '../ui/primitives';

function quickReplies(order: Order): string[] {
  if (order.myRole === 'courier') {
    if (order.status === 'accepted') return ['Je suis dans la file', 'Ils n’en ont plus, je prends autre chose ?', 'C’est acheté !'];
    if (order.status === 'picked_up') return ['J’arrive dans 2 min', 'Je suis devant l’entrée', 'Tu es où exactement ?'];
    return ['Merci !', 'Bon appétit 😊'];
  }
  if (order.status === 'accepted') return ['Merci beaucoup !', 'Sans oignons si possible', 'Prends autre chose si c’est épuisé'];
  if (order.status === 'picked_up' || order.status === 'delivered') return ['Je descends !', 'Je suis au 2e étage', 'Tu es où ?'];
  return ['Merci !'];
}

export function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: order } = useOrder(id);
  const { data: messages, isLoading } = useMessages(id, Boolean(order?.myRole));
  const send = useSendMessage(id ?? '');
  const markRead = useMarkRead(id ?? '');
  const typing = useTyping((s) => (id ? s.typing[id] ?? 0 : 0));
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);

  const spot = order ? SPOT_BY_ID.get(order.spotId) : undefined;
  const other = order ? (order.myRole === 'requester' ? order.courier : order.requester) : null;

  useEffect(() => {
    setActiveChat(id ?? null);
    return () => setActiveChat(null);
  }, [id]);

  useEffect(() => {
    if (order?.myRole && messages) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length, order?.myRole]);

  useEffect(() => {
    if (!typing) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [typing]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: messages && messages.length > 0 ? 'smooth' : 'auto' });
  }, [messages?.length, typing > now]);

  useMapScene(
    () =>
      order && spot
        ? {
            cameraKey: `chat-${order.id}`,
            camera: { kind: 'fit', points: [spot, order.dropoff], maxZoom: 17 },
            highlightSpotId: spot.id,
            focusSpotIds: [spot.id],
            routes: [{ id: 'leg', points: arc(spot, order.dropoff), style: 'active' }],
            dropoff: { ...order.dropoff, label: order.dropoff.label },
            courier: order.courierLocation && order.courier && order.myRole === 'requester' ? { ...order.courierLocation, user: order.courier } : null,
          }
        : { cameraKey: 'overview', camera: { kind: 'overview' } },
    [order?.id, order?.courierLocation?.lat, order?.courierLocation?.lng],
  );

  const submit = (body: string) => {
    const trimmed = body.trim();
    if (!trimmed || !id) return;
    send.mutate(trimmed);
    setText('');
    input.current?.focus();
  };

  const onType = (v: string) => {
    setText(v);
    if (id && Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      sendEvent({ type: 'typing', orderId: id });
    }
  };

  if (!order || !me) {
    return (
      <Screen back="/messages">
        <div className="center-pad">
          <Spinner size={22} />
        </div>
      </Screen>
    );
  }

  const canWrite = Boolean(order.courier && order.myRole);
  const line = statusLine(order);

  return (
    <Screen
      className="chat"
      back="/messages"
      scrollRef={scroller}
      navTitle={
        other && (
          <span className="chat__nav">
            <Avatar user={other} size={28} />
            <span>
              <strong>{other.firstName}</strong>
              <em>{typing > now ? 'écrit…' : line.title}</em>
            </span>
          </span>
        )
      }
      trailing={
        <button className="nav__icon" onClick={() => navigate(`/orders/${order.id}`)} aria-label="Voir la commande">
          <Receipt size={20} />
        </button>
      }
      footer={
        canWrite ? (
          <div className="composer">
            <div className="composer__quick">
              {quickReplies(order).map((q) => (
                <button key={q} onClick={() => submit(q)}>
                  {q}
                </button>
              ))}
            </div>
            <form
              className="composer__bar"
              onSubmit={(e) => {
                e.preventDefault();
                submit(text);
              }}
            >
              <textarea
                ref={input}
                rows={1}
                placeholder="Message"
                value={text}
                maxLength={500}
                onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit(text);
                  }
                }}
              />
              <motion.button type="submit" className="composer__send" disabled={!text.trim()} whileTap={{ scale: 0.85 }} aria-label="Envoyer">
                <ArrowUp size={18} strokeWidth={2.8} />
              </motion.button>
            </form>
          </div>
        ) : undefined
      }
    >
      <button className="chat__context" onClick={() => navigate(`/orders/${order.id}`)}>
        <span>
          <strong>
            {spot?.name} → {order.dropoff.label}
          </strong>
          <span>{line.detail}</span>
        </span>
        <ProgressBar order={order} />
      </button>

      {!canWrite && (
        <Empty icon={<Receipt size={24} />} title="Conversation indisponible" body="Elle s’ouvre dès qu’un rusher accepte la demande." />
      )}

      {isLoading && canWrite && (
        <div className="center-pad">
          <Spinner />
        </div>
      )}

      <div className="thread">
        {messages && <Thread messages={messages} meId={me.id} />}
        <AnimatePresence>
          {typing > now && (
            <motion.div className="bubble-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="bubble bubble--theirs bubble--typing">
                <span />
                <span />
                <span />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Screen>
  );
}

function Thread({ messages, meId }: { messages: Message[]; meId: string }) {
  return (
    <>
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const gap = !prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 10 * 60_000;
        const stamp = gap && (
          <div className="thread__stamp">
            <strong>{dayLabel(m.createdAt)}</strong> {clock(m.createdAt)}
          </div>
        );

        if (m.kind === 'system') {
          return (
            <Fragment key={m.id}>
              {stamp}
              <div className="thread__system">{m.body}</div>
            </Fragment>
          );
        }

        const mine = m.senderId === meId;
        const sameAsNext = next && next.kind === 'text' && next.senderId === m.senderId;
        return (
          <Fragment key={m.id}>
            {stamp}
            <motion.div
              className={cx('bubble-row', mine && 'bubble-row--mine', sameAsNext && 'is-grouped')}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            >
              <div className={cx('bubble', mine ? 'bubble--mine' : 'bubble--theirs', !sameAsNext && 'has-tail')} title={clock(m.createdAt)}>
                {m.body}
              </div>
            </motion.div>
          </Fragment>
        );
      })}
    </>
  );
}
