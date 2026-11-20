import { config } from './config.js';
import { run } from './db.js';

let transport;
async function getTransport() {
  if (transport !== undefined) return transport;
  if (!config.smtpUrl) return (transport = null);
  const nodemailer = (await import('nodemailer')).default;
  return (transport = nodemailer.createTransport(config.smtpUrl));
}

/**
 * يرسل بريدًا عبر SMTP إن كان SMTP_URL مضبوطًا. وإلا (وضع التطوير) يحفظ الرسالة في جدول outbox
 * ويطبعها في سجل الخادم حتى يمكن اختبار روابط التأكيد واستعادة كلمة المرور بدون خادم بريد.
 */
export async function sendMail({ to, subject, text }) {
  const t = await getTransport();
  if (t) {
    await t.sendMail({ from: config.mailFrom, to, subject, text });
    return { delivered: true };
  }
  run('INSERT INTO outbox (to_email, subject, body, created_at) VALUES (?,?,?,?)', to, subject, text, Date.now());
  if (!config.isProd) console.log(`\n[mail:dev] إلى ${to} — ${subject}\n${text}\n`);
  return { delivered: false };
}
