// طبقة قاعدة البيانات. SQLite (مدمجة في Node) للـMVP؛ كل الاستعلامات SQL قياسي تقريبًا
// وتمر عبر get/all/run/tx لتسهيل الانتقال إلى PostgreSQL لاحقًا.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'lamma.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const cache = new Map();
const stmt = (sql) => {
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = db.prepare(sql)));
  return s;
};
const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

export const get = (sql, ...p) => stmt(sql).get(...clean(p));
export const all = (sql, ...p) => stmt(sql).all(...clean(p));
export const run = (sql, ...p) => stmt(sql).run(...clean(p));
export const placeholders = (arr) => arr.map(() => '?').join(',');

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const counterTriggers = (table, parent, counter, parentKey) => `
  CREATE TRIGGER ${table}_ai AFTER INSERT ON ${table} BEGIN
    UPDATE ${parent} SET ${counter} = ${counter} + 1 WHERE id = NEW.${parentKey};
  END;
  CREATE TRIGGER ${table}_ad AFTER DELETE ON ${table} BEGIN
    UPDATE ${parent} SET ${counter} = MAX(${counter} - 1, 0) WHERE id = OLD.${parentKey};
  END;`;

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    avatar TEXT,
    cover TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
    ban_reason TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    followers_count INTEGER NOT NULL DEFAULT 0,
    following_count INTEGER NOT NULL DEFAULT 0,
    posts_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER
  );
  CREATE INDEX users_created ON users(created_at);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE TABLE login_attempts (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX login_attempts_key ON login_attempts(key, created_at);

  CREATE TABLE follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
  );
  CREATE INDEX follows_followee ON follows(followee_id, created_at);

  CREATE TABLE blocks (
    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
  );
  CREATE INDEX blocks_blocked ON blocks(blocked_id);

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caption TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('image','video')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    likes_count INTEGER NOT NULL DEFAULT 0,
    comments_count INTEGER NOT NULL DEFAULT 0,
    shares_count INTEGER NOT NULL DEFAULT 0,
    saves_count INTEGER NOT NULL DEFAULT 0,
    views_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX posts_user ON posts(user_id, id);
  CREATE INDEX posts_kind ON posts(kind, id);

  CREATE TABLE post_media (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('image','video')),
    key TEXT NOT NULL,
    poster TEXT,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    duration REAL,
    size_bytes INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX post_media_post ON post_media(post_id, position);

  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE post_tags (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
  );
  CREATE INDEX post_tags_tag ON post_tags(tag_id, post_id);

  CREATE TABLE likes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE INDEX likes_user ON likes(user_id, created_at);

  CREATE TABLE saves (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE INDEX saves_user ON saves(user_id, created_at);

  CREATE TABLE shares (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );

  CREATE TABLE views (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    viewer TEXT NOT NULL,
    day INTEGER NOT NULL,
    PRIMARY KEY (post_id, viewer, day)
  );

  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX comments_post ON comments(post_id, id);
  CREATE INDEX comments_parent ON comments(parent_id);

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('like','comment','reply','follow')),
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX notifications_user ON notifications(user_id, id);

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('post','comment','user')),
    target_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
    created_at INTEGER NOT NULL,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_at INTEGER,
    resolution TEXT,
    UNIQUE (reporter_id, target_type, target_id)
  );
  CREATE INDEX reports_status ON reports(status, id);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    details TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  ` +
    counterTriggers('likes', 'posts', 'likes_count', 'post_id') +
    counterTriggers('comments', 'posts', 'comments_count', 'post_id') +
    counterTriggers('saves', 'posts', 'saves_count', 'post_id') +
    counterTriggers('shares', 'posts', 'shares_count', 'post_id') +
    `
  CREATE TRIGGER views_ai AFTER INSERT ON views BEGIN
    UPDATE posts SET views_count = views_count + 1 WHERE id = NEW.post_id;
  END;
  CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
    UPDATE users SET posts_count = posts_count + 1 WHERE id = NEW.user_id;
  END;
  CREATE TRIGGER posts_ad AFTER DELETE ON posts BEGIN
    UPDATE users SET posts_count = MAX(posts_count - 1, 0) WHERE id = OLD.user_id;
  END;
  CREATE TRIGGER follows_ai AFTER INSERT ON follows BEGIN
    UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.followee_id;
    UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  END;
  CREATE TRIGGER follows_ad AFTER DELETE ON follows BEGIN
    UPDATE users SET followers_count = MAX(followers_count - 1, 0) WHERE id = OLD.followee_id;
    UPDATE users SET following_count = MAX(following_count - 1, 0) WHERE id = OLD.follower_id;
  END;
  `,
];

export function migrate() {
  const current = get('PRAGMA user_version').user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
migrate();
