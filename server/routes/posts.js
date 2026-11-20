import { Router } from 'express';
import { requireAuth, requireVerified } from '../auth.js';
import { config } from '../config.js';
import { all, get, run, tx } from '../db.js';
import { badRequest, forbidden, notFound, wrap } from '../errors.js';
import { deletePost, notify, setPostTags, unnotify } from '../content.js';
import { processPostImage, processPostVideo } from '../media.js';
import { rateLimit } from '../ratelimit.js';
import { cleanupTmp, storage } from '../storage.js';
import { hydratePosts, isBlocked, POST_SELECT, publicUser, visible } from '../serialize.js';
import { multerErrors, postUpload } from '../upload.js';
import { clientIp, cursorParam, DAY, extractTags, intParam, limitParam, now, sha256, validateText } from '../util.js';
import { mediaFileKeys } from '../media.js';

const r = Router();
const uploadLimit = rateLimit({ windowMs: 3600e3, max: config.rate.uploadsPerHour, key: (req) => `u${req.user.id}`, message: 'وصلت الحد الأقصى من المنشورات في الساعة' });
const actionLimit = rateLimit({ windowMs: 60e3, max: 120, key: (req) => `a${req.user?.id ?? clientIp(req)}`, message: 'تفاعلات كثيرة بسرعة، انتظر قليلًا' });
const commentLimit = rateLimit({ windowMs: 60e3, max: 20, key: (req) => `c${req.user.id}`, message: 'تعليقات كثيرة بسرعة، انتظر قليلًا' });

/** يجلب منشورًا يستطيع المشاهد رؤيته أو يرمي 404. */
function loadPost(req, id = intParam(req.params.id)) {
  const v = visible(req.user?.id);
  const row = get(`${POST_SELECT} WHERE p.id = ? AND ${v.sql}`, id, ...v.params);
  if (!row) throw notFound('المنشور غير موجود');
  return row;
}
const ownerOrThrow = (req, post) => {
  if (post.user_id !== req.user.id) throw forbidden('يمكن لصاحب المنشور فقط تنفيذ هذا الإجراء');
};

// ---------- إنشاء منشور ----------
r.post('/', requireAuth, requireVerified, uploadLimit, postUpload, wrap(async (req, res) => {
  const files = req.files || [];
  const created = [];
  try {
    if (!files.length) throw badRequest('no_media', 'أضف صورة أو فيديو واحدًا على الأقل');
    const caption = validateText(req.body.caption, config.limits.captionLength, 'الوصف');
    let explicitTags = [];
    if (req.body.tags) {
      try { explicitTags = Array.isArray(req.body.tags) ? req.body.tags : JSON.parse(req.body.tags); } catch { explicitTags = String(req.body.tags).split(/[,،\s]+/); }
      if (!Array.isArray(explicitTags)) explicitTags = [];
    }
    const tags = extractTags(caption, explicitTags);

    const videos = files.filter((f) => f.mimetype.startsWith('video/'));
    if (videos.length && files.length > 1) throw badRequest('mixed_media', 'يمكن نشر فيديو واحد، أو مجموعة صور، ولا يمكن الجمع بينهما');
    if (videos.length) {
      if (videos[0].size > config.limits.videoBytes) throw badRequest('file_too_large', `حجم الفيديو يتجاوز ${config.limits.videoBytes / 1048576}MB`);
      created.push(await processPostVideo(videos[0].path));
    } else {
      for (const f of files) {
        if (f.size > config.limits.imageBytes) throw badRequest('file_too_large', `حجم الصورة يتجاوز ${config.limits.imageBytes / 1048576}MB`);
        created.push(await processPostImage(f.path));
      }
    }

    const kind = created[0].type;
    const id = tx(() => {
      const t = now();
      const pid = Number(run('INSERT INTO posts (user_id, caption, kind, created_at, updated_at) VALUES (?,?,?,?,?)', req.user.id, caption, kind, t, t).lastInsertRowid);
      created.forEach((m, i) =>
        run('INSERT INTO post_media (post_id, position, type, key, poster, width, height, duration, size_bytes) VALUES (?,?,?,?,?,?,?,?,?)',
          pid, i, m.type, m.key, m.poster, m.width, m.height, m.duration, m.size_bytes));
      setPostTags(pid, tags);
      return pid;
    });
    created.length = 0; // نجح الحفظ: لا حذف للملفات
    const row = get(`${POST_SELECT} WHERE p.id = ?`, id);
    res.status(201).json({ post: hydratePosts([row], req.user.id)[0] });
  } catch (e) {
    await storage.removeMany(created.flatMap(mediaFileKeys)); // تنظيف ما كُتب قبل الفشل
    throw e;
  } finally {
    await cleanupTmp(files);
  }
}));

// ---------- قراءة / تعديل / حذف ----------
r.get('/:id', wrap(async (req, res) => {
  res.json({ post: hydratePosts([loadPost(req)], req.user?.id)[0] });
}));

r.patch('/:id', requireAuth, wrap(async (req, res) => {
  const post = loadPost(req);
  ownerOrThrow(req, post);
  const caption = validateText(req.body?.caption, config.limits.captionLength, 'الوصف');
  const tags = extractTags(caption, Array.isArray(req.body?.tags) ? req.body.tags : []);
  tx(() => {
    run('UPDATE posts SET caption = ?, updated_at = ? WHERE id = ?', caption, now(), post.id);
    setPostTags(post.id, tags);
  });
  res.json({ post: hydratePosts([get(`${POST_SELECT} WHERE p.id = ?`, post.id)], req.user.id)[0] });
}));

r.delete('/:id', requireAuth, wrap(async (req, res) => {
  const post = loadPost(req);
  ownerOrThrow(req, post);
  await deletePost(post.id);
  res.json({ ok: true });
}));

// ---------- إعجاب / حفظ / مشاركة / مشاهدة ----------
function toggle(table, notifType) {
  const counterOf = { likes: 'likes_count', saves: 'saves_count' }[table];
  return {
    add: wrap(async (req, res) => {
      const post = loadPost(req);
      const ins = run(`INSERT OR IGNORE INTO ${table} (post_id, user_id, created_at) VALUES (?,?,?)`, post.id, req.user.id, now());
      if (ins.changes && notifType) notify({ userId: post.user_id, actorId: req.user.id, type: notifType, postId: post.id });
      res.json({ active: true, count: get(`SELECT ${counterOf} c FROM posts WHERE id = ?`, post.id).c });
    }),
    remove: wrap(async (req, res) => {
      const post = loadPost(req);
      run(`DELETE FROM ${table} WHERE post_id = ? AND user_id = ?`, post.id, req.user.id);
      if (notifType) unnotify({ userId: post.user_id, actorId: req.user.id, type: notifType, postId: post.id });
      res.json({ active: false, count: get(`SELECT ${counterOf} c FROM posts WHERE id = ?`, post.id).c });
    }),
  };
}
const likes = toggle('likes', 'like');
const saves = toggle('saves', null);
r.post('/:id/like', requireAuth, actionLimit, likes.add);
r.delete('/:id/like', requireAuth, actionLimit, likes.remove);
r.post('/:id/save', requireAuth, actionLimit, saves.add);
r.delete('/:id/save', requireAuth, actionLimit, saves.remove);

r.post('/:id/share', requireAuth, actionLimit, wrap(async (req, res) => {
  const post = loadPost(req);
  run('INSERT OR IGNORE INTO shares (post_id, user_id, created_at) VALUES (?,?,?)', post.id, req.user.id, now());
  res.json({ count: get('SELECT shares_count c FROM posts WHERE id = ?', post.id).c });
}));

// عدّاد المشاهدات: مرة واحدة لكل مشاهِد (حساب أو IP) يوميًا، ولا يُحتسب مالك المنشور
r.post('/:id/view', actionLimit, wrap(async (req, res) => {
  const post = loadPost(req);
  if (post.kind === 'video' && post.user_id !== req.user?.id) {
    const viewer = req.user ? `u${req.user.id}` : `ip${sha256(clientIp(req)).slice(0, 16)}`;
    run('INSERT OR IGNORE INTO views (post_id, viewer, day) VALUES (?,?,?)', post.id, viewer, Math.floor(now() / DAY));
  }
  res.json({ views: get('SELECT views_count c FROM posts WHERE id = ?', post.id).c });
}));

// ---------- التعليقات ----------
function serializeComment(c, me) {
  return {
    id: c.id, postId: c.post_id, parentId: c.parent_id, body: c.body, createdAt: c.created_at,
    author: { id: c.user_id, username: c.a_username, displayName: c.a_name, avatar: storage.url(c.a_avatar) },
    canDelete: !!me && (c.user_id === me.id || c.post_owner === me.id || me.role === 'admin'),
  };
}
const COMMENT_SELECT = `
  SELECT c.*, u.username AS a_username, u.display_name AS a_name, u.avatar AS a_avatar, p.user_id AS post_owner
  FROM comments c JOIN users u ON u.id = c.user_id JOIN posts p ON p.id = c.post_id`;
const hiddenAuthors = (me) => `u.status = 'active' AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${me} AND b.blocked_id = c.user_id) OR (b.blocker_id = c.user_id AND b.blocked_id = ${me}))`;

r.get('/:id/comments', wrap(async (req, res) => {
  const post = loadPost(req);
  const limit = limitParam(req, 15, 40);
  const me = req.user?.id ?? -1;
  const top = all(`${COMMENT_SELECT} WHERE c.post_id = ? AND c.parent_id IS NULL AND c.id < ? AND ${hiddenAuthors(me)} ORDER BY c.id DESC LIMIT ?`, post.id, cursorParam(req), limit + 1);
  const page = top.slice(0, limit);
  let replies = [];
  if (page.length) {
    const ids = page.map((c) => c.id);
    replies = all(`${COMMENT_SELECT} WHERE c.parent_id IN (${ids.map(() => '?').join(',')}) AND ${hiddenAuthors(me)} ORDER BY c.id ASC`, ...ids);
  }
  res.json({
    items: page.map((c) => ({ ...serializeComment(c, req.user), replies: replies.filter((x) => x.parent_id === c.id).map((x) => serializeComment(x, req.user)) })),
    nextCursor: top.length > limit ? page[page.length - 1].id : null,
    total: post.comments_count,
  });
}));

r.post('/:id/comments', requireAuth, requireVerified, commentLimit, wrap(async (req, res) => {
  const post = loadPost(req);
  const body = validateText(req.body?.body, config.limits.commentLength, 'التعليق', { required: true });
  let parent = null;
  if (req.body?.parentId) {
    parent = get('SELECT * FROM comments WHERE id = ? AND post_id = ?', intParam(req.body.parentId, 'parentId'), post.id);
    if (!parent) throw notFound('التعليق الذي ترد عليه غير موجود');
    if (isBlocked(req.user.id, parent.user_id)) throw forbidden();
    // الردود بمستوى واحد: الرد على رد يُربط بالتعليق الأصلي
    if (parent.parent_id) parent = get('SELECT * FROM comments WHERE id = ?', parent.parent_id);
  }
  const id = Number(run('INSERT INTO comments (post_id, user_id, parent_id, body, created_at) VALUES (?,?,?,?,?)', post.id, req.user.id, parent?.id ?? null, body, now()).lastInsertRowid);
  if (parent) {
    notify({ userId: parent.user_id, actorId: req.user.id, type: 'reply', postId: post.id, commentId: id });
    if (post.user_id !== parent.user_id) notify({ userId: post.user_id, actorId: req.user.id, type: 'comment', postId: post.id, commentId: id });
  } else {
    notify({ userId: post.user_id, actorId: req.user.id, type: 'comment', postId: post.id, commentId: id });
  }
  const c = get(`${COMMENT_SELECT} WHERE c.id = ?`, id);
  res.status(201).json({ comment: { ...serializeComment(c, req.user), replies: [] }, count: get('SELECT comments_count c FROM posts WHERE id = ?', post.id).c });
}));

export const commentsRouter = Router();
commentsRouter.delete('/:id', requireAuth, wrap(async (req, res) => {
  const c = get(`${COMMENT_SELECT} WHERE c.id = ?`, intParam(req.params.id));
  if (!c) throw notFound('التعليق غير موجود');
  if (c.user_id !== req.user.id && c.post_owner !== req.user.id && req.user.role !== 'admin') throw forbidden();
  run('DELETE FROM comments WHERE id = ?', c.id);
  res.json({ ok: true, count: get('SELECT comments_count c FROM posts WHERE id = ?', c.post_id)?.c ?? 0 });
}));

r.use(multerErrors);
export default r;
