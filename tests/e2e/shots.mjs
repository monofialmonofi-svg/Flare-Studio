import { createRequire } from 'node:module';
import fs from 'node:fs';
import { startServer } from '../helpers.mjs';
import { seed } from './seed.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

const server = await startServer();
const data = await seed(server);
const browser = await chromium.launch();
const errors = [];
async function ctxFor(kind, user) {
  const opts = kind === 'mobile' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : kind === 'tablet' ? { viewport: { width: 820, height: 1100 } } : { viewport: { width: 1360, height: 900 } };
  const ctx = await browser.newContext({ ...opts, locale: 'ar' });
  if (user) { const [n, v] = user.cookie.split('='); await ctx.addCookies([{ name: n, value: v, url: server.base }]); }
  const page = await ctx.newPage();
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`[${kind}] console.${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${kind}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[${kind}] reqfailed ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && !r.url().includes('/api/') && errors.push(`[${kind}] http ${r.status()} ${r.url()}`));
  return { ctx, page };
}
const shots = [
  ['welcome', '/welcome', null], ['login', '/login', null], ['signup', '/signup', null],
  ['feed', '/', 'hossam'], ['explore', '/explore', 'hossam'], ['profile', '/u/mona', 'hossam'], ['post-gallery', `/post/${data.posts.gallery.id}`, 'hossam'],
  ['post-landscape', `/post/${data.posts.landscape.id}`, 'hossam'], ['videos', '/videos', 'hossam'], ['create', '/create', 'hossam'], ['notifications', '/notifications', 'mona'],
  ['people', '/people', 'hossam'], ['settings', '/settings', 'hossam'], ['privacy', '/settings/privacy', 'hossam'], ['edit-profile', '/settings/profile', 'mona'], ['search', '/search?q=%D8%B3%D9%81%D8%B1&type=posts', 'hossam'],
  ['admin-overview', '/admin#overview', 'hossam'], ['admin-users', '/admin#users', 'hossam'], ['admin-posts', '/admin#posts', 'hossam'], ['admin-reports', '/admin#reports', 'hossam'], ['admin-audit', '/admin#audit', 'hossam'],
];
for (const kind of (process.env.KINDS || 'mobile,desktop').split(',')) {
  for (const [name, url, who] of shots) {
    const { ctx, page } = await ctxFor(kind, who ? data[who] : null);
    await page.goto(server.base + url, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${kind}-${name}.png`, fullPage: false });
    await ctx.close();
  }
}
await browser.close();
await server.stop();
console.log('errors:', errors.length); [...new Set(errors)].slice(0, 40).forEach((e) => console.log(e));
