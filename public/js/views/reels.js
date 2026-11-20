// واجهة المشاهدة المتتابعة: فيديو بملء الشاشة، تمرير عمودي، تحميل تدريجي (الحالي ± 1 فقط).
import { h, clear, avatar, richText } from '../dom.js';
import { icon } from '../icons.js';
import { t, fmtNumber } from '../i18n.js';
import { get, post, del } from '../api.js';
import { state } from '../state.js';
import { ensureApp, markActive, setTitle } from '../shell.js';
import { emptyState, errorState, modal, toast } from '../ui.js';
import { followButton, requireLogin, sharePost, postMenu, commentsPanel, playerPrefs } from '../components.js';

export async function videos(ctx) {
  const view = ensureApp();
  markActive('/videos');
  setTitle(t('الفيديوهات'));
  document.body.classList.add('reels-page');

  const scroller = h('div', { class: 'reels', tabindex: '0', role: 'feed', 'aria-label': t('الفيديوهات المتتابعة') });
  const nav = h('div', { class: 'reels-nav' },
    h('button', { class: 'icon-btn', 'aria-label': t('الفيديو السابق'), onClick: () => go(-1) }, icon('chev-u')),
    h('button', { class: 'icon-btn', 'aria-label': t('الفيديو التالي'), onClick: () => go(1) }, icon('chev-d')));
  const wrap = h('div', { class: 'reels-wrap' }, scroller, nav);
  view.append(wrap);
  scroller.append(h('div', { class: 'reel' }, h('div', { class: 'spinner', style: { color: '#fff', width: '2rem', height: '2rem' } })));

  const reels = []; // {post, el, video, viewed}
  let cursor = null, loading = false, done = false, active = -1, destroyed = false;
  const first = ctx.params.id;

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= 0.7) setActive(reels.findIndex((r) => r.el === e.target));
    }
  }, { root: scroller, threshold: [0.7] });

  function mount(r) {
    if (r.video) return;
    const v = h('video', { playsinline: '', loop: true, preload: 'metadata', poster: r.post.media[0].poster, 'aria-label': r.post.caption || t('فيديو') });
    v.muted = playerPrefs.muted;
    v.src = r.post.media[0].url;
    v.addEventListener('timeupdate', () => { if (v.duration) r.bar.style.width = `${(v.currentTime / v.duration) * 100}%`; });
    v.addEventListener('error', () => toast(t('تعذّر تشغيل هذا الفيديو'), 'error'));
    r.video = v;
    r.el.querySelector('.poster').after(v);
  }
  function unmount(r) {
    if (!r.video) return;
    r.video.pause(); r.video.removeAttribute('src'); r.video.load(); r.video.remove(); r.video = null;
    r.el.classList.remove('paused'); r.bar.style.width = '0';
  }
  async function setActive(i) {
    if (i < 0 || i === active) return;
    active = i;
    reels.forEach((r, idx) => { if (Math.abs(idx - i) <= 1) mount(r); else unmount(r); if (idx !== i) r.video?.pause(); });
    const r = reels[i];
    history.replaceState({}, '', `/videos/${r.post.id}`);
    r.video.muted = playerPrefs.muted; syncMute();
    try { await r.video.play(); r.el.classList.remove('paused'); } catch { r.video.muted = true; playerPrefs.muted = true; syncMute(); r.video.play().catch(() => r.el.classList.add('paused')); }
    if (!r.viewed) { r.viewed = true; post(`/posts/${r.post.id}/view`).then((x) => { r.views.textContent = t('{n} مشاهدة', { n: fmtNumber(x.views) }); }).catch(() => {}); }
    if (i >= reels.length - 3) loadMore();
  }
  const syncMute = () => muteBtn.replaceChildren(icon(playerPrefs.muted ? 'mute' : 'volume'));
  const muteBtn = h('button', { class: 'icon-btn', 'aria-label': t('كتم / تشغيل الصوت'), onClick: () => { playerPrefs.muted = !playerPrefs.muted; reels.forEach((r) => r.video && (r.video.muted = playerPrefs.muted)); syncMute(); } }, icon('mute'));
  const fsBtn = h('button', { class: 'icon-btn', 'aria-label': t('ملء الشاشة'), onClick: () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    (wrap.requestFullscreen || wrap.webkitRequestFullscreen)?.call(wrap);
  } }, icon('expand'));
  function go(d) { const el = reels[Math.max(0, Math.min(reels.length - 1, active + d))]?.el; el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function toggle(r) { if (!r.video) return; if (r.video.paused) { r.video.play(); r.el.classList.remove('paused'); } else { r.video.pause(); r.el.classList.add('paused'); } }

  function build(p) {
    const m = p.media[0];
    const r = { post: p, viewed: false, video: null };
    const likeCount = h('span', null, fmtNumber(p.counts.likes));
    const likeBtn = h('button', { class: p.viewer.liked ? 'liked' : '', 'aria-label': t('إعجاب'), 'aria-pressed': p.viewer.liked }, icon('heart'), likeCount);
    const doLike = async (forceOn) => {
      if (!requireLogin()) return;
      const was = p.viewer.liked;
      if (forceOn && was) return;
      p.viewer.liked = !was; p.counts.likes += was ? -1 : 1;
      likeBtn.classList.toggle('liked', !was); likeCount.textContent = fmtNumber(p.counts.likes);
      try { const x = was ? await del(`/posts/${p.id}/like`) : await post(`/posts/${p.id}/like`); p.counts.likes = x.count; likeCount.textContent = fmtNumber(x.count); }
      catch (e) { p.viewer.liked = was; p.counts.likes += was ? 1 : -1; likeBtn.classList.toggle('liked', was); likeCount.textContent = fmtNumber(p.counts.likes); toast(e.message, 'error'); }
    };
    likeBtn.onclick = () => doLike();
    const cmtCount = h('span', null, fmtNumber(p.counts.comments));
    const cmtBtn = h('button', { 'aria-label': t('التعليقات'), onClick: () => {
      const panel = commentsPanel(p, { onCount: (n) => { p.counts.comments = n; cmtCount.textContent = fmtNumber(n); } });
      modal({ title: t('التعليقات'), content: h('div', { class: 'reel-comments' }, h('div', { class: 'scroll' }, panel.el)) });
    } }, icon('comment'), cmtCount);
    const shareCount = h('span', null, fmtNumber(p.counts.shares));
    const shareBtn = h('button', { 'aria-label': t('مشاركة'), onClick: () => sharePost(p, shareCount) }, icon('send'), shareCount);
    const saveBtn = h('button', { class: p.viewer.saved ? 'saved' : '', 'aria-label': t('حفظ'), 'aria-pressed': p.viewer.saved }, icon('bookmark'));
    saveBtn.onclick = async () => {
      if (!requireLogin()) return;
      const was = p.viewer.saved; p.viewer.saved = !was; saveBtn.classList.toggle('saved', !was);
      try { was ? await del(`/posts/${p.id}/save`) : await post(`/posts/${p.id}/save`); toast(was ? t('أُزيل من المحفوظات') : t('تم الحفظ'), 'success'); }
      catch (e) { p.viewer.saved = was; saveBtn.classList.toggle('saved', was); toast(e.message, 'error'); }
    };
    const moreBtn = h('button', { 'aria-label': t('المزيد'), onClick: () => postMenu(p, { onEdited: (np) => { p.caption = np.caption; capEl.replaceChildren(...richText(np.caption)); }, onDeleted: () => removeReel(r), onHidden: () => removeReel(r) }) }, icon('more'));
    const capEl = h('div', { class: 'cap' }, ...richText(p.caption));
    r.views = h('span', { class: 'xs' }, t('{n} مشاهدة', { n: fmtNumber(p.counts.views) }));
    r.bar = h('i');
    const burst = h('span', { class: 'heart-burst' }, icon('heart'));
    let lastTap = 0;
    const playBurst = () => { burst.classList.remove('go'); void burst.offsetWidth; burst.classList.add('go'); };
    const tap = h('div', { class: 'tap', onClick: () => {
      const now = Date.now();
      if (now - lastTap < 300) { playBurst(); doLike(true); lastTap = 0; return; }
      lastTap = now;
      setTimeout(() => { if (lastTap === now) toggle(r); }, 310);
    } });
    const ratio = m.width / m.height;
    r.el = h('section', { class: `reel${ratio < 0.8 ? ' cover' : ''}`, 'aria-label': p.author.displayName, 'data-id': p.id },
      h('img', { class: 'poster', src: m.poster, alt: '', decoding: 'async' }),
      tap,
      h('div', { class: 'shade' }),
      h('div', { class: 'pause-ind' }, icon('play', 'lg')),
      burst,
      h('div', { class: 'info' },
        h('div', { class: 'who' }, h('a', { href: `/u/${p.author.username}`, 'data-link': '' }, avatar(p.author, 40, { ring: false })), h('a', { href: `/u/${p.author.username}`, 'data-link': '', class: 'truncate' }, p.author.displayName),
          !p.viewer.isOwner && state.user && !p.viewer.following ? (() => { const f = followButton(p.author, false, { size: 'sm' }); f.classList.add('follow'); f.classList.remove('primary'); return f; })() : null),
        p.caption ? capEl : null, r.views),
      h('div', { class: 'side' }, likeBtn, cmtBtn, shareBtn, saveBtn, moreBtn),
      h('div', { class: 'progress' }, r.bar));
    return r;
  }
  function removeReel(r) {
    const i = reels.indexOf(r);
    io.unobserve(r.el); unmount(r); r.el.remove(); reels.splice(i, 1);
    if (!reels.length) showEmpty(); else { active = -1; setActive(Math.min(i, reels.length - 1)); reels[Math.min(i, reels.length - 1)].el.scrollIntoView(); }
  }
  function showEmpty() {
    clear(scroller);
    scroller.append(h('div', { class: 'reel', style: { background: 'var(--surface)' } }, emptyState({ icon: 'film', title: t('لا توجد فيديوهات بعد'), text: t('كن أول من ينشر فيديو في لَمّة!'), action: h('a', { class: 'btn primary', href: '/create', 'data-link': '' }, icon('plus', 'sm'), t('انشر فيديو')) })));
  }
  async function loadMore() {
    if (loading || done || destroyed) return;
    loading = true;
    try {
      const q = new URLSearchParams({ limit: '6' });
      if (cursor) q.set('cursor', cursor); else if (first) q.set('first', first);
      const res = await get(`/videos?${q}`);
      if (destroyed) return;
      if (!reels.length) clear(scroller);
      cursor = res.nextCursor; done = !cursor;
      const known = new Set(reels.map((r) => r.post.id));
      const fresh = res.items.filter((p) => !known.has(p.id)).map(build);
      fresh.forEach((r) => { reels.push(r); scroller.append(r.el); io.observe(r.el); });
      if (!reels.length) return showEmpty();
      if (active === -1 && reels.length) { setActive(0); }
    } catch (e) {
      if (!reels.length) { clear(scroller); scroller.append(h('div', { class: 'reel', style: { background: 'var(--surface)' } }, errorState(e.message, () => { clear(scroller); loadMore(); }))); }
      else toast(e.message, 'error');
    } finally { loading = false; }
  }

  const onKey = (e) => {
    if (document.querySelector('.modal-root > *') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); go(-1); }
    else if (e.key === ' ') { e.preventDefault(); reels[active] && toggle(reels[active]); }
    else if (e.key === 'm') muteBtn.click();
  };
  document.addEventListener('keydown', onKey);
  const topActions = h('div', { class: 'reel-top-actions' }, muteBtn, fsBtn);
  wrap.append(topActions);
  const onVis = () => { if (document.hidden) reels[active]?.video?.pause(); else if (!reels[active]?.el.classList.contains('paused')) reels[active]?.video?.play().catch(() => {}); };
  document.addEventListener('visibilitychange', onVis);
  syncMute();
  loadMore();
  return () => { destroyed = true; io.disconnect(); reels.forEach(unmount); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis); document.body.classList.remove('reels-page'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
}
