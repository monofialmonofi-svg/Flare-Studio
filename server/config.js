import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const MB = 1024 * 1024;

const isProd = env.NODE_ENV === 'production';
const port = num(env.PORT, 3000);

export const config = {
  root,
  isProd,
  port,
  appUrl: (env.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
  publicDir: path.join(root, 'public'),
  // قاعدة عنوان الوسائط: اجعلها عنوان CDN في الإنتاج (مثال: https://cdn.example.com/media)
  mediaBaseUrl: (env.MEDIA_BASE_URL || '/media').replace(/\/$/, ''),
  trustProxy: env.TRUST_PROXY ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY)) : false,
  // في الإنتاج: لا يمكن النشر قبل تأكيد البريد. في التطوير: اختياري ما لم يُفعَّل.
  requireVerifiedEmail: bool(env.REQUIRE_VERIFIED_EMAIL, isProd),
  adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'LAMMA <no-reply@lamma.local>',
  sessionDays: num(env.SESSION_DAYS, 30),
  ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: env.FFPROBE_PATH || 'ffprobe',
  limits: {
    imageBytes: num(env.MAX_IMAGE_MB, 15) * MB,
    videoBytes: num(env.MAX_VIDEO_MB, 200) * MB,
    avatarBytes: 5 * MB,
    maxImagesPerPost: 10,
    videoMaxSeconds: num(env.MAX_VIDEO_SECONDS, 600),
    captionLength: 2200,
    commentLength: 1000,
    bioLength: 160,
    maxTags: 15,
    maxPixels: 80e6,
  },
  rate: {
    signupPerHour: num(env.SIGNUP_LIMIT_PER_HOUR, 10),
    apiPerMinute: num(env.API_LIMIT_PER_MINUTE, 600),
    uploadsPerHour: num(env.UPLOAD_LIMIT_PER_HOUR, 40),
    loginMaxPerEmail: num(env.LOGIN_MAX_PER_EMAIL, 5),
    loginMaxPerIp: num(env.LOGIN_MAX_PER_IP, 30),
    loginWindowMs: num(env.LOGIN_WINDOW_MIN, 15) * 60 * 1000,
  },
};
