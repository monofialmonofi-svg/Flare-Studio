// اختبار واجهة شامل بمتصفح حقيقي (Playwright). تشغيل: npm run test:e2e
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer, makeAdmin, makeVideo } from '../helpers.mjs';
import { art } from './seed.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const server = await startServer();
const browser = await chromium.launch();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamma-e2e-'));
const jpg = async (name, w, h, hue) => { const p = path.join(tmp, name); fs.writeFileSync(p, await art(w, h, hue, hue + 80)); return p; };
const mp4 = (name, opts) => { const p = path.join(tmp, name); fs.writeFileSync(p, makeVideo(opts)); return p; };
const files = {
  photo: await jpg('photo.jpg', 1400, 900, 20), g1: await jpg('g1.jpg', 1000, 700, 100), g2: await jpg('g2.jpg', 700, 1000, 200), g3: await jpg('g3.jpg', 900, 900, 300),
  avatar: await jpg('avatar.jpg', 400, 400, 280), vid1: mp4('v1.mp4', { w: 360, h: 640, seconds: 5 }), vid2: mp4('v2.mp4', { w: 640, h: 360, seconds: 5 }),
};

const problems = [];
const results = [];
let mark = '';
const M = (x) => { mark = x; };
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([true, name]); console.log(`  ✓ ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push([false, name]); console.log(`  ✗ ${name} [@${mark}]\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); if (SHOTS && e.page) await e.page.screenshot({ path: `${SHOTS}/FAIL-${name.replace(/\W+/g, '_')}.png` }).catch(() => {}); }
}
async function newCtx(label, opts = { viewport: { width: 1280, height: 860 } }) {
  const ctx = await browser.newContext({ locale: 'ar', ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`[${label}] console.error: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`); });
  return { ctx, page };
}
const visible = async (page, sel, text) => { const l = text ? page.locator(sel, { hasText: text }).first() : page.locator(sel).first(); await l.waitFor({ state: 'visible' }); return l; };
const shot = (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/e2e-${n}.png` });

async function signupUI(page, { name, username, email, password = 'secret123' }) {
  await page.goto(server.base + '/signup');
  await page.fill('#f-displayName', name); await page.fill('#f-username', username); await page.fill('#f-email', email); await page.fill('#f-password', password);
  await page.click('button[type=submit]');
  await page.waitForURL(server.base + '/');
}
async function publish(page, filePaths, caption) {
  await page.goto(server.base + '/create');
  await page.setInputFiles('input[type=file]', filePaths);
  await page.locator('.preview').first().waitFor();
  if (caption) await page.fill('textarea[aria-label="الوصف"]', caption);
  await page.click('form button[type=submit]');
  await page.waitForURL(/\/post\/\d+/, { timeout: 60000 });
  return Number(page.url().match(/post\/(\d+)/)[1]);
}

console.log('\n▶ تدفق المستخدم الأول (حاسوب)');
const A = await newCtx('A-desktop'); const a = A.page;
let postPhoto, postGallery, postVideo1;

await step('الصفحة الترحيبية ثم إنشاء حساب عبر الواجهة', async () => {
  await a.goto(server.base + '/');
  await visible(a, 'h1', 'كل لحظاتنا');
  await a.click('text=أنشئ حسابك مجانًا');
  await a.waitForURL('**/signup');
  // التحقق من رسائل الخطأ الفورية
  await a.fill('#f-username', 'a b'); await visible(a, '.error-text', 'اسم المستخدم غير صالح');
  await a.fill('#f-username', 'hossam'); await a.fill('#f-displayName', 'حسام الدين'); await a.fill('#f-email', 'hossam@example.com'); await a.fill('#f-password', 'abc');
  await visible(a, '.error-text', 'كلمة المرور ضعيفة');
  await a.fill('#f-password', 'secret123');
  await a.click('button[type=submit]');
  await a.waitForURL(server.base + '/');
  await visible(a, 'text=خلاصتك ما زالت فارغة');
  await visible(a, '.verify-banner');
  await shot(a, '01-after-signup');
});
await step('تكرار البريد/اسم المستخدم يظهر خطأ تحت الحقل', async () => {
  const { page, ctx } = await newCtx('dup');
  await page.goto(server.base + '/signup');
  await page.fill('#f-displayName', 'x'); await page.fill('#f-username', 'other'); await page.fill('#f-email', 'hossam@example.com'); await page.fill('#f-password', 'secret123');
  await page.click('button[type=submit]');
  await visible(page, '.error-text', 'مسجّل بالفعل');
  await ctx.close();
});
await step('تأكيد البريد عبر الرابط المرسَل', async () => {
  const token = server.lastToken('hossam@example.com');
  assert.ok(token);
  await a.goto(`${server.base}/verify?token=${token}`);
  await visible(a, '.form-success', 'تم تأكيد بريدك');
  await a.goto(server.base + '/');
  assert.equal(await a.locator('.verify-banner').count(), 0);
  const bad = await newCtx('bad-verify'); await bad.page.goto(`${server.base}/verify?token=nope`); await visible(bad.page, '.form-error'); await bad.ctx.close();
});
await step('تسجيل الخروج ثم دخول (خطأ ثم نجاح)', async () => {
  await a.goto(server.base + '/settings');
  await a.click('button:has-text("تسجيل الخروج")');
  await a.waitForURL('**/welcome');
  await a.goto(server.base + '/create'); await a.waitForURL(/\/login\?next=/); // حماية المسارات
  await a.fill('#f-identifier', 'hossam'); await a.fill('#f-password', 'wrongpass1');
  await a.click('button[type=submit]');
  await visible(a, '.form-error', 'بيانات الدخول غير صحيحة');
  await a.fill('#f-password', 'secret123');
  await a.click('button[type=submit]');
  await a.waitForURL('**/create'); // يعود إلى الصفحة المطلوبة
});
await step('استعادة كلمة المرور عبر الواجهة', async () => {
  const { page, ctx } = await newCtx('reset');
  await page.goto(server.base + '/forgot');
  await page.fill('#f-email', 'hossam@example.com'); await page.click('button[type=submit]');
  await visible(page, '.form-success');
  const token = server.lastToken('hossam@example.com');
  await page.goto(`${server.base}/reset?token=${token}`);
  await page.fill('#f-password', 'newpass456'); await page.click('button[type=submit]');
  await page.waitForURL('**/login?reset=1');
  await page.fill('#f-identifier', 'hossam@example.com'); await page.fill('#f-password', 'newpass456'); await page.click('button[type=submit]');
  await page.waitForURL(server.base + '/');
  await ctx.close();
  // الجلسة القديمة في A انتهت بعد إعادة التعيين
  await a.goto(server.base + '/create'); await a.waitForURL(/\/login/);
  await a.fill('#f-identifier', 'hossam'); await a.fill('#f-password', 'newpass456'); await a.click('button[type=submit]'); await a.waitForURL('**/create');
});

await step('نشر صورة مع وصف ووسم', async () => {
  postPhoto = await publish(a, files.photo, 'أول لحظة لي في لَمّة #لمة 🎉');
  await visible(a, '.post img.fg');
  await visible(a, `.post-caption a[href="/tag/${encodeURIComponent('لمة')}"]`);
  const nat = await a.locator('.post img.fg').evaluate((i) => i.complete ? [i.naturalWidth, i.naturalHeight] : null);
  assert.ok(nat && nat[0] > 100, 'الصورة تحمّلت');
  await shot(a, '02-photo-post');
});
await step('نشر معرض صور + التنقل + المعاينة الكبيرة', async () => {
  postGallery = await publish(a, [files.g1, files.g2, files.g3], 'معرض #صور');
  await visible(a, '.gallery .count', '1/3');
  await a.locator('.gallery').hover();
  await a.click('.gallery .nav.next');
  await a.waitForFunction(() => document.querySelector('.gallery .count').textContent === '2/3');
  await a.locator('.gallery .slide').nth(1).click();
  await visible(a, '.lightbox'); await visible(a, '.lightbox .top span', '/ 3');
  await shot(a, '03-lightbox');
  await a.keyboard.press('Escape');
  await a.locator('.lightbox').waitFor({ state: 'detached' });
});
await step('رفع فيديو مع تقدّم ثم تشغيله فعليًا + كتم + ملء الشاشة', async () => {
  postVideo1 = await publish(a, files.vid1, 'فيديو عمودي #ريلز');
  const player = await visible(a, '.player');
  // التشغيل التلقائي (صامتًا) عند ظهور الفيديو
  await a.waitForFunction(() => { const v = document.querySelector('.player video'); return v && !v.paused && v.currentTime > 0.4; }, null, { timeout: 15000 });
  await a.locator('.player').hover();
  await a.locator('.player button[aria-label="كتم / تشغيل الصوت"]').click();
  assert.equal(await a.locator('.player video').evaluate((v) => v.muted), false);
  await a.locator('.player button[aria-label="ملء الشاشة"]').click();
  await a.waitForFunction(() => !!document.fullscreenElement).catch(() => { throw new Error('لم يدخل وضع ملء الشاشة'); });
  await a.keyboard.press('Escape'); await a.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await a.locator('.player .media-frame').click(); // إيقاف
  assert.equal(await a.locator('.player video').evaluate((v) => v.paused), true);
  // التقدّم: النقر على شريط التقدّم يغيّر الوقت
  await a.locator('.player').hover();
  const box = await a.locator('.player .seek').boundingBox();
  await a.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
  await a.waitForFunction(() => document.querySelector('.player video').currentTime > 2, null, { timeout: 4000 }).catch(async () => { throw new Error('seek: t=' + await a.locator('.player video').evaluate((v) => v.currentTime + '/' + v.duration + ' paused=' + v.paused)); });
  await a.waitForFunction(() => /1 مشاهدة|مشاهدة/.test(document.querySelector('.post-stats')?.textContent || ''));
});
await step('رفض ملف غير مدعوم وفيديو مع صور من الواجهة', async () => {
  await a.goto(server.base + '/create');
  const bad = path.join(tmp, 'x.txt'); fs.writeFileSync(bad, 'hello');
  await a.setInputFiles('input[type=file]', bad);
  await visible(a, '.form-error', 'غير مدعوم');
  await a.setInputFiles('input[type=file]', files.photo);
  await a.setInputFiles('input[type=file]', files.vid2);
  await visible(a, '.form-error', 'لا يمكن الجمع');
});

await step('الخلاصة: كل منشوراتي ظاهرة، الإعجاب يبقى بعد إعادة التحميل', async () => {
  await a.goto(server.base + '/');
  await a.locator('.post').nth(2).waitFor();
  assert.equal(await a.locator('.post').count(), 3);
  const first = a.locator('.post').first();
  await first.locator('button[aria-label="إعجاب"]').click();
  await a.waitForFunction(() => document.querySelector('.post button[aria-label="إعجاب"]').getAttribute('aria-pressed') === 'true');
  await a.reload(); await a.locator('.post').first().waitFor();
  assert.equal(await a.locator('.post').first().locator('button[aria-label="إعجاب"]').getAttribute('aria-pressed'), 'true');
  await shot(a, '04-feed');
});
await step('تعليق ثم رد ثم حذف', async () => {
  await a.goto(`${server.base}/post/${postPhoto}`);
  await a.fill('textarea[aria-label="اكتب تعليقًا"]', 'تعليقي الأول');
  await a.click('.comment-form button[type=submit]');
  await visible(a, '.comment .body', 'تعليقي الأول');
  await a.locator('.comment .foot button', { hasText: 'رد' }).first().click();
  await visible(a, '.reply-chip');
  await a.fill('textarea[aria-label="اكتب تعليقًا"]', 'هذا رد');
  await a.click('.comment-form button[type=submit]');
  await visible(a, '.replies .comment .body', 'هذا رد');
  await a.locator('.comment .foot button', { hasText: 'حذف' }).last().click();
  await a.locator('.modal button.danger').click();
  await a.locator('.replies .comment').waitFor({ state: 'detached' });
  await shot(a, '05-comments');
});
await step('حفظ المنشور ثم ظهوره في المحفوظات وإلغاء الحفظ', async () => {
  await a.goto(`${server.base}/post/${postPhoto}`);
  await a.click('button[aria-label="حفظ"]');
  await visible(a, '.toast', 'تم الحفظ');
  await a.goto(server.base + '/saved');
  await visible(a, `.tile[href="/post/${postPhoto}"]`);
  await a.goto(`${server.base}/post/${postPhoto}`); await a.click('button[aria-label="حفظ"]');
});
await step('تعديل وصف الفيديو وحذف منشور من صاحبه', async () => {
  await a.goto(`${server.base}/post/${postVideo1}`);
  await a.click('button[aria-label="المزيد من الخيارات"]');
  await a.click('.menu-item:has-text("تعديل الوصف")');
  await a.fill('.modal textarea', 'وصف جديد للفيديو #معدّل');
  await a.click('.modal button[type=submit]');
  await visible(a, '.post-caption', 'وصف جديد للفيديو');
  const extra = await publish(a, files.g1, 'للحذف');
  await a.click('button[aria-label="المزيد من الخيارات"]');
  await a.click('.menu-item:has-text("حذف المنشور")');
  await a.locator('.modal button.danger').click();
  await a.waitForURL((u) => !u.pathname.includes(`/post/${extra}`));
  const r = await a.request.get(`${server.base}/api/posts/${extra}`); assert.equal(r.status(), 404);
});

console.log('\n▶ مستخدم ثانٍ: متابعة وتفاعل وإشعارات');
const B = await newCtx('B-desktop'); const b = B.page;
await step('المستخدم الثاني يسجّل ويتابع ويعجب ويعلّق', async () => {
  await signupUI(b, { name: 'منى', username: 'mona', email: 'mona@example.com' });
  await b.goto(server.base + '/u/hossam');
  await visible(b, 'h1', 'حسام الدين');
  await b.locator('.profile-top button', { hasText: 'متابعة' }).click();
  await b.locator('.profile-top button', { hasText: 'إلغاء المتابعة' }).waitFor();
  await b.goto(`${server.base}/post/${postPhoto}`);
  await b.click('.post button[aria-label="إعجاب"]');
  await b.fill('textarea[aria-label="اكتب تعليقًا"]', 'جميلة جدًا يا حسام!');
  await b.click('.comment-form button[type=submit]');
  await visible(b, '.comment .body', 'جميلة جدًا');
  // منى تنشر فيديو أفقيًا أيضًا لاختبار التنقل بين الفيديوهات
  await publish(b, files.vid2, 'فيديو أفقي من منى #ريلز');
});
await step('الإشعارات: شارة العدّاد → صفحة الإشعارات → تعليم كمقروء', async () => {
  await a.goto(server.base + '/');
  const badge = a.locator('.sidebar .nav-link[data-match="/notifications"] .badge');
  await badge.waitFor({ state: 'visible' });
  assert.ok(Number(await badge.textContent()) >= 3);
  await a.click('.sidebar a[href="/notifications"]');
  await visible(a, '.notif', 'بدأ منى بمتابعتك');
  await visible(a, '.notif', 'أُعجب منى بمنشورك');
  await visible(a, '.notif', 'علّق منى على منشورك');
  await shot(a, '06-notifications');
  await a.click('button:has-text("تعليم الكل كمقروء")');
  await badge.waitFor({ state: 'hidden' });
  await a.locator('.notif.unread').first().waitFor({ state: 'detached' });
  await a.reload(); assert.equal(await a.locator('.notif.unread').count(), 0);
});
await step('الفيديوهات المتتابعة: تشغيل، تنقل بالسهم، إعجاب، تعليقات، كتم', async () => {
  await a.goto(server.base + '/videos'); M('reels-load');
  await a.locator('.reel video').first().waitFor();
  await a.waitForFunction(() => { const v = document.querySelector('.reel video'); return v && !v.paused && v.currentTime > 0.3; }, null, { timeout: 15000 });
  M('reels-count'); assert.equal(await a.locator('.reel').count(), 2);
  const firstId = await a.locator('.reel').first().getAttribute('data-id');
  M('reels-down'); await a.keyboard.press('ArrowDown');
  await a.waitForFunction((id) => location.pathname !== `/videos/${id}` && /\/videos\/\d+/.test(location.pathname), firstId);
  M('reels-play2'); await a.waitForFunction(() => { const reels = [...document.querySelectorAll('.reel')]; const v = reels[1].querySelector('video'); return v && !v.paused && v.currentTime > 0.2; }, null, { timeout: 15000 });
  assert.equal(await a.locator('.reel').first().locator('video').evaluate((v) => v.paused), true, 'الفيديو السابق توقف');
  M('reels-like'); await a.locator('.reel').nth(1).locator('button[aria-label="إعجاب"]').click();
  await a.waitForFunction(() => !document.querySelectorAll('.reel')[1].querySelector('button[aria-label="إعجاب"]').classList.contains('liked'));
  await a.locator('.reel').nth(1).locator('button[aria-label="التعليقات"]').click();
  await visible(a, '.modal .comment-form'); await a.keyboard.press('Escape');
  await a.click('.reel-top-actions button[aria-label="كتم / تشغيل الصوت"]');
  await shot(a, '07-reels');
  M('reels-up'); await a.keyboard.press('ArrowUp');
  await a.waitForFunction(() => document.querySelectorAll('.reel')[0].querySelector('video') && !document.querySelectorAll('.reel')[0].querySelector('video').paused);
  // رابط مباشر لفيديو محدد
  M('reels-deeplink'); await a.goto(`${server.base}/videos/${postVideo1}`);
  await a.waitForFunction((id) => document.querySelector('.reel').dataset.id === String(id), postVideo1);
});
await step('البحث (أشخاص/منشورات/وسوم) والاستكشاف وصفحة الوسم', async () => {
  await a.goto(server.base + '/explore');
  await visible(a, '.chip', '#ريلز');
  await a.fill('.topbar .search-mini input', 'mona'); await a.keyboard.press('Enter');
  await a.waitForURL(/\/search\?q=mona/);
  await visible(a, '.user-row', 'منى');
  await a.click('.tabs button:has-text("منشورات")');
  await a.goto(`${server.base}/search?q=${encodeURIComponent('أفقي')}&type=posts`); await visible(a, '.tile');
  await a.goto(`${server.base}/search?q=${encodeURIComponent('ريل')}&type=tags`); await visible(a, '.list-item', '#ريلز');
  await a.click('.list-item'); await a.waitForURL(/\/tag\//); await visible(a, '.tile');
  await a.goto(server.base + '/search?q=zzzzzz'); await visible(a, 'text=لا توجد نتائج');
});
await step('صفحة المستخدمين: بحث ومتابعة', async () => {
  await a.goto(server.base + '/people');
  await visible(a, '.user-row', 'منى');
  await a.fill('.page-head ~ form input', 'مون'); // لا يطابق
  await visible(a, 'text=لا يوجد مستخدم بهذا الاسم');
  await a.fill('.page-head ~ form input', 'mona');
  await a.locator('.user-row button', { hasText: 'متابعة' }).click();
  await a.locator('.user-row button', { hasText: 'إلغاء المتابعة' }).waitFor();
});
await step('تعديل الملف الشخصي + صورة شخصية + الغلاف', async () => {
  await a.goto(server.base + '/settings/profile');
  await a.fill('#ep-bio', 'مصوّر ومونتير وصانع محتوى 🎬'); await a.fill('#ep-name', 'حسام الدين مصطفى');
  await a.setInputFiles('.edit-avatar ~ input[type=file], input[type=file] >> nth=1', files.avatar);
  await a.locator('.edit-avatar .avatar img').waitFor();
  await a.click('form button[type=submit]');
  await a.waitForURL('**/u/hossam');
  await visible(a, 'p', 'مصوّر ومونتير');
  await visible(a, 'h1', 'حسام الدين مصطفى');
  await a.locator('.profile-body .avatar img').waitFor();
  assert.equal(await a.locator('.stats b').first().textContent(), '3', 'صورة + معرض + فيديو (المحذوف لا يُحتسب)');
});
await step('الخصوصية: تغيير كلمة المرور + الجلسات + الحظر وإلغاؤه', async () => {
  await a.goto(server.base + '/settings/privacy');
  await visible(a, '.session', 'هذا الجهاز');
  await a.fill('#pw-cur', 'newpass456'); await a.fill('#pw-new', 'thirdpass789'); await a.click('form button:has-text("تغيير كلمة المرور")');
  await visible(a, '.form-success');
  // حظر منى من ملفها
  await a.goto(server.base + '/u/mona');
  await a.click('.profile-top button[aria-label="المزيد"]');
  await a.click('.menu-item:has-text("حظر")');
  await a.locator('.modal button.danger').click();
  await a.waitForURL(server.base + '/');
  await a.goto(server.base + '/u/mona'); await visible(a, 'text=هذا الحساب غير متاح');
  await b.goto(server.base + '/u/hossam'); await visible(b, 'text=هذا الحساب غير متاح');
  await a.goto(server.base + '/settings/privacy');
  await a.locator('.user-row button', { hasText: 'إلغاء الحظر' }).click();
  await a.goto(server.base + '/u/mona'); await visible(a, 'h1', 'منى');
});
await step('الإبلاغ عن منشور من الواجهة', async () => {
  await b.goto(`${server.base}/post/${postPhoto}`);
  await b.click('button[aria-label="المزيد من الخيارات"]');
  await b.click('.menu-item:has-text("إبلاغ")');
  await b.click('.modal label:has-text("مزعج")');
  await b.fill('.modal textarea', 'إعلانات');
  await b.click('.modal button[type=submit]');
  await visible(b, '.toast', 'وصلنا بلاغك');
});

console.log('\n▶ لوحة الإدارة');
await makeAdmin(server, 'hossam@example.com');
await step('غير المسؤول لا يدخل لوحة الإدارة (من الخادم)', async () => {
  await b.goto(server.base + '/admin'); await visible(b, 'text=غير مصرّح');
  const r = await b.request.get(`${server.base}/api/admin/stats`); assert.equal(r.status(), 403);
  const anon = await newCtx('anon'); await anon.page.goto(server.base + '/admin'); await visible(anon.page, 'h1', 'لوحة الإدارة'); assert.equal(await anon.page.locator('.stat').count(), 0); await anon.ctx.close();
});
await step('المسؤول: إحصائيات + البلاغات + حذف المحتوى + حظر مستخدم', async () => {
  await a.goto(server.base + '/admin');
  await visible(a, '.stat', 'المستخدمون'); await visible(a, '.chart');
  assert.equal((await a.locator('.stat .v').first().textContent()).trim(), '2');
  await shot(a, '08-admin');
  await a.click('.adm-nav a[href="#reports"]');
  await visible(a, '.report', 'مزعج');
  await a.locator('.report button:has-text("تجاهل البلاغ")').click();
  await a.locator('.modal button[type=submit]').click();
  await a.locator('.report').waitFor({ state: 'detached' });
  await a.click('.adm-nav a[href="#users"]');
  await a.fill('input[aria-label="بحث"]', 'mona');
  await a.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1 && document.querySelector('tbody tr').dataset.user === 'mona');
  const row = a.locator('tr[data-user="mona"]');
  await row.locator('button:has-text("حظر")').click();
  await a.fill('.modal input', 'مخالفة تجريبية'); await a.click('.modal button[type=submit]');
  await row.locator('.pill.red').waitFor();
  await a.click('.adm-nav a[href="#audit"]'); await visible(a, '.audit-row', 'حظر مستخدم');
});
await step('المستخدم المحظور يُطرد فورًا ولا يستطيع الدخول', async () => {
  await b.goto(server.base + '/');
  await visible(b, 'h1', 'كل لحظاتنا'); // أُنهيت جلسته فيرى صفحة الزوار
  await b.goto(server.base + '/login'); await b.fill('#f-identifier', 'mona'); await b.fill('#f-password', 'secret123'); await b.click('button[type=submit]');
  await visible(b, '.form-error', 'محظور');
  await a.goto(server.base + '/videos'); await a.locator('.reel video').first().waitFor();
  assert.equal(await a.locator('.reel').count(), 1, 'فيديو المحظور اختفى من التطبيق');
});

console.log('\n▶ الاستجابة: لا تمرير أفقي في أي مقاس + الجوال');
const routes = ['/', '/explore', '/videos', '/create', '/notifications', '/u/hossam', '/settings', '/settings/privacy', '/settings/profile', '/people', '/saved', `/post/${postGallery}`, '/search?q=a'];
const login = async (page) => { await page.goto(server.base + '/login'); await page.fill('#f-identifier', 'hossam'); await page.fill('#f-password', 'thirdpass789'); await page.click('button[type=submit]'); await page.waitForURL(server.base + '/'); };
for (const [label, vp, mobile] of [['320', { width: 320, height: 640 }, true], ['390', { width: 390, height: 844 }, true], ['820', { width: 820, height: 1100 }, false], ['1360', { width: 1360, height: 900 }, false]]) {
  await step(`لا تمرير أفقي على عرض ${label}px في ${routes.length + 2} صفحة`, async () => {
    const { ctx, page } = await newCtx(`resp-${label}`, { viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    await login(page);
    const bad = [];
    for (const r of [...routes, '/welcome', '/login']) {
      if (r === '/login') await page.request.post(`${server.base}/api/auth/logout`).catch(() => {});
      await page.goto(server.base + r, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(250);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (o.sw > o.cw + 1) bad.push(`${r}: ${o.sw}>${o.cw}`);
    }
    if (label === '390') { await login(page).catch(() => {}); await page.goto(server.base + '/'); await page.locator('.post').first().waitFor().catch(() => {}); await shot(page, '09-mobile-feed'); assert.ok(await page.locator('.tabbar').isVisible()); assert.ok(!(await page.locator('.sidebar').isVisible())); }
    await ctx.close();
    assert.equal(bad.length, 0, 'تجاوز أفقي: ' + bad.join(' | '));
  });
}
await step('الجوال: النشر ثم الإعجاب باللمس ثم الفيديوهات', async () => {
  const { ctx, page } = await newCtx('mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await login(page);
  const id = await publish(page, files.g2, 'من الجوال #جوال');
  await page.tap('button[aria-label="إعجاب"]');
  await page.waitForFunction(() => document.querySelector('button[aria-label="إعجاب"]').getAttribute('aria-pressed') === 'true');
  await page.goto(server.base + '/videos'); await page.locator('.reel').first().waitFor();
  const h = await page.evaluate(() => ({ reel: document.querySelector('.reel').getBoundingClientRect().height, view: innerHeight }));
  assert.ok(h.reel > h.view * 0.7, 'الفيديو يملأ الشاشة');
  await ctx.close();
});

await browser.close();
await server.stop();
fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} خطوة نجحت`);
const uniq = [...new Set(problems)];
if (uniq.length) { console.log(`\n⚠ ${uniq.length} مشكلة في المتصفح/الخادم:`); uniq.forEach((p) => console.log('  - ' + p)); }
process.exit(failed.length || uniq.length ? 1 : 0);
