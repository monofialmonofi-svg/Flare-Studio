// عناصر واجهة مشتركة: إشعارات سريعة، نوافذ، قوائم، حالات فارغة، هياكل التحميل، التمرير اللانهائي.
import { h, clear, button, spinner } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

export function toast(message, type = 'info') {
  const root = document.getElementById('toasts');
  const el = h('div', { class: `toast ${type}` }, message);
  root.append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, type === 'error' ? 5000 : 3000);
}

let openModals = 0;
export function modal({ title, content, tall = false, onClose, dismissible = true }) {
  const root = document.getElementById('modal-root');
  const prevFocus = document.activeElement;
  const box = h('div', { class: `modal${tall ? ' tall' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || t('نافذة') },
    h('div', { class: 'grab' }),
    title ? h('h2', null, title) : null,
    content);
  const wrap = h('div', { class: 'modal-root' }, h('div', { class: 'modal-backdrop', onClick: () => dismissible && close() }), box);
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    wrap.remove();
    if (--openModals === 0) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
    onClose?.(result);
  }
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };
  document.addEventListener('keydown', onKey);
  root.append(wrap);
  if (openModals++ === 0) document.body.style.overflow = 'hidden';
  (box.querySelector('[autofocus]') || box).focus?.();
  return { close, box };
}

export function confirmDialog(message, { confirmText = t('تأكيد'), danger = false, title } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      onClose: () => resolve(false),
      content: h('div', { class: 'col' },
        h('p', null, message),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          button(t('إلغاء'), { cls: 'ghost', onClick: () => m.close() }),
          button(confirmText, { cls: danger ? 'danger' : 'primary', onClick: () => { resolve(true); m.close(true); } }))),
    });
  });
}

/** قائمة إجراءات (ورقة سفلية في الجوال / نافذة في الحاسوب). items: [{label, icon, danger, onClick}] */
export function actionMenu(items, title) {
  const m = modal({
    title,
    content: h('div', null, items.filter(Boolean).map((it) =>
      h('button', { type: 'button', class: `menu-item${it.danger ? ' danger' : ''}`, onClick: async () => { m.close(); await it.onClick(); } },
        icon(it.icon || 'chev-l'), it.label))),
  });
  return m;
}

export function emptyState({ icon: ic = 'sparkles', title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'art' }, icon(ic)),
    h('h3', null, title),
    text ? h('p', null, text) : null,
    action || null);
}
export function errorState(message, retry) {
  return emptyState({ icon: 'alert', title: t('تعذّر التحميل'), text: message, action: retry ? button(t('إعادة المحاولة'), { cls: 'primary', iconName: 'refresh', onClick: retry }) : null });
}

export const skeletonPosts = (n = 2) => h('div', { class: 'feed', 'aria-hidden': 'true' }, Array.from({ length: n }, () =>
  h('div', { class: 'card sk-post' },
    h('div', { class: 'row' }, h('div', { class: 'skeleton', style: { width: '44px', height: '44px', borderRadius: '50%' } }),
      h('div', { class: 'col grow', style: { gap: '6px' } }, h('div', { class: 'skeleton', style: { height: '12px', width: '40%' } }), h('div', { class: 'skeleton', style: { height: '10px', width: '25%' } }))),
    h('div', { class: 'skeleton sk-media' }),
    h('div', { class: 'skeleton', style: { height: '12px', width: '70%' } }))));
export const skeletonRows = (n = 5) => h('div', { class: 'card', 'aria-hidden': 'true' }, Array.from({ length: n }, () =>
  h('div', { class: 'user-row' }, h('div', { class: 'skeleton', style: { width: '44px', height: '44px', borderRadius: '50%' } }),
    h('div', { class: 'col grow', style: { gap: '6px' } }, h('div', { class: 'skeleton', style: { height: '12px', width: '45%' } }), h('div', { class: 'skeleton', style: { height: '10px', width: '30%' } })))));
export const skeletonGrid = (n = 9) => h('div', { class: 'grid', 'aria-hidden': 'true' }, Array.from({ length: n }, () => h('div', { class: 'tile skeleton', style: { borderRadius: 0 } })));

/**
 * تمرير لانهائي: loader(cursor) => {items, next} حيث next مؤشر الصفحة التالية أو null.
 * render(items, append) تضيف العناصر إلى container.
 */
export function infiniteList(container, { loader, render, empty, skeleton, endNote = false }) {
  let cursor = undefined, done = false, loading = false, destroyed = false, count = 0;
  const sentinel = h('div', { class: 'sentinel' });
  const more = h('div', { class: 'loading-more', hidden: true }, spinner());
  const host = h('div', { class: 'il-host' });
  container.append(host, more, sentinel);
  let skel = skeleton ? skeleton() : null;
  if (skel) host.append(skel);

  const io = new IntersectionObserver((e) => e[0].isIntersecting && load(), { rootMargin: '600px 0px' });

  async function load() {
    if (loading || done || destroyed) return;
    loading = true;
    more.hidden = count === 0;
    try {
      const { items, next } = await loader(cursor);
      if (destroyed) return;
      skel?.remove(); skel = null;
      count += items.length;
      if (items.length) render(items, host);
      cursor = next;
      if (next === null || next === undefined) {
        done = true; io.disconnect();
        if (count === 0) host.append(typeof empty === 'function' ? empty() : empty || '');
        else if (endNote) host.append(h('div', { class: 'end-note' }, t('وصلت إلى النهاية')));
      }
    } catch (e) {
      if (destroyed) return;
      skel?.remove(); skel = null;
      done = true; io.disconnect();
      host.append(errorState(e.message, () => { done = false; host.querySelector('.empty')?.remove(); io.observe(sentinel); load(); }));
    } finally {
      loading = false; more.hidden = true;
    }
  }
  io.observe(sentinel);
  load();
  return { destroy() { destroyed = true; io.disconnect(); }, host, reload() { /* يُعاد بناء القائمة بالكامل من الاستدعاء */ } };
}
