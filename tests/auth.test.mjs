import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startServer, newUser, makeAdmin } from './helpers.mjs';

let s;
before(async () => { s = await startServer(); });
after(async () => { await s.stop(); });

test('التسجيل: يرفض البيانات غير الصالحة', async () => {
  const c = new Client(s.base);
  const bad = async (body, code) => {
    const r = await c.post('/api/auth/signup', { email: 'x@example.com', username: 'validname', displayName: 'x', password: 'secret123', ...body });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.error.code, code);
  };
  await bad({ email: 'not-an-email' }, 'bad_email');
  await bad({ password: 'short1' }, 'weak_password');
  await bad({ password: 'onlyletters' }, 'weak_password');
  await bad({ username: 'ab' }, 'bad_username');
  await bad({ username: 'has space' }, 'bad_username');
  await bad({ username: 'admin' }, 'bad_username');
  await bad({ displayName: '   ' }, 'bad_name');
});

test('التسجيل + me + منع التكرار + تأكيد البريد', async () => {
  const c = new Client(s.base);
  let r = await c.post('/api/auth/signup', { email: 'Sara@Example.com', username: 'sara', displayName: 'سارة', password: 'secret123' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.username, 'sara');
  assert.equal(r.data.user.emailVerified, false);
  assert.equal(r.data.user.password_hash, undefined);
  assert.match(r.res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.res.headers.get('set-cookie'), /SameSite=Lax/);

  r = await c.get('/api/auth/me');
  assert.equal(r.data.user.email, 'sara@example.com');

  const dup = await new Client(s.base).post('/api/auth/signup', { email: 'sara@example.com', username: 'other', displayName: 'x', password: 'secret123' });
  assert.equal(dup.status, 409); assert.equal(dup.data.error.code, 'email_taken');
  const dup2 = await new Client(s.base).post('/api/auth/signup', { email: 'o@example.com', username: 'SARA', displayName: 'x', password: 'secret123' });
  assert.equal(dup2.status, 409); assert.equal(dup2.data.error.code, 'username_taken');

  const token = s.lastToken('sara@example.com');
  assert.ok(token, 'رسالة التأكيد يجب أن تُسجَّل في outbox');
  assert.equal((await c.post('/api/auth/verify', { token: 'wrong' })).status, 400);
  assert.equal((await c.post('/api/auth/verify', { token })).status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user.emailVerified, true);
  assert.equal((await c.post('/api/auth/verify', { token })).status, 400, 'الرمز يُستخدم مرة واحدة');
});

test('كلمة المرور لا تُخزَّن كنص صريح', async () => {
  await newUser(s, 'hashcheck');
  const d = s.sql();
  const row = d.prepare("SELECT password_hash FROM users WHERE username = 'hashcheck'").get();
  d.close();
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes('secret123'));
});

test('الدخول والخروج وإبطال الجلسة', async () => {
  await newUser(s, 'login1');
  const c = new Client(s.base);
  assert.equal((await c.post('/api/auth/login', { identifier: 'login1', password: 'bad' })).status, 401);
  let r = await c.post('/api/auth/login', { identifier: 'LOGIN1@example.com', password: 'secret123' });
  assert.equal(r.status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user.username, 'login1');
  const stale = c.cookie;
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).data.user, null);
  const old = new Client(s.base); old.cookie = stale;
  assert.equal((await old.get('/api/auth/me')).data.user, null, 'الجلسة القديمة يجب أن تنتهي من الخادم');
});

test('قفل محاولات الدخول المتكررة', async () => {
  await newUser(s, 'locky');
  const c = new Client(s.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { identifier: 'locky', password: 'wrong' + i })).status, 401);
  const r = await c.post('/api/auth/login', { identifier: 'locky', password: 'secret123' });
  assert.equal(r.status, 429, 'حتى كلمة المرور الصحيحة مرفوضة أثناء القفل');
  assert.ok(r.data.error.retryAfter > 0);
});

test('استعادة كلمة المرور تُنهي الجلسات القديمة وتعمل مرة واحدة', async () => {
  const u = await newUser(s, 'resetme');
  const r0 = await new Client(s.base).post('/api/auth/forgot', { email: 'ghost@example.com' });
  assert.equal(r0.status, 200, 'لا نكشف وجود البريد');
  assert.equal((await new Client(s.base).post('/api/auth/forgot', { email: u.email })).status, 200);
  const token = s.lastToken(u.email);
  assert.equal((await new Client(s.base).post('/api/auth/reset', { token, password: 'weak' })).status, 400);
  assert.equal((await new Client(s.base).post('/api/auth/reset', { token, password: 'brandnew99' })).status, 200);
  assert.equal((await new Client(s.base).post('/api/auth/reset', { token, password: 'another999' })).status, 400);
  assert.equal((await u.get('/api/auth/me')).data.user, null, 'الجلسة القديمة أُبطلت');
  const c = new Client(s.base);
  assert.equal((await c.post('/api/auth/login', { identifier: u.email, password: 'secret123' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { identifier: u.email, password: 'brandnew99' })).status, 200);
});

test('تغيير كلمة المرور وإدارة الجلسات', async () => {
  const u = await newUser(s, 'chpw');
  const other = new Client(s.base);
  await other.post('/api/auth/login', { identifier: 'chpw', password: 'secret123' });
  assert.equal((await u.post('/api/auth/change-password', { current: 'nope12345', next: 'newsecret1' })).status, 401);
  assert.equal((await u.post('/api/auth/change-password', { current: 'secret123', next: 'newsecret1' })).status, 200);
  assert.equal((await u.get('/api/auth/me')).data.user.username, 'chpw', 'الجلسة الحالية تبقى');
  assert.equal((await other.get('/api/auth/me')).data.user, null, 'الجلسات الأخرى تنتهي');
  const third = new Client(s.base);
  await third.post('/api/auth/login', { identifier: 'chpw', password: 'newsecret1' });
  const list = (await u.get('/api/auth/sessions')).data.items;
  assert.equal(list.length, 2);
  const target = list.find((x) => !x.current);
  assert.equal((await u.del(`/api/auth/sessions/${target.id}`)).status, 200);
  assert.equal((await third.get('/api/auth/me')).data.user, null);
});

test('CSRF: طلب مغيِّر من مصدر غريب برفض، ومن نفس المصدر مقبول', async () => {
  const u = await newUser(s, 'csrf');
  const evil = await u.post('/api/posts/1/like', {}, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403); assert.equal(evil.data.error.code, 'bad_origin');
  const cross = await u.post('/api/auth/logout', {}, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403);
  const ok = await u.post('/api/auth/logout', {}, { headers: { origin: s.base } });
  assert.equal(ok.status, 200);
});

test('الصلاحيات: غير المسجّل 401، والمستخدم العادي لا يدخل الإدارة 403', async () => {
  const anon = new Client(s.base);
  assert.equal((await anon.post('/api/posts/1/like')).status, 401);
  assert.equal((await anon.get('/api/admin/stats')).status, 401);
  const u = await newUser(s, 'plain');
  for (const p of ['/api/admin/stats', '/api/admin/users', '/api/admin/posts', '/api/admin/reports', '/api/admin/audit']) {
    assert.equal((await u.get(p)).status, 403, p);
  }
  assert.equal((await u.post('/api/admin/users/1/ban', {})).status, 403);
  assert.equal((await u.patch('/api/users/me', { role: 'admin' })).data.user.role, 'user', 'لا يمكن ترقية النفس بحقن الحقل');
  await makeAdmin(s, u.email);
  assert.equal((await u.get('/api/admin/stats')).status, 200);
});

test('Bearer token لتطبيقات الجوال القادمة', async () => {
  await newUser(s, 'native1');
  const c = new Client(s.base, { 'x-client': 'native' });
  const r = await c.post('/api/auth/login', { identifier: 'native1', password: 'secret123' });
  assert.ok(r.data.token);
  const n = new Client(s.base, { authorization: `Bearer ${r.data.token}` });
  assert.equal((await n.get('/api/auth/me')).data.user.username, 'native1');
});

test('REQUIRE_VERIFIED_EMAIL يمنع النشر قبل التأكيد', async () => {
  const s2 = await startServer({ REQUIRE_VERIFIED_EMAIL: 'true' });
  try {
    const u = await newUser(s2, 'unver');
    const r = await u.upload('/api/posts', { caption: 'x' }, []);
    assert.equal(r.status, 403); assert.equal(r.data.error.code, 'email_unverified');
    await u.post('/api/auth/verify', { token: s2.lastToken(u.email) });
    const r2 = await u.upload('/api/posts', { caption: 'x' }, []);
    assert.equal(r2.status, 400, 'بعد التأكيد يصل إلى فحص الملفات');
  } finally { await s2.stop(); }
});
