import { createHash, randomBytes, randomInt } from 'node:crypto';
import { env } from '../env';
import { one, run } from '../db';
import { HttpError } from '../http';
import { sendLoginCode } from '../mail';
import { createUser, findUserByEmail, getUser, type UserRow } from './users';

const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 30_000;
const MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const SESSION_COOKIE = 'rush_session';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const match = /^[a-z0-9._%+-]+@([a-z0-9.-]+)$/.exec(email);
  const domain = match?.[1];
  if (!domain || !env.allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    throw new HttpError(422, 'Rush est réservé à la communauté EPFL : utilise ton adresse @epfl.ch.');
  }
  return email;
}

export async function requestCode(rawEmail: string): Promise<{ devCode?: string }> {
  const email = normalizeEmail(rawEmail);
  const existing = one<{ last_sent_at: number }>('SELECT last_sent_at FROM login_codes WHERE email = ?', email);
  if (existing && Date.now() - existing.last_sent_at < RESEND_COOLDOWN_MS) {
    throw new HttpError(429, 'Un code vient d’être envoyé. Patiente quelques secondes.');
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  run(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts, last_sent_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, last_sent_at = excluded.last_sent_at`,
    email,
    sha256(`${email}:${code}`),
    Date.now() + CODE_TTL_MS,
    Date.now(),
  );

  const delivered = await sendLoginCode(email, code);
  // Sans SMTP (développement local), le code est renvoyé pour pouvoir tester.
  return delivered || env.production ? {} : { devCode: code };
}

export function verifyCode(rawEmail: string, code: string): { user: UserRow; token: string } {
  const email = normalizeEmail(rawEmail);
  const row = one<{ code_hash: string; expires_at: number; attempts: number }>(
    'SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?',
    email,
  );
  if (!row || row.expires_at < Date.now()) throw new HttpError(422, 'Ce code a expiré. Demandes-en un nouveau.');
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Trop de tentatives. Demande un nouveau code.');

  if (row.code_hash !== sha256(`${email}:${code.trim()}`)) {
    run('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?', email);
    throw new HttpError(422, 'Code incorrect.');
  }
  run('DELETE FROM login_codes WHERE email = ?', email);

  const user = findUserByEmail(email) ?? createUser(email);
  const token = randomBytes(32).toString('base64url');
  run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token),
    user.id,
    Date.now(),
    Date.now() + SESSION_TTL_MS,
  );
  return { user, token };
}

export function userFromToken(token: string | undefined): UserRow | null {
  if (!token) return null;
  const row = one<{ user_id: string; expires_at: number }>(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
    sha256(token),
  );
  if (!row || row.expires_at < Date.now()) return null;
  return getUser(row.user_id) ?? null;
}

export function destroySession(token: string | undefined) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function purgeExpired() {
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  run('DELETE FROM login_codes WHERE expires_at < ?', Date.now() - CODE_TTL_MS);
}
