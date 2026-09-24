/**
 * Rush — envoi des codes de connexion depuis un compte Gmail, gratuit et
 * sans clé d'API (Google Apps Script, 100 destinataires par jour).
 *
 * 1. script.google.com → Nouveau projet → coller ce fichier à la place du code.
 * 2. Déployer → Nouveau déploiement → type « Application Web »,
 *    Exécuter en tant que : Moi, Qui a accès : Tout le monde → Déployer.
 * 3. Autoriser l'accès (Paramètres avancés → Accéder au projet).
 * 4. Copier l'URL de l'application Web dans MAIL_SCRIPT_URL sur Render.
 *
 * Le script ne sait envoyer qu'une chose : un code à 6 chiffres à une
 * adresse @epfl.ch, avec le modèle ci-dessous. Même si son URL fuitait,
 * il ne peut pas servir à envoyer autre chose.
 */

const ALLOWED_DOMAIN = 'epfl.ch';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const to = String(data.to || '').trim().toLowerCase();
    const code = String(data.code || '');
    const domain = to.split('@')[1] || '';
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(to) || !(domain === ALLOWED_DOMAIN || domain.endsWith('.' + ALLOWED_DOMAIN))) {
      throw new Error('Adresse refusée');
    }
    if (!/^\d{6}$/.test(code)) throw new Error('Code invalide');

    MailApp.sendEmail({
      to: to,
      name: 'Rush',
      subject: code + ' — ton code Rush',
      body: 'Ton code de connexion Rush est ' + code + ".\n\nIl expire dans 10 minutes. Si tu n'as rien demandé, ignore cet e-mail.",
      htmlBody:
        '<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:420px;margin:auto;padding:32px 24px">' +
        '<div style="font-size:22px;font-weight:800;letter-spacing:-0.02em">Rush</div>' +
        '<p style="color:#3c3c43;font-size:15px;line-height:1.5;margin:24px 0 8px">Ton code de connexion :</p>' +
        '<div style="font-size:36px;font-weight:700;letter-spacing:0.18em">' + code + '</div>' +
        '<p style="color:#8e8e93;font-size:13px;line-height:1.5;margin-top:24px">Il expire dans 10 minutes. Si tu n\'as rien demandé, ignore cet e-mail.</p>' +
        '</div>',
    });
    return reply({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String((err && err.message) || err) });
  }
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
