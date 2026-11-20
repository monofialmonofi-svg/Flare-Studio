import { h, avatar } from '../dom.js';
import { icon } from '../icons.js';
import { t, timeAgo } from '../i18n.js';
import { get, post } from '../api.js';
import { state, setUnread } from '../state.js';
import { navigate } from '../router.js';
import { ensureApp, markActive, setTitle, fillRail } from '../shell.js';
import { emptyState, infiniteList, skeletonRows } from '../ui.js';

const TEXT = {
  like: (n) => t('أُعجب {u} بمنشورك', { u: n.actor.displayName }),
  comment: (n) => t('علّق {u} على منشورك', { u: n.actor.displayName }),
  reply: (n) => t('ردّ {u} على تعليقك', { u: n.actor.displayName }),
  follow: (n) => t('بدأ {u} بمتابعتك', { u: n.actor.displayName }),
};
const ICON = { like: 'heart', comment: 'comment', reply: 'comment', follow: 'user' };

export function notifications() {
  const view = ensureApp();
  markActive('/notifications');
  setTitle(t('الإشعارات'));
  fillRail();
  const body = h('div', { class: 'card list' });
  const markAll = h('button', { class: 'btn ghost sm', onClick: async () => {
    await post('/notifications/read-all'); setUnread(0);
    body.querySelectorAll('.notif.unread').forEach((el) => el.classList.remove('unread'));
  } }, icon('check', 'sm'), t('تعليم الكل كمقروء'));
  view.append(h('div', { class: 'view-enter' }, h('div', { class: 'page-head' }, h('h1', null, t('الإشعارات')), state.unread ? markAll : null), body));
  const list = infiniteList(body, {
    skeleton: () => skeletonRows(5),
    loader: async (cursor) => { const r = await get(`/notifications?limit=20${cursor ? `&cursor=${cursor}` : ''}`); return { items: r.items, next: r.nextCursor }; },
    render: (items, host) => items.forEach((n) => {
      const target = n.type === 'follow' ? `/u/${n.actor.username}` : `/post/${n.postId}`;
      const el = h('a', { class: `notif${n.read ? '' : ' unread'}`, href: target, 'data-link': '', onClick: () => { if (!n.read) post(`/notifications/${n.id}/read`).then(() => setUnread(Math.max(0, state.unread - 1))).catch(() => {}); } },
        h('span', { class: 'av' }, avatar(n.actor, 48), h('span', { class: `type ${n.type}` }, icon(ICON[n.type]))),
        h('div', { class: 'txt' }, h('div', null, TEXT[n.type](n)), n.commentPreview ? h('div', { class: 'muted small truncate', style: { maxWidth: '36ch' } }, `«${n.commentPreview}»`) : null, h('div', { class: 'xs faint' }, timeAgo(n.createdAt))),
        n.thumb ? h('img', { class: 'thumb', src: n.thumb, alt: '', loading: 'lazy' }) : null);
      host.append(el);
    }),
    empty: () => emptyState({ icon: 'bell', title: t('لا توجد إشعارات'), text: t('عندما يتفاعل أحد مع منشوراتك أو يتابعك ستجد ذلك هنا.') }),
  });
  return () => list.destroy();
}
