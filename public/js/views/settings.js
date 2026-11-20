import { h, clear, avatar, withLoading, button, handle } from '../dom.js';
import { icon } from '../icons.js';
import { t, timeAgo } from '../i18n.js';
import { get, post, del } from '../api.js';
import { state, setUser } from '../state.js';
import { navigate, back } from '../router.js';
import { ensureApp, markActive, setTitle, paintBanner } from '../shell.js';
import { toast, confirmDialog, modal, emptyState } from '../ui.js';
import { userRow } from '../components.js';

const head = (title, withBack = true) => h('div', { class: 'page-head' },
  withBack ? h('button', { class: 'icon-btn', 'aria-label': t('رجوع'), onClick: back }, icon('chev-r')) : null, h('h1', null, title));

function item({ ic, title, sub, href, onClick, right }) {
  const body = [h('span', { class: 'ico' }, icon(ic)), h('span', { class: 'grow' }, h('b', null, title), sub ? h('span', { class: 'muted small' }, sub) : null), right ?? (href ? icon('chev-l', 'chev') : null)];
  return href ? h('a', { class: 'list-item', href, 'data-link': '' }, ...body) : h('button', { class: 'list-item', type: 'button', onClick }, ...body);
}

export function setTheme(pref) {
  try { localStorage.setItem('lamma-theme', pref); } catch {}
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function settings() {
  const view = ensureApp();
  markActive('/settings');
  setTitle(t('الإعدادات'));
  const u = state.user;
  const pref = (() => { try { return localStorage.getItem('lamma-theme') || 'auto'; } catch { return 'auto'; } })();
  const themeSeg = h('div', { class: 'tabs', style: { margin: 0, minWidth: '210px' }, role: 'tablist' });
  const paintTheme = (cur) => themeSeg.replaceChildren(...[['auto', t('تلقائي')], ['light', t('فاتح')], ['dark', t('داكن')]].map(([v, l]) => h('button', { role: 'tab', 'aria-selected': v === cur, onClick: () => { setTheme(v); paintTheme(v); } }, l)));
  paintTheme(pref);
  const logout = async () => { try { await post('/auth/logout'); } catch {} setUser(null); navigate('/welcome', { replace: true }); toast(t('تم تسجيل الخروج')); };
  view.append(h('div', { class: 'view-enter' }, head(t('الإعدادات'), false),
    h('a', { class: 'card pad row', href: `/u/${u.username}`, 'data-link': '', style: { marginBottom: '1rem' } }, avatar(u, 56), h('div', { class: 'grow' }, h('b', null, u.displayName), h('div', { class: 'muted small' }, handle(u.username))), icon('chev-l', 'chev')),
    h('div', { class: 'setting-group' }, h('div', { class: 'setting-title' }, t('الحساب')), h('div', { class: 'card list' },
      item({ ic: 'user', title: t('تعديل الملف الشخصي'), sub: t('الاسم والنبذة والصورة والغلاف'), href: '/settings/profile' }),
      item({ ic: 'shield', title: t('الخصوصية والأمان'), sub: t('كلمة المرور والجلسات والحظر'), href: '/settings/privacy' }),
      item({ ic: 'bookmark', title: t('المحفوظات'), href: '/saved' }))),
    h('div', { class: 'setting-group' }, h('div', { class: 'setting-title' }, t('المظهر')), h('div', { class: 'card' }, h('div', { class: 'list-item' }, h('span', { class: 'ico' }, icon('moon')), h('span', { class: 'grow' }, h('b', null, t('وضع العرض'))), themeSeg))),
    u.role === 'admin' ? h('div', { class: 'setting-group' }, h('div', { class: 'setting-title' }, t('الإدارة')), h('div', { class: 'card list' }, h('a', { class: 'list-item', href: '/admin' }, h('span', { class: 'ico' }, icon('shield')), h('span', { class: 'grow' }, h('b', null, t('لوحة الإدارة'))), icon('chev-l', 'chev')))) : null,
    h('div', { class: 'setting-group' }, h('div', { class: 'card list' }, item({ ic: 'logout', title: t('تسجيل الخروج'), onClick: logout }))),
    h('p', { class: 'center xs faint' }, 'LAMMA | لَمّة · v0.1')));
}

export function privacy() {
  const view = ensureApp();
  markActive('/settings');
  setTitle(t('الخصوصية والأمان'));
  const u = state.user;

  // ----- تأكيد البريد -----
  const emailCard = h('div', { class: 'card list-item', style: { cursor: 'default' } }, h('span', { class: 'ico' }, icon('mail')),
    h('span', { class: 'grow' }, h('b', null, u.email), u.emailVerified ? h('span', { class: 'pill' }, t('مؤكَّد')) : h('span', { class: 'pill warn' }, t('غير مؤكَّد'))),
    !u.emailVerified ? h('button', { class: 'btn sm primary', onClick: async (e) => { await withLoading(e.currentTarget, async () => { try { await post('/auth/resend-verification'); toast(t('أرسلنا رابط التأكيد'), 'success'); } catch (x) { toast(x.message, 'error'); } }); } }, t('إرسال الرابط')) : null);

  // ----- تغيير كلمة المرور -----
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', dir: 'ltr', id: 'pw-cur' });
  const nxt = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', dir: 'ltr', id: 'pw-new' });
  const pwMsg = h('div', { hidden: true, role: 'status' });
  const pwBtn = h('button', { class: 'btn primary', type: 'submit' }, t('تغيير كلمة المرور'));
  const pwForm = h('form', { class: 'card pad col', onSubmit: async (e) => {
    e.preventDefault(); pwMsg.hidden = true;
    await withLoading(pwBtn, async () => {
      try { await post('/auth/change-password', { current: cur.value, next: nxt.value }); cur.value = nxt.value = ''; pwMsg.hidden = false; pwMsg.className = 'form-success'; pwMsg.textContent = t('تم تغيير كلمة المرور وإنهاء الجلسات الأخرى.'); loadSessions(); }
      catch (ex) { pwMsg.hidden = false; pwMsg.className = 'form-error'; pwMsg.textContent = ex.message; }
    });
  } }, h('div', { class: 'field' }, h('label', { for: 'pw-cur' }, t('كلمة المرور الحالية')), cur),
  h('div', { class: 'field' }, h('label', { for: 'pw-new' }, t('كلمة المرور الجديدة')), nxt, h('div', { class: 'hint' }, t('8 أحرف على الأقل وتحتوي على حرف ورقم'))), pwMsg, pwBtn);

  // ----- الجلسات -----
  const sessions = h('div', { class: 'card list' });
  const device = (ua = '') => (/mobile|android|iphone|ipad/i.test(ua) ? ['smartphone', t('هاتف')] : ['monitor', t('كمبيوتر')]);
  const browser = (ua = '') => (/edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : t('متصفح'));
  async function loadSessions() {
    try {
      const { items } = await get('/auth/sessions');
      clear(sessions);
      items.forEach((s) => {
        const [ic, label] = device(s.userAgent);
        sessions.append(h('div', { class: 'session' }, h('span', { class: 'ico' }, icon(ic)),
          h('div', { class: 'grow' }, h('b', null, `${browser(s.userAgent)} · ${label}`, s.current ? h('span', { class: 'pill', style: { marginInlineStart: '.5rem' } }, t('هذا الجهاز')) : null),
            h('div', { class: 'xs muted' }, t('آخر نشاط {x}', { x: timeAgo(s.lastUsedAt) }))),
          !s.current ? h('button', { class: 'btn sm danger', onClick: async () => { await del(`/auth/sessions/${s.id}`); toast(t('تم إنهاء الجلسة'), 'success'); loadSessions(); } }, t('إنهاء')) : null));
      });
    } catch (e) { clear(sessions); sessions.append(h('div', { class: 'pad error-text' }, e.message)); }
  }

  // ----- المحظورون -----
  const blocks = h('div', { class: 'card list' });
  async function loadBlocks() {
    try {
      const { items } = await get('/users/me/blocks');
      clear(blocks);
      if (!items.length) { blocks.append(h('div', { class: 'pad muted small center', style: { padding: '1.2rem' } }, t('لا يوجد مستخدمون محظورون.'))); return; }
      items.forEach((b) => blocks.append(h('div', { class: 'user-row' }, avatar(b, 44), h('div', { class: 'info' }, h('div', { class: 'name' }, b.displayName), h('div', { class: 'sub' }, handle(b.username))),
        h('button', { class: 'btn sm outline', onClick: async () => { await del(`/users/${b.username}/block`); toast(t('تم إلغاء الحظر'), 'success'); loadBlocks(); } }, t('إلغاء الحظر')))));
    } catch (e) { clear(blocks); blocks.append(h('div', { class: 'pad error-text' }, e.message)); }
  }

  // ----- حذف الحساب -----
  const delAccount = () => {
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', dir: 'ltr', placeholder: t('كلمة المرور'), 'aria-label': t('كلمة المرور'), autofocus: '' });
    const err = h('div', { class: 'form-error', hidden: true });
    const m = modal({ title: t('حذف الحساب نهائيًا'), content: h('form', { class: 'col', onSubmit: async (e) => {
      e.preventDefault();
      try { await del('/auth/account', { password: pw.value }); m.close(); setUser(null); navigate('/welcome', { replace: true }); toast(t('تم حذف حسابك وكل محتواه')); }
      catch (ex) { err.hidden = false; err.textContent = ex.message; }
    } }, h('p', null, t('سيُحذف حسابك وكل منشوراتك وصورك وفيديوهاتك وتعليقاتك نهائيًا ولا يمكن التراجع.')), pw, err,
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, button(t('إلغاء'), { cls: 'ghost', onClick: () => m.close() }), button(t('حذف حسابي'), { cls: 'danger', type: 'submit' }))) });
  };

  view.append(h('div', { class: 'view-enter' }, head(t('الخصوصية والأمان')),
    h('div', { class: 'setting-group' }, h('div', { class: 'setting-title' }, t('البريد الإلكتروني')), emailCard),
    h('div', { class: 'setting-group' }, h('div', { class: 'setting-title' }, t('كلمة المرور')), pwForm),
    h('div', { class: 'setting-group' }, h('div', { class: 'setting-title' }, t('الأجهزة المسجّل دخولها')), sessions),
    h('div', { class: 'setting-group' }, h('div', { class: 'setting-title' }, t('المستخدمون المحظورون')), blocks),
    h('div', { class: 'setting-group' }, h('div', { class: 'setting-title' }, t('منطقة الخطر')), h('div', { class: 'card list' }, item({ ic: 'trash', title: t('حذف الحساب'), sub: t('حذف نهائي لكل بياناتك'), onClick: delAccount })))));
  loadSessions(); loadBlocks();
}
