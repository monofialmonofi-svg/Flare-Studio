import { h, avatar, button, richText, withLoading, clear, spinner, handle } from './dom.js';
import { icon } from './icons.js';
import { t, timeAgo, fmtNumber, fmtDuration } from './i18n.js';
import { post as apiPost, del as apiDel, get, patch, upload } from './api.js';
import { state } from './state.js';
import { navigate } from './router.js';
import { toast, modal, confirmDialog, actionMenu, emptyState } from './ui.js';

export function requireLogin() {
  if (state.user) return true;
  navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  return false;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sameWidthRatio = (m, min = 0.8, max = 1.91) => clamp(m.width / m.height, min, max);

// ======================= مشغّل الفيديو =======================
const players = new Set();
export const playerPrefs = { muted: true };

export function videoPlayer(post, { autoplay = true, minAr = 0.8, onViewed } = {}) {
  const m = post.media[0];
  const ar = sameWidthRatio(m, minAr, 1.91);
  let userPaused = false, viewed = false, seeking = false, srcSet = false;

  const video = h('video', {
    poster: m.poster, playsinline: '', preload: 'none', loop: true, 'aria-label': post.caption || t('فيديو'),
    disablepictureinpicture: '', controlslist: 'nodownload noremoteplayback',
  });
  video.muted = playerPrefs.muted;
  const playBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('تشغيل / إيقاف') });
  const muteBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('كتم / تشغيل الصوت') });
  const fsBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('ملء الشاشة') }, icon('expand'));
  const fill = h('div', { class: 'fill' }), buf = h('div', { class: 'buf' });
  const seek = h('div', { class: 'seek', role: 'slider', 'aria-label': t('شريط التقدم'), tabindex: '0', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'bar' }, buf, fill));
  const time = h('span', { class: 'time' }, `0:00 / ${fmtDuration(m.duration)}`);
  const root = h('div', { class: 'player paused', tabindex: '0', role: 'group', 'aria-label': t('مشغّل الفيديو') },
    h('div', { class: 'media-frame', style: { '--ar': ar }, onClick: () => toggle(true) },
      h('img', { class: 'bg', src: m.poster, alt: '', loading: 'lazy', 'aria-hidden': 'true' }), video),
    h('div', { class: 'bigplay' }, icon('play')),
    h('div', { class: 'spin spinner' }),
    h('span', { class: 'dur-badge' }, fmtDuration(m.duration)),
    h('div', { class: 'controls' }, playBtn, seek, time, muteBtn, fsBtn));

  const syncIcons = () => {
    playBtn.replaceChildren(icon(video.paused ? 'play' : 'pause'));
    muteBtn.replaceChildren(icon(video.muted ? 'mute' : 'volume'));
    root.classList.toggle('paused', video.paused);
  };
  function ensureSrc() { if (!srcSet) { srcSet = true; video.preload = 'metadata'; video.src = m.url; } }
  const api = {
    root, video,
    async play() {
      ensureSrc();
      for (const p of players) if (p !== api && p.root.isConnected) p.pause(); else if (!p.root.isConnected) players.delete(p);
      players.add(api);
      try { await video.play(); } catch (e) {
        if (!video.muted) { video.muted = true; playerPrefs.muted = true; try { await video.play(); } catch {} }
      }
      if (!viewed && !video.paused) { viewed = true; apiPost(`/posts/${post.id}/view`).then((r) => onViewed?.(r.views)).catch(() => {}); }
    },
    pause() { video.pause(); },
  };
  function toggle(byUser) { if (video.paused) { if (byUser) userPaused = false; api.play(); } else { if (byUser) userPaused = true; video.pause(); } }
  playBtn.onclick = () => toggle(true);
  muteBtn.onclick = () => { video.muted = !video.muted; playerPrefs.muted = video.muted; syncIcons(); };
  fsBtn.onclick = () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iOS Safari
  };
  video.addEventListener('play', syncIcons); video.addEventListener('pause', syncIcons); video.addEventListener('volumechange', syncIcons);
  video.addEventListener('waiting', () => root.classList.add('buffering'));
  for (const ev of ['playing', 'canplay', 'pause']) video.addEventListener(ev, () => root.classList.remove('buffering'));
  video.addEventListener('timeupdate', () => {
    if (seeking || !video.duration) return;
    fill.style.width = `${(video.currentTime / video.duration) * 100}%`;
    time.textContent = `${fmtDuration(video.currentTime)} / ${fmtDuration(video.duration)}`;
  });
  video.addEventListener('progress', () => {
    if (video.buffered.length && video.duration) buf.style.width = `${(video.buffered.end(video.buffered.length - 1) / video.duration) * 100}%`;
  });
  video.addEventListener('error', () => { root.classList.add('paused'); toast(t('تعذّر تشغيل هذا الفيديو'), 'error'); });

  const seekTo = (e) => {
    const r = seek.getBoundingClientRect();
    const p = clamp((e.clientX - r.left) / r.width, 0, 1);
    ensureSrc();
    if (video.duration) { video.currentTime = p * video.duration; fill.style.width = `${p * 100}%`; }
  };
  seek.addEventListener('pointerdown', (e) => { seeking = true; seek.setPointerCapture(e.pointerId); seekTo(e); });
  seek.addEventListener('pointermove', (e) => seeking && seekTo(e));
  seek.addEventListener('pointerup', () => { seeking = false; });
  seek.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') video.currentTime -= 5; if (e.key === 'ArrowRight') video.currentTime += 5; });
  root.addEventListener('keydown', (e) => {
    if (e.target !== root) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(true); }
    else if (e.key === 'm') muteBtn.click(); else if (e.key === 'f') fsBtn.click();
    else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
    else if (e.key === 'ArrowRight') video.currentTime += 5;
  });
  root.addEventListener('touchstart', () => { root.classList.add('show-controls'); clearTimeout(root._t); root._t = setTimeout(() => root.classList.remove('show-controls'), 2500); }, { passive: true });

  // تحميل تدريجي: لا يُجلب الفيديو إلا قرب الظهور، ويُشغَّل تلقائيًا (صامتًا) عند ظهور 60% منه
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) ensureSrc();
      if (autoplay) {
        if (e.intersectionRatio >= 0.6 && !userPaused) api.play();
        else if (e.intersectionRatio < 0.3) { video.pause(); if (e.intersectionRatio === 0) userPaused = false; }
      }
    }
  }, { threshold: [0, 0.3, 0.6], rootMargin: '200px 0px' });
  io.observe(root);
  syncIcons();
  return api;
}

// ======================= الصور والمعرض =======================
function imgEl(m, { cls = 'fg', sizes = '(min-width: 700px) 640px, 100vw', eager = false } = {}) {
  return h('img', { class: cls, src: m.medium, srcset: m.srcset, sizes, alt: '', width: m.width, height: m.height, loading: eager ? 'eager' : 'lazy', decoding: 'async' });
}

export function openLightbox(images, start = 0) {
  const root = document.getElementById('modal-root');
  const slides = h('div', { class: 'slides' }, images.map((m) => h('div', { class: 'slide', onClick: (e) => e.target === e.currentTarget && close() }, h('img', { src: m.large, alt: '', decoding: 'async' }))));
  const counter = h('span', null, `1 / ${images.length}`);
  const prevBtn = h('button', { class: 'icon-btn nav prev', 'aria-label': t('السابق'), onClick: () => go(-1) }, icon('chev-r'));
  const nextBtn = h('button', { class: 'icon-btn nav next', 'aria-label': t('التالي'), onClick: () => go(1) }, icon('chev-l'));
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('معرض الصور') },
    h('div', { class: 'top' }, h('button', { class: 'icon-btn', 'aria-label': t('إغلاق'), onClick: () => close() }, icon('x')), counter),
    slides, images.length > 1 ? [prevBtn, nextBtn] : null);
  let idx = start;
  const go = (d) => { idx = clamp(idx + d, 0, images.length - 1); slides.children[idx].scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); };
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { idx = [...slides.children].indexOf(e.target); counter.textContent = `${idx + 1} / ${images.length}`; } }), { root: slides, threshold: 0.6 });
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') go(1); if (e.key === 'ArrowRight') go(-1); };
  function close() { io.disconnect(); document.removeEventListener('keydown', onKey); box.remove(); document.body.style.overflow = ''; }
  document.addEventListener('keydown', onKey);
  root.append(box);
  document.body.style.overflow = 'hidden';
  [...slides.children].forEach((s) => io.observe(s));
  slides.children[start].scrollIntoView({ inline: 'center', block: 'nearest' });
}

export function mediaView(post, { eager = false } = {}) {
  const imgs = post.media;
  if (post.kind === 'video') return videoPlayer(post).root;
  const ar = sameWidthRatio(imgs[0]);
  const frame = (m, i) => h('div', { class: 'media-frame slide', style: { '--ar': ar }, onClick: () => openLightbox(imgs, i), role: 'button', tabindex: '0', 'aria-label': t('عرض الصورة بالحجم الكامل'), onKeydown: (e) => (e.key === 'Enter' || e.key === ' ') && openLightbox(imgs, i) },
    h('img', { class: 'bg', src: m.thumb, alt: '', 'aria-hidden': 'true', loading: 'lazy' }), imgEl(m, { eager: eager && i === 0 }));
  if (imgs.length === 1) { const f = frame(imgs[0], 0); f.classList.remove('slide'); f.style.cursor = 'zoom-in'; return f; }

  const slides = h('div', { class: 'slides' }, imgs.map(frame));
  const dots = h('div', { class: 'dots', 'aria-hidden': 'true' }, imgs.map((_, i) => h('i', { class: i === 0 ? 'on' : '' })));
  const count = h('span', { class: 'count' }, `1/${imgs.length}`);
  let idx = 0;
  const go = (d) => slides.children[clamp(idx + d, 0, imgs.length - 1)].scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  const prev = h('button', { class: 'nav prev', 'aria-label': t('السابق'), onClick: () => go(-1), hidden: true }, icon('chev-r'));
  const next = h('button', { class: 'nav next', 'aria-label': t('التالي'), onClick: () => go(1) }, icon('chev-l'));
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    idx = [...slides.children].indexOf(e.target);
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
    count.textContent = `${idx + 1}/${imgs.length}`;
    prev.hidden = idx === 0; next.hidden = idx === imgs.length - 1;
  }), { root: slides, threshold: 0.6 });
  const g = h('div', { class: 'gallery', role: 'group', 'aria-roledescription': 'carousel', 'aria-label': t('معرض صور') }, slides, count, dots, prev, next);
  requestAnimationFrame(() => [...slides.children].forEach((s) => io.observe(s)));
  return g;
}

// ======================= الأزرار الاجتماعية =======================
export function followButton(user, following, { onChange, size = 'sm' } = {}) {
  let on = following;
  const b = h('button', { type: 'button', class: `btn ${size}` });
  const paint = () => { b.className = `btn ${size} ${on ? 'following' : 'primary'}`; b.textContent = on ? t('إلغاء المتابعة') : t('متابعة'); b.setAttribute('aria-pressed', on); };
  paint();
  b.onclick = async () => {
    if (!requireLogin()) return;
    const prev = on; on = !on; paint();
    try { const r = on ? await apiPost(`/users/${user.username}/follow`) : await apiDel(`/users/${user.username}/follow`); onChange?.(on, r.followers); }
    catch (e) { on = prev; paint(); toast(e.message, 'error'); }
  };
  b.setState = (v) => { on = v; paint(); };
  return b;
}

export function userRow(u, { follow = true, sub } = {}) {
  return h('div', { class: 'user-row' },
    h('a', { href: `/u/${u.username}`, 'data-link': '' }, avatar(u, 48)),
    h('a', { class: 'info', href: `/u/${u.username}`, 'data-link': '' },
      h('div', { class: 'name truncate' }, u.displayName), h('div', { class: 'sub truncate' }, sub ?? handle(u.username))),
    follow && !u.isMe && state.user?.id !== u.id ? followButton(u, !!u.following) : null);
}

export async function sharePost(post, countEl) {
  const url = `${location.origin}/post/${post.id}`;
  try {
    if (navigator.share) await navigator.share({ title: `${post.author.displayName} على لَمّة`, text: post.caption.slice(0, 100), url });
    else { await navigator.clipboard.writeText(url); toast(t('تم نسخ رابط المنشور'), 'success'); }
  } catch (e) { if (e.name === 'AbortError') return; try { await navigator.clipboard.writeText(url); toast(t('تم نسخ رابط المنشور'), 'success'); } catch { toast(url); } }
  if (state.user) apiPost(`/posts/${post.id}/share`).then((r) => { post.counts.shares = r.count; countEl && (countEl.textContent = r.count ? fmtNumber(r.count) : ''); }).catch(() => {});
}

export function reportDialog(targetType, targetId) {
  if (!requireLogin()) return;
  const reasons = [['spam', t('محتوى مزعج أو إعلانات')], ['abuse', t('إساءة أو تنمّر')], ['nudity', t('محتوى غير لائق')], ['violence', t('عنف أو تهديد')], ['misinformation', t('معلومات مضلّلة')], ['impersonation', t('انتحال شخصية')], ['other', t('سبب آخر')]];
  const details = h('textarea', { class: 'textarea', maxlength: '500', placeholder: t('تفاصيل إضافية (اختياري)'), style: { minHeight: '80px' } });
  const err = h('div', { class: 'form-error', hidden: true });
  const m = modal({
    title: t('الإبلاغ عن محتوى'),
    content: h('form', { class: 'col', onSubmit: async (e) => {
      e.preventDefault();
      const reason = new FormData(e.target).get('reason');
      if (!reason) { err.hidden = false; err.textContent = t('اختر سبب البلاغ'); return; }
      try { await apiPost('/reports', { targetType, targetId, reason, details: details.value }); m.close(); toast(t('شكرًا، وصلنا بلاغك وسنراجعه'), 'success'); }
      catch (ex) { err.hidden = false; err.textContent = ex.message; }
    } },
      h('div', null, reasons.map(([v, l]) => h('label', { class: 'radio-row' }, h('input', { type: 'radio', name: 'reason', value: v }), l))),
      details, err,
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, button(t('إلغاء'), { cls: 'ghost', onClick: () => m.close() }), button(t('إرسال البلاغ'), { cls: 'primary', type: 'submit' }))),
  });
}

export function editPostDialog(post, onSaved) {
  const ta = h('textarea', { class: 'textarea', maxlength: String(state.config?.limits.captionLength || 2200), autofocus: '' });
  ta.value = post.caption;
  const err = h('div', { class: 'form-error', hidden: true });
  const m = modal({
    title: t('تعديل الوصف'),
    content: h('form', { class: 'col', onSubmit: async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      await withLoading(btn, async () => {
        try { const r = await patch(`/posts/${post.id}`, { caption: ta.value }); m.close(); toast(t('تم حفظ التعديل'), 'success'); onSaved?.(r.post); }
        catch (ex) { err.hidden = false; err.textContent = ex.message; }
      });
    } }, ta, h('div', { class: 'hint' }, t('يمكنك استخدام #الوسوم داخل الوصف.')), err,
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, button(t('إلغاء'), { cls: 'ghost', onClick: () => m.close() }), button(t('حفظ'), { cls: 'primary', type: 'submit' }))),
  });
}

export async function deletePostFlow(post, onDeleted) {
  if (!(await confirmDialog(t('سيُحذف هذا المنشور وجميع تعليقاته وملفاته نهائيًا. هل أنت متأكد؟'), { danger: true, confirmText: t('حذف نهائيًا'), title: t('حذف المنشور') }))) return;
  try { await apiDel(`/posts/${post.id}`); toast(t('تم حذف المنشور'), 'success'); onDeleted?.(); } catch (e) { toast(e.message, 'error'); }
}

export function postMenu(post, { onEdited, onDeleted, onHidden } = {}) {
  const own = post.viewer.isOwner;
  actionMenu([
    { label: t('نسخ الرابط'), icon: 'link', onClick: async () => { await navigator.clipboard.writeText(`${location.origin}/post/${post.id}`).catch(() => {}); toast(t('تم نسخ الرابط'), 'success'); } },
    own && { label: t('تعديل الوصف'), icon: 'edit', onClick: () => editPostDialog(post, onEdited) },
    own && { label: t('حذف المنشور'), icon: 'trash', danger: true, onClick: () => deletePostFlow(post, onDeleted) },
    !own && { label: t('إبلاغ عن المنشور'), icon: 'flag', onClick: () => reportDialog('post', post.id) },
    !own && { label: t('حظر @{u}', { u: post.author.username }), icon: 'ban', danger: true, onClick: async () => {
      if (!requireLogin()) return;
      if (!(await confirmDialog(t('لن يتمكن @{u} من رؤية حسابك ولن ترى محتواه. يمكنك التراجع من إعدادات الخصوصية.', { u: post.author.username }), { danger: true, confirmText: t('حظر'), title: t('حظر المستخدم') }))) return;
      try { await apiPost(`/users/${post.author.username}/block`); toast(t('تم حظر المستخدم'), 'success'); onHidden?.(); } catch (e) { toast(e.message, 'error'); }
    } },
  ]);
}

// ======================= بطاقة المنشور =======================
export function postCard(post, { onRemove, eager = false, detail = false } = {}) {
  const heartBtn = h('button', { type: 'button', class: `act${post.viewer.liked ? ' liked' : ''}`, 'aria-pressed': post.viewer.liked, 'aria-label': t('إعجاب') }, icon('heart'));
  const likeCount = h('span', null, post.counts.likes ? fmtNumber(post.counts.likes) : '');
  heartBtn.append(likeCount);
  heartBtn.onclick = async () => {
    if (!requireLogin()) return;
    const was = post.viewer.liked;
    post.viewer.liked = !was; post.counts.likes += was ? -1 : 1;
    heartBtn.classList.toggle('liked', !was); heartBtn.setAttribute('aria-pressed', !was);
    likeCount.textContent = post.counts.likes ? fmtNumber(post.counts.likes) : '';
    try { const r = was ? await apiDel(`/posts/${post.id}/like`) : await apiPost(`/posts/${post.id}/like`); post.counts.likes = r.count; likeCount.textContent = r.count ? fmtNumber(r.count) : ''; }
    catch (e) { post.viewer.liked = was; post.counts.likes += was ? 1 : -1; heartBtn.classList.toggle('liked', was); likeCount.textContent = post.counts.likes ? fmtNumber(post.counts.likes) : ''; toast(e.message, 'error'); }
  };
  const commentsLink = h('a', { class: 'act', href: `/post/${post.id}`, 'data-link': '', 'aria-label': t('التعليقات') }, icon('comment'), h('span', null, post.counts.comments ? fmtNumber(post.counts.comments) : ''));
  const shareCount = h('span', null, post.counts.shares ? fmtNumber(post.counts.shares) : '');
  const shareBtn = h('button', { type: 'button', class: 'act', 'aria-label': t('مشاركة'), onClick: () => sharePost(post, shareCount) }, icon('send'), shareCount);
  const saveBtn = h('button', { type: 'button', class: `act${post.viewer.saved ? ' saved' : ''}`, 'aria-pressed': post.viewer.saved, 'aria-label': t('حفظ') }, icon('bookmark'));
  saveBtn.onclick = async () => {
    if (!requireLogin()) return;
    const was = post.viewer.saved;
    post.viewer.saved = !was; saveBtn.classList.toggle('saved', !was); saveBtn.setAttribute('aria-pressed', !was);
    try { was ? await apiDel(`/posts/${post.id}/save`) : await apiPost(`/posts/${post.id}/save`); toast(was ? t('أُزيل من المحفوظات') : t('تم الحفظ'), 'success'); }
    catch (e) { post.viewer.saved = was; saveBtn.classList.toggle('saved', was); toast(e.message, 'error'); }
  };

  const LIMIT = 220;
  const capBox = h('div', { class: 'post-caption' });
  const paintCaption = (expanded) => {
    clear(capBox);
    if (!post.caption) return;
    const long = post.caption.length > LIMIT && !expanded && !detail;
    capBox.append(...richText(long ? post.caption.slice(0, LIMIT).trimEnd() + '…' : post.caption));
    if (long) capBox.append(h('button', { class: 'more', onClick: () => paintCaption(true) }, t('المزيد')));
  };
  paintCaption(false);
  capBox.hidden = !post.caption;

  const viewsEl = post.kind === 'video' ? h('span', { class: 'row', style: { gap: '.3rem' } }, icon('eye', 'sm'), h('span', null, t('{n} مشاهدة', { n: fmtNumber(post.counts.views) }))) : null;
  const media = post.kind === 'video' ? videoPlayer(post, { minAr: detail ? 0.56 : 0.8, onViewed: (v) => { if (viewsEl) viewsEl.lastChild.textContent = t('{n} مشاهدة', { n: fmtNumber(v) }); } }).root : mediaView(post, { eager });

  const card = h('article', { class: 'card post', 'data-post-id': post.id },
    h('header', { class: 'post-head' },
      h('a', { href: `/u/${post.author.username}`, 'data-link': '' }, avatar(post.author, 44)),
      h('div', { class: 'who' },
        h('a', { class: 'name truncate', href: `/u/${post.author.username}`, 'data-link': '', style: { display: 'block' } }, post.author.displayName),
        h('div', { class: 'meta' }, h('a', { href: `/post/${post.id}`, 'data-link': '' }, timeAgo(post.createdAt)), ' · ', handle(post.author.username))),
      !post.viewer.isOwner && state.user && !post.viewer.following ? followButton(post.author, false, { onChange: (on) => (post.viewer.following = on) }) : null,
      h('button', { class: 'icon-btn', 'aria-label': t('المزيد من الخيارات'), onClick: () => postMenu(post, {
        onEdited: (p) => { post.caption = p.caption; post.tags = p.tags; paintCaption(false); capBox.hidden = !post.caption; },
        onDeleted: () => { card.remove(); onRemove?.(post); }, onHidden: () => { card.remove(); onRemove?.(post); } }) }, icon('more'))),
    capBox, media,
    h('div', { class: 'post-actions' }, heartBtn, commentsLink, shareBtn, h('span', { class: 'spacer' }), saveBtn),
    viewsEl ? h('div', { class: 'post-stats' }, viewsEl) : null);
  return card;
}

export function gridTile(post, { showCaption = false } = {}) {
  const m = post.media[0];
  const thumb = post.kind === 'video' ? m.poster : m.thumb;
  return h('a', { class: 'tile', href: `/post/${post.id}`, 'data-link': '', 'aria-label': post.caption?.slice(0, 60) || (post.kind === 'video' ? t('فيديو') : t('صورة')) },
    h('img', { src: thumb, alt: '', loading: 'lazy', decoding: 'async', width: 320, height: 320 }),
    h('span', { class: 'tag' }, icon(post.kind === 'video' ? 'film' : 'layers', 'sm'), post.kind === 'image' && post.media.length === 1 ? '' : null),
    h('span', { class: 'over' }, h('span', null, icon('heart', 'sm filled'), fmtNumber(post.counts.likes)), h('span', null, icon('comment', 'sm filled'), fmtNumber(post.counts.comments))));
}
export const tileGrid = () => h('div', { class: 'grid' });
export function appendTiles(host, posts) {
  let grid = host.lastElementChild?.classList.contains('grid') ? host.lastElementChild : null;
  if (!grid) { grid = tileGrid(); host.append(grid); }
  posts.forEach((p) => {
    const tile = gridTile(p);
    if (p.kind === 'image' && p.media.length === 1) tile.querySelector('.tag').remove();
    if (p.kind === 'image' && p.media.length > 1) tile.querySelector('.tag .icon').replaceWith(icon('layers', 'sm'));
    grid.append(tile);
  });
}

// ======================= التعليقات =======================
export function commentsPanel(post, { onCount, autofocus = false } = {}) {
  const list = h('div', { class: 'comments' });
  const moreBtn = h('button', { class: 'btn ghost sm', hidden: true }, t('عرض المزيد من التعليقات'));
  const empty = h('p', { class: 'muted center small', hidden: true, style: { padding: '1rem' } }, t('لا توجد تعليقات بعد. كن أول من يعلّق!'));
  let cursor = undefined, replyTo = null, total = post.counts.comments;
  const replyChip = h('div', { class: 'reply-chip', hidden: true });
  const ta = h('textarea', { class: 'textarea', rows: '1', maxlength: String(state.config?.limits.commentLength || 1000), placeholder: t('اكتب تعليقًا…'), 'aria-label': t('اكتب تعليقًا') });
  const sendBtn = h('button', { class: 'btn primary', type: 'submit', style: { minWidth: '72px' } }, t('نشر'));
  const form = h('form', { class: 'comment-form' }, avatar(state.user, 40), h('div', { class: 'grow' }, replyChip, ta), sendBtn);

  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; ta.style.overflow = ta.scrollHeight > 140 ? 'auto' : 'hidden'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  function setReply(c) {
    replyTo = c;
    replyChip.hidden = !c;
    clear(replyChip);
    if (c) { replyChip.append(h('span', null, t('الرد على @{u}', { u: c.author.username })), h('button', { type: 'button', 'aria-label': t('إلغاء الرد'), onClick: () => setReply(null) }, icon('x', 'sm'))); ta.focus(); }
  }
  const updateCount = (n) => { total = n; onCount?.(n); empty.hidden = n > 0 || list.children.length > 0; };

  function commentEl(c, topId) {
    const el = h('div', { class: 'comment', 'data-id': c.id },
      h('a', { href: `/u/${c.author.username}`, 'data-link': '' }, avatar(c.author, 36)),
      h('div', { class: 'bubble' },
        h('div', { class: 'body' }, h('a', { class: 'name', href: `/u/${c.author.username}`, 'data-link': '' }, c.author.displayName), ...richText(c.body)),
        h('div', { class: 'foot' }, h('span', null, timeAgo(c.createdAt)),
          h('button', { type: 'button', onClick: () => { if (requireLogin()) setReply({ ...c, id: topId ?? c.id }); } }, t('رد')),
          c.canDelete ? h('button', { type: 'button', onClick: async () => {
            if (!(await confirmDialog(t('حذف هذا التعليق؟'), { danger: true, confirmText: t('حذف') }))) return;
            try { const r = await apiDel(`/comments/${c.id}`); el.remove(); updateCount(r.count); } catch (e) { toast(e.message, 'error'); }
          } }, t('حذف')) : null,
          state.user && state.user.id !== c.author.id ? h('button', { type: 'button', onClick: () => reportDialog('comment', c.id) }, t('إبلاغ')) : null)));
    return el;
  }
  function threadEl(c) {
    const el = commentEl(c);
    const rep = h('div', { class: 'replies', hidden: !c.replies?.length }, (c.replies || []).map((r) => commentEl(r, c.id)));
    el.querySelector('.bubble').append(rep);
    el._replies = rep;
    return el;
  }
  async function load() {
    moreBtn.disabled = true;
    try {
      const r = await get(`/posts/${post.id}/comments?limit=15${cursor ? `&cursor=${cursor}` : ''}`);
      r.items.forEach((c) => list.append(threadEl(c)));
      cursor = r.nextCursor; moreBtn.hidden = !cursor; total = r.total; empty.hidden = list.children.length > 0;
    } catch (e) { toast(e.message, 'error'); } finally { moreBtn.disabled = false; }
  }
  moreBtn.onclick = load;

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!requireLogin()) return;
    const body = ta.value.trim();
    if (!body) return;
    await withLoading(sendBtn, async () => {
      try {
        const r = await apiPost(`/posts/${post.id}/comments`, { body, parentId: replyTo?.id });
        if (replyTo) {
          const parentEl = list.querySelector(`[data-id="${replyTo.id}"]`);
          parentEl?._replies.append(commentEl(r.comment, replyTo.id)); if (parentEl) parentEl._replies.hidden = false;
        } else list.prepend(threadEl(r.comment));
        ta.value = ''; ta.style.height = 'auto'; setReply(null); updateCount(r.count);
      } catch (ex) { toast(ex.message, 'error'); }
    });
  };

  const el = h('div', { class: 'col' }, state.user ? form : h('a', { class: 'btn outline block', href: `/login?next=${encodeURIComponent(location.pathname)}`, 'data-link': '' }, t('سجّل الدخول لتعلّق')), list, empty, h('div', { class: 'center' }, moreBtn));
  load();
  if (autofocus) setTimeout(() => ta.focus(), 50);
  return { el, reload: () => { clear(list); cursor = undefined; return load(); } };
}
