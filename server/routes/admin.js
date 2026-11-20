// لوحة الإدارة. كل المسارات محمية من الخادم بـ requireAdmin (لا يكفي إخفاء الصفحة).
import { Router } from 'express';
import { destroyUserSessions, requireAdmin } from '../auth.js';
import { all, get, run, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound, wrap } from '../errors.js';
import { audit, deletePost, deleteUser } from '../content.js';
import { storage } from '../storage.js';
import { hydratePosts, POST_SELECT } from '../serialize.js';
import { cursorParam, DAY, escapeLike, intParam, limitParam, now, validateText } from '../util.js';

const r = Router();
r.use(requireAdmin);

const adminUser = (u) => ({
  id: u.id, username: u.username, displayName: u.display_name, email: u.email, avatar: storage.url(u.avatar),
  role: u.role, status: u.status, banReason: u.ban_reason, emailVerified: !!u.email_verified,
  counts: { posts: u.posts_count, followers: u.followers_count, following: u.following_count },
  createdAt: u.created_at, lastSeenAt: u.last_seen_at,
});

r.get('/stats', (req, res) => {
  const t = now();
  const day = (table, col = 'created_at') => {
    const rows = all(`SELECT date(${col}/1000, 'unixepoch') d, COUNT(*) c FROM ${table} WHERE ${col} > ? GROUP BY d`, t - 7 * DAY);
    const map = new Map(rows.map((x) => [x.d, x.c]));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(t - (6 - i) * DAY).toISOString().slice(0, 10);
      return { date: d, count: map.get(d) ?? 0 };
    });
  };
  const c = (sql, ...p) => get(sql, ...p).c;
  const bytes = get('SELECT COALESCE(SUM(size_bytes),0) b, COALESCE(SUM(CASE WHEN type = \'video\' THEN size_bytes END),0) v, COALESCE(SUM(CASE WHEN type = \'image\' THEN size_bytes END),0) i FROM post_media');
  res.json({
    users: { total: c('SELECT COUNT(*) c FROM users'), active: c("SELECT COUNT(*) c FROM users WHERE status = 'active'"), banned: c("SELECT COUNT(*) c FROM users WHERE status = 'banned'"), new7d: c('SELECT COUNT(*) c FROM users WHERE created_at > ?', t - 7 * DAY), active24h: c('SELECT COUNT(*) c FROM users WHERE last_seen_at > ?', t - DAY) },
    posts: { total: c('SELECT COUNT(*) c FROM posts'), images: c("SELECT COUNT(*) c FROM posts WHERE kind = 'image'"), videos: c("SELECT COUNT(*) c FROM posts WHERE kind = 'video'") },
    engagement: { comments: c('SELECT COUNT(*) c FROM comments'), likes: c('SELECT COUNT(*) c FROM likes'), views: c('SELECT COALESCE(SUM(views_count),0) c FROM posts') },
    reports: { open: c("SELECT COUNT(*) c FROM reports WHERE status = 'open'"), total: c('SELECT COUNT(*) c FROM reports') },
    storage: { totalBytes: bytes.b, videoBytes: bytes.v, imageBytes: bytes.i },
    activity: { signups: day('users'), posts: day('posts'), comments: day('comments') },
  });
});

r.get('/users', (req, res) => {
  const limit = limitParam(req, 25, 100);
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  const status = ['active', 'banned'].includes(req.query.status) ? req.query.status : null;
  const like = `%${escapeLike(q)}%`;
  const rows = all(
    `SELECT * FROM users WHERE id < ? AND (? IS NULL OR status = ?) AND (? = '' OR username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT ?`,
    cursorParam(req), status, status, q, like, like, like, limit + 1,
  );
  const page = rows.slice(0, limit);
  res.json({ items: page.map(adminUser), nextCursor: rows.length > limit ? page[page.length - 1].id : null });
});

function userTarget(req) {
  const u = get('SELECT * FROM users WHERE id = ?', intParam(req.params.id));
  if (!u) throw notFound('المستخدم غير موجود');
  return u;
}

r.post('/users/:id/ban', wrap(async (req, res) => {
  const u = userTarget(req);
  if (u.id === req.user.id) throw badRequest('self', 'لا يمكنك حظر حسابك');
  if (u.role === 'admin') throw forbidden('لا يمكن حظر مسؤول. أزل صلاحيته أولًا');
  const reason = validateText(req.body?.reason, 200, 'سبب الحظر');
  tx(() => {
    run("UPDATE users SET status = 'banned', ban_reason = ? WHERE id = ?", reason || null, u.id);
    destroyUserSessions(u.id);
    audit(req.user.id, 'user.ban', 'user', u.id, reason);
  });
  res.json({ user: adminUser(get('SELECT * FROM users WHERE id = ?', u.id)) });
}));
r.post('/users/:id/unban', wrap(async (req, res) => {
  const u = userTarget(req);
  run("UPDATE users SET status = 'active', ban_reason = NULL WHERE id = ?", u.id);
  audit(req.user.id, 'user.unban', 'user', u.id);
  res.json({ user: adminUser(get('SELECT * FROM users WHERE id = ?', u.id)) });
}));
r.post('/users/:id/role', wrap(async (req, res) => {
  const u = userTarget(req);
  const role = req.body?.role;
  if (!['user', 'admin'].includes(role)) throw badRequest('bad_role', 'دور غير صالح');
  if (u.role === 'admin' && role === 'user' && get("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND status = 'active'").c <= 1) {
    throw conflict('last_admin', 'لا يمكن إزالة صلاحية آخر مسؤول');
  }
  if (role === 'admin' && !u.email_verified) throw badRequest('unverified', 'لا يمكن ترقية حساب لم يؤكد بريده');
  run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
  audit(req.user.id, 'user.role', 'user', u.id, role);
  res.json({ user: adminUser(get('SELECT * FROM users WHERE id = ?', u.id)) });
}));
r.delete('/users/:id', wrap(async (req, res) => {
  const u = userTarget(req);
  if (u.id === req.user.id) throw badRequest('self', 'لا يمكنك حذف حسابك من هنا');
  if (u.role === 'admin') throw forbidden('لا يمكن حذف مسؤول. أزل صلاحيته أولًا');
  await deleteUser(u.id);
  audit(req.user.id, 'user.delete', 'user', u.id, u.username);
  res.json({ ok: true });
}));

r.get('/posts', wrap(async (req, res) => {
  const limit = limitParam(req, 20, 50);
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  const kind = ['image', 'video'].includes(req.query.kind) ? req.query.kind : null;
  const like = `%${escapeLike(q)}%`;
  const rows = all(
    `${POST_SELECT} WHERE p.id < ? AND (? IS NULL OR p.kind = ?) AND (? = '' OR p.caption LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\') ORDER BY p.id DESC LIMIT ?`,
    cursorParam(req), kind, kind, q, like, like, limit + 1,
  );
  const page = rows.slice(0, limit);
  res.json({ items: hydratePosts(page, req.user.id), nextCursor: rows.length > limit ? page[page.length - 1].id : null });
}));
r.delete('/posts/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  if (!(await deletePost(id))) throw notFound('المنشور غير موجود');
  audit(req.user.id, 'post.delete', 'post', id);
  res.json({ ok: true });
}));
r.delete('/comments/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  if (!run('DELETE FROM comments WHERE id = ?', id).changes) throw notFound('التعليق غير موجود');
  audit(req.user.id, 'comment.delete', 'comment', id);
  res.json({ ok: true });
}));

// ---- البلاغات ----
function reportTarget(rep) {
  if (rep.target_type === 'post') {
    const p = get(`${POST_SELECT} WHERE p.id = ?`, rep.target_id);
    if (!p) return null;
    const post = hydratePosts([p], null)[0];
    return { kind: 'post', id: p.id, text: post.caption.slice(0, 160), media: post.media[0] ? (post.media[0].thumb || post.media[0].poster) : null, mediaType: post.kind, author: post.author.username };
  }
  if (rep.target_type === 'comment') {
    const c = get('SELECT c.id, c.body, c.post_id, u.username FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?', rep.target_id);
    return c ? { kind: 'comment', id: c.id, text: c.body.slice(0, 160), postId: c.post_id, author: c.username } : null;
  }
  const u = get('SELECT * FROM users WHERE id = ?', rep.target_id);
  return u ? { kind: 'user', id: u.id, text: u.bio.slice(0, 160), author: u.username, banned: u.status === 'banned' } : null;
}

r.get('/reports', (req, res) => {
  const limit = limitParam(req, 20, 50);
  const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : null;
  const rows = all(
    `SELECT r.*, u.username AS reporter FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.id < ? AND (? IS NULL OR r.status = ?) ORDER BY r.id DESC LIMIT ?`,
    cursorParam(req), status, status, limit + 1,
  );
  const page = rows.slice(0, limit);
  res.json({
    items: page.map((x) => ({
      id: x.id, targetType: x.target_type, targetId: x.target_id, reason: x.reason, details: x.details, status: x.status,
      reporter: x.reporter, createdAt: x.created_at, resolvedAt: x.resolved_at, resolution: x.resolution, target: reportTarget(x),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  });
});

r.post('/reports/:id/resolve', wrap(async (req, res) => {
  const rep = get('SELECT * FROM reports WHERE id = ?', intParam(req.params.id));
  if (!rep) throw notFound('البلاغ غير موجود');
  const action = req.body?.action;
  const note = validateText(req.body?.note, 300, 'الملاحظة');
  if (!['dismiss', 'remove_content', 'ban_user'].includes(action)) throw badRequest('bad_action', 'إجراء غير صالح');

  let status = 'resolved';
  let resolution = note;
  if (action === 'dismiss') {
    status = 'dismissed';
    resolution = resolution || 'تم تجاهل البلاغ';
  } else if (action === 'remove_content') {
    if (rep.target_type === 'user') throw badRequest('bad_action', 'لا يمكن حذف محتوى مستخدم من بلاغ على حساب؛ استخدم حظر المستخدم');
    if (rep.target_type === 'post') await deletePost(rep.target_id);
    else run('DELETE FROM comments WHERE id = ?', rep.target_id);
    audit(req.user.id, `${rep.target_type}.delete`, rep.target_type, rep.target_id, `report #${rep.id}`);
    resolution = resolution || 'تم حذف المحتوى';
  } else {
    let uid = rep.target_id;
    if (rep.target_type === 'post') uid = get('SELECT user_id FROM posts WHERE id = ?', rep.target_id)?.user_id;
    if (rep.target_type === 'comment') uid = get('SELECT user_id FROM comments WHERE id = ?', rep.target_id)?.user_id;
    const u = uid && get('SELECT * FROM users WHERE id = ?', uid);
    if (!u) throw notFound('صاحب المحتوى غير موجود');
    if (u.role === 'admin') throw forbidden('لا يمكن حظر مسؤول');
    tx(() => {
      run("UPDATE users SET status = 'banned', ban_reason = ? WHERE id = ?", note || 'مخالفة سياسة المحتوى', u.id);
      destroyUserSessions(u.id);
      audit(req.user.id, 'user.ban', 'user', u.id, `report #${rep.id}`);
    });
    resolution = resolution || 'تم حظر المستخدم';
  }
  // نغلق كل البلاغات المفتوحة على نفس الهدف
  run(`UPDATE reports SET status = ?, resolved_by = ?, resolved_at = ?, resolution = ? WHERE status = 'open' AND target_type = ? AND target_id = ? OR id = ?`,
    status, req.user.id, now(), resolution, rep.target_type, rep.target_id, rep.id);
  audit(req.user.id, `report.${action}`, 'report', rep.id, note || null);
  res.json({ ok: true });
}));

r.get('/audit', (req, res) => {
  const rows = all(
    `SELECT a.*, u.username AS admin FROM audit_log a LEFT JOIN users u ON u.id = a.admin_id WHERE a.id < ? ORDER BY a.id DESC LIMIT 50`,
    cursorParam(req),
  );
  res.json({ items: rows.map((a) => ({ id: a.id, admin: a.admin, action: a.action, targetType: a.target_type, targetId: a.target_id, details: a.details, createdAt: a.created_at })) });
});

export default r;
