import { Router } from 'express';
import { config } from '../config.js';
import {
  burnPasswordTime, clearLoginFailures, clearSessionCookie, createSession, destroyUserSessions, hashPassword,
  loginBlocked, recordLoginFailure, requireAuth, setSessionCookie, verifyPassword,
} from '../auth.js';
import { all, get, run, tx } from '../db.js';
import { badRequest, conflict, forbidden, HttpError, tooMany, wrap } from '../errors.js';
import { sendMail } from '../mailer.js';
import { rateLimit } from '../ratelimit.js';
import { meUser } from '../serialize.js';
import { deleteUser } from '../content.js';
import {
  clientIp, now, randomToken, sha256, validateDisplayName, validateEmail, validatePassword, validateUsername, DAY,
} from '../util.js';

const r = Router();
const signupLimit = rateLimit({ windowMs: 3600e3, max: config.rate.signupPerHour, message: 'تم إنشاء حسابات كثيرة من هذا الجهاز، حاول لاحقًا' });
const mailLimit = rateLimit({ windowMs: 3600e3, max: 8, message: 'طلبات بريد كثيرة، حاول بعد قليل' });

async function issueToken(user, kind, ttlMs) {
  run('DELETE FROM tokens WHERE user_id = ? AND kind = ?', user.id, kind);
  const token = randomToken(32);
  run('INSERT INTO tokens (user_id, kind, token_hash, expires_at) VALUES (?,?,?,?)', user.id, kind, sha256(token), now() + ttlMs);
  return token;
}
async function sendVerification(user) {
  const token = await issueToken(user, 'verify', 2 * DAY);
  await sendMail({
    to: user.email,
    subject: 'أكّد بريدك الإلكتروني في لَمّة',
    text: `أهلًا ${user.display_name}،\n\nاضغط على الرابط التالي لتأكيد بريدك الإلكتروني:\n${config.appUrl}/verify?token=${token}\n\nينتهي الرابط خلال 48 ساعة. إن لم تنشئ حسابًا في لَمّة فتجاهل هذه الرسالة.`,
  });
}

r.post('/signup', signupLimit, wrap(async (req, res) => {
  const b = req.body || {};
  const email = validateEmail(b.email);
  const username = validateUsername(b.username);
  const displayName = validateDisplayName(b.displayName || username);
  const password = validatePassword(b.password);
  if (get('SELECT 1 FROM users WHERE email = ?', email)) throw conflict('email_taken', 'هذا البريد مسجّل بالفعل');
  if (get('SELECT 1 FROM users WHERE username = ?', username)) throw conflict('username_taken', 'اسم المستخدم مستخدم بالفعل');
  const hash = await hashPassword(password);
  let id;
  try {
    id = Number(run(
      'INSERT INTO users (email, username, display_name, password_hash, created_at) VALUES (?,?,?,?,?)',
      email, username, displayName, hash, now(),
    ).lastInsertRowid);
  } catch (e) {
    if (/UNIQUE/.test(String(e.message))) throw conflict('taken', 'البريد أو اسم المستخدم مستخدم بالفعل');
    throw e;
  }
  const user = get('SELECT * FROM users WHERE id = ?', id);
  await sendVerification(user).catch((e) => console.error('mail failed', e.message));
  setSessionCookie(res, createSession(id, req));
  res.status(201).json({ user: meUser(user) });
}));

r.post('/login', wrap(async (req, res) => {
  const identifier = String(req.body?.identifier ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!identifier || !password) throw badRequest('missing', 'أدخل البريد أو اسم المستخدم وكلمة المرور');
  const emailKey = `email:${identifier}`;
  const ipKey = `ip:${clientIp(req)}`;
  const wait = loginBlocked(emailKey, ipKey);
  if (wait > 0) throw tooMany(`محاولات دخول كثيرة. حاول مرة أخرى بعد ${Math.ceil(wait / 60)} دقيقة`, { retryAfter: wait });

  const user = get('SELECT * FROM users WHERE email = ? OR username = ?', identifier, identifier);
  const ok = user ? await verifyPassword(password, user.password_hash) : await burnPasswordTime(password);
  if (!user || !ok) {
    recordLoginFailure([emailKey, ipKey]);
    throw new HttpError(401, 'bad_credentials', 'بيانات الدخول غير صحيحة');
  }
  if (user.status === 'banned') {
    throw forbidden(`هذا الحساب محظور${user.ban_reason ? `: ${user.ban_reason}` : ''}`);
  }
  clearLoginFailures(emailKey);
  const token = createSession(user.id, req);
  setSessionCookie(res, token);
  const body = { user: meUser(user) };
  if (req.headers['x-client'] === 'native') body.token = token; // لتطبيقات Android/iOS لاحقًا
  res.json(body);
}));

r.post('/logout', wrap(async (req, res) => {
  if (req.sessionId) run('DELETE FROM sessions WHERE id = ?', req.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

r.get('/me', (req, res) => res.json({ user: req.user ? meUser(req.user) : null, config: { requireVerifiedEmail: config.requireVerifiedEmail, limits: {
  imageMB: config.limits.imageBytes / 1048576, videoMB: config.limits.videoBytes / 1048576, maxImages: config.limits.maxImagesPerPost,
  captionLength: config.limits.captionLength, commentLength: config.limits.commentLength, bioLength: config.limits.bioLength } } }));

r.post('/verify', wrap(async (req, res) => {
  const row = get('SELECT * FROM tokens WHERE token_hash = ? AND kind = ?', sha256(String(req.body?.token ?? '')), 'verify');
  if (!row || row.used_at || row.expires_at < now()) throw badRequest('bad_token', 'رابط التأكيد غير صالح أو منتهي');
  tx(() => {
    run('UPDATE tokens SET used_at = ? WHERE id = ?', now(), row.id);
    run('UPDATE users SET email_verified = 1 WHERE id = ?', row.user_id);
    const u = get('SELECT email FROM users WHERE id = ?', row.user_id);
    if (config.adminEmail && u.email.toLowerCase() === config.adminEmail) run("UPDATE users SET role = 'admin' WHERE id = ?", row.user_id);
  });
  res.json({ ok: true });
}));

r.post('/resend-verification', requireAuth, mailLimit, wrap(async (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true, alreadyVerified: true });
  await sendVerification(req.user);
  res.json({ ok: true });
}));

r.post('/forgot', mailLimit, wrap(async (req, res) => {
  // نردّ دائمًا بنجاح حتى لا نكشف أي البريدات مسجّلة
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const user = email ? get("SELECT * FROM users WHERE email = ? AND status = 'active'", email) : null;
  if (user) {
    const token = await issueToken(user, 'reset', 60 * 60 * 1000);
    await sendMail({
      to: user.email,
      subject: 'استعادة كلمة المرور — لَمّة',
      text: `لاستعادة كلمة المرور اضغط على الرابط التالي (صالح لمدة ساعة):\n${config.appUrl}/reset?token=${token}\n\nإن لم تطلب ذلك فتجاهل هذه الرسالة.`,
    }).catch((e) => console.error('mail failed', e.message));
  }
  res.json({ ok: true });
}));

r.post('/reset', wrap(async (req, res) => {
  const password = validatePassword(req.body?.password);
  const row = get('SELECT * FROM tokens WHERE token_hash = ? AND kind = ?', sha256(String(req.body?.token ?? '')), 'reset');
  if (!row || row.used_at || row.expires_at < now()) throw badRequest('bad_token', 'رابط الاستعادة غير صالح أو منتهي');
  const hash = await hashPassword(password);
  tx(() => {
    run('UPDATE tokens SET used_at = ? WHERE id = ?', now(), row.id);
    run('UPDATE users SET password_hash = ? WHERE id = ?', hash, row.user_id);
    destroyUserSessions(row.user_id); // أي جلسة قديمة تنتهي
  });
  clearLoginFailures(`email:${get('SELECT email FROM users WHERE id = ?', row.user_id).email}`);
  res.json({ ok: true });
}));

r.post('/change-password', requireAuth, wrap(async (req, res) => {
  const next = validatePassword(req.body?.next);
  if (!(await verifyPassword(String(req.body?.current ?? ''), req.user.password_hash))) {
    throw new HttpError(401, 'bad_credentials', 'كلمة المرور الحالية غير صحيحة');
  }
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), req.user.id);
  destroyUserSessions(req.user.id, req.sessionId); // نُبقي الجلسة الحالية فقط
  res.json({ ok: true });
}));

r.get('/sessions', requireAuth, (req, res) => {
  const rows = all('SELECT id, public_id, created_at, last_used_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC', req.user.id);
  res.json({ items: rows.map((s) => ({ id: s.public_id, createdAt: s.created_at, lastUsedAt: s.last_used_at, ip: s.ip, userAgent: s.user_agent, current: s.id === req.sessionId })) });
});
r.delete('/sessions/:id', requireAuth, (req, res) => {
  run('DELETE FROM sessions WHERE public_id = ? AND user_id = ?', String(req.params.id), req.user.id);
  res.json({ ok: true });
});

r.delete('/account', requireAuth, wrap(async (req, res) => {
  if (!(await verifyPassword(String(req.body?.password ?? ''), req.user.password_hash))) {
    throw new HttpError(401, 'bad_credentials', 'كلمة المرور غير صحيحة');
  }
  if (req.user.role === 'admin' && get("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND status = 'active'").c <= 1) {
    throw conflict('last_admin', 'لا يمكن حذف آخر مسؤول في النظام');
  }
  await deleteUser(req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

export default r;
