// منطق مشترك بين مسارات المستخدم ولوحة الإدارة: حذف المحتوى مع ملفاته، الإشعارات، التدقيق.
import { all, get, run, tx, placeholders } from './db.js';
import { mediaFileKeys } from './media.js';
import { storage } from './storage.js';
import { now } from './util.js';

export function notify({ userId, actorId, type, postId = null, commentId = null }) {
  if (userId === actorId) return;
  if (type === 'like' || type === 'follow') {
    const dup = get(
      'SELECT 1 FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND post_id IS ?',
      userId, actorId, type, postId,
    );
    if (dup) return;
  }
  run('INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, created_at) VALUES (?,?,?,?,?,?)', userId, actorId, type, postId, commentId, now());
}
export const unnotify = ({ userId, actorId, type, postId = null }) =>
  run('DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND post_id IS ?', userId, actorId, type, postId);

export const audit = (adminId, action, targetType, targetId, details = null) =>
  run('INSERT INTO audit_log (admin_id, action, target_type, target_id, details, created_at) VALUES (?,?,?,?,?,?)', adminId, action, targetType, targetId, details, now());

export function postFileKeys(postIds) {
  if (!postIds.length) return [];
  const media = all(`SELECT * FROM post_media WHERE post_id IN (${placeholders(postIds)})`, ...postIds);
  return media.flatMap(mediaFileKeys);
}

export async function deletePost(postId) {
  const keys = postFileKeys([postId]);
  const r = run('DELETE FROM posts WHERE id = ?', postId);
  await storage.removeMany(keys);
  return r.changes > 0;
}

export async function deleteUser(userId) {
  const u = get('SELECT avatar, cover FROM users WHERE id = ?', userId);
  if (!u) return false;
  const postIds = all('SELECT id FROM posts WHERE user_id = ?', userId).map((r) => r.id);
  const keys = [...postFileKeys(postIds), u.avatar, u.cover];
  tx(() => {
    // التقارير التي كان هذا المستخدم هدفها تُغلق لأن المحتوى سيُحذف
    run(`UPDATE reports SET status = 'resolved', resolved_at = ?, resolution = 'تم حذف الحساب' WHERE status = 'open' AND target_type = 'user' AND target_id = ?`, now(), userId);
    run('DELETE FROM users WHERE id = ?', userId);
  });
  await storage.removeMany(keys);
  return true;
}

/** يحفظ الوسوم لمنشور (استبدال كامل). */
export function setPostTags(postId, tags) {
  run('DELETE FROM post_tags WHERE post_id = ?', postId);
  for (const name of tags) {
    run('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
    const t = get('SELECT id FROM tags WHERE name = ?', name);
    run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?,?)', postId, t.id);
  }
}
