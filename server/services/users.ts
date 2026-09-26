import { randomUUID, createHash } from 'node:crypto';
import { all, nowIso, one, run } from '../db';
import { env } from '../env';
import type { Me, PublicUser } from '../../shared/types';
import { ACTIVE_STATUSES } from '../../shared/types';

export interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  section: string | null;
  hue: number;
  onboarded: number;
  is_bot: number;
  created_at: string;
}

const cap = (s: string) =>
  s
    .split('-')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join('-');

/** prenom.nom@epfl.ch → { Prenom, Nom } — l'utilisateur peut corriger à l'onboarding. */
export function namesFromEmail(email: string): { first: string; last: string } {
  const local = email.split('@')[0].replace(/[0-9]+$/, '');
  const [first = '', ...rest] = local.split('.');
  return { first: cap(first) || 'Rusher', last: cap(rest.join(' ')) };
}

export function hueFor(seed: string): number {
  const hash = createHash('sha1').update(seed).digest();
  return hash.readUInt16BE(0) % 360;
}

export function findUserByEmail(email: string) {
  return one<UserRow>('SELECT * FROM users WHERE email = ?', email);
}

export function getUser(id: string) {
  return one<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function createUser(email: string, opts: { first?: string; last?: string; bot?: boolean; section?: string } = {}) {
  const names = namesFromEmail(email);
  const id = randomUUID();
  run(
    `INSERT INTO users (id, email, first_name, last_name, section, hue, onboarded, is_bot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    email,
    opts.first ?? names.first,
    opts.last ?? names.last,
    opts.section ?? null,
    hueFor(email),
    opts.bot ? 1 : 0,
    opts.bot ? 1 : 0,
    nowIso(),
  );
  return getUser(id)!;
}

interface Stats {
  rating_sum: number | null;
  rating_count: number;
  deliveries: number;
}

function stats(userId: string): Stats {
  return one<Stats>(
    `SELECT
       (SELECT COALESCE(SUM(rating_for_courier), 0) FROM orders WHERE courier_id = ?1 AND rating_for_courier IS NOT NULL)
     + (SELECT COALESCE(SUM(rating_for_requester), 0) FROM orders WHERE requester_id = ?1 AND rating_for_requester IS NOT NULL)
       AS rating_sum,
       (SELECT COUNT(*) FROM orders WHERE courier_id = ?1 AND rating_for_courier IS NOT NULL)
     + (SELECT COUNT(*) FROM orders WHERE requester_id = ?1 AND rating_for_requester IS NOT NULL)
       AS rating_count,
       (SELECT COUNT(*) FROM orders WHERE courier_id = ?1 AND status = 'completed') AS deliveries`,
    userId,
  )!;
}

export function toPublic(user: UserRow): PublicUser {
  const s = stats(user.id);
  return {
    id: user.id,
    firstName: user.first_name,
    lastInitial: user.last_name ? `${user.last_name[0].toUpperCase()}.` : '',
    hue: user.hue,
    section: user.section,
    rating: s.rating_count > 0 ? Math.round(((s.rating_sum ?? 0) / s.rating_count) * 10) / 10 : null,
    ratingCount: s.rating_count,
    deliveries: s.deliveries,
  };
}

const publicCache = new Map<string, PublicUser>();

/** Profil public par id, avec un petit cache invalidé à chaque changement de note. */
export function publicUser(id: string): PublicUser {
  const cached = publicCache.get(id);
  if (cached) return cached;
  const row = getUser(id);
  if (!row) throw new Error(`Utilisateur inconnu : ${id}`);
  const pub = toPublic(row);
  publicCache.set(id, pub);
  return pub;
}

export function invalidatePublicUser(id: string) {
  publicCache.delete(id);
}

export function balanceOf(userId: string): number {
  return one<{ b: number }>('SELECT COALESCE(SUM(amount_cents), 0) AS b FROM transactions WHERE user_id = ?', userId)!.b;
}

export function heldOf(userId: string): number {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
  return one<{ h: number }>(
    `SELECT COALESCE(SUM(hold_cents), 0) AS h FROM orders WHERE requester_id = ? AND status IN (${placeholders})`,
    userId,
    ...ACTIVE_STATUSES,
  )!.h;
}

export function toMe(user: UserRow): Me {
  return {
    ...toPublic(user),
    email: user.email,
    lastName: user.last_name,
    balanceCents: balanceOf(user.id),
    heldCents: heldOf(user.id),
    onboarded: user.onboarded === 1,
    isAdmin: isAdmin(user),
    epfl: linkedToEpfl(user.id),
  };
}

export const isAdmin = (user: Pick<UserRow, 'email'>) => env.adminEmails.includes(user.email);

/** Compte ouvert avec la connexion EPFL : l'adresse est prouvée par l'annuaire de l'EPFL. */
export const linkedToEpfl = (userId: string) =>
  Boolean(one('SELECT 1 AS x FROM identities WHERE user_id = ? AND provider = ?', userId, 'epfl'));

/** Comptes de l'équipe Rush déjà inscrits. */
export function admins(): UserRow[] {
  if (!env.adminEmails.length) return [];
  return all<UserRow>(`SELECT * FROM users WHERE email IN (${env.adminEmails.map(() => '?').join(',')})`, ...env.adminEmails);
}

export function updateProfile(userId: string, patch: { firstName: string; lastName: string; section: string | null }) {
  run(
    'UPDATE users SET first_name = ?, last_name = ?, section = ?, onboarded = 1 WHERE id = ?',
    patch.firstName,
    patch.lastName,
    patch.section,
    userId,
  );
  invalidatePublicUser(userId);
}

export function bots(): UserRow[] {
  return all<UserRow>('SELECT * FROM users WHERE is_bot = 1');
}
