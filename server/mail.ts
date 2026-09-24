import { env } from './env';

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Script Google Apps Script déployé sur un compte Gmail (scripts/gmail-mailer.gs) :
 * gratuit, sans clé d'API, et en HTTPS, alors que les offres gratuites de
 * Render bloquent les ports SMTP (25, 465, 587). Le script a son propre modèle
 * d'e-mail et n'accepte qu'un code à 6 chiffres pour une adresse EPFL.
 */
async function viaGmailScript(to: string, code: string) {
  const res = await fetch(env.mailScriptUrl!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to, code }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !data?.ok) throw new Error(`Script Gmail ${res.status}: ${data?.error ?? 'réponse inattendue'}`);
}

let transport: { sendMail(opts: object): Promise<unknown> } | null = null;

async function viaSmtp(mail: Mail) {
  if (!transport) {
    const nodemailer = await import('nodemailer');
    transport = nodemailer.createTransport(env.smtpUrl!);
  }
  await transport.sendMail({ from: env.mailFrom, ...mail });
}

/** Moyen d'envoi retenu : le script Gmail en priorité, sinon SMTP, sinon rien (console). */
export const mailer = env.mailScriptUrl ? 'gmail-script' : env.smtpUrl ? 'smtp' : null;

/**
 * Envoie le code par e-mail. Renvoie false si aucun envoi n'est configuré
 * (le code part alors dans la console) ; lève une erreur si l'envoi échoue.
 */
export async function sendLoginCode(email: string, code: string): Promise<boolean> {
  if (!mailer) {
    console.log(`\n  ✉︎  Code de connexion pour ${email} : ${code}\n`);
    return false;
  }
  if (mailer === 'gmail-script') {
    await viaGmailScript(email, code);
    return true;
  }
  await viaSmtp({
    to: email,
    subject: `${code} — ton code Rush`,
    text: `Ton code de connexion Rush est ${code}.\n\nIl expire dans 10 minutes. Si tu n'as rien demandé, ignore cet e-mail.`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:420px;margin:auto;padding:32px 24px">
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em">Rush</div>
      <p style="color:#3c3c43;font-size:15px;line-height:1.5;margin:24px 0 8px">Ton code de connexion :</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:0.18em">${code}</div>
      <p style="color:#8e8e93;font-size:13px;line-height:1.5;margin-top:24px">Il expire dans 10 minutes. Si tu n'as rien demandé, ignore cet e-mail.</p>
    </div>`,
  });
  return true;
}
