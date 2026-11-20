import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { all, get, run, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound, wrap } from '../errors.js';
import { notify, unnotify } from '../content.js';
import { processAvatar, processCover } from '../media.js';
import { cleanupTmp, storage } from '../storage.js';
import { hydratePosts, isBlocked, meUser, pagePosts, POST_SELECT, profileUser, publicUser, visible } from '../serialize.js';
import { multerErrors, singleImageUpload } from '../upload.js';
import { config } from '../config.js';
import {
  cursorParam, escapeLike, limitParam, now, validateDisplayName, validateText, validateUsername,
} from '../util.js';

const r = Router();

function targetUser(req, { allowSelf = true } = {}) {
  const u = get('SELECT * FROM users WHERE username = ?', String(req.params.username));
  if (!u || (u.status === 'banned' && req.user?.role !== 'admin')) throw notFound('المستخدم غير موجود');
  if (req.user && u.id !== req.user.id && isBlocked(req.user.id, u.id) && req.user.role !== 'admin') throw notFound('المستخدم غير موجود');
  if (!allowSelf && req.user && u.id === req.user.id) throw badRequest('self', 'لا يمكنك تنفيذ هذا الإجراء على حسابك');
  return u;
}

// ---- حسابي ----
r.patch('/me', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.displayName !== undefined) { sets.push('display_name = ?'); vals.push(validateDisplayName(b.displayName)); }
  if (b.bio !== undefined) { sets.push('bio = ?'); vals.push(validateText(b.bio, config.limits.bioLength, 'النبذة')); }
  if (b.username !== undefined && b.username !== req.user.username) {
    const username = validateUsername(b.username);
    if (get('SELECT 1 FROM users WHERE username = ? AND id <> ?', username, req.user.id)) throw conflict('username_taken', 'اسم المستخدم مستخدم بالفعل');
    sets.push('username = ?'); vals.push(username);
  }
  if (sets.length) run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals, req.user.id);
  res.json({ user: meUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
}));

function imageField(column, processor) {
  return [requireAuth, singleImageUpload, wrap(async (req, res) => {
    try {
      if (!req.file) throw badRequest('no_file', 'اختر صورة أولًا');
      const key = await processor(req.file.path);
      const old = get(`SELECT ${column} AS k FROM users WHERE id = ?`, req.user.id).k;
      run(`UPDATE users SET ${column} = ? WHERE id = ?`, key, req.user.id);
      await storage.remove(old);
    } finally {
      await cleanupTmp(req.file ? [req.file] : []);
    }
    res.json({ user: meUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
  })];
}
const removeField = (column) => [requireAuth, wrap(async (req, res) => {
  const old = get(`SELECT ${column} AS k FROM users WHERE id = ?`, req.user.id).k;
  run(`UPDATE users SET ${column} = NULL WHERE id = ?`, req.user.id);
  await storage.remove(old);
  res.json({ user: meUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
})];
r.post('/me/avatar', ...imageField('avatar', processAvatar));
r.delete('/me/avatar', ...removeField('avatar'));
r.post('/me/cover', ...imageField('cover', processCover));
r.delete('/me/cover', ...removeField('cover'));

r.get('/me/blocks', requireAuth, (req, res) => {
  const rows = all('SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC', req.user.id);
  res.json({ items: rows.map(publicUser) });
});

// ---- قائمة الناس (صفحة المستخدمين) ----
r.get('/', wrap(async (req, res) => {
  const me = req.user?.id ?? -1;
  const q = String(req.query.q ?? '').trim().slice(0, 50).replace(/^@/, '');
  const limit = limitParam(req, 20, 50);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const like = `%${escapeLike(q)}%`;
  const rows = all(
    `SELECT u.* FROM users u
     WHERE u.status = 'active' AND u.id <> ?
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
       AND (? = '' OR u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')
     ORDER BY (u.username LIKE ? ESCAPE '\\') DESC, u.followers_count DESC, u.id DESC LIMIT ? OFFSET ?`,
    me, me, me, q, like, like, `${escapeLike(q)}%`, limit + 1, offset,
  );
  const items = rows.slice(0, limit);
  const following = req.user
    ? new Set(all('SELECT followee_id FROM follows WHERE follower_id = ?', me).map((x) => x.followee_id))
    : new Set();
  res.json({
    items: items.map((u) => ({ ...publicUser(u), bio: u.bio, counts: { followers: u.followers_count, posts: u.posts_count }, following: following.has(u.id) })),
    nextOffset: rows.length > limit ? offset + limit : null,
  });
}));

// ---- الملف الشخصي ----
r.get('/:username', wrap(async (req, res) => {
  const u = targetUser(req);
  const rel = req.user
    ? {
        following: !!get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', req.user.id, u.id),
        followedBy: !!get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', u.id, req.user.id),
        blocked: !!get('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, u.id),
        isMe: u.id === req.user.id,
      }
    : { following: false, followedBy: false, blocked: false, isMe: false };
  res.json({ user: profileUser(u), viewer: rel });
}));

r.get('/:username/posts', wrap(async (req, res) => {
  const u = targetUser(req);
  const limit = limitParam(req, 12, 30);
  const kind = ['image', 'video'].includes(req.query.kind) ? req.query.kind : null;
  const rows = all(`${POST_SELECT} WHERE p.user_id = ? AND p.id < ? AND (? IS NULL OR p.kind = ?) ORDER BY p.id DESC LIMIT ?`, u.id, cursorParam(req), kind, kind, limit + 1);
  res.json(pagePosts(rows, limit, req.user?.id));
}));

function userList(sql) {
  return wrap(async (req, res) => {
    const u = targetUser(req);
    const limit = limitParam(req, 20, 50);
    const rows = all(sql, u.id, cursorParam(req), limit + 1);
    const items = rows.slice(0, limit);
    const following = req.user ? new Set(all('SELECT followee_id FROM follows WHERE follower_id = ?', req.user.id).map((x) => x.followee_id)) : new Set();
    res.json({
      items: items.map((x) => ({ ...publicUser(x), bio: x.bio, following: following.has(x.id), isMe: x.id === req.user?.id })),
      nextCursor: rows.length > limit ? items[items.length - 1].fid : null,
    });
  });
}
r.get('/:username/followers', userList(`SELECT u.*, f.rowid AS fid FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? AND f.rowid < ? AND u.status = 'active' ORDER BY f.rowid DESC LIMIT ?`));
r.get('/:username/following', userList(`SELECT u.*, f.rowid AS fid FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? AND f.rowid < ? AND u.status = 'active' ORDER BY f.rowid DESC LIMIT ?`));

r.post('/:username/follow', requireAuth, wrap(async (req, res) => {
  const u = targetUser(req, { allowSelf: false });
  const ins = run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)', req.user.id, u.id, now());
  if (ins.changes) notify({ userId: u.id, actorId: req.user.id, type: 'follow' });
  res.json({ following: true, followers: get('SELECT followers_count c FROM users WHERE id = ?', u.id).c });
}));
r.delete('/:username/follow', requireAuth, wrap(async (req, res) => {
  const u = targetUser(req, { allowSelf: false });
  run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', req.user.id, u.id);
  unnotify({ userId: u.id, actorId: req.user.id, type: 'follow' });
  res.json({ following: false, followers: get('SELECT followers_count c FROM users WHERE id = ?', u.id).c });
}));

r.post('/:username/block', requireAuth, wrap(async (req, res) => {
  const u = get('SELECT * FROM users WHERE username = ?', String(req.params.username));
  if (!u) throw notFound('المستخدم غير موجود');
  if (u.id === req.user.id) throw badRequest('self', 'لا يمكنك حظر نفسك');
  if (u.role === 'admin') throw forbidden('لا يمكن حظر حساب مسؤول');
  tx(() => {
    run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)', req.user.id, u.id, now());
    run('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)', req.user.id, u.id, u.id, req.user.id);
  });
  res.json({ blocked: true });
}));
r.delete('/:username/block', requireAuth, wrap(async (req, res) => {
  const u = get('SELECT id FROM users WHERE username = ?', String(req.params.username));
  if (u) run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, u.id);
  res.json({ blocked: false });
}));

r.use(multerErrors);
export default r;
