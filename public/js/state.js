// حالة التطبيق العامة + ناقل أحداث صغير.
export const state = { user: null, config: null, unread: 0 };
const subs = new Map();
export const on = (evt, fn) => { (subs.get(evt) ?? subs.set(evt, new Set()).get(evt)).add(fn); return () => subs.get(evt).delete(fn); };
export const emit = (evt, data) => subs.get(evt)?.forEach((fn) => fn(data));
export function setUser(user) { state.user = user; emit('user', user); }
export function setUnread(n) { state.unread = n; emit('unread', n); }
