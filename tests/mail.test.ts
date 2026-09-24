import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as MailModule from '../server/mail';
import type * as AuthModule from '../server/services/auth';

let mail: typeof MailModule;
let auth: typeof AuthModule;

beforeAll(async () => {
  process.env.BREVO_API_KEY = 'brevo-test';
  process.env.MAIL_FROM = 'Rush <rush.epfl@gmail.com>';
  mail = await import('../server/mail');
  auth = await import('../server/services/auth');
});

afterEach(() => vi.unstubAllGlobals());

function mockBrevo(status = 201) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(status < 300 ? { messageId: 'm1' } : { message: 'sender not valid' }), { status });
    }),
  );
  return calls;
}

describe('envoi des codes par e-mail', () => {
  it('lit les adresses « Nom <e-mail> »', () => {
    expect(mail.parseAddress('Rush <rush@exemple.ch>')).toEqual({ name: 'Rush', email: 'rush@exemple.ch' });
    expect(mail.parseAddress('"Rush EPFL" <rush@exemple.ch>')).toEqual({ name: 'Rush EPFL', email: 'rush@exemple.ch' });
    expect(mail.parseAddress(' rush@exemple.ch ')).toEqual({ email: 'rush@exemple.ch' });
  });

  it('passe par l’API HTTP de Brevo quand la clé est définie', async () => {
    const calls = mockBrevo();
    expect(mail.mailer).toBe('brevo');
    expect(await mail.sendLoginCode('ada.lovelace@epfl.ch', '123456')).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0].init.headers as Record<string, string>)['api-key']).toBe('brevo-test');
    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload.sender).toEqual({ name: 'Rush', email: 'rush.epfl@gmail.com' });
    expect(payload.to).toEqual([{ email: 'ada.lovelace@epfl.ch' }]);
    expect(payload.subject).toContain('123456');
    expect(payload.htmlContent).toContain('123456');
  });

  it('signale un envoi raté sans bloquer une nouvelle demande', async () => {
    mockBrevo(400);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(auth.requestCode('grace.hopper@epfl.ch')).rejects.toMatchObject({ status: 502 });

    // Le code n'est jamais parti : pas de délai d'attente avant de réessayer.
    mockBrevo();
    await expect(auth.requestCode('grace.hopper@epfl.ch')).resolves.toEqual({});
  });
});
