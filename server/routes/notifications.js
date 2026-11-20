import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { all, get, run } from '../db.js';
import { wrap } from '../errors.js';
import { storage } from '../storage.js';
import { cursorParam, intParam, limitParam, now } from '../util.js';

const r = Router();
r.use(requireAuth);

r.get('/', wrap(async (req, res) => {
  const limit = limitParam(req, 20, 50);
  const rows = all(
    `SELECT n.*, u.username AS a_username, u.display_name AS a_name, u.avatar AS a_avatar,
            c.body AS comment_body,
            (SELECT pm.key FROM post_media pm WHERE pm.post_id = n.post_id ORDER BY pm.position LIMIT 1) AS m_key,
            (SELECT pm.poster FROM post_media pm WHERE pm.post_id = n.post_id ORDER BY pm.position LIMIT 1) AS m_poster,
            (SELECT pm.type FROM post_media pm WHERE pm.post_id = n.post_id ORDER BY pm.position LIMIT 1) AS m_type
     FROM notifications n
     JOIN users u ON u.id = n.actor_id AND u.status = 'active'
     LEFT JOIN comments c ON c.id = n.comment_id
     WHERE n.user_id = ? AND n.id < ?
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = n.actor_id) OR (b.blocker_id = n.actor_id AND b.blocked_id = ?))
     ORDER BY n.id DESC LIMIT ?`,
    req.user.id, cursorParam(req), req.user.id, req.user.id, limit + 1,
  );
  const page = rows.slice(0, limit);
  res.json({
    items: page.map((n) => ({
      id: n.id, type: n.type, postId: n.post_id, commentId: n.comment_id, createdAt: n.created_at, read: !!n.read_at,
      commentPreview: n.comment_body ? n.comment_body.slice(0, 80) : null,
      thumb: n.m_type === 'video' ? storage.url(n.m_poster) : n.m_key ? storage.url(`${n.m_key}-320.webp`) : null,
      actor: { id: n.actor_id, username: n.a_username, displayName: n.a_name, avatar: storage.url(n.a_avatar) },
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  });
}));

r.get('/unread-count', (req, res) => {
  res.json({ count: get('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).c });
});
r.post('/read-all', (req, res) => {
  run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), req.user.id);
  res.json({ ok: true });
});
r.post('/:id/read', (req, res) => {
  run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', now(), intParam(req.params.id), req.user.id);
  res.json({ ok: true });
});

export default r;
