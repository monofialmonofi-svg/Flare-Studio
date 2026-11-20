// طبقة ترجمة بسيطة: النص العربي هو المفتاح. لإضافة الإنجليزية لاحقًا يكفي تسجيل قاموس
// registerLocale('en', { 'الرئيسية': 'Home', ... }) ثم setLocale('en') — الاتجاه (rtl/ltr) يتبدّل تلقائيًا.
const dicts = { ar: null };
let locale = 'ar';
const rtl = new Set(['ar', 'he', 'fa', 'ur']);

export const registerLocale = (code, dict) => { dicts[code] = dict; };
export function setLocale(code) {
  locale = code;
  document.documentElement.lang = code;
  document.documentElement.dir = rtl.has(code) ? 'rtl' : 'ltr';
  try { localStorage.setItem('lamma-locale', code); } catch {}
}
export const getLocale = () => locale;

export function t(text, vars) {
  let s = (dicts[locale] && dicts[locale][text]) || text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return s;
}

const intlLocale = () => `${locale}-u-nu-latn`; // أرقام لاتينية لوضوح الأعداد وأسماء المستخدمين
export const fmtNumber = (n) => new Intl.NumberFormat(intlLocale(), { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
export function timeAgo(ms) {
  const diff = Date.now() - ms;
  const s = Math.round(diff / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });
  if (s < 45) return t('الآن');
  const units = [['minute', 60], ['hour', 3600], ['day', 86400]];
  for (let i = units.length - 1; i >= 0; i--) {
    const [u, sec] = units[i];
    if (s >= sec) { const v = Math.floor(s / sec); if (u === 'day' && v >= 7) break; return rtf.format(-v, u); }
  }
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute');
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(ms);
}
export const fmtDate = (ms) => new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
export const fmtBytes = (b) => (b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
