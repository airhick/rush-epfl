import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';
import { env } from '../env';

/*
 * Connexion EPFL : OpenID Connect avec Microsoft Entra ID, l'annuaire de l'EPFL.
 * Code d'autorisation + PKCE, puis jeton d'identité vérifié ici (signature,
 * émetteur, audience, annuaire, nonce) : seul un compte de l'annuaire EPFL passe.
 */

export const epflEnabled = () => Boolean(env.entraClientId && env.entraClientSecret);

const authority = () => `https://login.microsoftonline.com/${env.entraTenantId}`;
const CLOCK_SKEW_S = 300;

/** Ce qui doit survivre à l'aller-retour chez Microsoft (cookie HttpOnly de 10 minutes). */
export interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

/** Ce que l'EPFL nous dit de la personne connectée. */
export interface EpflProfile {
  /** Identifiant immuable du compte dans l'annuaire (oid). */
  subject: string;
  sciper: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export type EpflErrorCode = 'cancelled' | 'consent' | 'expired' | 'account' | 'unavailable' | 'failed';

export class EpflLoginError extends Error {
  constructor(
    public code: EpflErrorCode,
    detail: string = code,
  ) {
    super(detail);
  }
}

const random = () => randomBytes(24).toString('base64url');
const b64json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Chemin de l'app où revenir après la connexion ; tout le reste renvoie à l'accueil. */
export function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/api')) return '/';
  return raw.slice(0, 300);
}

export const encodeState = (s: LoginState) => Buffer.from(JSON.stringify(s)).toString('base64url');

export function decodeState(raw: string | undefined): LoginState | null {
  if (!raw) return null;
  try {
    const s = b64json(raw);
    if ([s.state, s.nonce, s.verifier, s.next].every((v) => typeof v === 'string')) return s as unknown as LoginState;
  } catch {
    // Cookie illisible : on repart de zéro.
  }
  return null;
}

export function beginLogin(redirectUri: string, opts: { next?: string; loginHint?: string } = {}): { url: string; state: LoginState } {
  if (!epflEnabled()) throw new EpflLoginError('unavailable');
  const state: LoginState = { state: random(), nonce: random(), verifier: random() + random(), next: safeNext(opts.next) };
  const hint = opts.loginHint && /^[^\s@]{1,80}@[a-z0-9.-]{1,60}$/i.test(opts.loginHint) ? opts.loginHint : null;
  const url = new URL(`${authority()}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: env.entraClientId,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state: state.state,
    nonce: state.nonce,
    code_challenge: createHash('sha256').update(state.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    // Après une déconnexion, on laisse choisir le compte au lieu de reprendre le même en silence.
    prompt: 'select_account',
    ...(hint ? { login_hint: hint } : { domain_hint: 'epfl.ch' }),
  }).toString();
  return { url: url.toString(), state };
}

/** Retour de Microsoft : contrôle l'état, échange le code, vérifie le jeton d'identité. */
export async function completeLogin(
  query: Record<string, string | undefined>,
  saved: LoginState | null,
  redirectUri: string,
): Promise<EpflProfile> {
  if (query.error) throw new EpflLoginError(errorCode(query.error, query.error_description ?? ''), `${query.error}: ${query.error_description ?? ''}`);
  if (!epflEnabled()) throw new EpflLoginError('unavailable');
  if (!saved || !query.state || query.state !== saved.state || !query.code) throw new EpflLoginError('expired', 'état absent ou différent');

  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.entraClientId,
      client_secret: env.entraClientSecret,
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: redirectUri,
      code_verifier: saved.verifier,
      scope: 'openid profile email',
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: Error) => {
    throw new EpflLoginError('failed', `échange du code : ${err.message}`);
  });
  const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !tokens.id_token) {
    throw new EpflLoginError(tokens.error === 'invalid_grant' ? 'expired' : 'failed', `jeton : ${tokens.error ?? res.status} ${tokens.error_description ?? ''}`);
  }

  const claims = await verifyIdToken(tokens.id_token, saved.nonce);
  const email = [claims.email, claims.preferred_username].map(str).find((v) => v?.includes('@'))?.toLowerCase();
  const subject = str(claims.oid) ?? str(claims.sub);
  if (!email || !subject) throw new EpflLoginError('account', 'jeton sans adresse ni identifiant');
  return {
    subject,
    sciper: str(claims.uniqueid),
    email,
    firstName: str(claims.given_name)?.slice(0, 40) ?? null,
    lastName: str(claims.family_name)?.slice(0, 60) ?? null,
  };
}

function errorCode(error: string, description: string): EpflErrorCode {
  // AADSTS65001 / 90094 : consentement (administrateur) requis ; 50105 : compte non autorisé pour l'application.
  if (error === 'consent_required' || /AADSTS(65001|90094|90095)/.test(description)) return 'consent';
  if (/AADSTS50105/.test(description)) return 'account';
  if (error === 'access_denied') return 'cancelled';
  return 'failed';
}

/* ── Jeton d'identité ─────────────────────────────────────────────────── */

let keyCache: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null;
const KEYS_TTL_MS = 12 * 60 * 60_000;

async function signingKey(kid: string): Promise<KeyObject | undefined> {
  const stale = !keyCache || Date.now() - keyCache.fetchedAt > KEYS_TTL_MS;
  // Microsoft change ses clés sans prévenir : une clé inconnue relance la lecture (au plus une fois par minute).
  const unknown = keyCache && !keyCache.keys.has(kid) && Date.now() - keyCache.fetchedAt > 60_000;
  if (stale || unknown) {
    const res = await fetch(`${authority()}/discovery/v2.0/keys`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new EpflLoginError('failed', `clés Microsoft : HTTP ${res.status}`);
    const { keys } = (await res.json()) as { keys: { kid: string; kty: string; n: string; e: string }[] };
    keyCache = {
      keys: new Map(keys.filter((k) => k.kty === 'RSA').map((k) => [k.kid, createPublicKey({ key: { kty: k.kty, n: k.n, e: k.e }, format: 'jwk' })])),
      fetchedAt: Date.now(),
    };
  }
  return keyCache?.keys.get(kid);
}

export async function verifyIdToken(token: string, nonce: string, now = Date.now()): Promise<Record<string, unknown>> {
  const [head, payload, signature] = token.split('.');
  if (!head || !payload || !signature) throw new EpflLoginError('failed', 'jeton mal formé');
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = b64json(head);
    claims = b64json(payload);
  } catch {
    throw new EpflLoginError('failed', 'jeton illisible');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new EpflLoginError('failed', `algorithme ${String(header.alg)}`);
  const key = await signingKey(header.kid);
  if (!key || !verify('sha256', Buffer.from(`${head}.${payload}`), key, Buffer.from(signature, 'base64url'))) {
    throw new EpflLoginError('failed', 'signature invalide');
  }

  const seconds = now / 1000;
  const checks: [boolean, string][] = [
    [claims.iss === `${authority()}/v2.0`, `émetteur ${String(claims.iss)}`],
    [claims.aud === env.entraClientId, 'audience'],
    // Un compte d'un autre annuaire (autre école, compte perso) ne passe pas.
    [claims.tid === env.entraTenantId, `annuaire ${String(claims.tid)}`],
    [claims.nonce === nonce, 'nonce'],
    [typeof claims.exp === 'number' && claims.exp + CLOCK_SKEW_S > seconds, 'jeton expiré'],
    [typeof claims.nbf !== 'number' || claims.nbf - CLOCK_SKEW_S <= seconds, 'jeton pas encore valable'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new EpflLoginError(claims.tid !== env.entraTenantId ? 'account' : 'failed', failed[1]);
  return claims;
}

/** Pour les tests : oublie les clés Microsoft en cache. */
export function forgetKeys() {
  keyCache = null;
}
