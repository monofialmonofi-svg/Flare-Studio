import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startServer, newUser, makeAdmin, jpeg, makeVideo } from './helpers.mjs';

let s, ali, mona, omar;
const photo = async (c, caption = 'منشور', seed = 1) => (await c.upload('/api/posts', { caption }, [{ buffer: await jpeg(300, 300, seed), name: 'p.jpg', type: 'image/jpeg' }])).data.post;
const video = async (c, caption = 'فيديو') => (await c.upload('/api/posts', { caption }, [{ buffer: makeVideo({ seconds: 1 }), name: 'v.mp4', type: 'video/mp4' }])).data.post;

before(async () => {
  s = await startServer();
  ali = await newUser(s, 'ali'); mona = await newUser(s, 'mona'); omar = await newUser(s, 'omar');
});
after(async () => { await s.stop(); });

test('المتابعة وإلغاؤها والعدّادات والإشعار', async () => {
  assert.equal((await ali.post('/api/users/ali/follow')).status, 400, 'لا يتابع نفسه');
  let r = await ali.post('/api/users/mona/follow');
  assert.equal(r.status, 200); assert.equal(r.data.followers, 1);
  await ali.post('/api/users/mona/follow'); // تكرار لا يضاعف
  let p = (await ali.get('/api/users/mona')).data;
  assert.equal(p.user.counts.followers, 1); assert.equal(p.viewer.following, true);
  assert.equal((await mona.get('/api/users/ali')).data.user.counts.following, 1, 'علي يتابع منى');
  assert.equal((await mona.get('/api/users/mona')).data.user.counts.following, 0);
  assert.equal((await ali.get('/api/users/ali')).data.user.counts.following, 1);
  assert.equal((await mona.get('/api/notifications/unread-count')).data.count, 1);
  const n = (await mona.get('/api/notifications')).data.items;
  assert.equal(n[0].type, 'follow'); assert.equal(n[0].actor.username, 'ali');
  r = await ali.del('/api/users/mona/follow');
  assert.equal(r.data.followers, 0);
  assert.equal((await mona.get('/api/notifications/unread-count')).data.count, 0, 'إلغاء المتابعة يزيل الإشعار');
  await ali.post('/api/users/mona/follow');
  const fl = (await mona.get('/api/users/mona/followers')).data.items;
  assert.deepEqual(fl.map((x) => x.username), ['ali']);
  assert.deepEqual((await ali.get('/api/users/ali/following')).data.items.map((x) => x.username), ['mona']);
});

test('الخلاصة: منشورات المتابَعين + منشوراتي، والأحدث للجميع', async () => {
  const pm = await photo(mona, 'من منى #خلاصة');
  const po = await photo(omar, 'من عمر');
  const pa = await photo(ali, 'من علي');
  const following = (await ali.get('/api/feed?scope=following')).data;
  assert.deepEqual(following.items.map((x) => x.id), [pa.id, pm.id], 'علي + منى فقط، الأحدث أولًا');
  const latest = (await ali.get('/api/feed?scope=latest')).data;
  assert.ok(latest.items.some((x) => x.id === po.id));
  assert.equal(latest.items[0].author.username, 'ali');
  // ترقيم الصفحات
  for (let i = 0; i < 3; i++) await photo(mona, `ترقيم ${i}`, i + 10);
  const p1 = (await ali.get('/api/feed?scope=latest&limit=3')).data;
  assert.equal(p1.items.length, 3); assert.ok(p1.nextCursor);
  const p2 = (await ali.get(`/api/feed?scope=latest&limit=3&cursor=${p1.nextCursor}`)).data;
  assert.ok(p2.items[0].id < p1.items.at(-1).id);
  const ids = new Set([...p1.items, ...p2.items].map((x) => x.id));
  assert.equal(ids.size, p1.items.length + p2.items.length, 'بدون تكرار بين الصفحات');
  assert.equal((await ali.get('/api/feed?cursor=abc')).status, 400);
});

test('الإعجاب: مرة واحدة، عدّاد صحيح، إشعار واحد، وإزالة الإشعار عند التراجع', async () => {
  const p = await photo(mona, 'للإعجاب');
  assert.equal((await ali.post(`/api/posts/${p.id}/like`)).data.count, 1);
  assert.equal((await ali.post(`/api/posts/${p.id}/like`)).data.count, 1, 'idempotent');
  assert.equal((await omar.post(`/api/posts/${p.id}/like`)).data.count, 2);
  const got = (await ali.get(`/api/posts/${p.id}`)).data.post;
  assert.equal(got.counts.likes, 2); assert.equal(got.viewer.liked, true);
  assert.equal((await new Client(s.base).get(`/api/posts/${p.id}`)).data.post.viewer.liked, false);
  const likes = (await mona.get('/api/notifications')).data.items.filter((n) => n.type === 'like' && n.postId === p.id);
  assert.equal(likes.length, 2);
  assert.ok(likes[0].thumb, 'الإشعار يحمل صورة مصغرة للمنشور');
  assert.equal((await ali.del(`/api/posts/${p.id}/like`)).data.count, 1);
  assert.equal((await mona.get('/api/notifications')).data.items.filter((n) => n.type === 'like' && n.postId === p.id).length, 1);
  const own = await mona.post(`/api/posts/${p.id}/like`);
  assert.equal(own.data.count, 2);
  assert.equal((await mona.get('/api/notifications')).data.items.filter((n) => n.type === 'like' && n.actor.username === 'mona').length, 0, 'لا إشعار لإعجابك بنفسك');
});

test('التعليقات والردود والإشعارات وصلاحيات الحذف والعدّاد', async () => {
  const p = await photo(mona, 'للتعليق');
  assert.equal((await ali.post(`/api/posts/${p.id}/comments`, { body: '   ' })).status, 400);
  assert.equal((await ali.post(`/api/posts/${p.id}/comments`, { body: 'x'.repeat(1001) })).status, 400);
  const c1 = (await ali.post(`/api/posts/${p.id}/comments`, { body: 'تعليق علي <script>alert(1)</script>' })).data;
  assert.equal(c1.count, 1);
  assert.equal(c1.comment.body, 'تعليق علي <script>alert(1)</script>', 'يُخزَّن كنص (التهريب عند العرض)');
  const r1 = (await omar.post(`/api/posts/${p.id}/comments`, { body: 'رد عمر', parentId: c1.comment.id })).data;
  const r2 = (await mona.post(`/api/posts/${p.id}/comments`, { body: 'رد على الرد', parentId: r1.comment.id })).data;
  assert.equal(r2.comment.parentId, c1.comment.id, 'الردود بمستوى واحد');
  assert.equal(r2.count, 3);
  const list = (await ali.get(`/api/posts/${p.id}/comments`)).data;
  assert.equal(list.items.length, 1); assert.equal(list.items[0].replies.length, 2);
  assert.equal(list.items[0].canDelete, true);
  assert.equal(list.items[0].replies[0].canDelete, false);

  const types = (await ali.get('/api/notifications')).data.items.map((n) => n.type);
  assert.ok(types.includes('reply'), 'علي يستلم إشعار رد');
  const monaN = (await mona.get('/api/notifications')).data.items.filter((n) => n.postId === p.id).map((n) => n.type);
  assert.ok(monaN.includes('comment'), 'صاحبة المنشور تستلم إشعار تعليق');

  assert.equal((await omar.del(`/api/comments/${c1.comment.id}`)).status, 403, 'غريب لا يحذف');
  assert.equal((await omar.del(`/api/comments/${r1.comment.id}`)).status, 200, 'صاحب التعليق يحذف');
  assert.equal((await mona.del(`/api/comments/${c1.comment.id}`)).status, 200, 'صاحب المنشور يحذف');
  const after = (await ali.get(`/api/posts/${p.id}`)).data.post;
  assert.equal(after.counts.comments, 0, 'الحذف المتسلسل للردود يحدّث العدّاد');
});

test('الحفظ والمشاركة والمشاهدات (بدون تكرار)', async () => {
  const v = await video(mona, 'فيديو للعدّادات');
  assert.equal((await ali.post(`/api/posts/${v.id}/save`)).data.count, 1);
  const saved = (await ali.get('/api/saved')).data.items;
  assert.equal(saved[0].id, v.id); assert.equal(saved[0].viewer.saved, true);
  assert.equal((await ali.del(`/api/posts/${v.id}/save`)).data.count, 0);
  assert.equal((await ali.get('/api/saved')).data.items.length, 0);
  assert.equal((await ali.post(`/api/posts/${v.id}/share`)).data.count, 1);
  assert.equal((await ali.post(`/api/posts/${v.id}/share`)).data.count, 1);
  assert.equal((await ali.post(`/api/posts/${v.id}/view`)).data.views, 1);
  assert.equal((await ali.post(`/api/posts/${v.id}/view`)).data.views, 1, 'مشاهدة واحدة لكل مشاهد يوميًا');
  assert.equal((await omar.post(`/api/posts/${v.id}/view`)).data.views, 2);
  assert.equal((await new Client(s.base).post(`/api/posts/${v.id}/view`)).data.views, 3, 'الزائر يُحتسب مرة');
  assert.equal((await mona.post(`/api/posts/${v.id}/view`)).data.views, 3, 'مشاهدة صاحب الفيديو لا تُحتسب');
});

test('واجهة الفيديوهات المتتابعة تعيد الفيديوهات فقط ويمكن تثبيت فيديو أولًا', async () => {
  const a = await video(ali, 'ف1'); const b = await video(omar, 'ف2');
  const r = (await ali.get('/api/videos?limit=50')).data;
  assert.ok(r.items.every((x) => x.kind === 'video'));
  assert.equal(r.items[0].id, b.id);
  const pinned = (await ali.get(`/api/videos?first=${a.id}&limit=50`)).data;
  assert.equal(pinned.items[0].id, a.id);
  assert.equal(pinned.items.filter((x) => x.id === a.id).length, 1);
});

test('الوسوم والبحث والاستكشاف', async () => {
  await photo(ali, 'رحلة إلى الجبل #سفر #جبال');
  await photo(mona, 'صور #سفر أخرى');
  const tag = (await ali.get('/api/tags/' + encodeURIComponent('سفر') + '/posts')).data;
  assert.equal(tag.items.length, 2);
  const ex = (await ali.get('/api/explore')).data;
  assert.equal(ex.trendingTags[0].name, 'سفر'); assert.equal(ex.trendingTags[0].posts, 2);
  assert.ok(!ex.suggestedUsers.some((u) => u.username === 'ali'), 'لا اقتراح لنفسي');
  assert.ok(!ex.suggestedUsers.some((u) => u.username === 'mona'), 'لا اقتراح لمن أتابعه');
  assert.ok(ex.suggestedUsers.some((u) => u.username === 'omar'));
  assert.equal((await ali.get('/api/search?type=users&q=mon')).data.items[0].username, 'mona');
  assert.equal((await ali.get('/api/search?type=users&q=@mona')).data.items[0].username, 'mona');
  assert.equal((await ali.get('/api/search?type=posts&q=' + encodeURIComponent('الجبل'))).data.items.length, 1);
  assert.equal((await ali.get('/api/search?type=tags&q=' + encodeURIComponent('سف'))).data.items[0].name, 'سفر');
  assert.equal((await ali.get('/api/search?type=users&q=' + encodeURIComponent('%'))).data.items.length, 0, 'علامات LIKE تُهرَّب');
  const pop = (await ali.get('/api/explore/posts')).data;
  assert.ok(pop.items.length > 0);
  const people = (await ali.get('/api/users?q=om')).data.items;
  assert.equal(people[0].username, 'omar'); assert.equal(people[0].following, false);
});

test('الحظر: يخفي المحتوى ويمنع التفاعل ويفكّ المتابعة', async () => {
  const x = await newUser(s, 'blocker1'); const y = await newUser(s, 'blocked1');
  const py = await photo(y, 'منشور المحظور');
  const px = await photo(x, 'منشور الحاظر');
  await x.post('/api/users/blocked1/follow'); await y.post('/api/users/blocker1/follow');
  assert.equal((await x.post('/api/users/blocked1/block')).status, 200);
  assert.equal((await x.get('/api/users/blocked1')).status, 404);
  assert.equal((await y.get('/api/users/blocker1')).status, 404, 'والعكس');
  assert.equal((await x.get(`/api/posts/${py.id}`)).status, 404);
  assert.equal((await y.post(`/api/posts/${px.id}/like`)).status, 404);
  assert.equal((await y.post(`/api/posts/${px.id}/comments`, { body: 'مرحبا' })).status, 404);
  assert.ok(!(await x.get('/api/feed?scope=latest&limit=50')).data.items.some((p) => p.id === py.id));
  assert.ok(!(await y.get('/api/feed?scope=latest&limit=50')).data.items.some((p) => p.id === px.id));
  assert.equal((await x.get('/api/search?type=users&q=blocked1')).data.items.length, 0);
  assert.equal((await x.get('/api/users/me/blocks')).data.items[0].username, 'blocked1');
  assert.equal((await x.get('/api/users/blocker1')).data.user.counts.followers, 0, 'المتابعة فُكّت في الاتجاهين');
  assert.equal((await x.del('/api/users/blocked1/block')).status, 200);
  assert.equal((await x.get('/api/users/blocked1')).status, 200);
});

test('الإشعارات: قراءة الكل وتعليم واحد', async () => {
  const p = await photo(omar, 'للإشعارات');
  await ali.post(`/api/posts/${p.id}/like`); await mona.post(`/api/posts/${p.id}/like`);
  const before = (await omar.get('/api/notifications/unread-count')).data.count;
  assert.ok(before >= 2);
  const first = (await omar.get('/api/notifications')).data.items[0];
  await omar.post(`/api/notifications/${first.id}/read`);
  assert.equal((await omar.get('/api/notifications/unread-count')).data.count, before - 1);
  await omar.post('/api/notifications/read-all');
  assert.equal((await omar.get('/api/notifications/unread-count')).data.count, 0);
  assert.equal((await ali.post(`/api/notifications/${first.id}/read`)).status, 200);
  assert.equal((await omar.get('/api/notifications')).data.items.find((n) => n.id === first.id).read, true, 'مستخدم آخر لا يؤثر على إشعاراتي');
});

test('الملف الشخصي: تعديل البيانات واسم المستخدم الفريد وتصفية المنشورات', async () => {
  const r = await mona.patch('/api/users/me', { displayName: 'منى الجديدة', bio: 'مصوّرة ومحبّة للسفر' });
  assert.equal(r.data.user.displayName, 'منى الجديدة'); assert.equal(r.data.user.bio, 'مصوّرة ومحبّة للسفر');
  assert.equal((await mona.patch('/api/users/me', { username: 'ali' })).status, 409);
  assert.equal((await mona.patch('/api/users/me', { bio: 'x'.repeat(161) })).status, 400);
  const posts = (await ali.get('/api/users/mona/posts?kind=video')).data.items;
  assert.ok(posts.length >= 1 && posts.every((p) => p.kind === 'video'));
  const ren = await mona.patch('/api/users/me', { username: 'mona_new' });
  assert.equal(ren.data.user.username, 'mona_new');
  assert.equal((await ali.get('/api/users/mona_new')).status, 200);
  await mona.patch('/api/users/me', { username: 'mona' });
});

test('الإبلاغ + لوحة الإدارة: مراجعة، حذف المحتوى، حظر، إحصائيات', async () => {
  const adm = await newUser(s, 'boss');
  await makeAdmin(s, adm.email);
  const bad = await newUser(s, 'spammer');
  const bp = await photo(bad, 'محتوى مخالف');
  const bc = (await bad.post(`/api/posts/${bp.id}/comments`, { body: 'تعليق مخالف' })).data.comment;

  assert.equal((await bad.post('/api/reports', { targetType: 'post', targetId: bp.id, reason: 'spam' })).status, 400, 'لا إبلاغ عن نفسك');
  assert.equal((await ali.post('/api/reports', { targetType: 'post', targetId: bp.id, reason: 'nonsense' })).status, 400);
  assert.equal((await ali.post('/api/reports', { targetType: 'post', targetId: bp.id, reason: 'spam', details: 'إعلانات' })).status, 201);
  assert.equal((await ali.post('/api/reports', { targetType: 'post', targetId: bp.id, reason: 'spam' })).status, 201, 'التكرار لا يضاعف');
  await omar.post('/api/reports', { targetType: 'comment', targetId: bc.id, reason: 'abuse' });
  await mona.post('/api/reports', { targetType: 'user', targetId: bad.user.id, reason: 'impersonation' });

  assert.equal((await ali.get('/api/admin/reports')).status, 403);
  const rep = (await adm.get('/api/admin/reports?status=open')).data.items;
  assert.equal(rep.length, 3);
  const postRep = rep.find((x) => x.targetType === 'post');
  assert.equal(postRep.target.author, 'spammer'); assert.equal(postRep.reporter, 'ali');

  const stats = (await adm.get('/api/admin/stats')).data;
  assert.equal(stats.reports.open, 3);
  assert.ok(stats.users.total === 7 && stats.posts.total > 5 && stats.posts.videos >= 3);
  assert.ok(stats.storage.totalBytes > 0 && stats.storage.videoBytes > 0);
  assert.equal(stats.activity.signups.length, 7);
  assert.equal(stats.activity.posts.at(-1).count, stats.posts.total, 'كل المنشورات أُنشئت اليوم في الاختبار');

  assert.equal((await adm.post(`/api/admin/reports/${postRep.id}/resolve`, { action: 'remove_content', note: 'سبام' })).status, 200);
  assert.equal((await ali.get(`/api/posts/${bp.id}`)).status, 404);
  assert.equal((await adm.get('/api/admin/reports?status=open')).data.items.length, 2);

  const userRep = rep.find((x) => x.targetType === 'user');
  assert.equal((await adm.post(`/api/admin/reports/${userRep.id}/resolve`, { action: 'ban_user', note: 'انتحال' })).status, 200);
  const login = await new Client(s.base).post('/api/auth/login', { identifier: 'spammer', password: 'secret123' });
  assert.equal(login.status, 403); assert.match(login.data.error.message, /محظور/);
  assert.equal((await bad.get('/api/auth/me')).data.user, null, 'جلسته أُبطلت فورًا');
  assert.equal((await ali.get('/api/users/spammer')).status, 404);
  const banned = (await adm.get('/api/admin/users?status=banned')).data.items;
  assert.equal(banned[0].username, 'spammer'); assert.equal(banned[0].banReason, 'انتحال');

  assert.equal((await adm.post(`/api/admin/users/${bad.user.id}/unban`)).status, 200);
  assert.equal((await new Client(s.base).post('/api/auth/login', { identifier: 'spammer', password: 'secret123' })).status, 200);
  assert.equal((await adm.post(`/api/admin/users/${adm.user.id}/ban`, {})).status, 400, 'لا يحظر نفسه');
  assert.equal((await adm.post(`/api/admin/users/${ali.user.id}/role`, { role: 'admin' })).status, 400, 'لا ترقية بدون تأكيد بريد');
  const oPost = await photo(omar, 'سيحذفه المسؤول');
  assert.equal((await adm.del(`/api/admin/posts/${oPost.id}`)).status, 200);
  assert.equal((await adm.get('/api/admin/posts?q=' + encodeURIComponent('سيحذفه'))).data.items.length, 0);
  const audit = (await adm.get('/api/admin/audit')).data.items.map((a) => a.action);
  for (const a of ['post.delete', 'user.ban', 'user.unban', 'report.remove_content']) assert.ok(audit.includes(a), a);
  assert.equal((await adm.del(`/api/admin/users/${bad.user.id}`)).status, 200);
  assert.equal((await adm.del(`/api/admin/users/${adm.user.id}`)).status, 400);
});
