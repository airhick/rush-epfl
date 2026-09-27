import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { db, one } from '../server/db';
import { env } from '../server/env';
import { createApp } from '../server/app';
import { accountExists, register, SESSION_COOKIE, userFromToken } from '../server/services/auth';
import { forgetKeys } from '../server/services/entra';
import { balanceOf, findUserByEmail } from '../server/services/users';

const TENANT = env.entraTenantId;
const CLIENT = 'client-rush-test';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const KID = 'cle-test';
const epflKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown>, key = epflKey.privateKey, kid = KID) {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64(claims);
  return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

/* Faux Microsoft : clés publiques et point d'échange du code. */
let nextToken: (nonce: string) => string;
let tokenRequests: URLSearchParams[] = [];
let issuedNonce = '';
const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`) {
    return Response.json({ keys: [{ kid: KID, kty: 'RSA', use: 'sig', ...epflKey.publicKey.export({ format: 'jwk' }) }] });
  }
  if (url === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`) {
    const form = new URLSearchParams(String(init?.body));
    tokenRequests.push(form);
    if (form.get('code') === 'code-perime') return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ token_type: 'Bearer', id_token: nextToken(issuedNonce) });
  }
  throw new Error(`fetch inattendu : ${url}`);
});
vi.stubGlobal('fetch', fetchMock);
afterAll(() => vi.unstubAllGlobals());

const now = () => Math.floor(Date.now() / 1000);
const claimsFor = (nonce: string, overrides: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: CLIENT,
  tid: TENANT,
  oid: 'oid-lea',
  sub: 'sub-lea',
  nonce,
  iat: now(),
  nbf: now(),
  exp: now() + 3600,
  email: 'Lea.Muller@epfl.ch',
  preferred_username: 'lmuller@epfl.ch',
  given_name: 'Léa',
  family_name: 'Müller',
  uniqueid: '123456',
  ...overrides,
});

const app = createApp();

/** Parcours complet dans un navigateur : départ, Microsoft (simulé), retour. */
async function epflLogin(opts: { claims?: Record<string, unknown>; code?: string; tamperState?: boolean; next?: string } = {}) {
  const start = await app.request(`/api/auth/epfl${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ''}`);
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location')!);
  const cookie = start.headers.get('set-cookie')!.split(';')[0];
  issuedNonce = authorize.searchParams.get('nonce')!;
  nextToken = (nonce) => idToken(claimsFor(nonce, opts.claims));
  const state = opts.tamperState ? 'etat-force' : authorize.searchParams.get('state')!;
  const back = await app.request(`/api/auth/epfl/callback?code=${opts.code ?? 'code-ok'}&state=${state}`, { headers: { cookie } });
  const session = /rush_session=([^;]+)/.exec(back.headers.getSetCookie().join('\n'))?.[1];
  return { authorize, back, location: back.headers.get('location'), user: userFromToken(session) };
}

beforeEach(() => {
  db.exec(
    'DELETE FROM identities; DELETE FROM withdrawals; DELETE FROM topups; DELETE FROM messages; DELETE FROM transactions; DELETE FROM orders; DELETE FROM presence; DELETE FROM sessions; DELETE FROM credentials; DELETE FROM users;',
  );
  env.entraClientId = CLIENT;
  env.entraClientSecret = 'secret-test';
  env.adminEmails = [];
  env.publicUrl = 'https://rush.example';
  tokenRequests = [];
  forgetKeys();
});

describe('connexion EPFL', () => {
  it('envoie chez Microsoft, sur l’annuaire EPFL, avec PKCE', async () => {
    const res = await app.request('/api/auth/options');
    expect(await res.json()).toEqual({ epfl: true });

    const { authorize } = await epflLogin();
    expect(authorize.origin + authorize.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT);
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://rush.example/api/auth/epfl/callback');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('scope')).toBe('openid profile email');
    // Le vérificateur PKCE part avec l'échange du code, jamais dans l'URL.
    expect(tokenRequests[0].get('code_verifier')).toBeTruthy();
    expect(authorize.toString()).not.toContain(tokenRequests[0].get('code_verifier')!);
    expect(tokenRequests[0].get('client_secret')).toBe('secret-test');
  });

  it('crée le compte avec le nom de l’annuaire et ouvre une session', async () => {
    const { user, location } = await epflLogin({ next: '/checkout' });
    expect(location).toBe('/checkout');
    expect(user).toMatchObject({ email: 'lea.muller@epfl.ch', first_name: 'Léa', last_name: 'Müller', onboarded: 0 });
    expect(balanceOf(user!.id)).toBe(env.welcomeBonusCents);
    expect(one('SELECT sciper FROM identities WHERE user_id = ?', user!.id)).toEqual({ sciper: '123456' });

    // Deuxième connexion : même compte, pas de second crédit de bienvenue.
    const again = await epflLogin();
    expect(again.user!.id).toBe(user!.id);
    expect(again.location).toBe('/');
    expect(balanceOf(user!.id)).toBe(env.welcomeBonusCents);
    const me = await (await app.request('/api/me', { headers: { cookie: `${SESSION_COOKIE}=${sessionOf(again.back)}` } })).json();
    expect(me).toMatchObject({ epfl: true, firstName: 'Léa' });
  });

  it('refuse un autre annuaire, un jeton mal signé, périmé ou rejoué', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ tid: '72f988bf-86f1-41af-91ab-2d7cd011db47', iss: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0' }, 'account'],
      [{ aud: 'autre-application' }, 'failed'],
      [{ exp: now() - 3600 }, 'failed'],
      [{ nonce: 'nonce-rejoue' }, 'failed'],
    ];
    for (const [claims, code] of cases) {
      const { location, user } = await epflLogin({ claims });
      expect(location).toBe(`/?epfl=${code}`);
      expect(user).toBeNull();
    }

    const start = await app.request('/api/auth/epfl');
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    nextToken = (nonce) => idToken(claimsFor(nonce), otherKey.privateKey);
    const forged = await app.request(`/api/auth/epfl/callback?code=x&state=${state}`, { headers: { cookie } });
    expect(forged.headers.get('location')).toBe('/?epfl=failed');
    expect(findUserByEmail('lea.muller@epfl.ch')).toBeUndefined();
  });

  it('refuse un retour sans l’état de ce navigateur ou avec un code périmé', async () => {
    expect((await epflLogin({ tamperState: true })).location).toBe('/?epfl=expired');
    expect((await epflLogin({ code: 'code-perime' })).location).toBe('/?epfl=expired');
    expect(tokenRequests).toHaveLength(1);
    const cancelled = await app.request('/api/auth/epfl/callback?error=access_denied&error_description=AADSTS65004');
    expect(cancelled.headers.get('location')).toBe('/?epfl=cancelled');
    const consent = await app.request('/api/auth/epfl/callback?error=invalid_client&error_description=AADSTS90094%3A+admin+consent');
    expect(consent.headers.get('location')).toBe('/?epfl=consent');
    expect(findUserByEmail('lea.muller@epfl.ch')).toBeUndefined();
  });

  it('ne revient que vers une page de l’app', async () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', '/api/admin/withdrawals']) {
      expect((await epflLogin({ next })).location).toBe('/');
    }
  });

  it('reprend un compte à mot de passe de la même adresse et ferme ses sessions', async () => {
    // Compte créé avec un mot de passe avant l'activation de la connexion EPFL.
    env.entraClientId = '';
    const squatter = await register('lea.muller@epfl.ch', 'motdepasse1');
    env.entraClientId = CLIENT;
    const { user } = await epflLogin();
    expect(user!.id).toBe(squatter.user.id);
    expect(userFromToken(squatter.token)).toBeNull();
    expect(one('SELECT 1 AS x FROM credentials WHERE user_id = ?', user!.id)).toBeUndefined();
    const retry = await app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'lea.muller@epfl.ch', password: 'motdepasse1' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(retry.status).toBe(403);
  });

  it('réserve le mot de passe aux adresses hors EPFL de l’équipe', async () => {
    expect(accountExists('nouveau@epfl.ch')).toMatchObject({ exists: false, epfl: true });
    await expect(register('nouveau@epfl.ch', 'motdepasse1')).rejects.toMatchObject({ status: 403 });

    env.adminEmails = ['owner@example.com'];
    expect(accountExists('owner@example.com')).toMatchObject({ exists: false, epfl: false });
    await expect(register('owner@example.com', 'motdepasse1')).resolves.toBeTruthy();

    // Connexion EPFL coupée plus tard : un mot de passe n'ouvre toujours pas un compte EPFL.
    const { user } = await epflLogin();
    env.entraClientId = '';
    expect(accountExists('lea.muller@epfl.ch')).toMatchObject({ exists: false, epfl: true });
    await expect(register('lea.muller@epfl.ch', 'motdepasse1')).rejects.toMatchObject({ status: 403 });
    expect(user).toBeTruthy();
    expect(await (await app.request('/api/auth/options')).json()).toEqual({ epfl: false });
    expect((await app.request('/api/auth/epfl')).headers.get('location')).toBe('/?epfl=unavailable');
  });
});

function sessionOf(res: Response) {
  return /rush_session=([^;]+)/.exec(res.headers.getSetCookie().join('\n'))?.[1];
}
