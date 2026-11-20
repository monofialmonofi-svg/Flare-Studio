// معالجة الوسائط: التحقق من المحتوى الحقيقي للملف، ضغط الصور وإنشاء أحجام متعددة،
// وتحويل الفيديو إلى MP4 (H.264/AAC) مع faststart وصورة غلاف.
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import { config } from './config.js';
import { badRequest, HttpError } from './errors.js';
import { storage, newKey, tmpPath } from './storage.js';

export const IMAGE_WIDTHS = [320, 800, 1600];
const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif']);

sharp.cache(false);

// ---------- قفل بسيط لتحديد عدد عمليات التحويل المتزامنة ----------
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const job = queue.shift();
    job();
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() =>
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          }),
      );
      next();
    });
}
const videoSlot = limiter(2);
const imageSlot = limiter(4);

// ---------- الصور ----------
async function readImageMeta(srcPath) {
  let meta;
  try {
    meta = await sharp(srcPath, { limitInputPixels: config.limits.maxPixels }).metadata();
  } catch {
    throw badRequest('bad_image', 'الملف ليس صورة صالحة');
  }
  if (!ALLOWED_IMAGE_FORMATS.has(meta.format) || !meta.width || !meta.height) {
    throw badRequest('bad_image', 'صيغة الصورة غير مدعومة (المدعوم: JPG, PNG, WebP, GIF, AVIF, HEIC)');
  }
  const swap = meta.orientation && meta.orientation >= 5;
  return { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height };
}

async function renderWebp(srcPath, { width, height, fit = 'inside', quality = 82 }) {
  return sharp(srcPath, { limitInputPixels: config.limits.maxPixels })
    .rotate() // يطبّق اتجاه EXIF ثم تُحذف البيانات الوصفية (الموقع والكاميرا) تلقائيًا
    .resize({ width, height, fit, withoutEnlargement: fit === 'inside' })
    .webp({ quality })
    .toBuffer();
}

/** صورة منشور: ثلاثة أحجام WebP مع الحفاظ على النسبة الأصلية دون تشويه. */
export function processPostImage(srcPath) {
  return imageSlot(async () => {
    const { width, height } = await readImageMeta(srcPath);
    const key = newKey('posts');
    const written = [];
    let size = 0;
    try {
      for (const w of IMAGE_WIDTHS) {
        const buf = await renderWebp(srcPath, { width: w });
        const k = `${key}-${w}.webp`;
        size += await storage.putBuffer(k, buf);
        written.push(k);
      }
    } catch (e) {
      await storage.removeMany(written);
      throw e;
    }
    return { type: 'image', key, poster: null, width, height, duration: null, size_bytes: size };
  });
}

export function processAvatar(srcPath) {
  return imageSlot(async () => {
    await readImageMeta(srcPath);
    const key = `${newKey('avatars')}.webp`;
    await storage.putBuffer(key, await renderWebp(srcPath, { width: 256, height: 256, fit: 'cover', quality: 85 }));
    return key;
  });
}

export function processCover(srcPath) {
  return imageSlot(async () => {
    await readImageMeta(srcPath);
    const key = `${newKey('covers')}.webp`;
    await storage.putBuffer(key, await renderWebp(srcPath, { width: 1500, height: 500, fit: 'cover', quality: 82 }));
    return key;
  });
}

// ---------- الفيديو ----------
function run(bin, args, { timeout = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '').slice(-600);
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

let ffmpegChecked;
export async function ffmpegAvailable() {
  if (ffmpegChecked === undefined) {
    ffmpegChecked = await run(config.ffmpeg, ['-version'], { timeout: 5000 }).then(
      () => run(config.ffprobe, ['-version'], { timeout: 5000 }).then(() => true),
    ).catch(() => false);
  }
  return ffmpegChecked;
}

export async function probeVideo(path) {
  let json;
  try {
    json = JSON.parse(
      await run(config.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { timeout: 30000 }),
    );
  } catch {
    throw badRequest('bad_video', 'الملف ليس فيديو صالحًا');
  }
  const v = (json.streams || []).find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = (json.streams || []).find((s) => s.codec_type === 'audio');
  if (!v || !v.width || !v.height) throw badRequest('bad_video', 'الملف لا يحتوي على مسار فيديو');
  const formats = String(json.format?.format_name || '');
  if (!/(mov|mp4|matroska|webm)/.test(formats)) throw badRequest('bad_video', 'صيغة الفيديو غير مدعومة (المدعوم: MP4, MOV, WebM, MKV)');
  const rotation = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 360;
  const swap = rotation === 90 || rotation === 270;
  const duration = Number(json.format?.duration ?? v.duration ?? 0);
  return {
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    duration,
    rotation,
    vcodec: v.codec_name,
    pixFmt: v.pix_fmt,
    acodec: a?.codec_name || null,
    container: formats,
  };
}

/** فيديو منشور: تحقق → (نسخ بدون إعادة ترميز إن كان متوافقًا أو تحويل إلى H.264) → غلاف WebP. */
export function processPostVideo(srcPath) {
  return videoSlot(async () => {
    if (!(await ffmpegAvailable())) throw new HttpError(503, 'video_unavailable', 'معالجة الفيديو غير متاحة حاليًا على الخادم');
    const info = await probeVideo(srcPath);
    if (info.duration <= 0) throw badRequest('bad_video', 'تعذّر تحديد مدة الفيديو');
    if (info.duration > config.limits.videoMaxSeconds) {
      throw badRequest('video_too_long', `مدة الفيديو يجب ألا تتجاوز ${Math.round(config.limits.videoMaxSeconds / 60)} دقائق`);
    }

    const compatible =
      info.vcodec === 'h264' && info.pixFmt === 'yuv420p' && (!info.acodec || info.acodec === 'aac') &&
      Math.max(info.width, info.height) <= 1920 && info.rotation === 0 && /(mp4|mov)/.test(info.container);

    const out = tmpPath('.mp4');
    const posterTmp = tmpPath('.jpg');
    const base = newKey('videos');
    const keys = [];
    try {
      const args = compatible
        ? ['-y', '-i', srcPath, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', out]
        : [
            '-y', '-i', srcPath, '-map', '0:v:0', '-map', '0:a:0?',
            '-vf', "scale='trunc(if(gt(iw,ih),min(1280,iw),min(1080,iw))/2)*2':-2",
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k', '-map_metadata', '-1', '-movflags', '+faststart', out,
          ];
      try {
        await run(config.ffmpeg, args);
      } catch (e) {
        throw badRequest('video_failed', 'تعذّرت معالجة الفيديو، تأكد أن الملف سليم');
      }
      const final = await probeVideo(out);

      const at = Math.min(1, final.duration / 2);
      const grab = (t) => run(config.ffmpeg, ['-y', '-ss', String(t), '-i', out, '-frames:v', '1', '-q:v', '3', posterTmp], { timeout: 60000 });
      await grab(at).catch(() => grab(0));
      const posterBuf = await sharp(posterTmp).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();

      const videoKey = `${base}.mp4`;
      const posterKey = `${base}-poster.webp`;
      let size = await storage.putFile(videoKey, out);
      keys.push(videoKey);
      size += await storage.putBuffer(posterKey, posterBuf);
      keys.push(posterKey);
      return {
        type: 'video', key: videoKey, poster: posterKey,
        width: final.width, height: final.height, duration: Math.round(final.duration * 100) / 100, size_bytes: size,
      };
    } catch (e) {
      await storage.removeMany(keys);
      throw e;
    } finally {
      await fs.rm(out, { force: true }).catch(() => {});
      await fs.rm(posterTmp, { force: true }).catch(() => {});
    }
  });
}

/** كل ملفات منشور/وسيط لحذفها من التخزين. */
export function mediaFileKeys(m) {
  if (m.type === 'video') return [m.key, m.poster];
  return IMAGE_WIDTHS.map((w) => `${m.key}-${w}.webp`);
}
