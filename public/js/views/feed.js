import { h, clear, avatar, debounce, handle } from '../dom.js';
import { icon } from '../icons.js';
import { t, fmtNumber } from '../i18n.js';
import { get } from '../api.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { ensureApp, markActive, setTitle, fillRail } from '../shell.js';
import { emptyState, infiniteList, skeletonPosts, skeletonGrid, skeletonRows } from '../ui.js';
import { postCard, userRow, appendTiles, followButton } from '../components.js';

function tabs(items, current, onSelect) {
  const el = h('div', { class: 'tabs', role: 'tablist' }, items.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': id === current, onClick: () => onSelect(id) }, label)));
  return el;
}

// ---------------- الخلاصة ----------------
export function home(ctx) {
  const view = ensureApp();
  markActive('/');
  setTitle('');
  fillRail();
  let scope = sessionStorage.getItem('feed-scope') || 'following';
  let list = null;
  const body = h('div');
  const composer = h('a', { class: 'card pad row', href: '/create', 'data-link': '', style: { marginBottom: '.9rem' } },
    avatar(state.user, 44), h('span', { class: 'muted grow' }, t('ماذا يدور في بالك يا {n}؟', { n: state.user.displayName.split(' ')[0] })),
    h('span', { class: 'btn primary sm' }, icon('image', 'sm'), t('نشر')));
  const tabEl = h('div');
  const paintTabs = () => tabEl.replaceChildren(tabs([['following', t('المتابَعون')], ['latest', t('الأحدث')]], scope, (s) => { scope = s; sessionStorage.setItem('feed-scope', s); paintTabs(); start(); }));
  function start() {
    list?.destroy(); clear(body);
    list = infiniteList(body, {
      skeleton: () => skeletonPosts(2),
      loader: async (cursor) => { const r = await get(`/feed?scope=${scope}&limit=6${cursor ? `&cursor=${cursor}` : ''}`); return { items: r.items, next: r.nextCursor }; },
      render: (items, host) => { const feed = host.querySelector('.feed') || host.appendChild(h('div', { class: 'feed' })); items.forEach((p, i) => feed.append(postCard(p, { eager: i === 0 && !feed.children.length }))); },
      empty: () => scope === 'following'
        ? emptyState({ icon: 'users', title: t('خلاصتك ما زالت فارغة'), text: t('تابع أشخاصًا لتظهر منشوراتهم هنا، أو اطّلع على أحدث ما نُشر في لَمّة.'),
          action: h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, h('a', { class: 'btn primary', href: '/people', 'data-link': '' }, t('اكتشف أشخاصًا')), h('button', { class: 'btn outline', onClick: () => { scope = 'latest'; paintTabs(); start(); } }, t('عرض الأحدث'))) })
        : emptyState({ icon: 'image', title: t('لا توجد منشورات بعد'), text: t('كن أول من يشارك لحظة في لَمّة!'), action: h('a', { class: 'btn primary', href: '/create', 'data-link': '' }, t('أنشئ منشورًا')) }),
    });
  }
  paintTabs();
  view.append(h('div', { class: 'view-enter' }, composer, tabEl, body));
  start();
  return () => list?.destroy();
}

// ---------------- استكشاف ----------------
export function explore(ctx) {
  const view = ensureApp();
  markActive('/explore');
  setTitle(t('استكشاف'));
  fillRail();
  let kind = '';
  const searchInput = h('input', { type: 'search', placeholder: t('ابحث عن أشخاص ومنشورات ووسوم'), 'aria-label': t('بحث'), enterkeyhint: 'search' });
  const searchForm = h('form', { class: 'search-mini', style: { display: 'flex', width: '100%', marginBottom: '1rem' }, role: 'search', onSubmit: (e) => { e.preventDefault(); const q = searchInput.value.trim(); if (q) navigate(`/search?q=${encodeURIComponent(q)}`); } }, icon('search', 'sm'), searchInput);
  const top = h('div');
  const gridHost = h('div');
  const filter = h('div');
  let list = null;
  const paintFilter = () => filter.replaceChildren(tabs([['', t('الكل')], ['image', t('صور')], ['video', t('فيديو')]], kind, (k) => { kind = k; paintFilter(); startGrid(); }));
  function startGrid() {
    list?.destroy(); clear(gridHost);
    list = infiniteList(gridHost, {
      skeleton: () => skeletonGrid(9),
      loader: async (offset = 0) => { const r = await get(`/explore/posts?limit=12&offset=${offset}${kind ? `&kind=${kind}` : ''}`); return { items: r.items, next: r.nextOffset }; },
      render: (items, host) => appendTiles(host, items),
      empty: () => emptyState({ icon: 'compass', title: t('لا يوجد محتوى للاستكشاف بعد'), text: t('عندما ينشر الأعضاء صورهم وفيديوهاتهم ستظهر هنا.'), action: h('a', { class: 'btn primary', href: '/create', 'data-link': '' }, t('شارك أول منشور')) }),
    });
  }
  view.append(h('div', { class: 'view-enter' }, searchForm, top, h('div', { class: 'section-title' }, t('الأكثر تفاعلًا')), filter, gridHost));
  paintFilter();
  startGrid();
  get('/explore').then((ex) => {
    if (!ctx.isCurrent()) return;
    if (ex.trendingTags.length) top.append(h('div', { class: 'section-title', style: { marginTop: 0 } }, h('span', { class: 'row' }, icon('trending', 'sm'), t('الوسوم الرائجة'))),
      h('div', { class: 'chips' }, ex.trendingTags.map((x) => h('a', { class: 'chip', href: `/tag/${encodeURIComponent(x.name)}`, 'data-link': '' }, `#${x.name}`, h('small', null, fmtNumber(x.posts))))));
    if (ex.suggestedUsers.length) top.append(h('div', { class: 'section-title' }, t('أشخاص قد تعرفهم'), h('a', { class: 'small', href: '/people', 'data-link': '', style: { color: 'var(--primary)' } }, t('عرض الكل'))),
      h('div', { class: 'hscroll' }, ex.suggestedUsers.map((u) => h('div', { class: 'card suggest-card' },
        h('a', { href: `/u/${u.username}`, 'data-link': '' }, avatar(u, 64)), h('a', { class: 'name truncate', href: `/u/${u.username}`, 'data-link': '' }, u.displayName),
        h('span', { class: 'xs muted' }, t('{n} متابِع', { n: fmtNumber(u.counts.followers) })), followButton(u, false)))));
  }).catch(() => {});
  return () => list?.destroy();
}

// ---------------- البحث ----------------
export function search(ctx) {
  const view = ensureApp();
  markActive('/search');
  const q = (ctx.query.get('q') || '').trim();
  let type = ctx.query.get('type') || 'users';
  setTitle(q ? t('بحث: {q}', { q }) : t('بحث'));
  const input = h('input', { type: 'search', value: q, placeholder: t('ابحث عن أشخاص ومنشورات ووسوم'), 'aria-label': t('بحث'), enterkeyhint: 'search' });
  const form = h('form', { class: 'search-mini', style: { display: 'flex', width: '100%', marginBottom: '1rem' }, role: 'search', onSubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) navigate(`/search?q=${encodeURIComponent(v)}&type=${type}`); } }, icon('search', 'sm'), input);
  const tabEl = h('div'); const body = h('div');
  let list = null;
  const paint = () => tabEl.replaceChildren(tabs([['users', t('حسابات')], ['posts', t('منشورات')], ['tags', t('وسوم')]], type, (x) => { type = x; history.replaceState({}, '', `/search?q=${encodeURIComponent(q)}&type=${x}`); paint(); run(); }));
  function run() {
    list?.destroy(); clear(body);
    if (!q) { body.append(emptyState({ icon: 'search', title: t('ابحث في لَمّة'), text: t('اكتب اسم شخص أو كلمة من منشور أو وسمًا.') })); return; }
    list = infiniteList(body, {
      skeleton: () => (type === 'posts' ? skeletonGrid(6) : skeletonRows(4)),
      loader: async (offset = 0) => { const r = await get(`/search?q=${encodeURIComponent(q)}&type=${type}&limit=15&offset=${offset}`); return { items: r.items, next: r.nextOffset }; },
      render: (items, host) => {
        if (type === 'users') { const c = host.querySelector('.card') || host.appendChild(h('div', { class: 'card list' })); items.forEach((u) => c.append(userRow(u, { sub: u.bio || handle(u.username) }))); }
        else if (type === 'posts') appendTiles(host, items);
        else { const c = host.querySelector('.card') || host.appendChild(h('div', { class: 'card list' })); items.forEach((x) => c.append(h('a', { class: 'list-item', href: `/tag/${encodeURIComponent(x.name)}`, 'data-link': '' }, h('span', { class: 'ico' }, icon('hash')), h('span', { class: 'grow' }, h('b', null, `#${x.name}`), h('span', { class: 'muted small' }, t('{n} منشور', { n: fmtNumber(x.posts) }))), icon('chev-l', 'chev')))); }
      },
      empty: () => emptyState({ icon: 'search', title: t('لا توجد نتائج'), text: t('لم نجد شيئًا يطابق «{q}». جرّب كلمات أخرى.', { q }) }),
    });
  }
  view.append(h('div', { class: 'view-enter' }, form, tabEl, body));
  paint(); run();
  return () => list?.destroy();
}

// ---------------- وسم ----------------
export function tag(ctx) {
  const view = ensureApp();
  markActive('/tag/');
  const name = ctx.params.tag;
  setTitle(`#${name}`);
  fillRail();
  const body = h('div');
  view.append(h('div', { class: 'view-enter' },
    h('div', { class: 'page-head' }, h('div', { class: 'list-item', style: { padding: 0, width: 'auto' } }, h('span', { class: 'ico' }, icon('hash'))), h('h1', null, `#${name}`)), body));
  const list = infiniteList(body, {
    skeleton: () => skeletonGrid(9),
    loader: async (cursor) => { const r = await get(`/tags/${encodeURIComponent(name)}/posts?limit=12${cursor ? `&cursor=${cursor}` : ''}`); return { items: r.items, next: r.nextCursor }; },
    render: (items, host) => appendTiles(host, items),
    empty: () => emptyState({ icon: 'hash', title: t('لا توجد منشورات بهذا الوسم') }),
  });
  return () => list.destroy();
}

// ---------------- المستخدمون ----------------
export function people(ctx) {
  const view = ensureApp();
  markActive('/people');
  setTitle(t('المستخدمون'));
  fillRail();
  let q = '';
  let list = null;
  const body = h('div');
  const input = h('input', { type: 'search', placeholder: t('ابحث بالاسم أو اسم المستخدم'), 'aria-label': t('بحث'), enterkeyhint: 'search' });
  const form = h('form', { class: 'search-mini', style: { display: 'flex', width: '100%', marginBottom: '1rem' }, role: 'search', onSubmit: (e) => e.preventDefault() }, icon('search', 'sm'), input);
  function start() {
    list?.destroy(); clear(body);
    list = infiniteList(body, {
      skeleton: () => skeletonRows(5),
      loader: async (offset = 0) => { const r = await get(`/users?q=${encodeURIComponent(q)}&limit=20&offset=${offset}`); return { items: r.items, next: r.nextOffset }; },
      render: (items, host) => { const c = host.querySelector('.card') || host.appendChild(h('div', { class: 'card list' })); items.forEach((u) => c.append(userRow(u, { sub: u.bio || t('{n} متابِع · {p} منشور', { n: fmtNumber(u.counts.followers), p: fmtNumber(u.counts.posts) }) }))); },
      empty: () => emptyState({ icon: 'users', title: q ? t('لا يوجد مستخدم بهذا الاسم') : t('لا يوجد مستخدمون آخرون بعد'), text: q ? t('تأكد من الإملاء أو جرّب اسمًا آخر.') : t('ادعُ أصدقاءك للانضمام إلى لَمّة!') }),
    });
  }
  input.addEventListener('input', debounce(() => { q = input.value.trim(); start(); }, 300));
  view.append(h('div', { class: 'view-enter' }, h('div', { class: 'page-head' }, h('h1', null, t('المستخدمون'))), form, body));
  start();
  return () => list?.destroy();
}
