import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../env';
import { one, run, transaction } from '../db';
import { HttpError } from '../http';
import { record } from './ledger';
import { createUser, findUserByEmail, getUser, type UserRow } from './users';

export const PASSWORD_MIN = 8;
const MAX_FAILURES = 8;
const LOCK_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const SESSION_COOKIE = 'rush_session';

export interface SignedIn {
  user: UserRow;
  token: string;
}

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
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

/* ── Mots de passe (scrypt, sel aléatoire, comparaison à temps constant) ── */

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const passwordOf = (userId: string) =>
  one<{ password_hash: string }>('SELECT password_hash FROM credentials WHERE user_id = ?', userId)?.password_hash ?? null;

/* Trop d'essais ratés sur une adresse : on la bloque un moment. */
const failures = new Map<string, { count: number; since: number }>();

function assertNotLocked(email: string) {
  const f = failures.get(email);
  if (!f) return;
  if (Date.now() - f.since > LOCK_MS) failures.delete(email);
  else if (f.count >= MAX_FAILURES) throw new HttpError(429, 'Trop d’essais. Réessaie dans un quart d’heure.');
}

function noteFailure(email: string) {
  const f = failures.get(email) ?? { count: 0, since: Date.now() };
  failures.set(email, { ...f, count: f.count + 1 });
}

/* ── Connexion ────────────────────────────────────────────────────────── */

/** L'adresse a-t-elle déjà un compte ? L'écran de connexion choisit entre « se connecter » et « créer ». */
export function accountExists(rawEmail: string): { email: string; exists: boolean } {
  const email = normalizeEmail(rawEmail);
  const user = findUserByEmail(email);
  return { email, exists: Boolean(user && passwordOf(user.id)) };
}

export async function login(rawEmail: string, password: string): Promise<SignedIn> {
  const email = normalizeEmail(rawEmail);
  assertNotLocked(email);
  const user = findUserByEmail(email);
  const stored = user ? passwordOf(user.id) : null;
  if (!user || !stored || !(await checkPassword(password, stored))) {
    noteFailure(email);
    throw new HttpError(422, 'Mot de passe incorrect.');
  }
  failures.delete(email);
  return { user, token: openSession(user.id) };
}

export async function register(rawEmail: string, password: string): Promise<SignedIn> {
  const email = normalizeEmail(rawEmail);
  if (password.length < PASSWORD_MIN) {
    throw new HttpError(422, `Choisis un mot de passe d’au moins ${PASSWORD_MIN} caractères.`);
  }
  const hash = await hashPassword(password);

  const user = transaction(() => {
    const existing = findUserByEmail(email);
    if (existing && (existing.is_bot || passwordOf(existing.id))) {
      throw new HttpError(409, 'Un compte existe déjà avec cette adresse.');
    }
    // Un compte créé avant les mots de passe reçoit simplement le sien.
    const account = existing ?? createAccount(email);
    run('INSERT INTO credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)', account.id, hash, Date.now());
    return account;
  });
  return { user, token: openSession(user.id) };
}

/** Nouveau compte, avec le crédit de bienvenue écrit dans la même transaction. */
function createAccount(email: string): UserRow {
  return transaction(() => {
    const user = createUser(email);
    if (env.welcomeBonusCents > 0) record(user.id, 'bonus', env.welcomeBonusCents, 'Bienvenue sur Rush');
    return user;
  });
}

/* ── Sessions ─────────────────────────────────────────────────────────── */

function openSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token),
    userId,
    Date.now(),
    Date.now() + SESSION_TTL_MS,
  );
  return token;
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
}
