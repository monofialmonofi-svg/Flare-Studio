import { h, button, withLoading } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { post, get } from '../api.js';
import { state, setUser } from '../state.js';
import { navigate } from '../router.js';
import { ensureBare, setTitle, refreshUnread, startPolling } from '../shell.js';

const safeNext = (q) => {
  const n = q.get('next');
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
};

function brand() {
  return h('a', { class: 'brand', href: '/welcome', 'data-link': '' }, h('img', { src: '/icons/logo.svg', alt: '', width: 40, height: 40 }), h('b', null, 'LAMMA'), h('small', null, '| لَمّة'));
}

function field({ label, name, type = 'text', placeholder, autocomplete, hint, required = true, dir, maxlength, inputmode }) {
  const input = h('input', { class: 'input', id: `f-${name}`, name, type, placeholder, autocomplete, required, dir, maxlength, inputmode, autocapitalize: 'none', spellcheck: 'false' });
  const err = h('div', { class: 'error-text', hidden: true, role: 'alert' });
  let control = input;
  if (type === 'password') {
    const eye = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('إظهار كلمة المرور') }, icon('eye'));
    eye.onclick = () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; eye.replaceChildren(icon(show ? 'eye-off' : 'eye')); eye.setAttribute('aria-label', show ? t('إخفاء كلمة المرور') : t('إظهار كلمة المرور')); };
    control = h('div', { class: 'input-wrap' }, input, eye);
  }
  const el = h('div', { class: 'field' }, h('label', { for: `f-${name}` }, label), control, hint ? h('div', { class: 'hint' }, hint) : null, err);
  el.input = input;
  el.setError = (m) => { err.hidden = !m; err.textContent = m || ''; input.setAttribute('aria-invalid', m ? 'true' : 'false'); };
  return el;
}

function authShell(title, subtitle, ...body) {
  const root = ensureBare();
  root.append(h('div', { class: 'auth-shell view-enter' },
    h('div', { class: 'card auth-card' }, brand(), h('h1', null, title), subtitle ? h('p', { class: 'sub' }, subtitle) : null, ...body),
    h('a', { class: 'back', href: '/welcome', 'data-link': '' }, t('← العودة إلى الصفحة الرئيسية'))));
}

async function afterAuth(user, next) {
  setUser(user);
  startPolling();
  await refreshUnread();
  navigate(next, { replace: true });
}

export function welcome() {
  setTitle('');
  const root = ensureBare();
  const feature = (ic, title, text) => h('div', { class: 'feature' }, h('div', { class: 'ico' }, icon(ic)), h('div', null, h('b', null, title), h('span', null, text)));
  root.append(h('div', { class: 'hero view-enter' },
    h('div', { class: 'orbs', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('header', { class: 'nav' }, h('a', { class: 'brand', href: '/welcome', 'data-link': '' }, h('img', { src: '/icons/logo.svg', alt: '', width: 38, height: 38 }), h('b', null, 'LAMMA'), h('small', { style: { color: 'rgba(255,255,255,.7)' } }, '| لَمّة')),
      h('div', { class: 'row' }, state.user
        ? h('a', { class: 'btn outline sm', href: '/', 'data-link': '' }, t('الذهاب إلى الخلاصة'))
        : [h('a', { class: 'btn outline sm', href: '/login', 'data-link': '' }, t('تسجيل الدخول'))])),
    h('div', { class: 'content' },
      h('h1', null, 'كل لحظاتنا ', h('em', null, 'في مكان واحد')),
      h('p', { class: 'lead' }, t('لَمّة مكانك لتشارك صورك وفيديوهاتك مع من تحب، وتتابع جديد أصدقائك، وتكتشف محتوى يستحق المشاهدة.')),
      h('div', { class: 'cta' },
        h('a', { class: 'btn primary lg', href: state.user ? '/' : '/signup', 'data-link': '' }, state.user ? t('افتح الخلاصة') : t('أنشئ حسابك مجانًا'), icon('chev-l', 'sm')),
        h('a', { class: 'btn outline lg', href: '/explore', 'data-link': '' }, t('تصفّح بدون حساب'))),
      h('div', { class: 'features' },
        feature('image', t('صور بجودة عالية'), t('ارفع صورة أو معرضًا كاملًا، وتُعرض بأبعادها الأصلية دون تشويه.')),
        feature('film', t('فيديوهات سلسة'), t('رفع من الهاتف أو الكمبيوتر وتشغيل سريع، مع واجهة مشاهدة متتابعة.')),
        feature('users', t('لمّة حقيقية'), t('تابع، علّق، شارك واحفظ — وتحكّم بخصوصيتك وأمان حسابك.'))))));
}

export function login(ctx) {
  setTitle(t('تسجيل الدخول'));
  const id = field({ label: t('البريد الإلكتروني أو اسم المستخدم'), name: 'identifier', autocomplete: 'username', dir: 'ltr' });
  const pw = field({ label: t('كلمة المرور'), name: 'password', type: 'password', autocomplete: 'current-password', dir: 'ltr' });
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const info = ctx.query.get('verified') ? h('div', { class: 'form-success' }, t('تم تأكيد بريدك. يمكنك تسجيل الدخول الآن.')) : ctx.query.get('reset') ? h('div', { class: 'form-success' }, t('تم تغيير كلمة المرور. سجّل الدخول بكلمتك الجديدة.')) : null;
  const submit = h('button', { class: 'btn primary lg block', type: 'submit' }, t('تسجيل الدخول'));
  const form = h('form', { class: 'col', novalidate: '', onSubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    await withLoading(submit, async () => {
      try { const r = await post('/auth/login', { identifier: id.input.value, password: pw.input.value }); await afterAuth(r.user, safeNext(ctx.query)); }
      catch (ex) { err.hidden = false; err.textContent = ex.message; }
    });
  } }, info, id, pw, err, h('div', null, h('a', { class: 'small bold', href: '/forgot', 'data-link': '', style: { color: 'var(--primary)' } }, t('نسيت كلمة المرور؟'))), submit);
  authShell(t('أهلًا بعودتك'), t('سجّل الدخول لمتابعة لحظاتك'), form,
    h('p', { class: 'center small muted', style: { marginTop: '1.2rem' } }, t('ليس لديك حساب؟'), ' ', h('a', { href: `/signup${location.search}`, 'data-link': '', class: 'bold', style: { color: 'var(--primary)' } }, t('أنشئ حسابًا'))));
  id.input.focus();
}

export function signup(ctx) {
  setTitle(t('إنشاء حساب'));
  const name = field({ label: t('الاسم المعروض'), name: 'displayName', autocomplete: 'name', maxlength: 50 });
  const user = field({ label: t('اسم المستخدم'), name: 'username', autocomplete: 'username', dir: 'ltr', hint: t('حروف إنجليزية وأرقام و _ و . فقط (3–24)'), maxlength: 24 });
  const email = field({ label: t('البريد الإلكتروني'), name: 'email', type: 'email', autocomplete: 'email', dir: 'ltr', inputmode: 'email' });
  const pw = field({ label: t('كلمة المرور'), name: 'password', type: 'password', autocomplete: 'new-password', dir: 'ltr', hint: t('8 أحرف على الأقل وتحتوي على حرف ورقم') });
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  user.input.addEventListener('input', () => user.setError(user.input.value && !/^[A-Za-z0-9_.]{3,24}$/.test(user.input.value) ? t('اسم المستخدم غير صالح') : ''));
  pw.input.addEventListener('input', () => pw.setError(pw.input.value && !(pw.input.value.length >= 8 && /\p{L}/u.test(pw.input.value) && /\d/.test(pw.input.value)) ? t('كلمة المرور ضعيفة: 8 أحرف على الأقل مع حرف ورقم') : ''));
  const submit = h('button', { class: 'btn primary lg block', type: 'submit' }, t('إنشاء الحساب'));
  const form = h('form', { class: 'col', novalidate: '', onSubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    await withLoading(submit, async () => {
      try {
        const r = await post('/auth/signup', { displayName: name.input.value, username: user.input.value, email: email.input.value, password: pw.input.value });
        await afterAuth(r.user, safeNext(ctx.query));
      } catch (ex) {
        const target = { bad_email: email, email_taken: email, bad_username: user, username_taken: user, weak_password: pw, bad_name: name }[ex.code];
        if (target) target.setError(ex.message); else { err.hidden = false; err.textContent = ex.message; }
      }
    });
  } }, name, user, email, pw, err,
  h('p', { class: 'xs muted center' }, t('بإنشاء الحساب فأنت توافق على استخدام المنصة بما يحترم الآخرين وقوانين المحتوى.')), submit);
  authShell(t('انضم إلى لَمّة'), t('كل لحظاتنا في مكان واحد'), form,
    h('p', { class: 'center small muted', style: { marginTop: '1.2rem' } }, t('لديك حساب بالفعل؟'), ' ', h('a', { href: `/login${location.search}`, 'data-link': '', class: 'bold', style: { color: 'var(--primary)' } }, t('سجّل الدخول'))));
  name.input.focus();
}

export function forgot() {
  setTitle(t('استعادة كلمة المرور'));
  const email = field({ label: t('البريد الإلكتروني'), name: 'email', type: 'email', autocomplete: 'email', dir: 'ltr' });
  const msg = h('div', { class: 'form-success', hidden: true, role: 'status' });
  const err = h('div', { class: 'form-error', hidden: true });
  const submit = h('button', { class: 'btn primary lg block', type: 'submit' }, t('إرسال رابط الاستعادة'));
  authShell(t('نسيت كلمة المرور؟'), t('أدخل بريدك وسنرسل لك رابطًا لإنشاء كلمة مرور جديدة'),
    h('form', { class: 'col', onSubmit: async (e) => {
      e.preventDefault(); err.hidden = true;
      await withLoading(submit, async () => {
        try { await post('/auth/forgot', { email: email.input.value }); msg.hidden = false; msg.textContent = t('إن كان هذا البريد مسجّلًا لدينا فقد أرسلنا إليه رابط الاستعادة. تحقق من بريدك (وملف الرسائل المزعجة).'); }
        catch (ex) { err.hidden = false; err.textContent = ex.message; }
      });
    } }, email, msg, err, submit),
    h('p', { class: 'center small', style: { marginTop: '1.2rem' } }, h('a', { href: '/login', 'data-link': '', class: 'bold', style: { color: 'var(--primary)' } }, t('العودة لتسجيل الدخول'))));
}

export function reset(ctx) {
  setTitle(t('كلمة مرور جديدة'));
  const token = ctx.query.get('token') || '';
  const pw = field({ label: t('كلمة المرور الجديدة'), name: 'password', type: 'password', autocomplete: 'new-password', dir: 'ltr', hint: t('8 أحرف على الأقل وتحتوي على حرف ورقم') });
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const submit = h('button', { class: 'btn primary lg block', type: 'submit' }, t('حفظ كلمة المرور'));
  authShell(t('إنشاء كلمة مرور جديدة'), '',
    h('form', { class: 'col', onSubmit: async (e) => {
      e.preventDefault(); err.hidden = true;
      await withLoading(submit, async () => {
        try { await post('/auth/reset', { token, password: pw.input.value }); setUser(null); navigate('/login?reset=1', { replace: true }); }
        catch (ex) { err.hidden = false; err.textContent = ex.message; }
      });
    } }, pw, err, submit));
}

export async function verify(ctx) {
  setTitle(t('تأكيد البريد'));
  const body = h('div', { class: 'col center' }, h('div', { class: 'loading-more' }, h('span', { class: 'spinner' })));
  authShell(t('تأكيد البريد الإلكتروني'), '', body);
  try {
    await post('/auth/verify', { token: ctx.query.get('token') || '' });
    if (state.user) { const me = await get('/auth/me'); setUser(me.user); }
    body.replaceChildren(h('div', { class: 'form-success' }, t('تم تأكيد بريدك الإلكتروني بنجاح 🎉')),
      h('a', { class: 'btn primary lg block', href: state.user ? '/' : '/login?verified=1', 'data-link': '' }, state.user ? t('متابعة إلى لَمّة') : t('تسجيل الدخول')));
  } catch (e) {
    body.replaceChildren(h('div', { class: 'form-error' }, e.message), h('a', { class: 'btn outline block', href: '/', 'data-link': '' }, t('العودة')));
  }
}
