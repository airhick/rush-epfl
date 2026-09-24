import { cx } from '../ui/primitives';
import { SPOT_BY_ID } from '../../shared/catalog';
import type { Order } from '../../shared/types';

const STEPS = ['open', 'accepted', 'picked_up', 'delivered'] as const;

export function stepIndex(order: Order): number {
  if (order.status === 'completed') return 4;
  if (order.status === 'cancelled') return -1;
  return STEPS.indexOf(order.status as (typeof STEPS)[number]);
}

/** Barre segmentée façon suivi Uber : le segment en cours scintille. */
export function ProgressBar({ order }: { order: Order }) {
  const idx = stepIndex(order);
  return (
    <span className={cx('progress', order.status === 'cancelled' && 'is-cancelled')} aria-hidden>
      {STEPS.map((s, i) => (
        <span key={s} className={cx('progress__seg', i < idx && 'is-done', i === idx && 'is-current')} />
      ))}
    </span>
  );
}

export const STEP_LABELS = ['Publiée', 'Acceptée', 'Achetée', 'Livrée'];

export function statusLine(order: Order): { title: string; detail: string } {
  const spot = SPOT_BY_ID.get(order.spotId)?.name ?? 'le spot';
  const courier = order.courier?.firstName ?? 'Ton rusher';
  const requester = order.requester.firstName;
  const mine = order.myRole === 'requester';

  switch (order.status) {
    case 'open':
      return mine
        ? { title: 'On cherche un rusher', detail: `Ta demande est visible par tous ceux qui passent par ${spot}.` }
        : { title: 'Demande ouverte', detail: `${requester} attend quelqu’un à ${spot}.` };
    case 'accepted':
      return mine
        ? { title: `${courier} s’occupe de ta demande`, detail: `Passage à ${spot} en cours.` }
        : { title: `Achète à ${spot}`, detail: `Puis livre ${requester} à ${order.dropoff.label}.` };
    case 'picked_up':
      return mine
        ? { title: `${courier} arrive`, detail: `Articles achetés, direction ${order.dropoff.label}.` }
        : { title: `Livre ${requester}`, detail: `Rendez-vous à ${order.dropoff.label}.` };
    case 'delivered':
      return mine
        ? { title: `${courier} est là`, detail: 'Confirme la réception pour lui verser le montant.' }
        : { title: 'En attente de confirmation', detail: `${requester} doit confirmer la réception.` };
    case 'completed':
      return { title: 'Terminée', detail: mine ? `Livrée par ${courier}.` : `Livrée à ${requester}.` };
    case 'cancelled':
      return {
        title: order.cancelReason === 'expired' ? 'Expirée' : 'Annulée',
        detail: order.cancelReason === 'expired' ? 'Personne n’a pu passer à temps. Montant rendu.' : 'Montant rendu sur ton solde.',
      };
  }
}
