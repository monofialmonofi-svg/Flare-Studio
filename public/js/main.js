import { get } from './api.js';
import { state, setUser } from './state.js';
import { route, render, navigate } from './router.js';
import { ensureApp, markActive, setTitle, refreshUnread, startPolling } from './shell.js';
import { h } from './dom.js';
import { emptyState } from './ui.js';
import { t } from './i18n.js';
import * as auth from './views/auth.js';
import * as feed from './views/feed.js';
import * as profile from './views/profile.js';
import { create } from './views/create.js';
import { postPage } from './views/post.js';
import { notifications } from './views/notifications.js';
import { videos } from './views/reels.js';
import { settings, privacy, setTheme } from './views/settings.js';

// المسارات: auth = يتطلب تسجيل دخول، guest = للزوار فقط
route('/', (ctx) => (state.user ? feed.home(ctx) : auth.welcome(ctx)));
route('/welcome', auth.welcome);
route('/login', auth.login, { guest: true });
route('/signup', auth.signup, { guest: true });
route('/forgot', auth.forgot);
route('/reset', auth.reset);
route('/verify', auth.verify);
route('/explore', feed.explore);
route('/search', feed.search);
route('/tag/:tag', feed.tag);
route('/people', feed.people, { auth: true });
route('/videos', videos);
route('/videos/:id', videos);
route('/create', create, { auth: true });
route('/notifications', notifications, { auth: true });
route('/saved', profile.saved, { auth: true });
route('/post/:id', postPage);
route('/u/:username', profile.profile);
route('/u/:username/followers', profile.followList('followers'));
route('/u/:username/following', profile.followList('following'));
route('/settings', settings, { auth: true });
route('/settings/profile', profile.editProfile, { auth: true });
route('/settings/privacy', privacy, { auth: true });
route('/:any', () => {
  const view = ensureApp();
  markActive('');
  setTitle(t('الصفحة غير موجودة'));
  view.append(emptyState({ icon: 'compass', title: t('الصفحة غير موجودة'), text: t('الرابط الذي فتحته غير صحيح أو لم يعد متاحًا.'), action: h('a', { class: 'btn primary', href: '/', 'data-link': '' }, t('العودة للرئيسية')) }));
}, { notFound: true });

// تحديث عنصر التنقل النشط بعد كل تغيير مسار
const origPush = history.pushState;
history.pushState = function (...a) { const r = origPush.apply(this, a); queueMicrotask(() => markActive(location.pathname)); return r; };
addEventListener('popstate', () => queueMicrotask(() => markActive(location.pathname)));

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  try { if ((localStorage.getItem('lamma-theme') || 'auto') === 'auto') setTheme('auto'); } catch { /* تجاهل */ }
});

async function boot() {
  try {
    const me = await get('/auth/me');
    state.config = me.config;
    setUser(me.user);
  } catch (e) {
    document.getElementById('root').replaceChildren(h('div', { class: 'auth-shell' }, emptyState({ icon: 'alert', title: t('تعذّر الاتصال بالخادم'), text: e.message, action: h('button', { class: 'btn primary', onClick: () => location.reload() }, t('إعادة المحاولة')) })));
    return;
  }
  if (state.user) { refreshUnread(); startPolling(); }
  await render();
  markActive(location.pathname);
}
boot();
