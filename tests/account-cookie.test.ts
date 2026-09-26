import { beforeEach, describe, expect, it } from 'vitest';
import { db, run } from '../server/db';
import { env } from '../server/env';
import { createApp } from '../server/app';
import { ACCOUNT_COOKIE, SESSION_COOKIE } from '../server/services/auth';
import { balanceOf, findUserByEmail } from '../server/services/users';

const app = createApp();

/** Ce qu'un navigateur garderait : les cookies posés par chaque réponse. */
class Browser {
  jar = new Map<string, string>();
  async call(path: string, init: { method?: string; body?: unknown } = {}) {
    const res = await app.request(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: {
        'content-type': 'application/json',
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      if (!value || /max-age=0/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }
}

/** Ce que fait Render à chaque veille ou déploiement : la base repart de zéro. */
const wipe = () =>
  db.exec(
    'DELETE FROM identities; DELETE FROM withdrawals; DELETE FROM topups; DELETE FROM messages; DELETE FROM transactions; DELETE FROM orders; DELETE FROM presence; DELETE FROM sessions; DELETE FROM credentials; DELETE FROM users;',
  );

async function signUp(browser: Browser, email = 'lea.muller@epfl.ch') {
  expect((await browser.call('/auth/register', { body: { email, password: 'motdepasse1' } })).status).toBe(201);
  await browser.call('/me', { method: 'PATCH', body: { firstName: 'Léa', lastName: 'Müller', section: 'IN' } });
}

beforeEach(() => {
  wipe();
  env.entraClientId = '';
});

describe('cookie de compte', () => {
  it('garde la connexion et recrée le compte quand la base a été vidée', async () => {
    const phone = new Browser();
    await signUp(phone);
    expect(phone.jar.has(ACCOUNT_COOKIE)).toBe(true);
    const before = (await (await phone.call('/me')).json()) as { id: string };

    wipe();
    const res = await phone.call('/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: before.id, email: 'lea.muller@epfl.ch', firstName: 'Léa', section: 'IN', onboarded: true });
    // Pas de second crédit de bienvenue en revenant.
    expect(balanceOf(before.id)).toBe(0);

    // Le mot de passe revient avec le compte : un autre appareil se connecte sans se réinscrire.
    const laptop = new Browser();
    expect(await (await laptop.call('/auth/check', { body: { email: 'lea.muller@epfl.ch' } })).json()).toMatchObject({ exists: true });
    expect((await laptop.call('/auth/login', { body: { email: 'lea.muller@epfl.ch', password: 'motdepasse1' } })).status).toBe(200);
  });

  it('rouvre une session expirée tant que le mot de passe est le même', async () => {
    const phone = new Browser();
    await signUp(phone);
    run('DELETE FROM sessions');
    expect((await phone.call('/me')).status).toBe(200);

    // Mot de passe retiré (compte repris par la connexion EPFL) : le cookie ne suffit plus.
    run('DELETE FROM sessions');
    run('DELETE FROM credentials');
    expect((await phone.call('/me')).status).toBe(401);
    expect(phone.jar.has(ACCOUNT_COOKIE)).toBe(false);
  });

  it('refuse un cookie modifié ou chiffré avec une autre clé', async () => {
    const phone = new Browser();
    await signUp(phone);
    const sealed = phone.jar.get(ACCOUNT_COOKIE)!;
    wipe();

    const forged = new Browser();
    forged.jar.set(ACCOUNT_COOKIE, sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
    expect((await forged.call('/me')).status).toBe(401);

    const secret = env.cookieSecret;
    env.cookieSecret = 'une-autre-cle';
    const other = new Browser();
    other.jar.set(ACCOUNT_COOKIE, sealed);
    expect((await other.call('/me')).status).toBe(401);
    env.cookieSecret = secret;
    expect(findUserByEmail('lea.muller@epfl.ch')).toBeUndefined();
  });

  it('laisse l’adresse au compte créé entre-temps', async () => {
    const phone = new Browser();
    await signUp(phone);
    wipe();
    await signUp(new Browser());
    const newcomer = findUserByEmail('lea.muller@epfl.ch')!;

    expect((await phone.call('/me')).status).toBe(401);
    expect(phone.jar.has(ACCOUNT_COOKIE)).toBe(false);
    expect(findUserByEmail('lea.muller@epfl.ch')!.id).toBe(newcomer.id);
  });

  it('oublie l’appareil à la déconnexion', async () => {
    const phone = new Browser();
    await signUp(phone);
    await phone.call('/auth/logout', { method: 'POST', body: {} });
    expect(phone.jar.has(SESSION_COOKIE)).toBe(false);
    expect(phone.jar.has(ACCOUNT_COOKIE)).toBe(false);
    wipe();
    expect((await phone.call('/me')).status).toBe(401);
  });

  it('ne pose pas de cookie de compte sans clé configurée', async () => {
    const secret = env.cookieSecret;
    env.cookieSecret = '';
    const phone = new Browser();
    await signUp(phone);
    expect(phone.jar.has(SESSION_COOKIE)).toBe(true);
    expect(phone.jar.has(ACCOUNT_COOKIE)).toBe(false);
    env.cookieSecret = secret;
  });
});
