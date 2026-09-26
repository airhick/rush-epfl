import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../env';
import { nowIso, one, run, transaction } from '../db';
import { HttpError } from '../http';
import { record } from './ledger';
import { epflEnabled, type EpflProfile } from './entra';
import { createUser, findUserByEmail, getUser, linkedToEpfl, type UserRow } from './users';

export const PASSWORD_MIN = 8;
const MAX_FAILURES = 8;
const LOCK_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const SESSION_COOKIE = 'rush_session';
export const ACCOUNT_COOKIE = 'rush_account';
export const ACCOUNT_TTL_MS = 365 * 24 * 60 * 60_000;

export interface SignedIn {
  user: UserRow;
  token: string;
}

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const domainOf = (email: string) => /^[a-z0-9._%+-]+@([a-z0-9.-]+)$/.exec(email)?.[1];
const inAllowedDomain = (domain: string | undefined) =>
  Boolean(domain && env.allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`)));

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!inAllowedDomain(domainOf(email)) && !env.adminEmails.includes(email)) {
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

/**
 * Avec la connexion EPFL active, une adresse EPFL ne crée plus de mot de passe :
 * l'EPFL prouve que l'adresse est bien à la personne. Les adresses de l'équipe
 * hors EPFL gardent le mot de passe.
 */
export const mustUseEpfl = (email: string) => epflEnabled() && inAllowedDomain(domainOf(email));

/**
 * L'adresse a-t-elle déjà un compte ? L'écran de connexion choisit entre « se connecter »,
 * « créer » et la connexion EPFL.
 */
export function accountExists(rawEmail: string): { email: string; exists: boolean; epfl: boolean } {
  const email = normalizeEmail(rawEmail);
  const user = findUserByEmail(email);
  const exists = Boolean(user && passwordOf(user.id));
  return { email, exists, epfl: !exists && (mustUseEpfl(email) || Boolean(user && linkedToEpfl(user.id))) };
}

export async function login(rawEmail: string, password: string): Promise<SignedIn> {
  const email = normalizeEmail(rawEmail);
  assertNotLocked(email);
  const user = findUserByEmail(email);
  const stored = user ? passwordOf(user.id) : null;
  if (!user || !stored) {
    // L'écran « Se connecter » propose alors de créer le compte (ou la connexion EPFL).
    if ((user && linkedToEpfl(user.id)) || (!user && mustUseEpfl(email))) {
      throw new HttpError(403, 'Ce compte se connecte avec « Continuer avec EPFL ».');
    }
    throw new HttpError(404, 'Aucun compte avec cette adresse. Crée-le en quelques secondes.');
  }
  if (!(await checkPassword(password, stored))) {
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
    // Même si la connexion EPFL est coupée ensuite, un mot de passe ne doit pas ouvrir un compte EPFL.
    if ((existing && linkedToEpfl(existing.id)) || mustUseEpfl(email)) {
      throw new HttpError(403, 'Avec une adresse EPFL, connecte-toi avec « Continuer avec EPFL ».');
    }
    // Un compte créé avant les mots de passe reçoit simplement le sien.
    const account = existing ?? createAccount(email);
    run('INSERT INTO credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)', account.id, hash, Date.now());
    return account;
  });
  return { user, token: openSession(user.id) };
}

/** Connexion EPFL réussie : retrouve le compte relié, relie celui de la même adresse ou en crée un. */
export function signInWithEpfl(profile: EpflProfile): SignedIn {
  const email = normalizeEmail(profile.email);
  const user = transaction(() => {
    const linked = one<{ user_id: string }>('SELECT user_id FROM identities WHERE provider = ? AND subject = ?', 'epfl', profile.subject);
    if (linked) return getUser(linked.user_id)!;

    const existing = findUserByEmail(email);
    if (existing && (existing.is_bot || linkedToEpfl(existing.id))) {
      throw new HttpError(409, 'Cette adresse est déjà reliée à un autre compte EPFL.');
    }
    if (existing) {
      // L'EPFL prouve à qui est l'adresse : un mot de passe posé avant, peut-être par quelqu'un
      // d'autre, n'ouvre plus le compte, et les sessions ouvertes avec lui sont fermées.
      run('DELETE FROM credentials WHERE user_id = ?', existing.id);
      run('DELETE FROM sessions WHERE user_id = ?', existing.id);
    }
    const account =
      existing ?? createAccount(email, { first: profile.firstName ?? undefined, last: profile.lastName ?? undefined });
    run(
      'INSERT INTO identities (provider, subject, user_id, sciper, created_at) VALUES (?, ?, ?, ?, ?)',
      'epfl',
      profile.subject,
      account.id,
      profile.sciper,
      Date.now(),
    );
    return account;
  });
  return { user, token: openSession(user.id) };
}

/** Nouveau compte, avec le crédit de bienvenue écrit dans la même transaction. */
function createAccount(email: string, names: { first?: string; last?: string } = {}): UserRow {
  return transaction(() => {
    const user = createUser(email, names);
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

/* ── Cookie de compte ─────────────────────────────────────────────────────
 * Sur l'offre gratuite de Render, la base repart de zéro à chaque veille ou
 * déploiement. Le navigateur garde donc une copie du compte (identité, profil,
 * empreinte du mot de passe), chiffrée et authentifiée par le serveur
 * (AES-256-GCM) : illisible et infalsifiable sans RUSH_COOKIE_SECRET.
 * Jamais le solde : un vieux cookie rejoué ne doit rien valoir.
 */

interface AccountCopy {
  v: 1;
  id: string;
  email: string;
  first: string;
  last: string;
  section: string | null;
  hue: number;
  onboarded: boolean;
  createdAt: string;
  password: string;
  sealedAt: number;
}

const accountKey = () => createHash('sha256').update(`rush-account:${env.cookieSecret}`).digest();

/** Copie chiffrée du compte pour le cookie ; null pour un compte sans mot de passe ou sans clé configurée. */
export function sealAccount(user: UserRow): string | null {
  const password = passwordOf(user.id);
  if (!env.cookieSecret || !password || user.is_bot) return null;
  const copy: AccountCopy = {
    v: 1,
    id: user.id,
    email: user.email,
    first: user.first_name,
    last: user.last_name,
    section: user.section,
    hue: user.hue,
    onboarded: user.onboarded === 1,
    createdAt: user.created_at,
    password,
    sealedAt: Date.now(),
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', accountKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(copy), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function openAccount(sealed: string | undefined): AccountCopy | null {
  if (!sealed || !env.cookieSecret) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', accountKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const copy = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as AccountCopy;
    return copy.v === 1 && copy.sealedAt + ACCOUNT_TTL_MS > Date.now() ? copy : null;
  } catch {
    // Cookie modifié, tronqué ou chiffré avec une autre clé.
    return null;
  }
}

/**
 * Compte disparu parce que la base a été vidée : le cookie de compte le recrée à
 * l'identique et rouvre une session, sans repasser par l'inscription.
 */
export function restoreAccount(sealed: string | undefined): SignedIn | null {
  const copy = openAccount(sealed);
  if (!copy) return null;
  const user = transaction(() => {
    // Le compte existe : sa session a été fermée exprès (déconnexion, reprise par la
    // connexion EPFL) ou a expiré. Une requête encore en route après une déconnexion
    // ne doit pas la rouvrir.
    if (getUser(copy.id)) return null;

    let email: string;
    try {
      email = normalizeEmail(copy.email);
    } catch {
      return null;
    }
    // L'adresse a été reprise par un nouveau compte depuis : celui-ci l'emporte.
    if (findUserByEmail(email)) return null;
    run(
      `INSERT INTO users (id, email, first_name, last_name, section, hue, onboarded, is_bot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      copy.id,
      email,
      copy.first,
      copy.last,
      copy.section,
      copy.hue,
      copy.onboarded ? 1 : 0,
      copy.createdAt || nowIso(),
    );
    run('INSERT INTO credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)', copy.id, copy.password, Date.now());
    return getUser(copy.id)!;
  });
  return user ? { user, token: openSession(user.id) } : null;
}

export function purgeExpired() {
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
}
