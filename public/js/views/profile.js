import { h, clear, avatar, button, withLoading, handle } from '../dom.js';
import { icon } from '../icons.js';
import { t, fmtNumber } from '../i18n.js';
import { get, post, del, patch, upload } from '../api.js';
import { state, setUser } from '../state.js';
import { navigate, back } from '../router.js';
import { ensureApp, markActive, setTitle, fillRail, paintBanner } from '../shell.js';
import { emptyState, errorState, infiniteList, skeletonGrid, skeletonRows, toast, actionMenu, confirmDialog } from '../ui.js';
import { followButton, userRow, appendTiles, reportDialog, requireLogin, postCard } from '../components.js';

export async function profile(ctx) {
  const view = ensureApp();
  const username = ctx.params.username === 'me' && state.user ? state.user.username : ctx.params.username;
  markActive(`/u/${username}`);
  fillRail();
  setTitle(`@${username}`);
  const holder = h('div', { class: 'view-enter' }, h('div', { class: 'card' }, h('div', { class: 'profile-cover skeleton' }), h('div', { class: 'profile-body', style: { height: '150px' } })));
  view.append(holder);
  let data;
  try { data = await get(`/users/${encodeURIComponent(username)}`); } catch (e) {
    holder.replaceChildren(e.status === 404 ? emptyState({ icon: 'user', title: t('هذا الحساب غير متاح'), text: t('ربما غُيّر اسمه أو حُذف أو لم يعد متاحًا لك.'), action: h('a', { class: 'btn primary', href: '/', 'data-link': '' }, t('العودة للرئيسية')) }) : errorState(e.message, () => location.reload()));
    return;
  }
  if (!ctx.isCurrent()) return;
  const { user: u, viewer: rel } = data;
  setTitle(`${u.displayName} (@${u.username})`);

  const followers = h('b', null, fmtNumber(u.counts.followers));
  const followBtn = !rel.isMe && state.user ? followButton(u, rel.following, { size: '', onChange: (_, n) => (followers.textContent = fmtNumber(n)) }) : null;
  if (!rel.isMe && !state.user) { /* الزائر: زر متابعة يوجّه للدخول */ }
  const actions = h('div', { class: 'actions' },
    rel.isMe ? [h('a', { class: 'btn outline', href: '/settings/profile', 'data-link': '' }, icon('edit', 'sm'), t('تعديل الملف')), h('a', { class: 'icon-btn', href: '/settings', 'data-link': '', 'aria-label': t('الإعدادات') }, icon('sliders'))]
      : [followBtn || followButton(u, false, { size: '' }),
        state.user ? h('button', { class: 'icon-btn', 'aria-label': t('المزيد'), onClick: () => actionMenu([
          { label: t('إبلاغ عن الحساب'), icon: 'flag', onClick: () => reportDialog('user', u.id) },
          { label: rel.blocked ? t('إلغاء حظر @{u}', { u: u.username }) : t('حظر @{u}', { u: u.username }), icon: 'ban', danger: !rel.blocked, onClick: async () => {
            if (rel.blocked) { await del(`/users/${u.username}/block`); toast(t('تم إلغاء الحظر'), 'success'); return navigate(location.pathname, { replace: true }); }
            if (!(await confirmDialog(t('لن يتمكن @{u} من رؤية حسابك ولن ترى محتواه، وسيُلغى التتبّع بينكما.', { u: u.username }), { danger: true, confirmText: t('حظر'), title: t('حظر المستخدم') }))) return;
            await post(`/users/${u.username}/block`); toast(t('تم حظر المستخدم'), 'success'); navigate('/', { replace: true });
          } }]) }, icon('more')) : null]);

  let kind = '';
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const grid = h('div');
  let list = null;
  const KINDS = [['', t('الكل'), 'grid'], ['image', t('الصور'), 'image'], ['video', t('الفيديوهات'), 'film']];
  const paintTabs = () => tabsEl.replaceChildren(...KINDS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': k === kind, onClick: () => { kind = k; paintTabs(); start(); } }, l)));
  function start() {
    list?.destroy(); clear(grid);
    list = infiniteList(grid, {
      skeleton: () => skeletonGrid(6),
      loader: async (cursor) => { const r = await get(`/users/${encodeURIComponent(u.username)}/posts?limit=12${kind ? `&kind=${kind}` : ''}${cursor ? `&cursor=${cursor}` : ''}`); return { items: r.items, next: r.nextCursor }; },
      render: (items, host) => appendTiles(host, items),
      empty: () => emptyState({ icon: kind === 'video' ? 'film' : 'image', title: rel.isMe ? t('لم تنشر شيئًا بعد') : t('لا توجد منشورات'), text: rel.isMe ? t('شارك أول صورة أو فيديو مع متابعيك.') : t('لم ينشر @{u} شيئًا بعد.', { u: u.username }),
        action: rel.isMe ? h('a', { class: 'btn primary', href: '/create', 'data-link': '' }, t('أنشئ منشورًا')) : null }),
    });
  }
  holder.replaceChildren(
    h('div', { class: 'card', style: { overflow: 'hidden' } },
      h('div', { class: 'profile-cover' }, u.cover ? h('img', { src: u.cover, alt: '', width: 1500, height: 500 }) : null),
      h('div', { class: 'profile-body' },
        h('div', { class: 'profile-top' }, avatar(u, 92), actions),
        h('h1', { style: { marginTop: '.6rem' } }, u.displayName),
        h('div', { class: 'muted small' }, handle(u.username)),
        u.bio ? h('p', { style: { marginTop: '.6rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, u.bio) : null,
        h('div', { class: 'stats' },
          h('div', null, h('b', null, fmtNumber(u.counts.posts)), h('span', null, t('منشور'))),
          h('a', { href: `/u/${u.username}/followers`, 'data-link': '' }, followers, h('span', null, t('متابِع'))),
          h('a', { href: `/u/${u.username}/following`, 'data-link': '' }, h('b', null, fmtNumber(u.counts.following)), h('span', null, t('يتابع')))))),
    h('div', { style: { marginTop: '1rem' } }, tabsEl, grid));
  paintTabs(); start();
  return () => list?.destroy();
}

export function followList(kind) {
  return async (ctx) => {
    const view = ensureApp();
    const username = ctx.params.username;
    markActive(`/u/${username}`);
    fillRail();
    const title = kind === 'followers' ? t('المتابِعون') : t('يتابع');
    setTitle(`${title} · @${username}`);
    const body = h('div', { class: 'card list' });
    view.append(h('div', { class: 'view-enter' }, h('div', { class: 'page-head' }, h('button', { class: 'icon-btn', 'aria-label': t('رجوع'), onClick: back }, icon('chev-r')), h('h1', null, title, ' ', h('span', { class: 'muted small' }, handle(username)))), body));
    const list = infiniteList(body, {
      skeleton: () => skeletonRows(4),
      loader: async (cursor) => { const r = await get(`/users/${encodeURIComponent(username)}/${kind}?limit=20${cursor ? `&cursor=${cursor}` : ''}`); return { items: r.items, next: r.nextCursor }; },
      render: (items, host) => items.forEach((x) => host.append(userRow(x, { sub: x.bio || handle(x.username) }))),
      empty: () => emptyState({ icon: 'users', title: kind === 'followers' ? t('لا يوجد متابِعون بعد') : t('لا يتابع أحدًا بعد') }),
    });
    return () => list.destroy();
  };
}

export function saved() {
  const view = ensureApp();
  markActive('/saved');
  setTitle(t('المحفوظات'));
  fillRail();
  const body = h('div');
  view.append(h('div', { class: 'view-enter' }, h('div', { class: 'page-head' }, h('h1', null, t('المحفوظات'))), body));
  const list = infiniteList(body, {
    skeleton: () => skeletonGrid(6),
    loader: async (cursor) => { const r = await get(`/saved?limit=12${cursor ? `&cursor=${cursor}` : ''}`); return { items: r.items, next: r.nextCursor }; },
    render: (items, host) => appendTiles(host, items),
    empty: () => emptyState({ icon: 'bookmark', title: t('لا توجد منشورات محفوظة'), text: t('اضغط على علامة الحفظ في أي منشور لتجده هنا لاحقًا.'), action: h('a', { class: 'btn primary', href: '/explore', 'data-link': '' }, t('استكشف المحتوى')) }),
  });
  return () => list.destroy();
}

// ---------------- تعديل الملف الشخصي ----------------
export function editProfile() {
  const view = ensureApp();
  markActive('/settings');
  setTitle(t('تعديل الملف الشخصي'));
  let u = state.user;
  const lim = state.config.limits;
  const coverBox = h('div', { class: 'profile-cover edit-cover' });
  const avatarBox = h('div', { class: 'edit-avatar' });
  const coverInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const avatarInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const name = h('input', { class: 'input', maxlength: '50', value: u.displayName, id: 'ep-name' });
  const username = h('input', { class: 'input', maxlength: '24', value: u.username, dir: 'ltr', id: 'ep-user', autocapitalize: 'none' });
  const bio = h('textarea', { class: 'textarea', maxlength: String(lim.bioLength), id: 'ep-bio', style: { minHeight: '90px' } });
  bio.value = u.bio || '';
  const bioCount = h('div', { class: 'counter' }, `${bio.value.length} / ${lim.bioLength}`);
  bio.addEventListener('input', () => (bioCount.textContent = `${bio.value.length} / ${lim.bioLength}`));
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });

  function paintImages() {
    clear(coverBox); clear(avatarBox);
    if (u.cover) coverBox.append(h('img', { src: u.cover, alt: '' }));
    coverBox.append(h('div', { class: 'overlay-btn row' },
      u.cover ? h('button', { type: 'button', class: 'btn sm', onClick: async () => { await apply(del('/users/me/cover')); } }, icon('trash', 'sm')) : null,
      h('button', { type: 'button', class: 'btn sm primary', onClick: () => coverInput.click() }, icon('camera', 'sm'), t('تغيير الغلاف'))));
    avatarBox.append(avatar(u, 92), h('button', { type: 'button', class: 'cam', 'aria-label': t('تغيير الصورة الشخصية'), onClick: () => avatarInput.click() }, icon('camera', 'sm')));
  }
  async function apply(promise) {
    try { const r = await promise; u = r.user; setUser(u); paintImages(); toast(t('تم التحديث'), 'success'); } catch (e) { toast(e.message, 'error'); }
  }
  const send = (path, input) => async () => {
    const f = input.files[0]; input.value = '';
    if (!f) return;
    if (f.size > 5 * 1048576) return toast(t('حجم الصورة يجب ألا يتجاوز 5MB'), 'error');
    toast(t('جارٍ الرفع…'));
    await apply(upload(path, {}, [{ field: 'file', file: f }]));
  };
  coverInput.onchange = send('/users/me/cover', coverInput);
  avatarInput.onchange = send('/users/me/avatar', avatarInput);

  const submit = h('button', { class: 'btn primary lg block', type: 'submit' }, t('حفظ التغييرات'));
  const form = h('form', { class: 'col', style: { padding: '0 1.1rem 1.1rem' }, onSubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    await withLoading(submit, async () => {
      try {
        const r = await patch('/users/me', { displayName: name.value, username: username.value.trim(), bio: bio.value });
        u = r.user; setUser(u); toast(t('تم حفظ التغييرات'), 'success'); navigate(`/u/${u.username}`);
      } catch (ex) { err.hidden = false; err.textContent = ex.message; }
    });
  } },
  h('div', { class: 'field' }, h('label', { for: 'ep-name' }, t('الاسم المعروض')), name),
  h('div', { class: 'field' }, h('label', { for: 'ep-user' }, t('اسم المستخدم')), username, h('div', { class: 'hint' }, t('سيتغيّر رابط ملفك الشخصي عند تعديله.'))),
  h('div', { class: 'field' }, h('label', { for: 'ep-bio' }, t('نبذة تعريفية')), bio, bioCount), err, submit);
  paintImages();
  view.append(h('div', { class: 'view-enter' }, h('div', { class: 'page-head' }, h('button', { class: 'icon-btn', 'aria-label': t('رجوع'), onClick: back }, icon('chev-r')), h('h1', null, t('تعديل الملف الشخصي'))),
    h('div', { class: 'card', style: { overflow: 'hidden' } }, coverBox, avatarBox, coverInput, avatarInput, h('div', { style: { height: '1rem' } }), form)));
}
