import { all, get, placeholders } from './db.js';
import { storage } from './storage.js';
import { IMAGE_WIDTHS } from './media.js';

export const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  avatar: storage.url(u.avatar),
});

export const profileUser = (u) => ({
  ...publicUser(u),
  bio: u.bio,
  cover: storage.url(u.cover),
  counts: { followers: u.followers_count, following: u.following_count, posts: u.posts_count },
  createdAt: u.created_at,
});

export const meUser = (u) => ({
  ...profileUser(u),
  email: u.email,
  emailVerified: !!u.email_verified,
  role: u.role,
});

const [W_THUMB, W_MED, W_LARGE] = IMAGE_WIDTHS;
export function serializeMedia(m) {
  if (m.type === 'video') {
    return {
      id: m.id, type: 'video', width: m.width, height: m.height, duration: m.duration,
      url: storage.url(m.key), poster: storage.url(m.poster),
    };
  }
  const u = (w) => storage.url(`${m.key}-${w}.webp`);
  return {
    id: m.id, type: 'image', width: m.width, height: m.height,
    thumb: u(W_THUMB), medium: u(W_MED), large: u(W_LARGE),
    srcset: `${u(W_THUMB)} ${W_THUMB}w, ${u(W_MED)} ${W_MED}w, ${u(W_LARGE)} ${W_LARGE}w`,
  };
}

export const POST_SELECT = `
  SELECT p.*, u.username AS a_username, u.display_name AS a_name, u.avatar AS a_avatar
  FROM posts p JOIN users u ON u.id = p.user_id`;

/** شرط الرؤية: المستخدم نشط وليس بينه وبين المشاهِد حظر. يتطلب alias: p, u. */
export const visible = (me) => ({
  sql: `u.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = ?))`,
  params: [me ?? -1, me ?? -1],
});

export function hydratePosts(rows, me) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = placeholders(ids);
  const media = all(`SELECT * FROM post_media WHERE post_id IN (${ph}) ORDER BY post_id, position`, ...ids);
  const tags = all(`SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id IN (${ph})`, ...ids);
  const mediaBy = new Map();
  for (const m of media) (mediaBy.get(m.post_id) ?? mediaBy.set(m.post_id, []).get(m.post_id)).push(serializeMedia(m));
  const tagsBy = new Map();
  for (const t of tags) (tagsBy.get(t.post_id) ?? tagsBy.set(t.post_id, []).get(t.post_id)).push(t.name);

  let liked = new Set(), saved = new Set(), following = new Set();
  if (me) {
    liked = new Set(all(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${ph})`, me, ...ids).map((r) => r.post_id));
    saved = new Set(all(`SELECT post_id FROM saves WHERE user_id = ? AND post_id IN (${ph})`, me, ...ids).map((r) => r.post_id));
    const authors = [...new Set(rows.map((r) => r.user_id))];
    following = new Set(
      all(`SELECT followee_id FROM follows WHERE follower_id = ? AND followee_id IN (${placeholders(authors)})`, me, ...authors).map((r) => r.followee_id),
    );
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    caption: r.caption,
    tags: tagsBy.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    author: { id: r.user_id, username: r.a_username, displayName: r.a_name, avatar: storage.url(r.a_avatar) },
    media: mediaBy.get(r.id) ?? [],
    counts: { likes: r.likes_count, comments: r.comments_count, shares: r.shares_count, saves: r.saves_count, views: r.views_count },
    viewer: { liked: liked.has(r.id), saved: saved.has(r.id), following: following.has(r.user_id), isOwner: me === r.user_id },
  }));
}

export function pagePosts(rows, limit, me) {
  const hasMore = rows.length > limit;
  const items = hydratePosts(hasMore ? rows.slice(0, limit) : rows, me);
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export const isBlocked = (a, b) =>
  !!get('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', a, b, b, a);
