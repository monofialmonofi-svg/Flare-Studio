import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startServer, newUser, jpeg, jpegWithOrientation, noisyPng, makeVideo } from './helpers.mjs';

let s, u;
before(async () => { s = await startServer({ MAX_IMAGE_MB: '1' }); u = await newUser(s, 'media1'); });
after(async () => { await s.stop(); });

const img = (buffer, name = 'a.jpg', type = 'image/jpeg') => ({ buffer, name, type });
const fetchBin = async (url, headers) => fetch(s.base + url, { headers });

test('صورة واحدة: ثلاثة أحجام WebP بنسبة أصلية بدون تشويه', async () => {
  const r = await u.upload('/api/posts', { caption: 'صورة #طبيعة جميلة' }, [img(await jpeg(1200, 800))]);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const m = r.data.post.media[0];
  assert.equal(m.type, 'image');
  assert.equal(m.width, 1200); assert.equal(m.height, 800);
  assert.deepEqual(r.data.post.tags, ['طبيعة']);
  const sizes = {};
  for (const k of ['thumb', 'medium', 'large']) {
    const res = await fetchBin(m[k]);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    assert.match(res.headers.get('cache-control'), /immutable/);
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    sizes[k] = meta;
    assert.equal(meta.format, 'webp');
    assert.ok(Math.abs(meta.width / meta.height - 1.5) < 0.02, `${k} يحافظ على النسبة 3:2`);
  }
  assert.equal(sizes.thumb.width, 320); assert.equal(sizes.medium.width, 800); assert.equal(sizes.large.width, 1200, 'لا تكبير فوق الأصل');
});

test('اتجاه EXIF يُصحَّح وتُحذف بيانات الموقع/الكاميرا', async () => {
  const r = await u.upload('/api/posts', { caption: '' }, [img(await jpegWithOrientation(600, 400, 6))]);
  assert.equal(r.status, 201);
  const m = r.data.post.media[0];
  assert.equal(m.width, 400); assert.equal(m.height, 600, 'الأبعاد بعد التدوير');
  const meta = await sharp(Buffer.from(await (await fetchBin(m.large)).arrayBuffer())).metadata();
  assert.equal(meta.width, 400); assert.equal(meta.height, 600);
  assert.equal(meta.exif, undefined);
});

test('معرض صور: حتى 10، والحد الأعلى مفروض', async () => {
  const files = [];
  for (let i = 0; i < 4; i++) files.push(img(await jpeg(400 + i * 100, 300, i), `p${i}.jpg`));
  const r = await u.upload('/api/posts', { caption: 'معرض' }, files);
  assert.equal(r.status, 201);
  assert.equal(r.data.post.media.length, 4);
  assert.deepEqual(r.data.post.media.map((m) => m.width), [400, 500, 600, 700]);
  const many = [];
  for (let i = 0; i < 11; i++) many.push(img(await jpeg(100, 100, i)));
  const r2 = await u.upload('/api/posts', { caption: 'كثير' }, many);
  assert.equal(r2.status, 400); assert.equal(r2.data.error.code, 'too_many_files');
});

test('رفض الملفات المزيفة وغير الصالحة (فحص المحتوى لا الامتداد)', async () => {
  const fake = await u.upload('/api/posts', {}, [img(Buffer.from('<?php echo 1; ?> not an image'), 'evil.jpg', 'image/jpeg')]);
  assert.equal(fake.status, 400); assert.equal(fake.data.error.code, 'bad_image');
  const fakeVid = await u.upload('/api/posts', {}, [{ buffer: Buffer.alloc(5000, 7), name: 'v.mp4', type: 'video/mp4' }]);
  assert.equal(fakeVid.status, 400); assert.equal(fakeVid.data.error.code, 'bad_video');
  const wrongType = await u.upload('/api/posts', {}, [{ buffer: Buffer.from('hello'), name: 'a.txt', type: 'text/plain' }]);
  assert.equal(wrongType.status, 400); assert.equal(wrongType.data.error.code, 'bad_file_type');
  const none = await u.upload('/api/posts', { caption: 'بدون وسائط' }, []);
  assert.equal(none.status, 400); assert.equal(none.data.error.code, 'no_media');
});

test('حد حجم الصورة (1MB في هذا الاختبار)', async () => {
  const big = await noisyPng(700, 700);
  assert.ok(big.length > 1048576);
  const r = await u.upload('/api/posts', {}, [img(big, 'big.png', 'image/png')]);
  assert.equal(r.status, 400); assert.equal(r.data.error.code, 'file_too_large');
});

test('فيديو عمودي: معالجة + غلاف + مدة + Range streaming', async () => {
  const r = await u.upload('/api/posts', { caption: 'فيديو عمودي #ريلز' }, [{ buffer: makeVideo({ w: 360, h: 640, seconds: 2 }), name: 'v.mp4', type: 'video/mp4' }]);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const p = r.data.post; const m = p.media[0];
  assert.equal(p.kind, 'video'); assert.equal(m.type, 'video');
  assert.equal(m.width, 360); assert.equal(m.height, 640);
  assert.ok(m.duration > 1.5 && m.duration < 2.6, `duration ${m.duration}`);

  const poster = await fetchBin(m.poster);
  assert.equal(poster.status, 200); assert.equal(poster.headers.get('content-type'), 'image/webp');

  const head = await fetchBin(m.url);
  assert.equal(head.status, 200); assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal(head.headers.get('content-type'), 'video/mp4');
  const total = (await head.arrayBuffer()).byteLength;
  const part = await fetchBin(m.url, { Range: 'bytes=0-999' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-999/${total}`);
  assert.equal((await part.arrayBuffer()).byteLength, 1000);
});

test('فيديو أفقي يحتاج تحويلًا (mpeg4/mkv → H.264/mp4) ويحافظ على النسبة', async () => {
  const r = await u.upload('/api/posts', { caption: 'أفقي' }, [{ buffer: makeVideo({ w: 640, h: 360, seconds: 2, vcodec: 'mpeg4', ext: 'mkv' }), name: 'v.mkv', type: 'video/x-matroska' }]);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const m = r.data.post.media[0];
  assert.equal(m.width, 640); assert.equal(m.height, 360);
  const res = await fetchBin(m.url);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(4, 8).toString(), 'ftyp', 'الناتج MP4 حقيقي');
});

test('لا يمكن الجمع بين فيديو وصور', async () => {
  const r = await u.upload('/api/posts', {}, [{ buffer: makeVideo({ seconds: 1 }), name: 'v.mp4', type: 'video/mp4' }, img(await jpeg(200, 200))]);
  assert.equal(r.status, 400); assert.equal(r.data.error.code, 'mixed_media');
});

test('الحذف يزيل الملفات من التخزين، وغير المالك لا يحذف', async () => {
  const r = await u.upload('/api/posts', { caption: 'سأُحذف' }, [img(await jpeg(500, 500, 9))]);
  const p = r.data.post; const url = p.media[0].medium;
  assert.equal((await fetchBin(url)).status, 200);
  const other = await newUser(s, 'intruder');
  assert.equal((await other.del(`/api/posts/${p.id}`)).status, 403);
  assert.equal((await other.patch(`/api/posts/${p.id}`, { caption: 'اختراق' })).status, 403);
  assert.equal((await u.del(`/api/posts/${p.id}`)).status, 200);
  assert.equal((await fetchBin(url)).status, 404, 'الملف حُذف فعليًا');
  assert.equal((await u.get(`/api/posts/${p.id}`)).status, 404);
});

test('تعديل وصف الفيديو والوسوم من صاحبه', async () => {
  const r = await u.upload('/api/posts', { caption: 'قديم #قديم' }, [{ buffer: makeVideo({ seconds: 1 }), name: 'v.mp4', type: 'video/mp4' }]);
  const id = r.data.post.id;
  const e = await u.patch(`/api/posts/${id}`, { caption: 'جديد #جديد #ثاني' });
  assert.equal(e.status, 200);
  assert.equal(e.data.post.caption, 'جديد #جديد #ثاني');
  assert.deepEqual(e.data.post.tags.sort(), ['ثاني', 'جديد'].sort());
  assert.equal((await u.get('/api/tags/' + encodeURIComponent('قديم') + '/posts')).data.items.length, 0, 'الوسم القديم أُزيل من المنشور');
});

test('الصورة الشخصية والغلاف', async () => {
  const a = await u.upload('/api/users/me/avatar', {}, [{ field: 'file', buffer: await jpeg(900, 600), name: 'a.jpg', type: 'image/jpeg' }]);
  assert.equal(a.status, 200);
  const av = await sharp(Buffer.from(await (await fetchBin(a.data.user.avatar)).arrayBuffer())).metadata();
  assert.equal(av.width, 256); assert.equal(av.height, 256);
  const cv = await u.upload('/api/users/me/cover', {}, [{ field: 'file', buffer: await jpeg(2000, 1000), name: 'c.jpg', type: 'image/jpeg' }]);
  const cm = await sharp(Buffer.from(await (await fetchBin(cv.data.user.cover)).arrayBuffer())).metadata();
  assert.equal(cm.width, 1500); assert.equal(cm.height, 500);
  const oldAvatar = a.data.user.avatar;
  const a2 = await u.upload('/api/users/me/avatar', {}, [{ field: 'file', buffer: await jpeg(300, 300, 5), name: 'b.jpg', type: 'image/jpeg' }]);
  assert.notEqual(a2.data.user.avatar, oldAvatar);
  assert.equal((await fetchBin(oldAvatar)).status, 404, 'القديمة حُذفت');
  const bad = await u.upload('/api/users/me/avatar', {}, [{ field: 'file', buffer: Buffer.from('xx'), name: 'x.jpg', type: 'image/jpeg' }]);
  assert.equal(bad.status, 400);
});

test('حذف الحساب يحذف كل ملفات صاحبه', async () => {
  const d = await newUser(s, 'doomed');
  const r = await d.upload('/api/posts', { caption: 'x' }, [img(await jpeg(400, 400, 3))]);
  const url = r.data.post.media[0].thumb;
  assert.equal((await fetchBin(url)).status, 200);
  assert.equal((await d.del('/api/auth/account', { password: 'wrong' })).status, 401);
  assert.equal((await d.del('/api/auth/account', { password: 'secret123' })).status, 200);
  assert.equal((await fetchBin(url)).status, 404);
  assert.equal((await new (await import('./helpers.mjs')).Client(s.base).get('/api/users/doomed')).status, 404);
});
