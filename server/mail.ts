import { env } from './env';

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** « Rush <rush@exemple.ch> » → { name: 'Rush', email: 'rush@exemple.ch' } */
export function parseAddress(raw: string): { name?: string; email: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (!match) return { email: raw.trim() };
  return match[1] ? { name: match[1], email: match[2].trim() } : { email: match[2].trim() };
}

/**
 * API HTTP de Brevo : elle passe par le port 443, alors que les offres
 * gratuites de Render bloquent les ports SMTP (25, 465, 587).
 */
async function viaBrevo(mail: Mail) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.brevoApiKey!, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: parseAddress(env.mailFrom),
      to: [{ email: mail.to }],
      subject: mail.subject,
      textContent: mail.text,
      htmlContent: mail.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

let transport: { sendMail(opts: object): Promise<unknown> } | null = null;

async function viaSmtp(mail: Mail) {
  if (!transport) {
    const nodemailer = await import('nodemailer');
    transport = nodemailer.createTransport(env.smtpUrl!);
  }
  await transport.sendMail({ from: env.mailFrom, ...mail });
}

/** Moyen d'envoi retenu : l'API Brevo en priorité, sinon SMTP, sinon rien (console). */
export const mailer = env.brevoApiKey ? 'brevo' : env.smtpUrl ? 'smtp' : null;

/**
 * Envoie le code par e-mail. Renvoie false si aucun envoi n'est configuré
 * (le code part alors dans la console) ; lève une erreur si l'envoi échoue.
 */
export async function sendLoginCode(email: string, code: string): Promise<boolean> {
  if (!mailer) {
    console.log(`\n  ✉︎  Code de connexion pour ${email} : ${code}\n`);
    return false;
  }
  const mail: Mail = {
    to: email,
    subject: `${code} — ton code Rush`,
    text: `Ton code de connexion Rush est ${code}.\n\nIl expire dans 10 minutes. Si tu n'as rien demandé, ignore cet e-mail.`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:420px;margin:auto;padding:32px 24px">
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em">Rush</div>
      <p style="color:#3c3c43;font-size:15px;line-height:1.5;margin:24px 0 8px">Ton code de connexion :</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:0.18em">${code}</div>
      <p style="color:#8e8e93;font-size:13px;line-height:1.5;margin-top:24px">Il expire dans 10 minutes. Si tu n'as rien demandé, ignore cet e-mail.</p>
    </div>`,
  };
  await (mailer === 'brevo' ? viaBrevo(mail) : viaSmtp(mail));
  return true;
}
