import { h, clear, avatar, button, withLoading, handle } from '../dom.js';
import { icon } from '../icons.js';
import { t, fmtBytes } from '../i18n.js';
import { upload, ApiError } from '../api.js';
import { state } from '../state.js';
import { navigate, setBeforeLeave } from '../router.js';
import { ensureApp, markActive, setTitle } from '../shell.js';
import { toast, confirmDialog } from '../ui.js';

const IMG_OK = /^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i;
const VID_OK = /^video\/(mp4|quicktime|webm|x-matroska)$/i;

export function create() {
  const view = ensureApp();
  markActive('/create');
  setTitle(t('منشور جديد'));
  const lim = state.config.limits;
  let files = []; // {file, url, type}
  let busy = false;
  let abort = null;

  const input = h('input', { type: 'file', multiple: '', accept: 'image/*,video/mp4,video/quicktime,video/webm,video/x-matroska', hidden: true });
  const drop = h('div', { class: 'drop', role: 'button', tabindex: '0', onClick: () => input.click(), onKeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()) },
    h('div', { class: 'art' }, icon('upload', 'lg')), h('b', null, t('اختر صورًا أو فيديو')),
    h('span', { class: 'muted small' }, t('اسحب الملفات وأفلتها هنا، أو اضغط للاختيار')),
    h('span', { class: 'xs faint' }, t('حتى {n} صور (بحد {i}MB للصورة) أو فيديو واحد (بحد {v}MB)', { n: lim.maxImages, i: lim.imageMB, v: lim.videoMB })));
  const previews = h('div', { class: 'previews', hidden: true });
  const caption = h('textarea', { class: 'textarea', maxlength: String(lim.captionLength), placeholder: t('اكتب وصفًا… استخدم #الوسوم ليسهل الوصول لمنشورك'), 'aria-label': t('الوصف'), rows: '4' });
  const counter = h('div', { class: 'counter' }, `0 / ${lim.captionLength}`);
  const tagsInput = h('input', { class: 'input', placeholder: t('وسوم إضافية مفصولة بمسافة (اختياري)'), 'aria-label': t('وسوم'), maxlength: '200' });
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const bar = h('i'); const barBox = h('div', { class: 'progress-bar', hidden: true }, bar);
  const status = h('div', { class: 'small muted center', hidden: true });
  const submit = h('button', { class: 'btn primary lg block', type: 'submit', disabled: true }, icon('send', 'sm'), t('نشر'));

  caption.addEventListener('input', () => { counter.textContent = `${caption.value.length} / ${lim.captionLength}`; counter.classList.toggle('warn', caption.value.length > lim.captionLength * 0.95); });
  const showErr = (m) => { err.hidden = !m; err.textContent = m || ''; };

  function render() {
    clear(previews);
    previews.hidden = !files.length;
    drop.hidden = files.length > 0 && files[0].type === 'video';
    files.forEach((f, i) => previews.append(h('div', { class: 'preview' },
      f.type === 'video' ? h('video', { src: f.url, muted: true, playsinline: '', preload: 'metadata' }) : h('img', { src: f.url, alt: '' }),
      files.length > 1 ? h('span', { class: 'idx' }, i + 1) : null,
      h('button', { type: 'button', class: 'rm', 'aria-label': t('إزالة'), onClick: () => { URL.revokeObjectURL(f.url); files.splice(i, 1); render(); } }, icon('x')))));
    if (files.length && files[0].type === 'image' && files.length < lim.maxImages) {
      previews.append(h('button', { type: 'button', class: 'preview', style: { display: 'grid', placeItems: 'center', background: 'var(--primary-soft)', color: 'var(--primary)' }, 'aria-label': t('إضافة صورة'), onClick: () => input.click() }, icon('plus', 'lg')));
    }
    submit.disabled = !files.length || busy;
  }

  function addFiles(list) {
    showErr('');
    for (const file of list) {
      const isImg = IMG_OK.test(file.type) || (!file.type && /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(file.name));
      const isVid = VID_OK.test(file.type) || (!file.type && /\.(mp4|mov|webm|mkv)$/i.test(file.name));
      if (!isImg && !isVid) { showErr(t('الملف «{n}» غير مدعوم. المدعوم: صور (JPG/PNG/WebP/GIF/AVIF/HEIC) وفيديو (MP4/MOV/WebM/MKV).', { n: file.name })); continue; }
      if (isVid) {
        if (files.length) { showErr(t('لا يمكن الجمع بين فيديو وصور أو أكثر من فيديو في منشور واحد.')); continue; }
        if (file.size > lim.videoMB * 1048576) { showErr(t('حجم الفيديو ({s}) يتجاوز الحد المسموح ({v}MB).', { s: fmtBytes(file.size), v: lim.videoMB })); continue; }
        files = [{ file, type: 'video', url: URL.createObjectURL(file) }];
        break;
      }
      if (files[0]?.type === 'video') { showErr(t('لا يمكن الجمع بين فيديو وصور في منشور واحد.')); continue; }
      if (file.size > lim.imageMB * 1048576) { showErr(t('حجم الصورة «{n}» ({s}) يتجاوز {i}MB.', { n: file.name, s: fmtBytes(file.size), i: lim.imageMB })); continue; }
      if (files.length >= lim.maxImages) { showErr(t('الحد الأقصى {n} صور في المنشور.', { n: lim.maxImages })); break; }
      files.push({ file, type: 'image', url: URL.createObjectURL(file) });
    }
    render();
  }
  input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));

  const form = h('form', { class: 'col', onSubmit: async (e) => {
    e.preventDefault();
    if (!files.length || busy) return;
    showErr('');
    busy = true; render();
    barBox.hidden = false; status.hidden = false; bar.style.width = '0';
    status.textContent = t('جارٍ الرفع…');
    abort = new AbortController();
    submit.replaceChildren(h('span', { class: 'spinner' }), t('جارٍ النشر…'));
    try {
      const isVideo = files[0].type === 'video';
      const r = await upload('/posts', { caption: caption.value, tags: JSON.stringify(tagsInput.value.split(/[\s,،]+/).filter(Boolean)) }, files.map((f) => ({ file: f.file })), {
        signal: abort.signal,
        onProgress: (p, phase) => { bar.style.width = `${Math.round(p * 100)}%`; status.textContent = phase === 'processing' ? (isVideo ? t('اكتمل الرفع، نجهّز الفيديو (ضغط وإنشاء غلاف)…') : t('اكتمل الرفع، نجهّز الصور…')) : t('جارٍ الرفع… {p}%', { p: Math.round(p * 100) }); },
      });
      files.forEach((f) => URL.revokeObjectURL(f.url)); files = [];
      setBeforeLeave(null);
      toast(t('تم نشر منشورك'), 'success');
      navigate(`/post/${r.post.id}`, { replace: true });
    } catch (ex) {
      if (ex.code !== 'aborted') showErr(ex.message);
      busy = false; barBox.hidden = true; status.hidden = true;
      submit.replaceChildren(icon('send', 'sm'), t('نشر')); render();
      if (ex.code === 'email_unverified') toast(ex.message, 'error');
    }
  } },
  h('div', { class: 'row' }, avatar(state.user, 44), h('div', null, h('b', null, state.user.displayName), h('div', { class: 'xs muted' }, handle(state.user.username)))),
  input, drop, previews, caption, counter, tagsInput, err, barBox, status, submit);

  view.append(h('div', { class: 'view-enter' }, h('div', { class: 'page-head' }, h('h1', null, t('منشور جديد'))), h('div', { class: 'card pad' }, form)));

  // تنبيه قبل ترك الصفحة أثناء الرفع أو مع محتوى غير منشور
  const unload = (e) => { if (busy) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', unload);
  setBeforeLeave(() => { if (!busy && !files.length && !caption.value) return true; if (busy) { toast(t('انتظر حتى ينتهي الرفع')); return false; } return confirm(t('لديك محتوى غير منشور. هل تريد المغادرة؟')); });
  return () => { removeEventListener('beforeunload', unload); files.forEach((f) => URL.revokeObjectURL(f.url)); abort?.abort(); };
}
