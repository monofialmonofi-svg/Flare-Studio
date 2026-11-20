// الاستخدام: npm run make-admin -- someone@example.com
import { get, run } from '../db.js';

const email = String(process.argv[2] ?? '').trim().toLowerCase();
if (!email) {
  console.error('الاستخدام: npm run make-admin -- email@example.com');
  process.exit(1);
}
const u = get('SELECT id, username FROM users WHERE email = ?', email);
if (!u) {
  console.error(`لا يوجد مستخدم بالبريد ${email}. أنشئ الحساب من الموقع أولًا.`);
  process.exit(1);
}
run("UPDATE users SET role = 'admin', email_verified = 1 WHERE id = ?", u.id);
console.log(`تمت ترقية @${u.username} إلى مسؤول.`);
