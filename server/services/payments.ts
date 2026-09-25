import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { all, nowIso, one, run, transaction } from '../db';
import { HttpError } from '../http';
import { sendTo } from '../realtime';
import { record, wallet } from './ledger';
import { admins, balanceOf, findUserByEmail, getUser } from './users';
import { topupsEnabled, type StripeEvent } from './stripe';
import { formatCHF } from '../../shared/money';
import { formatPhone, normalizeTwintPhone, WITHDRAW_MIN_CENTS } from '../../shared/payments';
import type { OwnerOverview, OwnerWithdrawal, TopupStatus, UnmatchedTopup, WalletView, Withdrawal, WithdrawalStatus } from '../../shared/types';

/* ── Équipe Rush ──────────────────────────────────────────────────────── */

const refreshOwners = () => {
  for (const admin of admins()) sendTo(admin.id, { type: 'withdrawals.updated' });
};

/**
 * Prévient l'équipe : toast dans l'app si elle est connectée, et notification
 * sur téléphone via ntfy. Le texte envoyé à ntfy ne contient ni nom ni numéro.
 */
function notifyOwners(title: string, body: string, push = body) {
  refreshOwners();
  for (const admin of admins()) sendTo(admin.id, { type: 'toast', title, body, href: '/admin' });
  if (!env.ntfyTopic || process.env.NODE_ENV === 'test') return;
  fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      topic: env.ntfyTopic,
      title,
      message: push,
      tags: ['moneybag'],
      ...(env.publicUrl ? { click: `${env.publicUrl}/admin` } : {}),
    }),
    signal: AbortSignal.timeout(8000),
  }).catch((err) => console.error('[ntfy]', err instanceof Error ? err.message : err));
}

function walletChanged(userId: string) {
  sendTo(userId, { type: 'wallet.updated' });
}

/* ── Recharges Stripe ─────────────────────────────────────────────────── */

interface CheckoutSession {
  id: string;
  mode?: string;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  payment_intent?: string | null;
  metadata?: Record<string, string> | null;
}

export type TopupOutcome = 'credited' | 'duplicate' | 'unmatched' | 'waiting' | 'ignored';

/**
 * Traite un évènement Stripe déjà vérifié. Seules les sessions du lien de
 * recharge (metadata rush=topup) payées comptent ; un paiement différé
 * (virement…) est crédité à l'évènement async_payment_succeeded.
 */
export function handleStripeEvent(event: StripeEvent): TopupOutcome {
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return 'ignored';
  const session = event.data.object as unknown as CheckoutSession;
  if (session.metadata?.rush !== 'topup' || session.mode !== 'payment') return 'ignored';
  if (session.payment_status !== 'paid') return 'waiting';
  return creditTopup(session);
}

function creditTopup(session: CheckoutSession): TopupOutcome {
  const amount = session.amount_total ?? 0;
  const currency = (session.currency ?? '').toLowerCase();
  const email = (session.customer_details?.email ?? session.customer_email ?? '').trim().toLowerCase() || null;
  const byRef = session.client_reference_id ? getUser(session.client_reference_id) : undefined;
  const user = byRef ?? (email ? findUserByEmail(email) : undefined);
  // Un montant hors CHF ne peut pas être crédité tel quel : l'équipe le traite à la main.
  const creditable = Boolean(user) && currency === 'chf' && Number.isInteger(amount) && amount > 0;

  const outcome = transaction((): TopupOutcome => {
    if (one('SELECT 1 FROM topups WHERE session_id = ?', session.id)) return 'duplicate';
    run(
      `INSERT INTO topups (session_id, user_id, amount_cents, currency, email, payment_intent, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      creditable ? user!.id : null,
      amount,
      currency,
      email,
      session.payment_intent ?? null,
      creditable ? 'credited' : 'unmatched',
      nowIso(),
    );
    if (!creditable) return 'unmatched';
    record(user!.id, 'topup', amount, 'Recharge · Paiement Stripe');
    return 'credited';
  });

  if (outcome === 'credited') {
    walletChanged(user!.id);
    sendTo(user!.id, { type: 'toast', title: 'Solde rechargé', body: `${formatCHF(amount)} ajoutés à ton solde.`, href: '/wallet' });
  } else if (outcome === 'unmatched') {
    console.error(`[stripe] recharge non attribuée : ${session.id}`);
    notifyOwners('Paiement Stripe à rattacher', `${formatCHF(amount)} (${currency.toUpperCase()}) sans compte Rush correspondant.`);
  }
  return outcome;
}

/** Après le retour de Stripe : l'app attend que le webhook ait crédité le solde. */
export function topupStatus(userId: string, sessionId: string): TopupStatus {
  const row = one<{ amount_cents: number }>(
    "SELECT amount_cents FROM topups WHERE session_id = ? AND user_id = ? AND status = 'credited'",
    sessionId,
    userId,
  );
  return row ? { status: 'credited', amountCents: row.amount_cents } : { status: 'pending', amountCents: null };
}

/* ── Retraits TWINT ───────────────────────────────────────────────────── */

interface WithdrawalRow {
  id: string;
  user_id: string;
  amount_cents: number;
  twint_phone: string;
  status: WithdrawalStatus;
  note: string | null;
  created_at: string;
  processed_at: string | null;
}

const toWithdrawal = (r: WithdrawalRow): Withdrawal => ({
  id: r.id,
  amountCents: r.amount_cents,
  phone: r.twint_phone,
  status: r.status,
  note: r.note,
  createdAt: r.created_at,
  processedAt: r.processed_at,
});

const sumOf = (userId: string, kind: string) =>
  one<{ s: number }>('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE user_id = ? AND kind = ?', userId, kind)!.s;

/** Ce qui peut sortir du solde : tout, sauf le crédit offert à l'inscription. */
export function withdrawable(userId: string): number {
  return Math.max(0, balanceOf(userId) - sumOf(userId, 'bonus'));
}

export function walletView(userId: string): WalletView {
  return {
    ...wallet(userId),
    withdrawableCents: withdrawable(userId),
    topupsEnabled: topupsEnabled(),
    withdrawals: all<WithdrawalRow>('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', userId).map(toWithdrawal),
  };
}

export function requestWithdrawal(userId: string, amountCents: number, rawPhone: string): Withdrawal {
  const phone = normalizeTwintPhone(rawPhone);
  if (!phone) throw new HttpError(422, 'Entre un numéro de mobile suisse relié à TWINT (07x xxx xx xx).');
  if (!Number.isInteger(amountCents) || amountCents < WITHDRAW_MIN_CENTS) {
    throw new HttpError(422, `Le retrait minimum est de ${formatCHF(WITHDRAW_MIN_CENTS)}.`);
  }

  const row = transaction(() => {
    if (one("SELECT 1 FROM withdrawals WHERE user_id = ? AND status = 'pending'", userId)) {
      throw new HttpError(409, 'Tu as déjà un retrait en attente. Attends qu’il soit envoyé ou annule-le.');
    }
    const max = withdrawable(userId);
    if (amountCents > max) {
      throw new HttpError(402, max > 0 ? `Tu peux retirer au plus ${formatCHF(max)}.` : 'Rien à retirer pour le moment.');
    }
    const id = randomUUID();
    run(
      "INSERT INTO withdrawals (id, user_id, amount_cents, twint_phone, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      id,
      userId,
      amountCents,
      phone,
      nowIso(),
    );
    record(userId, 'withdrawal', -amountCents, `Retrait · TWINT ${formatPhone(phone)}`);
    return one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', id)!;
  });

  const user = getUser(userId)!;
  walletChanged(userId);
  notifyOwners(
    'Retrait demandé',
    `${formatCHF(amountCents)} à envoyer par TWINT à ${user.first_name} ${user.last_name}.`.replace(' .', '.'),
    `${formatCHF(amountCents)} à envoyer par TWINT. Le numéro est dans Rush.`,
  );
  return toWithdrawal(row);
}

/** Retire la demande et rend le montant au solde (par l'utilisateur, ou refus de l'équipe). */
function closeWithRefund(id: string, status: 'cancelled' | 'rejected', by: string, note: string | null, label: string) {
  return transaction(() => {
    const row = one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Demande de retrait introuvable.');
    if (row.status !== 'pending') throw new HttpError(409, 'Cette demande a déjà été traitée.');
    run('UPDATE withdrawals SET status = ?, note = ?, processed_at = ?, processed_by = ? WHERE id = ?', status, note, nowIso(), by, id);
    record(row.user_id, 'withdrawal_refund', row.amount_cents, `${label} · TWINT ${formatPhone(row.twint_phone)}`);
    return one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', id)!;
  });
}

export function cancelWithdrawal(userId: string, id: string): Withdrawal {
  const owned = one<{ user_id: string }>('SELECT user_id FROM withdrawals WHERE id = ?', id);
  if (!owned || owned.user_id !== userId) throw new HttpError(404, 'Demande de retrait introuvable.');
  const row = closeWithRefund(id, 'cancelled', userId, null, 'Retrait annulé');
  walletChanged(userId);
  refreshOwners();
  return toWithdrawal(row);
}

/* ── Traitement par l'équipe ──────────────────────────────────────────── */

export function markPaid(adminId: string, id: string): Withdrawal {
  const row = transaction(() => {
    const row = one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Demande de retrait introuvable.');
    if (row.status !== 'pending') throw new HttpError(409, 'Cette demande a déjà été traitée.');
    run("UPDATE withdrawals SET status = 'paid', processed_at = ?, processed_by = ? WHERE id = ?", nowIso(), adminId, id);
    return one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', id)!;
  });
  walletChanged(row.user_id);
  sendTo(row.user_id, {
    type: 'toast',
    title: 'Retrait envoyé',
    body: `${formatCHF(row.amount_cents)} envoyés par TWINT au ${formatPhone(row.twint_phone)}.`,
    href: '/wallet',
  });
  refreshOwners();
  return toWithdrawal(row);
}

export function reject(adminId: string, id: string, reason: string): Withdrawal {
  const row = closeWithRefund(id, 'rejected', adminId, reason, 'Retrait refusé');
  walletChanged(row.user_id);
  sendTo(row.user_id, {
    type: 'toast',
    title: 'Retrait refusé',
    body: `${formatCHF(row.amount_cents)} sont revenus sur ton solde. ${reason}`,
    href: '/wallet',
  });
  refreshOwners();
  return toWithdrawal(row);
}

interface OwnerRow extends WithdrawalRow {
  first_name: string;
  last_name: string;
  email: string;
  section: string | null;
}

const toOwnerWithdrawal = (r: OwnerRow): OwnerWithdrawal => ({
  ...toWithdrawal(r),
  user: { id: r.user_id, firstName: r.first_name, lastName: r.last_name, email: r.email, section: r.section },
  stats: { topupsCents: sumOf(r.user_id, 'topup'), earnedCents: sumOf(r.user_id, 'payout'), balanceCents: balanceOf(r.user_id) },
});

export function ownerOverview(): OwnerOverview {
  const select = `SELECT w.*, u.first_name, u.last_name, u.email, u.section FROM withdrawals w JOIN users u ON u.id = w.user_id`;
  return {
    // Les plus anciennes d'abord : premier arrivé, premier payé.
    pending: all<OwnerRow>(`${select} WHERE w.status = 'pending' ORDER BY w.created_at ASC`).map(toOwnerWithdrawal),
    recent: all<OwnerRow>(`${select} WHERE w.status != 'pending' ORDER BY w.processed_at DESC LIMIT 30`).map(toOwnerWithdrawal),
    unmatchedTopups: all<{ session_id: string; amount_cents: number; currency: string; email: string | null; created_at: string }>(
      "SELECT * FROM topups WHERE status = 'unmatched' ORDER BY created_at DESC LIMIT 30",
    ).map(
      (t): UnmatchedTopup => ({ sessionId: t.session_id, amountCents: t.amount_cents, currency: t.currency, email: t.email, createdAt: t.created_at }),
    ),
  };
}
