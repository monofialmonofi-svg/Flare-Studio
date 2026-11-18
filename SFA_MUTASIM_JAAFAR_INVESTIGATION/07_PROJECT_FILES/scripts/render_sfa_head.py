"""Alwan news reel: Omar Osman Jaboura (Misseriya, Central Darfur) defection
Usage: render_appiah.py SCRATCH UNUSED OUT_DIR [wK | preview times...]"""
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S, EDL_PATH, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ARGS = sys.argv[4:]
WORKER = ARGS[0] if ARGS and ARGS[0].startswith("w") else None
PREVIEW = [] if WORKER else [float(x) for x in ARGS]
W, H, FPS = 1080, 1920, 30
X = f"{S}/haroun"; PH = f"{S}/ext/photos_ka"

# brand palette — sampled from the official Alwan logo
RED = np.array([215, 36, 41], np.float32) / 255      # #D72429 (logo dot)
CHAR = np.array([64, 64, 64], np.float32) / 255      # #404040 (logo letters)
GREY = np.array([216, 218, 217], np.float32) / 255   # #D8DAD9 (logo map)
WHITE = np.ones(3, np.float32)
INK = np.array([18, 18, 19], np.float32) / 255       # near-black base (darkened charcoal)

FONT = {"alex": f"{S}/fonts/Alexandria%5Bwght%5D.ttf", "taj": f"{S}/fonts/Tajawal-Bold.ttf", "tajm": f"{S}/fonts/Tajawal-Medium.ttf", "tajx": f"{S}/fonts/Tajawal-ExtraBold.ttf", "oswald": f"{S}/fonts/Oswald%5Bwght%5D.ttf"}

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_io(x): x = clamp(x); return x * x * (3 - 2 * x)
def lerp(a, b, u): return a + (b - a) * u
def fade(t, t0, t1, fi=0.35, fo=0.3):
    if t < t0 or t > t1: return 0.0
    return min(ease_out((t - t0) / fi), ease_io((t1 - t) / fo))

def font(name, size, wght=None):
    f = ImageFont.truetype(FONT[name], size)
    if wght is not None and name in ("alex", "oswald"):
        axes = f.get_variation_axes(); f.set_variation_by_axes([wght] + [0] * (len(axes) - 1))
    return f

_cache = {}
def text(txt, size, wght=700, color=(255, 255, 255), fname="alex", ar=True, maxw=None, stroke=0, stroke_fill=(0, 0, 0), align="center", spacing=14):
    """Premultiplied RGBA float sprite; wraps to maxw (RTL-aware for Arabic)."""
    key = (txt, size, wght, color, fname, ar, maxw, stroke, align)
    if key in _cache: return _cache[key]
    f = font(fname, size, wght); kw = dict(direction="rtl", language="ar") if ar else {}
    d0 = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    def width(s): return d0.textbbox((0, 0), s, font=f, stroke_width=stroke, **kw)[2]
    lines = []
    for para in txt.split("\n"):
        words = para.split(" "); cur = ""
        for w_ in words:
            cand = (cur + " " + w_).strip()
            if maxw and width(cand) > maxw and cur: lines.append(cur); cur = w_
            else: cur = cand
        lines.append(cur)
    asc, desc = f.getmetrics(); lh = asc + desc + spacing
    tw = max(width(l) for l in lines) + 2 * stroke + 8
    im = Image.new("RGBA", (tw + 40, lh * len(lines) + 40), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for i, l in enumerate(lines):
        lw = width(l); x = 20 + (tw - lw) // 2 if align == "center" else (20 + tw - lw if align == "right" else 20)
        d.text((x, 20 + i * lh), l, font=f, fill=color + (255,), stroke_width=stroke, stroke_fill=stroke_fill, **kw)
    im = im.crop(im.getbbox() or (0, 0, 1, 1))
    a = np.asarray(im).astype(np.float32) / 255
    out = np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2); _cache[key] = out; return out

def scale_sprite(sp, s):
    if abs(s - 1) < 1e-3: return sp
    h, w = sp.shape[:2]; nw, nh = max(1, int(w * s)), max(1, int(h * s))
    return np.stack([np.asarray(Image.fromarray(sp[..., c]).resize((nw, nh), Image.BILINEAR)) for c in range(4)], 2)

def blit(fr, sp, cx, cy, a=1.0, anchor="c"):
    if a <= 0.003: return
    h, w = sp.shape[:2]
    x0 = int(round(cx - w / 2)) if anchor in ("c",) else (int(round(cx - w)) if anchor == "r" else int(round(cx)))
    y0 = int(round(cy - h / 2))
    fx0, fy0, fx1, fy1 = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if fx1 <= fx0 or fy1 <= fy0: return
    s = sp[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0]; reg = fr[fy0:fy1, fx0:fx1]
    reg *= (1 - s[..., 3:4] * a); reg += s[..., :3] * a

def rect(fr, x0, y0, x1, y1, col, a=1.0):
    x0, y0, x1, y1 = [int(round(v)) for v in (max(0, x0), max(0, y0), min(W, x1), min(H, y1))]
    if x1 > x0 and y1 > y0: fr[y0:y1, x0:x1] = fr[y0:y1, x0:x1] * (1 - a) + col * a

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = (1 - 0.5 * np.clip(((xx - 540) / 780) ** 2 + ((yy - 960) / 1300) ** 2, 0, 1) ** 1.4)[..., None].astype(np.float32)
GRAIN = [np.random.default_rng(k).normal(0, 0.012, (H, W, 1)).astype(np.float32) for k in range(5)]
BOTTOM = np.clip((yy - 1150) / 600, 0, 1)[..., None].astype(np.float32) ** 1.3   # gradient for subtitle legibility

def sudan_flag(w):
    h = w // 2; im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, h // 3], fill=(210, 16, 52)); d.rectangle([0, h // 3, w, 2 * h // 3], fill=(255, 255, 255))
    d.rectangle([0, 2 * h // 3, w, h], fill=(0, 0, 0)); d.polygon([(0, 0), (int(w / 3), h // 2), (0, h)], fill=(0, 114, 41))
    return np.asarray(im).astype(np.float32) / 255
FLAG = sudan_flag(900)

LOGO_IM = Image.open(f"{S}/assets/logo_white.png").convert("RGBA")
def logo_sprite(h):
    k = ("logo", h)
    if k not in _cache:
        im = LOGO_IM.resize((int(LOGO_IM.width * h / LOGO_IM.height), h), Image.LANCZOS)
        a = np.asarray(im).astype(np.float32) / 255; _cache[k] = np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2)
    return _cache[k]

# ---------------------------------------------------------------- graphic elements
def T(txt, size, wght=700, color=(255, 255, 255), fname="alex", maxw=None, stroke=0, spacing=14, ar=True):
    return text(txt, size, wght, color, fname=fname, ar=ar, maxw=maxw, stroke=stroke, spacing=spacing)

def box_text(fr, t, t0, t1, txt, y, size=72, fname="alex", wght=800, bg=None, maxw=920, slide=40, color=(255, 255, 255), bar=True, a_mul=1.0):
    a = fade(t, t0, t1, 0.35, 0.3) * a_mul
    if not a: return
    sp = T(txt, size, wght, color, fname, maxw=maxw); h, w = sp.shape[:2]; pad = 30
    dx = slide * (1 - ease_out((t - t0) / 0.45))
    rect(fr, 540 - w / 2 - pad, y - h / 2 - pad * 0.7, 540 + w / 2 + pad, y + h / 2 + pad * 0.7, INK if bg is None else bg, 0.8 * a)
    if bar:
        bw = (w + 2 * pad) * ease_out((t - t0) / 0.5)
        rect(fr, 540 + w / 2 + pad - bw, y + h / 2 + pad * 0.7, 540 + w / 2 + pad, y + h / 2 + pad * 0.7 + 9, RED, a)
    blit(fr, sp, 540 + dx, y, a)

def kicker(fr, t, t0, t1, txt, y=180):
    a = fade(t, t0, t1, 0.3, 0.3)
    if not a: return
    sp = T(txt, 40, 800, (255, 255, 255), "taj"); w = sp.shape[1] + 44
    rect(fr, 540 - w / 2, y - 32, 540 + w / 2, y + 32, RED, a); blit(fr, sp, 540, y, a)

def source(fr, t, t0, t1, label, y=1700):
    a = fade(t, t0, t1, 0.3, 0.25)
    if not a: return
    asc = label.isascii(); sp = T(label, 32, 600 if asc else 500, (230, 230, 230), "oswald" if asc else "tajm")
    w = sp.shape[1] + 40; x1 = W - 60
    rect(fr, x1 - w, y - 28, x1, y + 28, CHAR, 0.88 * a); rect(fr, x1 - 8, y - 28, x1, y + 28, RED, a)
    blit(fr, sp, x1 - 22 - sp.shape[1] / 2, y, a)

def caveat(fr, t, t0, t1, txt, y):
    a = fade(t, t0, t1, 0.3, 0.25)
    if not a: return
    sp = T(txt, 32, 0, (255, 255, 255), "tajm", maxw=900); h, w = sp.shape[:2]
    rect(fr, 540 - w / 2 - 22, y - h / 2 - 12, 540 + w / 2 + 22, y + h / 2 + 12, np.array([0.55, 0.1, 0.12], np.float32), 0.9 * a)
    blit(fr, sp, 540, y, a)

def quote_card(fr, t, t0, t1, who, role, txt, y, side, color):
    """Split-screen card: side=+1 right half, -1 left half."""
    a = fade(t, t0, t1, 0.4, 0.3)
    if not a: return
    cx = 540 + side * 270; x0, x1 = cx - 255, cx + 255
    slide = side * 80 * (1 - ease_out((t - t0) / 0.45))
    sw = T(who, 40, 800, (255, 255, 255), "tajx", maxw=470); sr = T(role, 28, 0, (216, 218, 217), "tajm", maxw=470)
    sq = T(txt, 38, 0, (255, 255, 255), "taj", maxw=460, spacing=10)
    h = sw.shape[0] + sr.shape[0] + sq.shape[0] + 110
    rect(fr, x0 + slide, y, x1 + slide, y + h, INK, 0.86 * a); rect(fr, x0 + slide, y, x1 + slide, y + 10, color, a)
    yy_ = y + 30 + sw.shape[0] / 2; blit(fr, sw, cx + slide, yy_, a)
    yy_ += sw.shape[0] / 2 + 14 + sr.shape[0] / 2; blit(fr, sr, cx + slide, yy_, a)
    blit(fr, T("«", 64, 800, tuple(int(c * 255) for c in color), "alex"), cx + slide, yy_ + sr.shape[0] / 2 + 32, a)
    blit(fr, sq, cx + slide, yy_ + sr.shape[0] / 2 + 72 + sq.shape[0] / 2, a)

def org_chart(fr, t, t0, t1):
    """رئاسة الاتحاد → لجنة المنتخبات → الجهاز الإداري → الجهاز الفني."""
    nodes = [("رئاسة الاتحاد", "معتصم جعفر"), ("لجنة المنتخبات الوطنية", ""), ("الجهاز الإداري", ""), ("الجهاز الفني", "بقيادة كواسي أبياه")]
    y0, step = 430, 250
    for i, (n, s) in enumerate(nodes):
        ti = t0 + 0.5 + i * 0.8; a = fade(t, ti, t1, 0.35, 0.3)
        if not a: continue
        y = y0 + i * step; sp = T(n, 48, 800, (255, 255, 255), "tajx"); w = max(560, sp.shape[1] + 80)
        col = RED if i == 3 else CHAR
        rect(fr, 540 - w / 2, y - 62, 540 + w / 2, y + (52 if s else 40), col, 0.92 * a)
        blit(fr, sp, 540, y - (14 if s else 10), a)
        if s: blit(fr, T(s, 32, 0, (235, 235, 235), "tajm"), 540, y + 28, a)
        if i < 3:   # animated connector line + arrow
            tl = t - (ti + 0.3); L = step - 120
            if tl > 0:
                ln = int(L * ease_out(tl / 0.45)); yA = y + (52 if s else 40)
                rect(fr, 536, yA, 544, yA + ln, GREY, a)
                if ln >= L - 2:
                    for k in range(18): rect(fr, 540 - (18 - k), yA + L - 18 + k, 540 + (18 - k), yA + L - 17 + k, GREY, a)

def narr(fr, t, items):
    """On-screen narration (the approved script, shortened), Tajawal, highlighted key phrase in brand red."""
    for s in items:
        if s[0] <= t < s[1]:
            a = min(1, (t - s[0]) / 0.15, (s[1] - t) / 0.15)
            txt = s[2]; y = s[3] if len(s) > 3 else 1440
            parts = txt.split("|")
            if len(parts) < 3:
                blit(fr, T(txt, 52, 0, (255, 255, 255), "taj", maxw=920, stroke=3, spacing=8), 540, y, a); continue
            pre = T(parts[0].strip(), 50, 0, (255, 255, 255), "taj", maxw=920, stroke=3, spacing=6)
            hl = T(parts[1].strip(), 54, 0, (215, 36, 41), "tajx", maxw=900, stroke=0, spacing=6)
            post = T(parts[2].strip(), 50, 0, (255, 255, 255), "taj", maxw=920, stroke=3) if parts[2].strip() else None
            yy_ = y - (pre.shape[0] + hl.shape[0] + (post.shape[0] if post is not None else 0)) / 2
            blit(fr, pre, 540, yy_ + pre.shape[0] / 2, a); yy_ += pre.shape[0] + 10
            rect(fr, 540 - hl.shape[1] / 2 - 14, yy_ - 4, 540 + hl.shape[1] / 2 + 14, yy_ + hl.shape[0] + 6, np.ones(3, np.float32), 0.96 * a)
            blit(fr, hl, 540, yy_ + hl.shape[0] / 2 + 1, a); yy_ += hl.shape[0] + 14
            if post is not None: blit(fr, post, 540, yy_ + post.shape[0] / 2, a)

def big_q(fr, t, t0, t1, txt, y, size=96):
    a = fade(t, t0, t1, 0.15, 0.25)
    if not a: return
    sc = 1 + 0.3 * (1 - ease_out((t - t0) / 0.3))
    blit(fr, scale_sprite(T(txt, size, 900, (255, 255, 255), "alex", maxw=980), sc), 540, y, a)

def stamp_card(fr, t, t0, t1, date, txt, src, y):
    a = fade(t, t0, t1, 0.35, 0.3)
    if not a: return
    sd = T(date, 40, 800, (215, 36, 41), "tajx"); st = T(txt, 40, 0, (255, 255, 255), "taj", maxw=820, spacing=8)
    ss = T(src, 28, 0, (180, 180, 180), "tajm")
    h = sd.shape[0] + st.shape[0] + ss.shape[0] + 70; slide = 70 * (1 - ease_out((t - t0) / 0.4))
    rect(fr, 90 + slide, y, 990 + slide, y + h, INK, 0.86 * a); rect(fr, 982 + slide, y, 990 + slide, y + h, RED, a)
    blit(fr, sd, 950 + slide - sd.shape[1] / 2, y + 20 + sd.shape[0] / 2, a)
    blit(fr, st, 950 + slide - st.shape[1] / 2, y + 30 + sd.shape[0] + st.shape[0] / 2, a)
    blit(fr, ss, 950 + slide - ss.shape[1] / 2, y + 45 + sd.shape[0] + st.shape[0] + ss.shape[0] / 2, a)

def percent_free(fr, t, t0, t1): pass
def lower_third(fr, t, t0, t1, name, role, y=1215):
    a = fade(t, t0, t1, 0.35, 0.3)
    if not a: return
    sn = T(name, 50, 800, (255, 255, 255), "tajx"); sr = T(role, 32, 0, (40, 40, 40), "tajm")
    w = max(sn.shape[1], sr.shape[1]) + 70; x1 = W - 50; g = ease_out((t - t0) / 0.45)
    rect(fr, x1 - w * g, y - 46, x1, y + 30, CHAR, 0.92 * a); rect(fr, x1 - w * g, y + 30, x1, y + 82, GREY, 0.95 * a)
    rect(fr, x1 - 12, y - 46, x1, y + 82, RED, a)
    blit(fr, sn, x1 - 36 - sn.shape[1] / 2, y - 8, a * g); blit(fr, sr, x1 - 36 - sr.shape[1] / 2, y + 56, a * g)

