// بناء DOM بشكل آمن: النصوص تُضاف دائمًا كـ text nodes (لا innerHTML) فلا ثغرات XSS بالتصميم.
import { icon } from './icons.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('aria-') && typeof v === 'boolean') { el.setAttribute(k, String(v)); continue; }
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'muted' || k === 'autoplay' || k === 'loop') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms = 300) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** يحوّل نصًا إلى عقد: #وسوم وروابط http(s) تصبح روابط آمنة. */
export function richText(text, { onTag } = {}) {
  const out = [];
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"،؛؟])|(^|[\s(،.!؟?])#([\p{L}\p{N}_]{1,50})/gu;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer nofollow ugc', class: 'ltr' }, m[1].replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)));
    } else {
      out.push(m[2]);
      out.push(h('a', { href: `/tag/${encodeURIComponent(m[3])}`, 'data-link': '' }, `#${m[3]}`));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function avatar(user, size = 44, { ring = false } = {}) {
  const name = user?.displayName || user?.username || '؟';
  let hash = 0;
  for (const ch of user?.username || '') hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const el = h('span', { class: `avatar${ring ? ' ring' : ''}`, style: { '--s': `${size}px`, '--hue': hash } }, [...name][0]?.toUpperCase());
  if (user?.avatar) el.append(h('img', { src: user.avatar, alt: '', loading: 'lazy', decoding: 'async', width: size, height: size }));
  return el;
}

/** اسم المستخدم بعزل ثنائي الاتجاه حتى لا ينقلب @ إلى آخر النص في الواجهة العربية. */
export const handle = (username) => h('bdi', { dir: 'ltr' }, `@${username}`);

export function spinner() { return h('span', { class: 'spinner', role: 'progressbar', 'aria-label': 'جارٍ التحميل' }); }

export function button(label, { cls = '', iconName, onClick, type = 'button', ...rest } = {}) {
  return h('button', { type, class: `btn ${cls}`, onClick, ...rest }, iconName ? icon(iconName, 'sm') : null, label);
}
export function iconButton(iconName, label, onClick, cls = '') {
  return h('button', { type: 'button', class: `icon-btn ${cls}`, 'aria-label': label, title: label, onClick }, icon(iconName));
}

/** يعطّل الزر ويعرض مؤشرًا أثناء تنفيذ دالة غير متزامنة. */
export async function withLoading(btn, fn) {
  if (btn.classList.contains('is-loading')) return;
  const children = [...btn.childNodes];
  btn.classList.add('is-loading');
  btn.replaceChildren(spinner());
  try { return await fn(); } finally { btn.classList.remove('is-loading'); btn.replaceChildren(...children); }
}
