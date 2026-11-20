// لوحة الإدارة. كل البيانات تأتي من /api/admin/* المحمية بصلاحيات حقيقية من الخادم.
import { h, clear, avatar, handle, withLoading, button, debounce } from './dom.js';
import { icon } from './icons.js';
import { t, fmtNumber, fmtBytes, fmtDate, timeAgo } from './i18n.js';
import { get, post, del } from './api.js';
import { toast, modal, confirmDialog, emptyState, errorState, skeletonRows } from './ui.js';

const root = document.getElementById('root');
let me = null;

const SECTIONS = [
  ['overview', t('نظرة عامة'), 'grid'], ['users', t('المستخدمون'), 'users'], ['posts', t('المنشورات'), 'image'],
  ['reports', t('البلاغات'), 'flag'], ['audit', t('سجل الإجراءات'), 'shield'],
];
const REASONS = { spam: 'مزعج/إعلانات', abuse: 'إساءة', nudity: 'غير لائق', violence: 'عنف', misinformation: 'تضليل', impersonation: 'انتحال', other: 'آخر' };
const ACTION_LABEL = { 'user.ban': 'حظر مستخدم', 'user.unban': 'إلغاء حظر', 'user.role': 'تغيير صلاحية', 'user.delete': 'حذف مستخدم', 'post.delete': 'حذف منشور', 'comment.delete': 'حذف تعليق', 'report.dismiss': 'تجاهل بلاغ', 'report.remove_content': 'بلاغ: حذف المحتوى', 'report.ban_user': 'بلاغ: حظر المستخدم' };

async function boot() {
  try { me = (await get('/auth/me')).user; } catch (e) { return showFatal(e.message); }
  if (!me) return showLogin();
  if (me.role !== 'admin') return showDenied();
  showApp();
}

function showFatal(msg) { clear(root).append(h('div', { class: 'auth-shell' }, errorState(msg, () => location.reload()))); }

function showLogin() {
  const id = h('input', { class: 'input', name: 'identifier', autocomplete: 'username', dir: 'ltr', placeholder: t('البريد أو اسم المستخدم'), 'aria-label': t('البريد أو اسم المستخدم'), required: true });
  const pw = h('input', { class: 'input', type: 'password', name: 'password', autocomplete: 'current-password', dir: 'ltr', placeholder: t('كلمة المرور'), 'aria-label': t('كلمة المرور'), required: true });
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, t('دخول'));
  clear(root).append(h('div', { class: 'auth-shell' }, h('div', { class: 'card auth-card' },
    h('a', { class: 'brand', href: '/admin' }, h('img', { src: '/icons/logo.svg', alt: '', width: 40, height: 40 }), h('b', null, 'LAMMA'), h('small', null, t('الإدارة'))),
    h('h1', null, t('لوحة الإدارة')), h('p', { class: 'sub' }, t('للمسؤولين فقط. سجّل الدخول بحساب مسؤول.')),
    h('form', { class: 'col', onSubmit: async (e) => {
      e.preventDefault(); err.hidden = true;
      await withLoading(btn, async () => { try { await post('/auth/login', { identifier: id.value, password: pw.value }); await boot(); } catch (ex) { err.hidden = false; err.textContent = ex.message; } });
    } }, id, pw, err, btn))));
}

function showDenied() {
  clear(root).append(h('div', { class: 'auth-shell' }, h('div', { class: 'card auth-card' }, emptyState({ icon: 'lock', title: t('غير مصرّح'), text: t('حسابك لا يملك صلاحية الدخول إلى لوحة الإدارة.'),
    action: h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, h('a', { class: 'btn primary', href: '/' }, t('العودة إلى لَمّة')), h('button', { class: 'btn outline', onClick: async () => { await post('/auth/logout'); location.reload(); } }, t('تسجيل الخروج'))) }))));
}

let current = null, cleanup = null;
const main = h('main', { class: 'adm-main', id: 'adm-main', tabindex: '-1' });
const nav = h('nav', { class: 'adm-nav', 'aria-label': t('أقسام الإدارة') });

function showApp() {
  clear(nav).append(...SECTIONS.map(([id, label, ic]) => h('a', { href: `#${id}`, 'data-id': id }, icon(ic, 'sm'), label, id === 'reports' ? h('span', { class: 'badge', hidden: true, id: 'rep-badge' }) : null)));
  clear(root).append(h('div', { class: 'adm' },
    h('header', { class: 'adm-top' }, h('a', { class: 'brand', href: '/admin' }, h('img', { src: '/icons/logo.svg', alt: '', width: 34, height: 34 }), h('b', null, 'LAMMA'), h('small', null, t('الإدارة'))),
      h('div', { class: 'who' }, h('span', null, me.displayName), h('a', { class: 'btn sm', href: '/' }, t('الموقع')),
        h('button', { class: 'btn sm', onClick: async () => { await post('/auth/logout'); location.reload(); } }, icon('logout', 'sm'), t('خروج')))),
    h('div', { class: 'adm-body' }, nav, main)));
  addEventListener('hashchange', route);
  route();
  refreshBadge();
}
async function refreshBadge() {
  try { const s = await get('/admin/stats'); const b = document.getElementById('rep-badge'); if (b) { b.hidden = !s.reports.open; b.textContent = s.reports.open; } } catch { /* غير حرج */ }
}

function route() {
  const id = (location.hash || '#overview').slice(1);
  const sec = SECTIONS.find((s) => s[0] === id) || SECTIONS[0];
  if (typeof cleanup === 'function') cleanup();
  current = sec[0];
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.id === current));
  document.title = `${sec[1]} · ${t('إدارة لَمّة')}`;
  clear(main);
  cleanup = { overview, users, posts, reports, audit }[current]();
}

const statCard = (ic, k, v, s, warn) => h('div', { class: `card stat${warn ? ' warn' : ''}` }, h('span', { class: 'ico' }, icon(ic, 'sm')), h('span', { class: 'k' }, k), h('span', { class: 'v' }, fmtNumber(v)), s ? h('span', { class: 's' }, s) : null);

function barChart(title, series, cls = '') {
  const max = Math.max(1, ...series.map((x) => x.count));
  const total = series.reduce((a, b) => a + b.count, 0);
  return h('div', { class: 'card chart' }, h('h3', null, title), h('div', { class: 'total' }, t('آخر 7 أيام: {n}', { n: fmtNumber(total) })),
    h('div', { class: 'bars', role: 'img', 'aria-label': `${title}: ${series.map((x) => x.count).join(', ')}` }, series.map((x) =>
      h('div', { class: `bar ${cls}` }, h('span', null, x.count || ''), h('i', { style: { height: `${Math.max(3, (x.count / max) * 80)}px` } }), h('span', null, x.date.slice(5))))));
}

function overview() {
  main.append(h('h1', { style: { marginBottom: '1rem' } }, t('نظرة عامة')), h('div', { class: 'stat-grid' }, ...Array(8).fill(0).map(() => h('div', { class: 'card stat skeleton', style: { height: '98px' } }))));
  let dead = false;
  get('/admin/stats').then((s) => {
    if (dead) return;
    const total = Math.max(1, s.storage.totalBytes);
    clear(main).append(h('div', { class: 'row between', style: { marginBottom: '1rem' } }, h('h1', null, t('نظرة عامة')), h('button', { class: 'btn outline sm', onClick: route }, icon('refresh', 'sm'), t('تحديث'))),
      h('div', { class: 'stat-grid' },
        statCard('users', t('المستخدمون'), s.users.total, t('{a} نشط · {b} محظور', { a: s.users.active, b: s.users.banned })),
        statCard('user', t('جدد (7 أيام)'), s.users.new7d, t('نشطون آخر 24 ساعة: {n}', { n: s.users.active24h })),
        statCard('image', t('المنشورات'), s.posts.total, t('{a} صور · {b} فيديو', { a: s.posts.images, b: s.posts.videos })),
        statCard('flag', t('بلاغات مفتوحة'), s.reports.open, t('من أصل {n}', { n: s.reports.total }), s.reports.open > 0),
        statCard('comment', t('التعليقات'), s.engagement.comments), statCard('heart', t('الإعجابات'), s.engagement.likes), statCard('eye', t('مشاهدات الفيديو'), s.engagement.views),
        h('div', { class: 'card stat' }, h('span', { class: 'ico' }, icon('upload', 'sm')), h('span', { class: 'k' }, t('حجم الوسائط المرفوعة')), h('span', { class: 'v' }, fmtBytes(s.storage.totalBytes)), h('span', { class: 's' }, t('في المنشورات')))),
      h('div', { class: 'card pad', style: { marginTop: '.75rem' } }, h('h3', null, t('توزيع حجم الوسائط')),
        h('div', { class: 'storage-bar' }, h('i', { style: { width: `${(s.storage.videoBytes / total) * 100}%`, background: 'var(--purple-600)' } }), h('i', { style: { width: `${(s.storage.imageBytes / total) * 100}%`, background: 'var(--coral-500)' } })),
        h('div', { class: 'legend' }, h('span', null, h('i', { class: 'dot', style: { background: 'var(--purple-600)' } }), t('فيديو'), ' ', h('b', null, fmtBytes(s.storage.videoBytes))), h('span', null, h('i', { class: 'dot', style: { background: 'var(--coral-500)' } }), t('صور'), ' ', h('b', null, fmtBytes(s.storage.imageBytes))))),
      h('div', { class: 'charts' }, barChart(t('تسجيلات جديدة'), s.activity.signups), barChart(t('منشورات جديدة'), s.activity.posts, 'coral'), barChart(t('تعليقات جديدة'), s.activity.comments, 'green')));
    const b = document.getElementById('rep-badge'); if (b) { b.hidden = !s.reports.open; b.textContent = s.reports.open; }
  }).catch((e) => { if (!dead) clear(main).append(errorState(e.message, route)); });
  return () => { dead = true; };
}

// ---------- قائمة مرقّمة عامة ----------
function pager(host, loader, render, empty) {
  let cursor, loading = false;
  const more = h('button', { class: 'btn outline block', style: { marginTop: '1rem' }, hidden: true }, t('عرض المزيد'));
  host.append(more);
  const slot = h('div'); host.insertBefore(slot, more);
  async function load(reset) {
    if (loading) return; loading = true;
    if (reset) { cursor = undefined; clear(slot); slot.append(skeletonRows(3)); }
    try {
      const r = await loader(cursor);
      if (reset) clear(slot);
      cursor = r.nextCursor;
      if (!r.items.length && reset) slot.append(empty); else render(r.items, slot, reset);
      more.hidden = !cursor;
    } catch (e) { clear(slot); slot.append(errorState(e.message, () => load(true))); } finally { loading = false; }
  }
  more.onclick = () => withLoading(more, () => load(false));
  return { reload: () => load(true) };
}

// ---------- المستخدمون ----------
function users() {
  let q = '', status = '';
  const search = h('input', { class: 'input', type: 'search', placeholder: t('بحث بالاسم أو البريد أو اسم المستخدم'), 'aria-label': t('بحث') });
  const sel = h('select', { class: 'select', 'aria-label': t('الحالة') }, h('option', { value: '' }, t('كل الحالات')), h('option', { value: 'active' }, t('نشط')), h('option', { value: 'banned' }, t('محظور')));
  const host = h('div');
  main.append(h('h1', { style: { marginBottom: '1rem' } }, t('إدارة المستخدمين')), h('div', { class: 'toolbar' }, search, sel), host);
  let table, body;
  const p = pager(host, (c) => get(`/admin/users?limit=25&q=${encodeURIComponent(q)}&status=${status}${c ? `&cursor=${c}` : ''}`), (items, slot, reset) => {
    if (reset) { body = h('tbody'); table = h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['المستخدم', 'البريد', 'الحالة', 'منشورات', 'انضم', 'آخر نشاط', ''].map((x) => h('th', null, t(x))))), body)); slot.append(table); }
    items.forEach((u) => body.append(row(u)));
  }, emptyState({ icon: 'users', title: t('لا يوجد مستخدمون مطابقون') }));
  function row(u) {
    const tr = h('tr', { 'data-user': u.username });
    const paint = (u) => {
      clear(tr).append(
        h('td', null, h('div', { class: 'u' }, avatar(u, 38), h('div', null, h('b', null, u.displayName), h('span', null, handle(u.username))))),
        h('td', { class: 'ltr', style: { fontSize: '.85rem' } }, u.email, ' ', u.emailVerified ? null : h('span', { class: 'pill warn' }, t('غير مؤكد'))),
        h('td', null, u.status === 'banned' ? h('span', { class: 'pill red', title: u.banReason || '' }, t('محظور')) : h('span', { class: 'pill' }, t('نشط')), u.role === 'admin' ? [' ', h('span', { class: 'pill purple' }, t('مسؤول'))] : null),
        h('td', null, fmtNumber(u.counts.posts)), h('td', { class: 'xs muted' }, timeAgo(u.createdAt)), h('td', { class: 'xs muted' }, u.lastSeenAt ? timeAgo(u.lastSeenAt) : '—'),
        h('td', null, h('div', { class: 'acts' },
          h('a', { class: 'btn sm outline', href: `/u/${u.username}`, target: '_blank', rel: 'noopener' }, t('الملف')),
          u.status === 'banned'
            ? h('button', { class: 'btn sm', onClick: async () => { try { paint((await post(`/admin/users/${u.id}/unban`)).user); toast(t('تم إلغاء الحظر'), 'success'); } catch (e) { toast(e.message, 'error'); } } }, t('إلغاء الحظر'))
            : u.role !== 'admin' && u.id !== me.id ? h('button', { class: 'btn sm danger', onClick: () => banDialog(u, paint) }, t('حظر')) : null,
          u.id !== me.id ? h('button', { class: 'btn sm ghost', onClick: async () => {
            const to = u.role === 'admin' ? 'user' : 'admin';
            if (!(await confirmDialog(to === 'admin' ? t('ترقية @{u} إلى مسؤول؟ سيحصل على كامل الصلاحيات.', { u: u.username }) : t('إزالة صلاحية المسؤول من @{u}؟', { u: u.username }), { confirmText: t('تأكيد') }))) return;
            try { paint((await post(`/admin/users/${u.id}/role`, { role: to })).user); toast(t('تم التحديث'), 'success'); } catch (e) { toast(e.message, 'error'); }
          } }, u.role === 'admin' ? t('إزالة الإدارة') : t('ترقية')) : null,
          u.role !== 'admin' && u.id !== me.id ? h('button', { class: 'btn sm ghost', 'aria-label': t('حذف'), style: { color: 'var(--danger)' }, onClick: async () => {
            if (!(await confirmDialog(t('سيُحذف @{u} وكل محتواه نهائيًا. لا يمكن التراجع.', { u: u.username }), { danger: true, confirmText: t('حذف نهائيًا'), title: t('حذف المستخدم') }))) return;
            try { await del(`/admin/users/${u.id}`); tr.remove(); toast(t('تم حذف المستخدم'), 'success'); } catch (e) { toast(e.message, 'error'); }
          } }, icon('trash', 'sm')) : null)));
    };
    paint(u);
    return tr;
  }
  search.addEventListener('input', debounce(() => { q = search.value.trim(); p.reload(); }, 300));
  sel.addEventListener('change', () => { status = sel.value; p.reload(); });
  p.reload();
}
function banDialog(u, onDone) {
  const reason = h('input', { class: 'input', maxlength: '200', placeholder: t('سبب الحظر (يظهر للمستخدم)'), 'aria-label': t('سبب الحظر'), autofocus: '' });
  const m = modal({ title: t('حظر @{u}', { u: u.username }), content: h('form', { class: 'col', onSubmit: async (e) => {
    e.preventDefault();
    try { onDone((await post(`/admin/users/${u.id}/ban`, { reason: reason.value })).user); m.close(); toast(t('تم حظر المستخدم وإنهاء جلساته'), 'success'); } catch (ex) { toast(ex.message, 'error'); }
  } }, h('p', { class: 'muted small' }, t('سيتم تسجيل خروجه فورًا وإخفاء محتواه عن الجميع.')), reason,
  h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, button(t('إلغاء'), { cls: 'ghost', onClick: () => m.close() }), button(t('حظر'), { cls: 'danger', type: 'submit' }))) });
}

// ---------- المنشورات ----------
function posts() {
  let q = '', kind = '';
  const search = h('input', { class: 'input', type: 'search', placeholder: t('بحث في الوصف أو اسم الناشر'), 'aria-label': t('بحث') });
  const sel = h('select', { class: 'select', 'aria-label': t('النوع') }, h('option', { value: '' }, t('الكل')), h('option', { value: 'image' }, t('صور')), h('option', { value: 'video' }, t('فيديو')));
  const host = h('div');
  main.append(h('h1', { style: { marginBottom: '1rem' } }, t('مراجعة المنشورات')), h('div', { class: 'toolbar' }, search, sel), host);
  let grid;
  const p = pager(host, (c) => get(`/admin/posts?limit=18&q=${encodeURIComponent(q)}&kind=${kind}${c ? `&cursor=${c}` : ''}`), (items, slot, reset) => {
    if (reset) { grid = h('div', { class: 'posts-grid' }); slot.append(grid); }
    items.forEach((po) => {
      const m = po.media[0];
      const card = h('article', { class: 'card apost', 'data-post': po.id },
        h('a', { class: 'thumb', href: `/post/${po.id}`, target: '_blank', rel: 'noopener', 'aria-label': t('فتح المنشور') }, h('img', { src: po.kind === 'video' ? m.poster : m.thumb, alt: '', loading: 'lazy' }), h('span', { class: 'kind' }, icon(po.kind === 'video' ? 'film' : 'image', 'sm'), po.kind === 'video' ? t('فيديو') : po.media.length > 1 ? t('{n} صور', { n: po.media.length }) : t('صورة'))),
        h('div', { class: 'body' }, h('div', { class: 'row' }, avatar(po.author, 28), h('b', { class: 'small' }, po.author.displayName), h('span', { class: 'xs muted' }, handle(po.author.username))),
          h('p', { class: 'cap' }, po.caption || t('بدون وصف')),
          h('div', { class: 'meta' }, h('span', null, `❤ ${po.counts.likes}`), h('span', null, `💬 ${po.counts.comments}`), po.kind === 'video' ? h('span', null, `👁 ${po.counts.views}`) : null, h('span', null, timeAgo(po.createdAt))),
          h('div', { class: 'foot' }, h('span', { class: 'xs faint' }, `#${po.id}`), h('button', { class: 'btn sm danger', onClick: async () => {
            if (!(await confirmDialog(t('حذف هذا المنشور وملفاته وتعليقاته نهائيًا؟'), { danger: true, confirmText: t('حذف'), title: t('حذف منشور مخالف') }))) return;
            try { await del(`/admin/posts/${po.id}`); card.remove(); toast(t('تم حذف المنشور'), 'success'); } catch (e) { toast(e.message, 'error'); }
          } }, icon('trash', 'sm'), t('حذف')))));
      grid.append(card);
    });
  }, emptyState({ icon: 'image', title: t('لا توجد منشورات') }));
  search.addEventListener('input', debounce(() => { q = search.value.trim(); p.reload(); }, 300));
  sel.addEventListener('change', () => { kind = sel.value; p.reload(); });
  p.reload();
}

// ---------- البلاغات ----------
function reports() {
  let status = 'open';
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const host = h('div');
  const paint = () => tabs.replaceChildren(...[['open', t('مفتوحة')], ['resolved', t('تمت المعالجة')], ['dismissed', t('متجاهَلة')]].map(([v, l]) => h('button', { role: 'tab', 'aria-selected': v === status, onClick: () => { status = v; paint(); p.reload(); } }, l)));
  main.append(h('h1', { style: { marginBottom: '1rem' } }, t('مراجعة البلاغات')), tabs, host);
  const p = pager(host, (c) => get(`/admin/reports?limit=15&status=${status}${c ? `&cursor=${c}` : ''}`), (items, slot) => items.forEach((r) => slot.append(reportCard(r))),
    emptyState({ icon: 'check-circle', title: status === 'open' ? t('لا توجد بلاغات مفتوحة 🎉') : t('لا توجد بلاغات'), text: status === 'open' ? t('كل شيء تحت السيطرة.') : '' }));
  paint(); p.reload();
}
function reportCard(r) {
  const tg = r.target;
  const el = h('article', { class: 'card report', 'data-report': r.id },
    h('div', { class: 'why' }, h('span', { class: 'pill red' }, t(REASONS[r.reason] || r.reason)), h('span', { class: 'muted' }, t('على {k}', { k: { post: t('منشور'), comment: t('تعليق'), user: t('حساب') }[r.targetType] })),
      h('span', { class: 'muted' }, '·'), h('span', { class: 'muted' }, t('بلاغ من'), ' ', handle(r.reporter)), h('span', { class: 'muted xs' }, timeAgo(r.createdAt))),
    r.details ? h('p', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, `«${r.details}»`) : null,
    tg ? h('div', { class: 'tgt' }, tg.media ? h('img', { src: tg.media, alt: '' }) : null,
      h('div', { class: 'grow' }, h('div', { class: 'small bold' }, t('صاحب المحتوى'), ': ', handle(tg.author), tg.banned ? [' ', h('span', { class: 'pill red' }, t('محظور'))] : null), h('p', { class: 'small muted', style: { overflowWrap: 'anywhere' } }, tg.text || t('بدون نص'))),
      tg.kind === 'post' ? h('a', { class: 'btn sm outline', href: `/post/${tg.id}`, target: '_blank', rel: 'noopener' }, t('فتح')) : tg.kind === 'user' ? h('a', { class: 'btn sm outline', href: `/u/${tg.author}`, target: '_blank', rel: 'noopener' }, t('فتح')) : null)
      : h('div', { class: 'tgt muted small' }, t('المحتوى المُبلَّغ عنه محذوف بالفعل.')),
    r.status !== 'open' ? h('div', { class: 'small muted' }, h('span', { class: `pill ${r.status === 'resolved' ? '' : 'gray'}` }, r.status === 'resolved' ? t('تمت المعالجة') : t('متجاهَل')), ' ', r.resolution || '') : h('div', { class: 'acts' },
      h('button', { class: 'btn sm outline', onClick: () => act('dismiss') }, t('تجاهل البلاغ')),
      tg && r.targetType !== 'user' ? h('button', { class: 'btn sm danger', onClick: () => act('remove_content') }, icon('trash', 'sm'), t('حذف المحتوى')) : null,
      tg ? h('button', { class: 'btn sm danger', onClick: () => act('ban_user') }, icon('ban', 'sm'), t('حظر صاحب المحتوى')) : null));
  function act(action) {
    const note = h('input', { class: 'input', maxlength: '300', placeholder: t('ملاحظة (اختياري)'), 'aria-label': t('ملاحظة'), autofocus: '' });
    const label = { dismiss: t('تجاهل البلاغ'), remove_content: t('حذف المحتوى المُبلَّغ عنه'), ban_user: t('حظر صاحب المحتوى') }[action];
    const m = modal({ title: label, content: h('form', { class: 'col', onSubmit: async (e) => {
      e.preventDefault();
      try { await post(`/admin/reports/${r.id}/resolve`, { action, note: note.value }); m.close(); el.remove(); toast(t('تمت معالجة البلاغ'), 'success'); refreshBadge(); } catch (ex) { toast(ex.message, 'error'); }
    } }, note, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, button(t('إلغاء'), { cls: 'ghost', onClick: () => m.close() }), button(t('تأكيد'), { cls: action === 'dismiss' ? 'primary' : 'danger', type: 'submit' }))) });
  }
  return el;
}

// ---------- السجل ----------
function audit() {
  const host = h('div', { class: 'card list' });
  main.append(h('h1', { style: { marginBottom: '1rem' } }, t('سجل إجراءات الإدارة')), host);
  get('/admin/audit').then((r) => {
    if (!r.items.length) return host.replaceWith(emptyState({ icon: 'shield', title: t('لا توجد إجراءات مسجّلة بعد') }));
    r.items.forEach((a) => host.append(h('div', { class: 'audit-row' }, h('span', { class: 'muted xs', style: { minWidth: '8.5em' } }, fmtDate(a.createdAt)), h('b', null, a.admin ? handle(a.admin) : '—'), h('span', null, t(ACTION_LABEL[a.action] || a.action)), h('code', null, `${a.targetType || ''}#${a.targetId ?? ''}`), a.details ? h('span', { class: 'muted small truncate' }, a.details) : null)));
  }).catch((e) => host.replaceWith(errorState(e.message, route)));
}

boot();
