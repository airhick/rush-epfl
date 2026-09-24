import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as MailModule from '../server/mail';
import type * as AuthModule from '../server/services/auth';

const SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';

let mail: typeof MailModule;
let auth: typeof AuthModule;

beforeAll(async () => {
  process.env.MAIL_SCRIPT_URL = SCRIPT_URL;
  mail = await import('../server/mail');
  auth = await import('../server/services/auth');
});

afterEach(() => vi.unstubAllGlobals());

function mockScript(reply: object, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(reply), { status });
    }),
  );
  return calls;
}

describe('envoi des codes par le script Gmail', () => {
  it('envoie seulement l’adresse et le code au script', async () => {
    const calls = mockScript({ ok: true, remaining: 99 });
    expect(mail.mailer).toBe('gmail-script');
    expect(await mail.sendLoginCode('ada.lovelace@epfl.ch', '123456')).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SCRIPT_URL);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ to: 'ada.lovelace@epfl.ch', code: '123456' });
  });

  it('traite un refus du script comme un échec', async () => {
    mockScript({ ok: false, error: 'Service invoked too many times for one day: email.' });
    await expect(mail.sendLoginCode('ada.lovelace@epfl.ch', '123456')).rejects.toThrow(/too many times/);

    // Page d'erreur HTML de Google plutôt que du JSON.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Erreur</html>', { status: 200 })));
    await expect(mail.sendLoginCode('ada.lovelace@epfl.ch', '123456')).rejects.toThrow(/réponse inattendue/);
  });

  it('signale un envoi raté sans bloquer une nouvelle demande', async () => {
    mockScript({ ok: false, error: 'quota' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(auth.requestCode('grace.hopper@epfl.ch')).rejects.toMatchObject({ status: 502 });

    // Le code n'est jamais parti : pas de délai d'attente avant de réessayer.
    mockScript({ ok: true });
    await expect(auth.requestCode('grace.hopper@epfl.ch')).resolves.toEqual({});
  });
});
