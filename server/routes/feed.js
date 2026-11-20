import { Router } from 'express';
import { all, get } from '../db.js';
import { notFound, wrap } from '../errors.js';
import { hydratePosts, pagePosts, POST_SELECT, publicUser, visible } from '../serialize.js';
import { cursorParam, DAY, escapeLike, intParam, limitParam, now } from '../util.js';
import { requireAuth } from '../auth.js';

const r = Router();

// الخلاصة: scope=following (متابَعون + أنا) أو latest (أحدث ما نُشر)
r.get('/feed', wrap(async (req, res) => {
  const me = req.user?.id;
  const limit = limitParam(req, 8, 20);
  const v = visible(me);
  const scope = req.query.scope === 'latest' || !me ? 'latest' : 'following';
  const followClause = scope === 'following'
    ? 'AND (p.user_id = ? OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))'
    : 'AND ? IS NOT NULL AND ? IS NOT NULL';
  const rows = all(
    `${POST_SELECT} WHERE p.id < ? AND ${v.sql} ${followClause} ORDER BY p.id DESC LIMIT ?`,
    cursorParam(req), ...v.params, scope === 'following' ? me : 1, scope === 'following' ? me : 1, limit + 1,
  );
  res.json({ ...pagePosts(rows, limit, me), scope });
}));

// الفيديوهات المتتابعة. first=<id> يضع فيديو محددًا أولًا (للروابط المباشرة)
r.get('/videos', wrap(async (req, res) => {
  const me = req.user?.id;
  const limit = limitParam(req, 6, 15);
  const v = visible(me);
  const cursor = cursorParam(req);
  const first = req.query.first && cursor === Number.MAX_SAFE_INTEGER ? intParam(req.query.first, 'first') : null;
  let pinned = [];
  if (first) pinned = all(`${POST_SELECT} WHERE p.id = ? AND p.kind = 'video' AND ${v.sql}`, first, ...v.params);
  const rows = all(
    `${POST_SELECT} WHERE p.kind = 'video' AND p.id < ? AND p.id <> ? AND ${v.sql} ORDER BY p.id DESC LIMIT ?`,
    cursor, first ?? -1, ...v.params, limit + 1,
  );
  const hasMore = rows.length > limit;
  const items = hydratePosts([...pinned, ...(hasMore ? rows.slice(0, limit) : rows)], me);
  res.json({ items, nextCursor: hasMore ? items[items.length - 1].id : null });
}));

r.get('/saved', requireAuth, wrap(async (req, res) => {
  const limit = limitParam(req, 12, 30);
  const v = visible(req.user.id);
  const cursor = req.query.cursor ? Number(req.query.cursor) : Number.MAX_SAFE_INTEGER;
  // مؤشر الصفحة هو rowid في جدول saves حتى تظهر المحفوظات بترتيب الحفظ (الأحدث أولًا)
  const rows = all(
    `SELECT p.*, u.username AS a_username, u.display_name AS a_name, u.avatar AS a_avatar, s.rowid AS save_rid
     FROM saves s JOIN posts p ON p.id = s.post_id JOIN users u ON u.id = p.user_id
     WHERE s.user_id = ? AND s.rowid < ? AND ${v.sql} ORDER BY s.rowid DESC LIMIT ?`,
    req.user.id, cursor, ...v.params, limit + 1,
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  res.json({ items: hydratePosts(page, req.user.id), nextCursor: hasMore ? page[page.length - 1].save_rid : null });
}));

// ---------- استكشاف ----------
r.get('/explore', wrap(async (req, res) => {
  const me = req.user?.id;
  const since = now() - 14 * DAY;
  const tags = all(
    `SELECT t.name, COUNT(*) AS posts FROM post_tags pt
     JOIN tags t ON t.id = pt.tag_id JOIN posts p ON p.id = pt.post_id JOIN users u ON u.id = p.user_id
     WHERE p.created_at > ? AND u.status = 'active' GROUP BY t.id ORDER BY posts DESC, t.id DESC LIMIT 12`,
    since,
  );
  const sug = all(
    `SELECT u.* FROM users u WHERE u.status = 'active' AND u.id <> ?
       AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
     ORDER BY u.followers_count DESC, u.posts_count DESC, u.id DESC LIMIT 8`,
    me ?? -1, me ?? -1, me ?? -1, me ?? -1,
  );
  res.json({
    trendingTags: tags,
    suggestedUsers: sug.map((u) => ({ ...publicUser(u), bio: u.bio, counts: { followers: u.followers_count, posts: u.posts_count }, following: false })),
  });
}));

// المنشورات الأكثر تفاعلًا (مرتبة بدرجة التفاعل ثم الأحدث)
r.get('/explore/posts', wrap(async (req, res) => {
  const me = req.user?.id;
  const limit = limitParam(req, 12, 30);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const kind = ['image', 'video'].includes(req.query.kind) ? req.query.kind : null;
  const v = visible(me);
  const rows = all(
    `${POST_SELECT} WHERE ${v.sql} AND (? IS NULL OR p.kind = ?)
     ORDER BY (p.likes_count * 2 + p.comments_count * 3 + p.shares_count * 4 + p.saves_count * 2 + p.views_count * 0.2) DESC, p.id DESC LIMIT ? OFFSET ?`,
    ...v.params, kind, kind, limit + 1, offset,
  );
  const hasMore = rows.length > limit;
  res.json({ items: hydratePosts(hasMore ? rows.slice(0, limit) : rows, me), nextOffset: hasMore ? offset + limit : null });
}));

r.get('/tags/:tag/posts', wrap(async (req, res) => {
  const me = req.user?.id;
  const limit = limitParam(req, 12, 30);
  const v = visible(me);
  const tag = get('SELECT * FROM tags WHERE name = ?', String(req.params.tag).replace(/^#/, ''));
  if (!tag) throw notFound('الوسم غير موجود');
  const rows = all(
    `${POST_SELECT} JOIN post_tags pt ON pt.post_id = p.id AND pt.tag_id = ? WHERE p.id < ? AND ${v.sql} ORDER BY p.id DESC LIMIT ?`,
    tag.id, cursorParam(req), ...v.params, limit + 1,
  );
  res.json({ tag: tag.name, ...pagePosts(rows, limit, me) });
}));

// ---------- البحث ----------
r.get('/search', wrap(async (req, res) => {
  const me = req.user?.id;
  const q = String(req.query.q ?? '').trim().slice(0, 80).replace(/^[@#]/, '');
  const type = ['users', 'posts', 'tags'].includes(req.query.type) ? req.query.type : 'users';
  if (q.length < 1) return res.json({ items: [], nextOffset: null });
  const limit = limitParam(req, 15, 30);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const like = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;

  if (type === 'users') {
    const rows = all(
      `SELECT u.* FROM users u WHERE u.status = 'active' AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
       ORDER BY (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\') DESC, u.followers_count DESC, u.id LIMIT ? OFFSET ?`,
      like, like, me ?? -1, me ?? -1, prefix, prefix, limit + 1, offset,
    );
    const following = me ? new Set(all('SELECT followee_id FROM follows WHERE follower_id = ?', me).map((x) => x.followee_id)) : new Set();
    return res.json({
      items: rows.slice(0, limit).map((u) => ({ ...publicUser(u), bio: u.bio, counts: { followers: u.followers_count, posts: u.posts_count }, following: following.has(u.id), isMe: u.id === me })),
      nextOffset: rows.length > limit ? offset + limit : null,
    });
  }
  if (type === 'tags') {
    const rows = all(
      `SELECT t.name, COUNT(p.id) AS posts FROM tags t JOIN post_tags pt ON pt.tag_id = t.id JOIN posts p ON p.id = pt.post_id JOIN users u ON u.id = p.user_id
       WHERE t.name LIKE ? ESCAPE '\\' AND u.status = 'active' GROUP BY t.id ORDER BY (t.name LIKE ? ESCAPE '\\') DESC, posts DESC LIMIT ? OFFSET ?`,
      like, prefix, limit + 1, offset,
    );
    return res.json({ items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null });
  }
  const v = visible(me);
  const rows = all(
    `${POST_SELECT} WHERE ${v.sql} AND p.caption LIKE ? ESCAPE '\\' ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    ...v.params, like, limit + 1, offset,
  );
  const hasMore = rows.length > limit;
  res.json({ items: hydratePosts(hasMore ? rows.slice(0, limit) : rows, me), nextOffset: hasMore ? offset + limit : null });
}));

export default r;
