import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { ArrowUpRight, Bike, Check, CreditCard, Gift, Lock, Plus, RotateCcw, ShoppingBag, Undo2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatCHF } from '../../shared/money';
import type { TxKind } from '../../shared/types';
import { keys, useMe, useTopupStatus, useWallet } from '../lib/queries';
import { clock, groupByDay } from '../lib/format';
import { useCartSummary } from '../state/cart';
import { useMapScene } from '../state/scene';
import { TopupSheet, WithdrawalList, WithdrawSheet } from '../features/Money';
import { Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { Button, cx, Empty, Skeleton, Spinner } from '../ui/primitives';
import { Logo } from '../ui/Logo';

const TX_STYLE: Record<TxKind, { icon: typeof Gift; name: string }> = {
  bonus: { icon: Gift, name: 'Crédit offert' },
  hold: { icon: ShoppingBag, name: 'Réservation' },
  refund: { icon: RotateCcw, name: 'Remboursement' },
  release: { icon: Undo2, name: 'Annulation' },
  payout: { icon: Bike, name: 'Livraison' },
  topup: { icon: CreditCard, name: 'Recharge' },
  withdrawal: { icon: ArrowUpRight, name: 'Retrait' },
  withdrawal_refund: { icon: Undo2, name: 'Retrait' },
};

export function Wallet() {
  const { data: wallet, isLoading } = useWallet();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [topup, setTopup] = useState(false);
  const [withdraw, setWithdraw] = useState(false);

  useMapScene(() => ({ cameraKey: 'overview', camera: { kind: 'overview' } }), []);

  return (
    <Screen title="Solde" navTitle="Solde">
      <div className="pad-x">
        <motion.div className="cash-card" initial={{ rotateX: 8, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
          <div className="cash-card__top">
            <Logo size={18} />
            <span className="cash-card__label">Solde Rush</span>
          </div>
          <div className="cash-card__amount">
            {isLoading || !wallet ? <Skeleton h={40} w={180} /> : formatCHF(wallet.balanceCents)}
          </div>
          <div className="cash-card__bottom">
            <span>
              {me?.firstName} {me?.lastInitial}
            </span>
            {wallet && wallet.heldCents > 0 && (
              <button className="cash-card__held" onClick={() => navigate('/orders')}>
                <Lock size={12} strokeWidth={2.6} />
                {formatCHF(wallet.heldCents)} réservés
              </button>
            )}
          </div>
        </motion.div>

        <div className="wallet-actions">
          {wallet?.topupsEnabled && (
            <Button icon={<Plus size={18} strokeWidth={2.4} />} onClick={() => setTopup(true)}>
              Recharger
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<ArrowUpRight size={18} strokeWidth={2.4} />}
            disabled={!wallet}
            onClick={() => setWithdraw(true)}
            className={cx(!wallet?.topupsEnabled && 'wallet-actions__wide')}
          >
            Retirer
          </Button>
          <Button className="wallet-actions__wide" variant="secondary" icon={<Bike size={18} strokeWidth={2.2} />} onClick={() => navigate('/deliver')}>
            Livrer pour gagner du solde
          </Button>
        </div>

        {wallet && (
          <div className="stat-tiles">
            <div className="stat-tile">
              <span>Gagné ce mois</span>
              <strong className="text-green">{formatCHF(wallet.earnedThisMonthCents)}</strong>
            </div>
            <div className="stat-tile">
              <span>Dépensé ce mois</span>
              <strong>{formatCHF(wallet.spentThisMonthCents)}</strong>
            </div>
          </div>
        )}
      </div>

      {wallet && <WithdrawalList withdrawals={wallet.withdrawals} />}

      {wallet && wallet.transactions.length === 0 && (
        <Empty icon={<Gift size={24} />} title="Aucun mouvement" body="Recharge ton solde ou livre une demande pour gagner tes premiers francs." />
      )}

      {wallet &&
        groupByDay(wallet.transactions, (t) => t.createdAt).map((g) => (
          <section key={g.label} className="section">
            <div className="section__head">
              <h2 className="section__small">{g.label}</h2>
            </div>
            <div className="tx-list">
              {g.items.map((t) => {
                // Écritures d'anciennes versions : affichage neutre.
                const style = TX_STYLE[t.kind] ?? TX_STYLE.release;
                const [kind, context] = t.label.split(' · ');
                return (
                  <button
                    key={t.id}
                    className="tx"
                    onClick={() => t.orderId && navigate(`/orders/${t.orderId}`)}
                    disabled={!t.orderId}
                  >
                    <span className="tx__icon">
                      <style.icon size={18} strokeWidth={2.2} />
                    </span>
                    <span className="tx__text">
                      <strong>{context ?? t.label}</strong>
                      <span>{context ? `${t.orderId ? style.name : kind} · ${clock(t.createdAt)}` : clock(t.createdAt)}</span>
                    </span>
                    <span className={cx('tx__amount', t.amountCents > 0 && 'is-positive')}>{formatCHF(t.amountCents, { sign: true })}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

      <p className="footnote">
        Recharge ton solde par carte (CHF 1 à 100) ou gagne-le en livrant : chaque livraison te rembourse l’achat avancé et te verse le
        pourboire. Tu peux retirer ton solde par TWINT, l’équipe Rush te l’envoie. Le crédit offert à l’inscription sert à tes demandes et
        ne se retire pas. Les montants réservés restent bloqués jusqu’à la livraison ou l’annulation.
      </p>

      <TopupSheet open={topup} onClose={() => setTopup(false)} />
      {wallet && <WithdrawSheet open={withdraw} onClose={() => setWithdraw(false)} wallet={wallet} />}
      <TopupReturn />
    </Screen>
  );
}

/** Retour de la page Stripe (/wallet?recharge=cs_…) : on attend le crédit envoyé par le webhook. */
function TopupReturn() {
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('recharge');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cart = useCartSummary();
  const { data, dataUpdatedAt, isError } = useTopupStatus(sessionId);
  const [startedAt] = useState(Date.now);

  const credited = data?.status === 'credited';
  const slow = !credited && (isError || dataUpdatedAt - startedAt > 55_000);

  useEffect(() => {
    if (credited) {
      qc.invalidateQueries({ queryKey: keys.wallet });
      qc.invalidateQueries({ queryKey: keys.me });
    }
  }, [credited, qc]);

  const close = () => setParams({}, { replace: true });

  return (
    <Sheet open={Boolean(sessionId)} onClose={close} title="Recharge">
      <div className="topup-done">
        <span className={cx('topup-done__check', !credited && 'is-waiting')}>{credited ? <Check size={34} strokeWidth={3} /> : <Spinner size={30} />}</span>
        {credited ? (
          <>
            <strong>+{formatCHF(data.amountCents ?? 0)}</strong>
            <span>ajoutés à ton solde. Merci !</span>
          </>
        ) : slow ? (
          <>
            <strong>Paiement en cours</strong>
            <span>Stripe n’a pas encore confirmé. Ton solde sera crédité automatiquement dès la confirmation : rien à refaire.</span>
          </>
        ) : (
          <>
            <strong>Paiement reçu</strong>
            <span>On attend la confirmation de Stripe…</span>
          </>
        )}
      </div>
      <div className="sheet-actions">
        {credited && cart.count > 0 ? (
          <Button
            block
            onClick={() => {
              close();
              navigate('/checkout');
            }}
          >
            Reprendre ma demande
          </Button>
        ) : (
          <Button block variant={credited ? 'primary' : 'secondary'} onClick={close}>
            {credited ? 'Voir mon solde' : 'Fermer'}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
