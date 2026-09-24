import { env } from './env';

let transport: { sendMail(opts: object): Promise<unknown> } | null = null;

async function getTransport() {
  if (!env.smtpUrl) return null;
  if (!transport) {
    const nodemailer = await import('nodemailer');
    transport = nodemailer.createTransport(env.smtpUrl);
  }
  return transport;
}

/** Envoie le code par e-mail. Renvoie false si aucun SMTP n'est configuré. */
export async function sendLoginCode(email: string, code: string): Promise<boolean> {
  const t = await getTransport();
  if (!t) {
    console.log(`\n  ✉︎  Code de connexion pour ${email} : ${code}\n`);
    return false;
  }
  await t.sendMail({
    from: env.mailFrom,
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
