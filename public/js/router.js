// موجّه بسيط يعتمد History API. كل مسار: pattern + view(ctx) => cleanup?
import { state } from './state.js';

const routes = [];
let current = { cleanup: null, path: null };
let beforeLeave = null;

export const route = (pattern, view, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => (keys.push(k), '/([^/]+)')) + '/?$');
  routes.push({ re, keys, view, ...opts });
};
export const setBeforeLeave = (fn) => { beforeLeave = fn; };

export function navigate(to, { replace = false } = {}) {
  if (beforeLeave && !beforeLeave()) return;
  if (to === location.pathname + location.search) return render();
  history[replace ? 'replaceState' : 'pushState']({}, '', to);
  render();
}
export const back = () => (history.length > 1 ? history.back() : navigate('/'));

export async function render() {
  const url = new URL(location.href);
  let match = null, params = {};
  for (const r of routes) {
    const m = r.re.exec(url.pathname);
    if (m) { match = r; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); break; }
  }
  if (typeof current.cleanup === 'function') { try { current.cleanup(); } catch (e) { console.error(e); } }
  current = { cleanup: null, path: url.pathname };
  beforeLeave = null;

  const notFound = routes.find((r) => r.notFound);
  match = match || notFound;
  if (match.auth && !state.user) return navigate(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, { replace: true });
  if (match.guest && state.user) return navigate('/', { replace: true });

  const token = (current.token = Symbol());
  const ctx = { params, query: url.searchParams, path: url.pathname, isCurrent: () => current.token === token };
  const out = await match.view(ctx);
  if (current.token === token) current.cleanup = out;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[data-link]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  const href = a.getAttribute('href');
  if (!href?.startsWith('/')) return;
  e.preventDefault();
  navigate(href);
});
addEventListener('popstate', () => render());
