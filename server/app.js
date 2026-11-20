import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config.js';
import { loadUser, originCheck, purgeOldAttempts } from './auth.js';
import { HttpError, notFound } from './errors.js';
import { rateLimit } from './ratelimit.js';
import { mediaRoot } from './storage.js';
import { ffmpegAvailable } from './media.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import postRoutes, { commentsRouter } from './routes/posts.js';
import feedRoutes from './routes/feed.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

  const mediaOrigin = /^https?:\/\//.test(config.mediaBaseUrl) ? new URL(config.mediaBaseUrl).origin : null;
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', ...(mediaOrigin ? [mediaOrigin] : [])],
        'media-src': ["'self'", 'blob:', ...(mediaOrigin ? [mediaOrigin] : [])],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: config.isProd ? undefined : false,
  }));
  app.use(compression());

  // الوسائط: أسماء الملفات عشوائية وغير قابلة للتخمين وغير متغيرة => كاش طويل. يدعم Range للفيديو.
  app.use('/media', express.static(mediaRoot, {
    index: false, dotfiles: 'ignore', maxAge: '365d', immutable: true, acceptRanges: true,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use(loadUser);
  api.use(originCheck);
  api.use(rateLimit({ windowMs: 60e3, max: config.rate.apiPerMinute, message: 'طلبات كثيرة، انتظر قليلًا' }));
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use('/auth', authRoutes);
  api.use('/users', userRoutes);
  api.use('/posts', postRoutes);
  api.use('/comments', commentsRouter);
  api.use('/notifications', notificationRoutes);
  api.use('/reports', reportRoutes);
  api.use('/admin', adminRoutes);
  api.use('/', feedRoutes);
  api.use((req, res, next) => next(notFound('المسار غير موجود')));
  app.use('/api', api);

  // الواجهة
  const staticOpts = { index: false, maxAge: 0, etag: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
  app.use(express.static(config.publicDir, staticOpts));
  app.get(/^\/admin(\/.*)?$/, (req, res) => res.sendFile(path.join(config.publicDir, 'admin.html')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || path.extname(req.path)) return next(notFound());
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  // معالج الأخطاء
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'bad_json', 'صيغة الطلب غير صحيحة');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'too_large', 'الطلب كبير جدًا');
    if (!(err instanceof HttpError)) {
      console.error('[error]', req.method, req.originalUrl, err);
      err = new HttpError(500, 'server_error', 'حدث خطأ غير متوقع');
    }
    if (res.headersSent) return;
    const accepts = req.path.startsWith('/api/');
    if (!accepts) return res.status(err.status).send(err.message);
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } });
  });

  return app;
}

export async function startMaintenance() {
  purgeOldAttempts();
  setInterval(purgeOldAttempts, 60 * 60 * 1000).unref();
  if (!(await ffmpegAvailable())) console.warn('[warn] ffmpeg/ffprobe غير موجودين: رفع الفيديو معطّل حتى تثبيتهما.');
}
