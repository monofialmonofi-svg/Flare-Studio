import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { get, run } from '../db.js';
import { badRequest, notFound, wrap } from '../errors.js';
import { rateLimit } from '../ratelimit.js';
import { intParam, now, validateText } from '../util.js';

export const REPORT_REASONS = ['spam', 'abuse', 'nudity', 'violence', 'misinformation', 'impersonation', 'other'];
const r = Router();

r.post('/', requireAuth, rateLimit({ windowMs: 3600e3, max: 30, key: (req) => `r${req.user.id}`, message: 'بلاغات كثيرة، حاول لاحقًا' }), wrap(async (req, res) => {
  const { targetType } = req.body || {};
  const targetId = intParam(req.body?.targetId, 'targetId');
  const reason = String(req.body?.reason ?? '');
  if (!['post', 'comment', 'user'].includes(targetType)) throw badRequest('bad_target', 'نوع البلاغ غير صالح');
  if (!REPORT_REASONS.includes(reason)) throw badRequest('bad_reason', 'اختر سبب البلاغ');
  const details = validateText(req.body?.details, 500, 'التفاصيل');

  const table = { post: 'posts', comment: 'comments', user: 'users' }[targetType];
  const target = get(`SELECT * FROM ${table} WHERE id = ?`, targetId);
  if (!target) throw notFound('المحتوى غير موجود');
  const ownerId = targetType === 'user' ? target.id : target.user_id;
  if (ownerId === req.user.id) throw badRequest('self', 'لا يمكنك الإبلاغ عن محتواك');

  // بلاغ واحد لكل مستخدم على نفس المحتوى (تكراره يُعامل كنجاح)
  run('INSERT OR IGNORE INTO reports (reporter_id, target_type, target_id, reason, details, created_at) VALUES (?,?,?,?,?,?)',
    req.user.id, targetType, targetId, reason, details, now());
  res.status(201).json({ ok: true });
}));

export default r;
