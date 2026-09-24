import { randomUUID } from 'node:crypto';
import { all, nowIso, one, run, transaction } from '../db';
import { HttpError } from '../http';
import { balanceOf, heldOf } from './users';
import type { Transaction, TxKind, Wallet } from '../../shared/types';

/** Plafond du solde : Rush n'est pas une banque, juste un porte-monnaie de campus. */
export const MAX_BALANCE_CENTS = 50_000;

export function record(userId: string, kind: TxKind, amountCents: number, label: string, orderId: string | null = null) {
  if (!Number.isInteger(amountCents)) throw new Error('Montant non entier');
  if (amountCents === 0) return;
  run(
    'INSERT INTO transactions (id, user_id, kind, amount_cents, label, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    randomUUID(),
    userId,
    kind,
    amountCents,
    label,
    orderId,
    nowIso(),
  );
}

/** Débite le solde disponible, ou échoue si les fonds manquent. */
export function debit(userId: string, kind: TxKind, amountCents: number, label: string, orderId: string) {
  transaction(() => {
    const balance = balanceOf(userId);
    if (balance < amountCents) {
      throw new HttpError(402, `Solde insuffisant : il manque CHF ${((amountCents - balance) / 100).toFixed(2)}.`);
    }
    record(userId, kind, -amountCents, label, orderId);
  });
}

export const TOPUP_METHODS = { twint: 'TWINT', card: 'Carte', camipro: 'Camipro' } as const;

export function topUp(userId: string, amountCents: number, method: keyof typeof TOPUP_METHODS) {
  transaction(() => {
    if (balanceOf(userId) + amountCents > MAX_BALANCE_CENTS) {
      throw new HttpError(422, 'Le solde Rush est plafonné à CHF 500.');
    }
    record(userId, 'topup', amountCents, `Recharge ${TOPUP_METHODS[method]}`);
  });
}

interface TxRow {
  id: string;
  kind: TxKind;
  amount_cents: number;
  label: string;
  order_id: string | null;
  created_at: string;
}

export function wallet(userId: string): Wallet {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const since = monthStart.toISOString();

  const month = one<{ earned: number; spent: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN kind = 'payout' THEN amount_cents END), 0) AS earned,
       COALESCE(-SUM(CASE WHEN kind IN ('hold', 'refund') THEN amount_cents END), 0) AS spent
     FROM transactions WHERE user_id = ? AND created_at >= ?`,
    userId,
    since,
  )!;

  const rows = all<TxRow>(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 80',
    userId,
  );

  return {
    balanceCents: balanceOf(userId),
    heldCents: heldOf(userId),
    earnedThisMonthCents: month.earned,
    // Les réservations encore actives ne sont pas des dépenses : on les retire.
    spentThisMonthCents: Math.max(0, month.spent - heldOf(userId)),
    transactions: rows.map(
      (r): Transaction => ({
        id: r.id,
        kind: r.kind,
        amountCents: r.amount_cents,
        label: r.label,
        orderId: r.order_id,
        createdAt: r.created_at,
      }),
    ),
  };
}
