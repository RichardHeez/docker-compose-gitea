// Email (verify address, password reset, invites, MoMo renewal reminders). Without SMTP_URL the
// messages are printed to the console — fine for testing, not for a live site.
import nodemailer from 'nodemailer';

export function createMailer({ smtpUrl, from }) {
  const outbox = [];
  const transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  return {
    outbox,
    async send(to, subject, text) {
      outbox.push({ to, subject, text, at: Date.now() }); if (outbox.length > 50) outbox.shift();
      if (!transport) { console.log(`\n[mail → ${to}] ${subject}\n${text}\n`); return; }
      try { await transport.sendMail({ from, to, subject, text }); }
      catch (e) { console.error('mail failed', to, subject, e.message); }
    },
  };
}
