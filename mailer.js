const nodemailer = require('nodemailer');

function createTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: parseInt(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendMail(to, subject, html) {
  const transport = createTransport();
  if (!transport) return; // Email non configurata, skip silenzioso
  const from = process.env.SMTP_FROM || `Fanta F1 2026 <${process.env.SMTP_USER}>`;
  try {
    await transport.sendMail({ from, to, subject, html });
  } catch (e) {
    console.warn(`⚠️ Email non inviata a ${to}:`, e.message);
  }
}

function wrap(content) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a0a0a;color:#fff;padding:24px;">
    <div style="max-width:520px;margin:auto;background:#1a1a1a;border-radius:12px;padding:28px;border:1px solid #2a2a2a;">
      <div style="font-size:22px;font-weight:900;margin-bottom:20px;">🏎️ FANTA <span style="color:#e10600;">F1</span> 2026</div>
      ${content}
      <div style="margin-top:28px;font-size:11px;color:#555;">Fanta F1 2026 · Messaggio automatico, non rispondere a questa email.</div>
    </div>
  </body></html>`;
}

async function sendWelcome(email, username) {
  await sendMail(email, '🏎️ Benvenuto in Fanta F1 2026!', wrap(`
    <h2 style="margin:0 0 12px;font-size:18px;">Ciao ${username}! 👋</h2>
    <p style="color:#ccc;line-height:1.6;">La tua registrazione è andata a buon fine. Puoi ora accedere alla dashboard, fare i tuoi pronostici e partecipare alla stagione 2026.</p>
    <a href="${process.env.BASE_URL}/dashboard.html"
      style="display:inline-block;margin-top:16px;background:#e10600;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:700;">
      Vai alla Dashboard →
    </a>
  `));
}

async function sendPaymentReceipt(email, username, raceName, amount) {
  await sendMail(email, `✅ Pagamento confermato — ${raceName}`, wrap(`
    <h2 style="margin:0 0 12px;font-size:18px;">Pagamento ricevuto!</h2>
    <p style="color:#ccc;line-height:1.6;">Abbiamo ricevuto il tuo pagamento per la gara:</p>
    <div style="background:#111;border-radius:8px;padding:16px;margin:16px 0;">
      <div style="font-size:16px;font-weight:700;">${raceName}</div>
      <div style="color:#4ade80;font-size:20px;font-weight:900;margin-top:4px;">${amount}€ ✓</div>
    </div>
    <p style="color:#ccc;line-height:1.6;">Sei ufficialmente iscritto. In bocca al lupo con i tuoi pronostici, ${username}!</p>
  `));
}

async function sendScoresReady(email, username, raceName, total, breakdown) {
  const rows = breakdown.map(b => `<div style="padding:6px 0;border-bottom:1px solid #2a2a2a;color:#ccc;">${b}</div>`).join('');
  const color = total >= 0 ? '#4ade80' : '#f87171';
  await sendMail(email, `🏁 Punteggi ${raceName} — il tuo risultato`, wrap(`
    <h2 style="margin:0 0 12px;font-size:18px;">Risultati disponibili!</h2>
    <p style="color:#ccc;">I punteggi per <strong>${raceName}</strong> sono stati calcolati.</p>
    <div style="background:#111;border-radius:8px;padding:16px;margin:16px 0;">
      <div style="color:#aaa;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Il tuo punteggio</div>
      <div style="font-size:32px;font-weight:900;color:${color};margin:4px 0;">200 + ${total > 0 ? '+' : ''}${total} pt</div>
      <div style="margin-top:12px;font-size:13px;">${rows || '<div style="color:#666;">Nessun dettaglio disponibile</div>'}</div>
    </div>
    <a href="${process.env.BASE_URL}/leaderboard.html"
      style="display:inline-block;margin-top:8px;background:#e10600;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:700;">
      Vedi la classifica →
    </a>
  `));
}

async function sendDeadlineReminder(email, username, raceName, deadline) {
  const deadlineStr = new Date(deadline).toLocaleString('it-IT', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  await sendMail(email, `⏰ Ultimo momento — pronostico ${raceName}`, wrap(`
    <h2 style="margin:0 0 12px;font-size:18px;">Hai ancora tempo, ${username}!</h2>
    <p style="color:#ccc;line-height:1.6;">Non hai ancora inviato il tuo pronostico per:</p>
    <div style="background:#111;border-radius:8px;padding:16px;margin:16px 0;">
      <div style="font-size:16px;font-weight:700;">${raceName}</div>
      <div style="color:#facc15;margin-top:4px;">⏰ Scadenza: ${deadlineStr}</div>
    </div>
    <a href="${process.env.BASE_URL}/dashboard.html"
      style="display:inline-block;margin-top:8px;background:#e10600;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:700;">
      Fai il pronostico ora →
    </a>
  `));
}

module.exports = { sendWelcome, sendPaymentReceipt, sendScoresReady, sendDeadlineReminder };
