import crypto from 'node:crypto';
import { config } from './config.js';
import { badRequest } from './errors.js';

export const now = () => Date.now();
export const DAY = 86400000;
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomHex = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');

export const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

export function cursorParam(req) {
  const c = req.query.cursor;
  if (c === undefined || c === '') return Number.MAX_SAFE_INTEGER;
  const n = Number(c);
  if (!Number.isInteger(n) || n < 0) throw badRequest('bad_cursor', 'قيمة التصفح غير صالحة');
  return n;
}
export function limitParam(req, def = 10, max = 30) {
  const n = Number(req.query.limit);
  if (!Number.isInteger(n) || n < 1) return def;
  return Math.min(n, max);
}
export function intParam(value, name = 'id') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw badRequest('bad_id', `معرّف غير صالح (${name})`);
  return n;
}
export const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);

export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'api', 'media', 'root', 'support', 'lamma', 'help', 'settings', 'explore', 'videos',
  'login', 'signup', 'welcome', 'post', 'u', 'tag', 'search', 'people', 'notifications', 'saved', 'create', 'null', 'undefined',
]);

export function validateEmail(v) {
  const email = String(v ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw badRequest('bad_email', 'البريد الإلكتروني غير صالح');
  return email;
}
export function validateUsername(v) {
  const u = String(v ?? '').trim();
  if (!/^[A-Za-z0-9_.]{3,24}$/.test(u) || /^\.|\.$|\.\./.test(u)) {
    throw badRequest('bad_username', 'اسم المستخدم: من 3 إلى 24 حرفًا إنجليزيًا أو أرقامًا أو _ أو . فقط');
  }
  if (RESERVED_USERNAMES.has(u.toLowerCase())) throw badRequest('bad_username', 'اسم المستخدم هذا محجوز');
  return u;
}
export function validateDisplayName(v) {
  const n = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (n.length < 1 || n.length > 50) throw badRequest('bad_name', 'الاسم المعروض يجب أن يكون من 1 إلى 50 حرفًا');
  return n;
}
export function validatePassword(v) {
  const p = String(v ?? '');
  if (p.length < 8 || p.length > 128 || !/\p{L}/u.test(p) || !/\d/.test(p)) {
    throw badRequest('weak_password', 'كلمة المرور: 8 أحرف على الأقل وتحتوي على حرف ورقم');
  }
  return p;
}
export function validateText(v, max, label, { required = false } = {}) {
  const s = String(v ?? '').replace(/\r\n/g, '\n').trim();
  if (required && !s) throw badRequest('empty', `${label} مطلوب`);
  if (s.length > max) throw badRequest('too_long', `${label} يجب ألا يتجاوز ${max} حرفًا`);
  return s;
}

const TAG_RE = /(^|[\s(،.!؟?])#([\p{L}\p{N}_]{1,50})/gu;
export function extractTags(caption, explicit = []) {
  const set = new Map();
  for (const m of caption.matchAll(TAG_RE)) set.set(m[2].toLowerCase(), m[2]);
  for (let t of explicit) {
    t = String(t).trim().replace(/^#+/, '');
    if (/^[\p{L}\p{N}_]{1,50}$/u.test(t)) set.set(t.toLowerCase(), t);
  }
  return [...set.values()].slice(0, config.limits.maxTags);
}
