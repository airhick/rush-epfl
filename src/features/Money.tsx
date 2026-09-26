import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { formatCHF } from '../../shared/money';
import {
  formatPhone,
  normalizeTwintPhone,
  TOPUP_MAX_CENTS,
  TOPUP_MIN_CENTS,
  TOPUP_PRESETS_CENTS,
  WITHDRAW_MIN_CENTS,
} from '../../shared/payments';
import type { WalletView, Withdrawal, WithdrawalStatus } from '../../shared/types';
import { useCancelWithdrawal, useRequestWithdrawal, useStartTopup } from '../lib/queries';
import { shortDate } from '../lib/format';
import { Sheet } from '../ui/Sheet';
import { Button, Chip, cx } from '../ui/primitives';

/** « 12 », « 12.5 » ou « 12,50 » → centimes ; null si illisible. */
export function parseCHF(text: string): number | null {
  const match = /^\s*(\d{1,5})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

const francs = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/* ── Recharge Stripe ─────────────────────────────────────────────────── */

export function TopupSheet({ open, onClose, initialCents = 2000 }: { open: boolean; onClose: () => void; initialCents?: number }) {
  const start = useStartTopup();
  const [text, setText] = useState(francs(initialCents));

  useEffect(() => {
    if (open) {
      setText(francs(initialCents));
      start.reset();
    }
  }, [open, initialCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const cents = parseCHF(text);
  const valid = cents !== null && cents >= TOPUP_MIN_CENTS && cents <= TOPUP_MAX_CENTS;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Recharger mon solde"
      footer={
        <>
          {start.error && <p className="form-error">{(start.error as Error).message}</p>}
          <Button block loading={start.isPending || start.isSuccess} disabled={!valid} onClick={() => valid && start.mutate(cents)}>
            {valid ? `Payer ${formatCHF(cents)}` : 'Entre un montant de CHF 1 à 100'}
          </Button>
        </>
      }
    >
      <label className="money-input">
        <span>CHF</span>
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))}
          style={{ width: `${Math.max(1, text.length) + 0.6}ch` }}
          aria-label="Montant en francs"
          autoComplete="off"
        />
      </label>
      <p className={cx('money-input__hint', !valid && text !== '' && 'is-error')}>De CHF 1 à CHF 100, au centime près.</p>
      <div className="chip-wrap chip-wrap--center">
        {TOPUP_PRESETS_CENTS.map((c) => (
          <Chip key={c} active={cents === c} onClick={() => setText(francs(c))}>
            {formatCHF(c).replace('.00', '')}
          </Chip>
        ))}
      </div>
      <p className="sheet-note">
        <Lock size={12} strokeWidth={2.4} /> Paiement par carte, Apple Pay ou Google Pay sur la page sécurisée de Stripe. Ton solde est
        crédité dès que Stripe confirme le paiement, en général en quelques secondes.
      </p>
    </Sheet>
  );
}

/* ── Retrait TWINT ───────────────────────────────────────────────────── */

export const WITHDRAWAL_STATUS: Record<WithdrawalStatus, { label: string; tone: string }> = {
  pending: { label: 'En attente', tone: 'pill--orange' },
  paid: { label: 'Envoyé', tone: 'pill--green' },
  cancelled: { label: 'Annulé', tone: '' },
  rejected: { label: 'Refusé', tone: 'pill--red' },
};

export function WithdrawSheet({ open, onClose, wallet }: { open: boolean; onClose: () => void; wallet: WalletView }) {
  const request = useRequestWithdrawal();
  const max = wallet.withdrawableCents;
  const lastPhone = wallet.withdrawals[0]?.phone;
  const [text, setText] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (open) {
      setText(francs(max));
      setPhone(lastPhone ? formatPhone(lastPhone) : '');
      request.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cents = parseCHF(text);
  const amountOk = cents !== null && cents >= WITHDRAW_MIN_CENTS && cents <= max;
  const phoneOk = normalizeTwintPhone(phone) !== null;
  const bonusKept = wallet.balanceCents - max;

  if (max < WITHDRAW_MIN_CENTS) {
    return (
      <Sheet open={open} onClose={onClose} title="Retirer par TWINT">
        <p className="sheet-text">
          Il faut au moins <strong>{formatCHF(WITHDRAW_MIN_CENTS)}</strong> retirable sur ton solde.
          {bonusKept > 0 && ` Le crédit offert (${formatCHF(bonusKept)}) reste dans l’app : il sert à tes demandes.`}
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Retirer par TWINT"
      footer={
        <>
          {request.error && <p className="form-error">{(request.error as Error).message}</p>}
          <Button
            block
            loading={request.isPending}
            disabled={!amountOk || !phoneOk}
            onClick={() => cents !== null && request.mutate({ amountCents: cents, phone }, { onSuccess: onClose })}
          >
            {amountOk ? `Demander ${formatCHF(cents)}` : 'Demander le retrait'}
          </Button>
        </>
      }
    >
      <label className="money-input">
        <span>CHF</span>
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, '').slice(0, 7))}
          style={{ width: `${Math.max(1, text.length) + 0.6}ch` }}
          aria-label="Montant à retirer en francs"
          autoComplete="off"
        />
      </label>
      <p className={cx('money-input__hint', !amountOk && text !== '' && 'is-error')}>
        {formatCHF(max)} retirable
        {bonusKept > 0 && ` · le crédit offert (${formatCHF(bonusKept)}) reste dans l’app`}
      </p>
      <div className="chip-wrap chip-wrap--center">
        <Chip active={cents === max} onClick={() => setText(francs(max))}>
          Tout ({formatCHF(max)})
        </Chip>
      </div>
      <div className="form-stack">
        <label className="field">
          <span className="field__label">Numéro TWINT</span>
          <span className="field__control">
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="079 123 45 67"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </span>
        </label>
      </div>
      <p className="sheet-note">
        Le montant quitte ton solde dès maintenant. L’équipe Rush te l’envoie par TWINT à ce numéro ; tu peux annuler tant que ce n’est
        pas fait.
      </p>
    </Sheet>
  );
}

export function WithdrawalList({ withdrawals }: { withdrawals: Withdrawal[] }) {
  const cancel = useCancelWithdrawal();
  if (withdrawals.length === 0) return null;
  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__small">Retraits TWINT</h2>
      </div>
      <div className="tx-list">
        {withdrawals.map((w) => {
          const status = WITHDRAWAL_STATUS[w.status];
          return (
            <div key={w.id} className="withdrawal">
              <span className="withdrawal__text">
                <strong>{formatCHF(w.amountCents)}</strong>
                <span>
                  {formatPhone(w.phone)} · {shortDate(w.createdAt)}
                  {w.status === 'rejected' && w.note && ` · ${w.note}`}
                </span>
              </span>
              {w.status === 'pending' ? (
                <span className="withdrawal__actions">
                  <span className={cx('pill', status.tone)}>{status.label}</span>
                  <button className="link" disabled={cancel.isPending} onClick={() => cancel.mutate(w.id)}>
                    Annuler
                  </button>
                </span>
              ) : (
                <span className={cx('pill', status.tone)}>{status.label}</span>
              )}
            </div>
          );
        })}
      </div>
      {cancel.error && <p className="form-error pad-x">{(cancel.error as Error).message}</p>}
    </section>
  );
}
