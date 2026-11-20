// الهيكل العام: شريط علوي + تنقل جانبي (حاسوب/تابلت) + شريط سفلي (جوال).
import { h, clear, $, $$ } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { state, on, setUnread } from './state.js';
import { navigate } from './router.js';
import { get, post } from './api.js';
import { toast } from './ui.js';

let mode = null; // 'app' | 'bare'
const root = () => document.getElementById('root');

export function setTitle(s) { document.title = s ? `${s} · لَمّة` : 'LAMMA | لَمّة — كل لحظاتنا في مكان واحد'; }

const navItems = () => (state.user
  ? [
    { href: '/', icon: 'home', label: t('الرئيسية'), match: (p) => p === '/' },
    { href: '/explore', icon: 'compass', label: t('استكشاف'), match: (p) => p.startsWith('/explore') || p.startsWith('/search') || p.startsWith('/tag/') },
    { href: '/videos', icon: 'film', label: t('الفيديوهات'), match: (p) => p.startsWith('/videos') },
    { href: '/notifications', icon: 'bell', label: t('الإشعارات'), match: (p) => p.startsWith('/notifications'), badge: true },
    { href: '/people', icon: 'users', label: t('المستخدمون'), match: (p) => p.startsWith('/people') },
    { href: '/saved', icon: 'bookmark', label: t('المحفوظات'), match: (p) => p.startsWith('/saved') },
    { href: `/u/${state.user.username}`, icon: 'user', label: t('ملفي الشخصي'), match: (p) => p === `/u/${state.user.username}` || p.startsWith(`/u/${state.user.username}/`) },
    { href: '/settings', icon: 'sliders', label: t('الإعدادات'), match: (p) => p.startsWith('/settings') },
  ]
  : [
    { href: '/welcome', icon: 'home', label: t('الرئيسية'), match: (p) => p === '/welcome' || p === '/' },
    { href: '/explore', icon: 'compass', label: t('استكشاف'), match: (p) => p.startsWith('/explore') || p.startsWith('/search') || p.startsWith('/tag/') },
    { href: '/videos', icon: 'film', label: t('الفيديوهات'), match: (p) => p.startsWith('/videos') },
  ]);

function brand() {
  return h('a', { class: 'brand', href: state.user ? '/' : '/welcome', 'data-link': '', 'aria-label': 'LAMMA لَمّة' },
    h('img', { src: '/icons/logo.svg', alt: '', width: 34, height: 34 }), h('b', null, 'LAMMA'), h('small', null, '| لَمّة'));
}

function buildApp() {
  const input = h('input', { type: 'search', name: 'q', placeholder: t('ابحث عن أشخاص ومنشورات ووسوم'), 'aria-label': t('بحث'), enterkeyhint: 'search', autocomplete: 'off' });
  const search = h('form', {
    class: 'search-mini', role: 'search',
    onSubmit: (e) => { e.preventDefault(); const q = input.value.trim(); if (q) navigate(`/search?q=${encodeURIComponent(q)}`); },
  }, icon('search', 'sm'), input);

  const guestActions = h('div', { class: 'row' },
    h('a', { class: 'btn ghost sm', href: '/login', 'data-link': '' }, t('دخول')),
    h('a', { class: 'btn primary sm', href: '/signup', 'data-link': '' }, t('إنشاء حساب')));
  const userActions = h('div', { class: 'row', style: { gap: '.15rem' } },
    h('a', { class: 'icon-btn mobile-only', href: '/search', 'data-link': '', 'aria-label': t('بحث') }, icon('search')),
    h('a', { class: 'icon-btn mobile-only', href: '/notifications', 'data-link': '', 'aria-label': t('الإشعارات'), 'data-nav-bell': '' }, icon('bell')));

  const topbar = h('header', { class: 'topbar' }, brand(), search, state.user ? userActions : guestActions);

  const links = navItems().map((n) => h('a', { class: 'nav-link', href: n.href, 'data-link': '', 'data-match': n.href, 'aria-label': n.label },
    icon(n.icon), h('span', { class: 't' }, n.label), n.badge ? h('span', { class: 'badge', hidden: true, 'data-badge': '' }) : null));
  const sidebar = h('nav', { class: 'sidebar', 'aria-label': t('التنقل الرئيسي') }, links,
    state.user ? h('a', { class: 'btn primary create', href: '/create', 'data-link': '' }, icon('plus', 'sm'), t('منشور جديد')) : null);

  const tabs = state.user
    ? [['/', 'home', t('الرئيسية')], ['/explore', 'compass', t('استكشاف')], ['/create', 'plus', t('نشر'), true], ['/videos', 'film', t('فيديو')], [`/u/${state.user.username}`, 'user', t('ملفي')]]
    : [['/welcome', 'home', t('الرئيسية')], ['/explore', 'compass', t('استكشاف')], ['/videos', 'film', t('الفيديوهات')]];
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': t('التنقل السفلي'), style: !state.user ? { gridTemplateColumns: 'repeat(3,1fr)' } : null },
    tabs.map(([href, ic, label, fab]) => h('a', { class: `tab${fab ? ' create' : ''}`, href, 'data-link': '', 'data-match': href, 'aria-label': label },
      fab ? h('span', { class: 'fab' }, icon(ic)) : icon(ic), fab ? null : h('span', null, label))));

  const rail = h('aside', { class: 'rail', id: 'rail', 'aria-label': t('اقتراحات') });
  const view = h('main', { id: 'view', tabindex: '-1' });
  const layout = h('div', { class: 'layout' }, sidebar, h('div', { class: 'main-col' }, h('div', { id: 'banner' }), view), rail);
  return h('div', { class: 'app' }, topbar, layout, tabbar);
}

export function ensureApp() {
  if (mode !== 'app' || root().dataset.user !== String(state.user?.id ?? 0)) {
    clear(root()).append(buildApp());
    root().dataset.user = String(state.user?.id ?? 0);
    mode = 'app';
    paintBadge();
    paintBanner();
  }
  document.body.classList.remove('reels-page');
  clear($('#rail'));
  return clear($('#view'));
}
export function ensureBare() {
  mode = 'bare';
  delete root().dataset.user;
  document.body.classList.remove('reels-page');
  return clear(root());
}

export function markActive(path) {
  const items = navItems();
  $$('[data-match]').forEach((a) => {
    const n = items.find((x) => x.href === a.dataset.match) || { match: (p) => p === a.dataset.match };
    const active = n.match(path);
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function paintBadge() {
  $$('[data-badge]').forEach((b) => { b.hidden = !state.unread; b.textContent = state.unread > 99 ? '99+' : state.unread; });
  const bell = $('[data-nav-bell]');
  if (bell) {
    bell.querySelector('.badge')?.remove();
    if (state.unread) bell.append(h('span', { class: 'badge' }, state.unread > 99 ? '99+' : state.unread));
  }
}
on('unread', paintBadge);

export function paintBanner() {
  const el = $('#banner');
  if (!el) return;
  clear(el);
  if (state.user && !state.user.emailVerified) {
    const b = h('button', {
      class: 'btn primary sm',
      onClick: async () => {
        b.disabled = true;
        try { await post('/auth/resend-verification'); toast(t('أرسلنا رابط التأكيد إلى بريدك'), 'success'); } catch (e) { toast(e.message, 'error'); } finally { b.disabled = false; }
      },
    }, t('إعادة إرسال الرابط'));
    el.append(h('div', { class: 'verify-banner', role: 'status' }, icon('mail', 'sm'),
      h('span', { class: 'grow' }, t('أكّد بريدك الإلكتروني لتأمين حسابك واستعادته عند الحاجة.')), b));
  }
}

// ---- الإشعارات غير المقروءة ----
export async function refreshUnread() {
  if (!state.user) return;
  try { setUnread((await get('/notifications/unread-count')).count); } catch { /* تجاهل أخطاء الشبكة المؤقتة */ }
}
let pollTimer;
export function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => document.visibilityState === 'visible' && refreshUnread(), 45000);
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshUnread());

/** يملأ العمود الجانبي (حاسوب) باقتراحات المتابعة والوسوم الرائجة. */
export async function fillRail() {
  const rail = $('#rail');
  if (!rail || getComputedStyle(rail).display === 'none') return;
  try {
    const { userRow } = await import('./components.js');
    const ex = await get('/explore');
    if (!document.body.contains(rail)) return;
    clear(rail);
    if (ex.suggestedUsers.length) {
      rail.append(h('div', { class: 'card' },
        h('div', { class: 'section-title', style: { margin: '.9rem 1rem .2rem' } }, t('أشخاص قد تعرفهم')),
        ex.suggestedUsers.slice(0, 4).map((u) => userRow(u, { sub: t('{n} متابِع', { n: u.counts.followers }) }))));
    }
    if (ex.trendingTags.length) {
      rail.append(h('div', { class: 'card pad' },
        h('div', { class: 'section-title', style: { margin: '0 0 .6rem' } }, t('الوسوم الرائجة')),
        h('div', { class: 'chips' }, ex.trendingTags.slice(0, 8).map((x) => h('a', { class: 'chip', href: `/tag/${encodeURIComponent(x.name)}`, 'data-link': '' }, `#${x.name}`)))));
    }
    rail.append(h('p', { class: 'xs faint', style: { padding: '0 .5rem' } }, 'LAMMA | لَمّة · كل لحظاتنا في مكان واحد'));
  } catch { /* العمود الجانبي اختياري */ }
}
