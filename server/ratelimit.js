// محدِّد معدل بسيط في الذاكرة (عملية واحدة). للتوسّع الأفقي: انقله إلى Redis بنفس الواجهة.
import { tooMany } from './errors.js';
import { clientIp } from './util.js';

export function rateLimit({ windowMs, max, key = (req) => clientIp(req), message }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  }, Math.min(windowMs, 60000));
  timer.unref();
  return (req, res, next) => {
    const k = key(req);
    const t = Date.now();
    let e = hits.get(k);
    if (!e || e.reset <= t) hits.set(k, (e = { count: 0, reset: t + windowMs }));
    e.count++;
    if (e.count > max) {
      const retry = Math.ceil((e.reset - t) / 1000);
      res.setHeader('Retry-After', retry);
      return next(tooMany(message, { retryAfter: retry }));
    }
    next();
  };
}
