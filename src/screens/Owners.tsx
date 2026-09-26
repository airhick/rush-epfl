import { useState } from 'react';
import { Navigate } from 'react-router';
import { Check, Copy, CreditCard, Inbox } from 'lucide-react';
import { formatCHF } from '../../shared/money';
import { formatPhone } from '../../shared/payments';
import type { OwnerWithdrawal } from '../../shared/types';
import { useMe, useOwnerAction, useOwnerOverview } from '../lib/queries';
import { shortDate, timeAgo } from '../lib/format';
import { useMapScene } from '../state/scene';
import { WITHDRAWAL_STATUS } from '../features/Money';
import { Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { Button, cx, Empty, Skeleton } from '../ui/primitives';

/** Écran de l'équipe Rush : retraits à envoyer par TWINT, puis à marquer comme envoyés. */
export function Owners() {
  const { data: me } = useMe();
  const { data, isLoading } = useOwnerOverview(Boolean(me?.isAdmin));
  const action = useOwnerAction();
  const [confirm, setConfirm] = useState<OwnerWithdrawal | null>(null);
  const [rejecting, setRejecting] = useState<OwnerWithdrawal | null>(null);

  useMapScene(() => ({ cameraKey: 'overview', camera: { kind: 'overview' } }), []);
  if (me && !me.isAdmin) return <Navigate to="/" replace />;

  const total = data?.pending.reduce((s, w) => s + w.amountCents, 0) ?? 0;

  return (
    <Screen back="/profile" title="Retraits" navTitle="Retraits" subtitle={data && data.pending.length > 0 ? `${formatCHF(total)} à envoyer par TWINT` : 'Équipe Rush'}>
      {isLoading && (
        <div className="pad-x">
          <Skeleton h={150} r={18} />
        </div>
      )}

      {data && data.pending.length === 0 && (
        <Empty icon={<Inbox size={24} />} title="Aucun retrait à envoyer" body="Les nouvelles demandes apparaissent ici, avec une notification." />
      )}

      {data && data.pending.length > 0 && (
        <div className="owner-list">
          {data.pending.map((w) => (
            <article key={w.id} className="owner-card">
              <header className="owner-card__head">
                <span>
                  <strong>
                    {w.user.firstName} {w.user.lastName}
                  </strong>
                  <span>
                    {w.user.email}
                    {w.user.section && ` · ${w.user.section}`}
                  </span>
                  <span className={cx('pill', w.user.epfl ? 'pill--green' : 'pill--orange')}>
                    {w.user.epfl ? 'Vérifié par l’EPFL' : 'Adresse non vérifiée'}
                  </span>
                </span>
                <span className="owner-card__amount">{formatCHF(w.amountCents)}</span>
              </header>
              <CopyPhone phone={w.phone} />
              <p className="owner-card__meta">
                Demandé {timeAgo(w.createdAt)} · rechargé {formatCHF(w.stats.topupsCents)} · gagné en livrant {formatCHF(w.stats.earnedCents)} ·
                solde restant {formatCHF(w.stats.balanceCents)}
              </p>
              <div className="owner-card__actions">
                <Button size="md" icon={<Check size={16} strokeWidth={2.6} />} onClick={() => setConfirm(w)}>
                  Envoyé
                </Button>
                <Button size="md" variant="secondary" onClick={() => setRejecting(w)}>
                  Refuser
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {data && data.unmatchedTopups.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__small">Paiements Stripe sans compte</h2>
          </div>
          <div className="tx-list">
            {data.unmatchedTopups.map((t) => (
              <div key={t.sessionId} className="tx">
                <span className="tx__icon">
                  <CreditCard size={18} strokeWidth={2.2} />
                </span>
                <span className="tx__text">
                  <strong>{t.email ?? 'Adresse inconnue'}</strong>
                  <span>
                    {shortDate(t.createdAt)} · {t.sessionId}
                  </span>
                </span>
                <span className="tx__amount">
                  {t.currency.toUpperCase()} {(t.amountCents / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <p className="footnote">Aucun compte Rush ne correspond à ces paiements. Retrouve-les dans Stripe (Paiements) pour les rembourser.</p>
        </section>
      )}

      {data && data.recent.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__small">Traités récemment</h2>
          </div>
          <div className="tx-list">
            {data.recent.map((w) => {
              const status = WITHDRAWAL_STATUS[w.status];
              return (
                <div key={w.id} className="withdrawal">
                  <span className="withdrawal__text">
                    <strong>
                      {formatCHF(w.amountCents)} · {w.user.firstName} {w.user.lastName}
                    </strong>
                    <span>
                      {formatPhone(w.phone)} · {shortDate(w.processedAt ?? w.createdAt)}
                      {w.note && ` · ${w.note}`}
                    </span>
                  </span>
                  <span className={cx('pill', status.tone)}>{status.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <p className="footnote">
        Envoie le montant par TWINT au numéro indiqué, puis touche « Envoyé » : la personne est prévenue. « Refuser » rend le montant à
        son solde. Le montant a déjà quitté son solde au moment de la demande.
      </p>

      {action.error && <p className="form-error pad-x">{(action.error as Error).message}</p>}

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title="Retrait envoyé ?">
        {confirm && (
          <>
            <p className="sheet-text">
              Tu as envoyé <strong>{formatCHF(confirm.amountCents)}</strong> par TWINT au <strong>{formatPhone(confirm.phone)}</strong> (
              {confirm.user.firstName} {confirm.user.lastName}) ?
            </p>
            <div className="sheet-actions">
              <Button
                block
                loading={action.isPending}
                onClick={() => action.mutate({ id: confirm.id, action: 'paid' }, { onSettled: () => setConfirm(null) })}
              >
                Oui, c’est envoyé
              </Button>
              <Button block variant="secondary" onClick={() => setConfirm(null)}>
                Pas encore
              </Button>
            </div>
          </>
        )}
      </Sheet>

      <RejectSheet
        withdrawal={rejecting}
        onClose={() => setRejecting(null)}
        onReject={(reason) =>
          rejecting && action.mutate({ id: rejecting.id, action: 'reject', reason }, { onSettled: () => setRejecting(null) })
        }
        loading={action.isPending}
      />
    </Screen>
  );
}

function CopyPhone({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false);
  const pretty = formatPhone(phone);
  return (
    <button
      className="owner-card__phone"
      onClick={() => {
        navigator.clipboard
          ?.writeText(pretty.replace(/\s/g, ''))
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => {});
      }}
    >
      <span>
        <span className="owner-card__label">TWINT</span>
        <strong>{pretty}</strong>
      </span>
      {copied ? <Check size={16} strokeWidth={2.6} /> : <Copy size={16} strokeWidth={2.2} />}
    </button>
  );
}

function RejectSheet({
  withdrawal,
  onClose,
  onReject,
  loading,
}: {
  withdrawal: OwnerWithdrawal | null;
  onClose: () => void;
  onReject: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;
  return (
    <Sheet open={withdrawal !== null} onClose={onClose} title="Refuser le retrait">
      <p className="sheet-text">
        Le montant revient sur le solde de {withdrawal?.user.firstName}. Explique-lui pourquoi : le message lui est envoyé.
      </p>
      <label className="custom-request__field">
        <textarea
          value={reason}
          maxLength={200}
          rows={3}
          placeholder="Ex. : ce numéro n’est pas relié à TWINT, corrige-le et refais la demande."
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="sheet-actions">
        <Button
          block
          variant="danger"
          disabled={!valid}
          loading={loading}
          onClick={() => {
            onReject(reason.trim());
            setReason('');
          }}
        >
          Refuser et rendre le montant
        </Button>
      </div>
    </Sheet>
  );
}
