import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Bike, Gift, Lock, RotateCcw, ShoppingBag, Undo2 } from 'lucide-react';
import { formatCHF } from '../../shared/money';
import type { TxKind } from '../../shared/types';
import { useMe, useWallet } from '../lib/queries';
import { clock, groupByDay } from '../lib/format';
import { useMapScene } from '../state/scene';
import { Screen } from '../ui/Screen';
import { Button, cx, Empty, Skeleton } from '../ui/primitives';
import { Logo } from '../ui/Logo';

const TX_STYLE: Record<TxKind, { icon: typeof Gift; color: string; name: string }> = {
  bonus: { icon: Gift, color: 'var(--blue)', name: 'Crédit offert' },
  hold: { icon: ShoppingBag, color: 'var(--orange)', name: 'Réservation' },
  refund: { icon: RotateCcw, color: 'var(--green)', name: 'Remboursement' },
  release: { icon: Undo2, color: 'var(--label-2)', name: 'Annulation' },
  payout: { icon: Bike, color: 'var(--green)', name: 'Livraison' },
};

export function Wallet() {
  const { data: wallet, isLoading } = useWallet();
  const { data: me } = useMe();
  const navigate = useNavigate();

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
          <Button variant="secondary" icon={<Bike size={18} strokeWidth={2.2} />} onClick={() => navigate('/deliver')}>
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

      {wallet && wallet.transactions.length === 0 && (
        <Empty icon={<Gift size={24} />} title="Aucun mouvement" body="Livre une demande pour gagner ton premier solde." />
      )}

      {wallet &&
        groupByDay(wallet.transactions, (t) => t.createdAt).map((g) => (
          <section key={g.label} className="section">
            <div className="section__head">
              <h2 className="section__small">{g.label}</h2>
            </div>
            <div className="tx-list">
              {g.items.map((t) => {
                // Écritures d'anciennes versions (ex. recharges) : affichage neutre.
                const style = TX_STYLE[t.kind] ?? TX_STYLE.release;
                const [, context] = t.label.split(' · ');
                return (
                  <button
                    key={t.id}
                    className="tx"
                    onClick={() => t.orderId && navigate(`/orders/${t.orderId}`)}
                    disabled={!t.orderId}
                  >
                    <span className="tx__icon" style={{ color: style.color }}>
                      <style.icon size={18} strokeWidth={2.2} />
                    </span>
                    <span className="tx__text">
                      <strong>{context ?? t.label}</strong>
                      <span>{context ? `${style.name} · ${clock(t.createdAt)}` : clock(t.createdAt)}</span>
                    </span>
                    <span className={cx('tx__amount', t.amountCents > 0 && 'is-positive')}>{formatCHF(t.amountCents, { sign: true })}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

      <p className="footnote">
        Le solde Rush se gagne en livrant : chaque livraison te rembourse l’achat avancé et te verse le pourboire. Il sert à payer tes
        propres demandes. Les montants réservés restent bloqués jusqu’à la livraison ou l’annulation.
      </p>
    </Screen>
  );
}
