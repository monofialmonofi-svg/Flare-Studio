import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { get, run } from './db.js';
import { forbidden, unauthorized, HttpError } from './errors.js';
import { clientIp, now, randomToken, sha256, DAY } from './util.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'lamma_sid';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(key, expected);
}
// لمنع كشف وجود الحساب من زمن الاستجابة
const DUMMY_HASH = await hashPassword('dummy-password-1');
export const burnPasswordTime = (pw) => verifyPassword(String(pw ?? ''), DUMMY_HASH).catch(() => false);

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(userId, req) {
  const token = randomToken(32);
  const t = now();
  run(
    'INSERT INTO sessions (id, public_id, user_id, created_at, expires_at, last_used_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)',
    sha256(token), randomToken(9), userId, t, t + config.sessionDays * DAY, t, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200),
  );
  run('UPDATE users SET last_seen_at = ? WHERE id = ?', t, userId);
  return token;
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: config.sessionDays * DAY,
  });
}
export const clearSessionCookie = (res) => res.clearCookie(COOKIE, { path: '/' });

export function destroyUserSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', userId, exceptSessionId);
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

/** يحمّل المستخدم من الكوكي (المتصفح) أو من Authorization: Bearer (تطبيقات الجوال لاحقًا). */
export function loadUser(req, res, next) {
  req.user = null;
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const token = bearer?.[1] || parseCookies(req.headers.cookie)[COOKIE];
  req.authVia = bearer ? 'bearer' : token ? 'cookie' : null;
  if (!token) return next();
  const row = get(
    `SELECT s.id AS sid, s.last_used_at, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    sha256(token),
  );
  if (!row || row.expires_at < now()) {
    if (row) run('DELETE FROM sessions WHERE id = ?', row.sid);
    return next();
  }
  if (row.status === 'banned') return next();
  const { sid, last_used_at, expires_at, ...user } = row;
  req.user = user;
  req.sessionId = sid;
  const t = now();
  if (t - last_used_at > 5 * 60 * 1000) {
    run('UPDATE sessions SET last_used_at = ? WHERE id = ?', t, sid);
    run('UPDATE users SET last_seen_at = ? WHERE id = ?', t, user.id);
  }
  next();
}

/** حماية CSRF للجلسات المعتمدة على الكوكي: SameSite=Lax + فحص Origin للطلبات المغيِّرة. */
export function originCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.authVia !== 'cookie') return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = ''; }
    const allowed = new Set([req.headers.host, new URL(config.appUrl).host]);
    if (!allowed.has(host)) return next(new HttpError(403, 'bad_origin', 'طلب مرفوض (مصدر غير موثوق)'));
  } else if (req.headers['sec-fetch-site'] === 'cross-site') {
    return next(new HttpError(403, 'bad_origin', 'طلب مرفوض (مصدر غير موثوق)'));
  }
  next();
}

export const requireAuth = (req, res, next) => (req.user ? next() : next(unauthorized()));
export const requireAdmin = (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('هذه الصفحة للمسؤولين فقط'));
  next();
};
/** يمنع النشر والتعليق قبل تأكيد البريد عند تفعيل REQUIRE_VERIFIED_EMAIL. */
export const requireVerified = (req, res, next) => {
  if (config.requireVerifiedEmail && !req.user.email_verified) {
    return next(new HttpError(403, 'email_unverified', 'أكّد بريدك الإلكتروني أولًا لتتمكن من النشر والتفاعل'));
  }
  next();
};

export function recordLoginFailure(keys) {
  const t = now();
  for (const k of keys) run('INSERT INTO login_attempts (key, created_at) VALUES (?,?)', k, t);
}
export function loginBlocked(emailKey, ipKey) {
  const since = now() - config.rate.loginWindowMs;
  const e = get('SELECT COUNT(*) c, MIN(created_at) first FROM login_attempts WHERE key = ? AND created_at > ?', emailKey, since);
  const i = get('SELECT COUNT(*) c, MIN(created_at) first FROM login_attempts WHERE key = ? AND created_at > ?', ipKey, since);
  if (e.c >= config.rate.loginMaxPerEmail) return Math.ceil((e.first + config.rate.loginWindowMs - now()) / 1000);
  if (i.c >= config.rate.loginMaxPerIp) return Math.ceil((i.first + config.rate.loginWindowMs - now()) / 1000);
  return 0;
}
export function clearLoginFailures(key) {
  run('DELETE FROM login_attempts WHERE key = ?', key);
}
export function purgeOldAttempts() {
  run('DELETE FROM login_attempts WHERE created_at < ?', now() - config.rate.loginWindowMs);
  run('DELETE FROM sessions WHERE expires_at < ?', now());
  run('DELETE FROM views WHERE day < ?', Math.floor(now() / DAY) - 2);
}
