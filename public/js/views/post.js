import { h } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { get } from '../api.js';
import { back } from '../router.js';
import { ensureApp, markActive, setTitle, fillRail } from '../shell.js';
import { emptyState, errorState, skeletonPosts } from '../ui.js';
import { postCard, commentsPanel } from '../components.js';

export async function postPage(ctx) {
  const view = ensureApp();
  markActive('/post');
  fillRail();
  setTitle(t('منشور'));
  const holder = h('div', { class: 'view-enter' }, h('div', { class: 'page-head' },
    h('button', { class: 'icon-btn', 'aria-label': t('رجوع'), onClick: back }, icon('chev-r')), h('h1', null, t('المنشور'))), skeletonPosts(1));
  view.append(holder);
  try {
    const { post } = await get(`/posts/${ctx.params.id}`);
    if (!ctx.isCurrent()) return;
    setTitle(post.caption ? post.caption.slice(0, 60) : t('منشور {n}', { n: post.author.displayName }));
    const commentsTitle = h('h2', null, t('التعليقات'), ' ', h('span', { class: 'muted' }, post.counts.comments ? `(${post.counts.comments})` : ''));
    const panel = commentsPanel(post, { autofocus: ctx.query.get('comment') === '1', onCount: (n) => { post.counts.comments = n; commentsTitle.lastChild.textContent = n ? `(${n})` : ''; } });
    holder.lastChild.replaceWith(h('div', { class: 'col', style: { gap: '1rem' } },
      postCard(post, { eager: true, detail: true, onRemove: () => back() }),
      h('div', { class: 'card pad col' }, commentsTitle, panel.el)));
  } catch (e) {
    holder.lastChild.replaceWith(e.status === 404
      ? emptyState({ icon: 'image', title: t('هذا المنشور غير متاح'), text: t('ربما حُذف أو لم يعد متاحًا لك.'), action: h('a', { class: 'btn primary', href: '/', 'data-link': '' }, t('العودة للرئيسية')) })
      : errorState(e.message, () => location.reload()));
  }
}
