// بذر بيانات تجريبية عبر الـAPI الحقيقي (للاختبار والفحص البصري فقط — لا يُستخدم في الإنتاج).
import sharp from 'sharp';
import { Client, newUser, makeAdmin, makeVideo } from '../helpers.mjs';

export async function art(w, h, hueA, hueB, shapes = 3) {
  const circles = Array.from({ length: shapes }, (_, i) => {
    const cx = (w * (0.2 + 0.3 * i)) | 0, cy = (h * (0.3 + 0.2 * i)) | 0, r = Math.min(w, h) * (0.15 + 0.05 * i);
    return `<circle cx="${cx}" cy="${cy}" r="${r | 0}" fill="hsla(${(hueA + 50 * i) % 360},85%,70%,.55)"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hueA},75%,55%)"/><stop offset="1" stop-color="hsl(${hueB},80%,45%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${circles}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}
const file = (buffer, name = 'a.jpg', type = 'image/jpeg') => ({ buffer, name, type });

export async function seed(server) {
  const hossam = await newUser(server, 'hossam', { displayName: 'حسام الدين مصطفى' });
  await makeAdmin(server, hossam.email);
  const mona = await newUser(server, 'mona', { displayName: 'منى السيد' });
  const ali = await newUser(server, 'ali_k', { displayName: 'علي كمال' });
  const sara = await newUser(server, 'sara.m', { displayName: 'سارة محمود' });
  await mona.patch('/api/users/me', { bio: 'مصوّرة ومحبّة للسفر 📷 — أوثّق اللحظات الصغيرة' });
  await mona.upload('/api/users/me/avatar', {}, [{ field: 'file', buffer: await art(300, 300, 320, 20), name: 'a.jpg', type: 'image/jpeg' }]);
  await mona.upload('/api/users/me/cover', {}, [{ field: 'file', buffer: await art(1600, 600, 260, 330, 5), name: 'c.jpg', type: 'image/jpeg' }]);

  const P = async (c, caption, files) => (await c.upload('/api/posts', { caption }, files)).data.post;
  const landscape = await P(mona, 'غروب الشمس على الكورنيش 🌅 #غروب #سفر', [file(await art(1600, 1000, 18, 300))]);
  const portrait = await P(ali, 'صورة طولية لبرج المدينة #عمارة', [file(await art(900, 1500, 200, 260, 4))]);
  const gallery = await P(mona, 'رحلتنا الأخيرة إلى الجبل ⛰️ — أربع لقطات من أجمل ما صوّرنا #سفر #جبال', [file(await art(1200, 800, 140, 200)), file(await art(800, 1200, 30, 340, 2)), file(await art(1000, 1000, 270, 20, 5)), file(await art(1800, 600, 200, 120))]);
  const square = await P(sara, 'قهوة الصباح ☕', [file(await art(1080, 1080, 28, 8, 2))]);
  const vVideo = await P(ali, 'لقطة عمودية سريعة 🎬 #ريلز', [file(makeVideo({ w: 360, h: 640, seconds: 4 }), 'v.mp4', 'video/mp4')]);
  const hVideo = await P(sara, 'فيديو أفقي من الرحلة #سفر', [file(makeVideo({ w: 640, h: 360, seconds: 4 }), 'h.mp4', 'video/mp4')]);

  await hossam.post('/api/users/mona/follow'); await hossam.post('/api/users/ali_k/follow');
  await sara.post('/api/users/mona/follow'); await mona.post('/api/users/hossam/follow');
  for (const c of [hossam, sara, ali]) await c.post(`/api/posts/${landscape.id}/like`);
  await hossam.post(`/api/posts/${gallery.id}/like`); await hossam.post(`/api/posts/${vVideo.id}/like`);
  const c1 = (await sara.post(`/api/posts/${landscape.id}/comments`, { body: 'صورة رائعة جدًا! الألوان خيالية 😍' })).data.comment;
  await mona.post(`/api/posts/${landscape.id}/comments`, { body: 'شكرًا يا سارة ❤️', parentId: c1.id });
  await ali.post(`/api/posts/${landscape.id}/comments`, { body: 'أين التُقطت؟ #سؤال' });
  await ali.post('/api/users/hossam/follow');
  await hossam.post(`/api/posts/${hVideo.id}/save`);
  await sara.post('/api/reports', { targetType: 'post', targetId: portrait.id, reason: 'spam', details: 'يبدو كإعلان مدفوع' });
  await mona.post('/api/reports', { targetType: 'user', targetId: ali.user.id, reason: 'impersonation' });
  return { hossam, mona, ali, sara, posts: { landscape, portrait, gallery, square, vVideo, hVideo } };
}
