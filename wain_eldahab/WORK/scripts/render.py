# -*- coding: utf-8 -*-
"""Frame-by-frame compositor for «وين الدهب؟». Pipes raw RGB frames into ffmpeg.
usage: python3 render.py OUT.mp4 [t_start t_end] [--preview]
"""
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageOps
sys.path.insert(0, os.path.dirname(__file__))
from episode import FPS, TIMELINE, TITLE, SUBTITLE
from timing import SCENES, DURATION
import subs as SUBS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PH = os.path.join(ROOT, "EXTERNAL_RESEARCH", "PHOTOGRAPHS")
FONTS = os.path.join(ROOT, "fonts")
W, H = 1080, 1920
SAFE_TOP, SAFE_BOTTOM, SAFE_SIDE = 220, 1440, 70   # FB Reels: keep text out of top bar & bottom UI/caption area

GOLD = (232, 182, 72); SAND = (240, 222, 190); INK = (20, 14, 8)

def font(name, size): return ImageFont.truetype(os.path.join(FONTS, name), size)
_fc = {}
def F(name, size):
    k = (name, size)
    if k not in _fc: _fc[k] = font(name, size)
    return _fc[k]

# ---------- text ----------
_tc = {}
def text_img(s, size, fnt="Cairo-Black.ttf", fill=SAND, stroke=0, stroke_fill=INK, shadow=True, maxw=W - 2 * SAFE_SIDE):
    """Render Arabic text (raqm: shaping + bidi) to an RGBA image, auto-shrinking to maxw."""
    key = (s, size, fnt, fill, stroke, shadow, maxw)
    if key in _tc: return _tc[key]
    while True:
        f = F(fnt, size)
        bb = f.getbbox(s, direction="rtl", language="ar", features=["-liga"] if False else None)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        if tw <= maxw or size < 20: break
        size = int(size * 0.92)
    pad = max(20, stroke * 2 + 20)
    im = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    org = (pad - bb[0], pad - bb[1])
    if shadow:
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((org[0] + 3, org[1] + 5), s, font=f, fill=(0, 0, 0, 200), direction="rtl", language="ar",
                                stroke_width=stroke, stroke_fill=(0, 0, 0, 200))
        sh = sh.filter(ImageFilter.GaussianBlur(6))
        im = Image.alpha_composite(im, sh); d = ImageDraw.Draw(im)
    d.text(org, s, font=f, fill=fill, direction="rtl", language="ar", stroke_width=stroke, stroke_fill=stroke_fill)
    _tc[key] = im
    return im

def paste(canvas, im, cx, cy, alpha=1.0, scale=1.0):
    if alpha <= 0.003: return
    if scale != 1.0:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    if alpha < 1:
        a = im.getchannel("A").point(lambda v: int(v * alpha)); im = im.copy(); im.putalpha(a)
    canvas.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))

def ease(u): u = min(max(u, 0), 1); return u * u * (3 - 2 * u)
def eout(u): u = min(max(u, 0), 1); return 1 - (1 - u) ** 3
def fade(t, t0, t1, d=0.35): return min(ease((t - t0) / d), ease((t1 - t) / d))

# ---------- images & grading ----------
_ic = {}
def graded(name, maxdim=2600):
    if name in _ic: return _ic[name]
    im = Image.open(os.path.join(PH, name)).convert("RGB")
    im = ImageOps.exif_transpose(im)
    if max(im.size) > maxdim: im.thumbnail((maxdim, maxdim), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    # earthy cinematic grade: gentle S-curve, warm highlights, teal-ish shadows kept subtle, slight desat
    lum = a @ np.array([.299, .587, .114], np.float32)
    a = a + (lum[..., None] - a) * 0.12                        # desaturate 12%
    a = np.clip((a - .5) * 1.10 + .5, 0, 1)                    # contrast
    a = a * a * (3 - 2 * a) * .35 + a * .65                    # soft S curve
    warm = np.array([1.06, 1.0, .88], np.float32); cool = np.array([.96, 1.0, 1.04], np.float32)
    w = lum[..., None]
    a = a * (warm * w + cool * (1 - w))
    a = np.clip(a, 0, 1)
    im = Image.fromarray((a * 255).astype(np.uint8))
    im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=40, threshold=3))
    _ic[name] = im
    return im

def kenburns(name, u, mv):
    """cover-crop W×H from image with zoom/pan interpolated by u in [0,1]"""
    im = graded(name); iw, ih = im.size
    e = ease(u)
    z = mv["z0"] + (mv["z1"] - mv["z0"]) * e
    fx = mv["x0"] + (mv["x1"] - mv["x0"]) * e; fy = mv["y0"] + (mv["y1"] - mv["y0"]) * e
    base = max(W / iw, H / ih)            # cover scale
    s = base * z
    cw, ch = W / s, H / s
    x0 = (iw - cw) * fx; y0 = (ih - ch) * fy
    x0 = min(max(x0, 0), iw - cw); y0 = min(max(y0, 0), ih - ch)
    return im.transform((W, H), Image.EXTENT, (x0, y0, x0 + cw, y0 + ch), Image.BICUBIC).convert("RGBA")

def framed(name, u, mv=None):
    """for small/odd images: blurred cover background + sharp framed image"""
    im = graded(name)
    bg = kenburns(name, u, dict(z0=1.3, z1=1.4, x0=.5, x1=.5, y0=.5, y1=.5)).filter(ImageFilter.GaussianBlur(28))
    bg = ImageEnhance.Brightness(bg).enhance(.45)
    tw = int(W * .78); s = tw / im.width; th = int(im.height * s)
    if th > H * .40: s = H * .40 / im.height; tw, th = int(im.width * s), int(H * .40)
    sc = 1 + .05 * ease(u)
    fr = im.resize((int(tw * sc), int(th * sc)), Image.LANCZOS).convert("RGBA")
    border = Image.new("RGBA", (fr.width + 16, fr.height + 16), GOLD + (255,))
    border.alpha_composite(fr, (8, 8))
    shadow = Image.new("RGBA", (border.width + 80, border.height + 80), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rectangle((40, 50, border.width + 40, border.height + 50), fill=(0, 0, 0, 170))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    bg.alpha_composite(shadow, ((W - shadow.width) // 2, int(H * .52 - shadow.height / 2) + 10))
    bg.alpha_composite(border, ((W - border.width) // 2, int(H * .52 - border.height / 2)))
    return bg

# ---------- overlays ----------
_vig = None
def vignette():
    global _vig
    if _vig is None:
        y, x = np.mgrid[0:H, 0:W]
        r = np.sqrt(((x - W / 2) / (W * .75)) ** 2 + ((y - H / 2) / (H * .62)) ** 2)
        a = np.clip((r - .55) / .6, 0, 1) ** 1.6 * 200
        v = np.zeros((H, W, 4), np.uint8); v[..., 3] = a.astype(np.uint8)
        # bottom gradient so subtitles stay readable
        g = np.clip((y - H * .58) / (H * .25), 0, 1) * 140
        v[..., 3] = np.maximum(v[..., 3], g.astype(np.uint8))
        _vig = Image.fromarray(v, "RGBA")
    return _vig

_grain = [Image.fromarray((np.random.default_rng(i).normal(128, 18, (H // 2, W // 2))).clip(0, 255).astype(np.uint8)).resize((W, H)) for i in range(6)]

def credit(canvas, s, t, t0, t1):
    a = fade(t, t0, t1, .3) * .85
    if a > 0:
        im = text_img(s, 22, "Cairo-Regular.ttf", fill=(235, 225, 205), shadow=True, maxw=W - 160)
        paste(canvas, im, W - SAFE_SIDE - im.width / 2 + 10, SAFE_TOP + 10, a)

def tag(canvas, s, t, t0, t1, y=SAFE_TOP + 90):
    a = fade(t, t0, t1, .35)
    if a <= 0: return
    im = text_img(s, 38, "Cairo-Bold.ttf", fill=SAND, maxw=W - 2 * SAFE_SIDE - 40)
    box = Image.new("RGBA", (im.width + 10, im.height - 14), (20, 14, 8, 150))
    slide = (1 - eout((t - t0) / .5)) * 60
    paste(canvas, box, W - SAFE_SIDE - box.width / 2 + slide, y, a)
    bar = Image.new("RGBA", (8, box.height), GOLD + (255,))
    paste(canvas, bar, W - SAFE_SIDE + 2 + slide, y, a)
    paste(canvas, im, W - SAFE_SIDE - box.width / 2 + slide, y, a)

def big(canvas, s, t, t0, t1, y=640, size=170, small=None):
    a = fade(t, t0, t1, .25)
    if a <= 0: return
    pop = 1.25 - .25 * eout((t - t0) / .45)
    im = text_img(s, size, "Cairo-Black.ttf", fill=GOLD, stroke=4, stroke_fill=INK)
    paste(canvas, im, W / 2, y, a, pop)
    if small:
        sm = text_img(small, 52, "Cairo-Bold.ttf", fill=SAND)
        paste(canvas, sm, W / 2, y + im.height * .55 + 30, fade(t, t0 + .35, t1, .4))

def timeline(canvas, t, t0, t1, year):
    a = fade(t, t0, t1, .4)
    if a <= 0: return
    layer = Image.new("RGBA", (W, 230), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    d.rounded_rectangle((SAFE_SIDE - 20, 10, W - SAFE_SIDE + 20, 220), 26, fill=(15, 10, 6, 175))
    n = len(TIMELINE); xs = [W - SAFE_SIDE - 50 - i * (W - 2 * SAFE_SIDE - 100) / (n - 1) for i in range(n)]  # RTL: oldest on the right
    ly = 120
    d.line((xs[-1], ly, xs[0], ly), fill=(120, 100, 70, 255), width=4)
    idx = [k for k, (_, y, _) in enumerate(TIMELINE) if y == year][0]
    prog = ease((t - t0 - .2) / .9)
    prev = max(idx - 1, 0)
    xcur = xs[prev] + (xs[idx] - xs[prev]) * prog
    d.line((xs[0], ly, xcur, ly), fill=GOLD + (255,), width=6)
    for k, x in enumerate(xs):
        on = k < idx or (k == idx and prog > .95)
        r = 14 if k == idx and on else 9
        d.ellipse((x - r, ly - r, x + r, ly + r), fill=GOLD + (255,) if on or k < idx else (120, 100, 70, 255))
    canvas_layer = layer
    for k, (lab, yv, desc) in enumerate(TIMELINE):
        on = k <= idx
        col = GOLD if k == idx else ((235, 225, 205) if on else (140, 125, 100))
        im = text_img(lab, 34 if k == idx else 28, "Cairo-Bold.ttf", fill=col, shadow=False)
        canvas_layer.alpha_composite(im, (int(xs[k] - im.width / 2), int(ly - 22 - im.height + 10)))
    desc = text_img(TIMELINE[idx][2], 30, "Cairo-Regular.ttf", fill=SAND, shadow=False)
    dl = Image.new("RGBA", desc.size); dl.alpha_composite(desc)
    canvas_layer.alpha_composite(dl, (int(min(max(xs[idx] - desc.width / 2, SAFE_SIDE - 10), W - SAFE_SIDE + 10 - desc.width)), ly + 2))
    paste(canvas, canvas_layer, W / 2, SAFE_TOP + 60 + 115, a)

# ---------- map ----------
MAPDIR = os.path.join(ROOT, "EXTERNAL_RESEARCH", "MAPS")
_map = None
def basemap():
    global _map
    if _map is None:
        im = Image.open(os.path.join(MAPDIR, "base_map.png")).convert("RGB")
        meta = json.load(open(os.path.join(MAPDIR, "base_map.json")))
        # paper texture + grade
        a = np.asarray(im).astype(np.float32)
        tex = np.random.default_rng(3).normal(0, 6, a.shape[:2])[..., None]
        a = np.clip(a + tex, 0, 255)
        _map = (Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.GaussianBlur(.6)), meta)
    return _map

def geo_px(lon, lat):
    _, meta = basemap(); Wm, Hm = meta["W"], meta["H"]
    m = lambda la: math.log(math.tan(math.pi / 4 + math.radians(la) / 2))
    return lon / 48 * Wm, (m(56) - m(lat)) / (m(56) - m(5)) * Hm

PLACES = {  # label -> (lon, lat)
 "القاهرة": (31.2357, 30.0444), "الخرطوم": (32.5599, 15.5007), "مروي (البجراوية)": (33.749, 16.938),
 "ميونخ": (11.575, 48.137), "برلين": (13.405, 52.52),
}
REGION_LABELS = {"مصر": (29.5, 26.5), "السودان": (30.0, 13.8), "البحر الأحمر": (38.2, 20.5),
                 "البحر المتوسط": (19.0, 34.0), "نهر النيل": (31.6, 21.3), "ألمانيا": (10.2, 51.0)}

def map_frame(t, keys, marks, routes=(), regions=()):
    """keys: list of (time, cx, cy, view_h) camera keyframes in map px."""
    mp, meta = basemap()
    ks = keys
    if t <= ks[0][0]: c = ks[0][1:]
    elif t >= ks[-1][0]: c = ks[-1][1:]
    else:
        for (ta, *ca), (tb, *cb) in zip(ks, ks[1:]):
            if ta <= t <= tb:
                u = ease((t - ta) / (tb - ta))
                # zoom in log space for natural feel
                vh = math.exp(math.log(ca[2]) + (math.log(cb[2]) - math.log(ca[2])) * u)
                c = (ca[0] + (cb[0] - ca[0]) * u, ca[1] + (cb[1] - ca[1]) * u, vh); break
    cx, cy, vh = c; vw = vh * W / H
    x0, y0 = cx - vw / 2, cy - vh / 2
    fr = mp.transform((W, H), Image.EXTENT, (x0, y0, x0 + vw, y0 + vh), Image.BICUBIC).convert("RGBA")
    sc = W / vw
    to_s = lambda p: ((p[0] - x0) * sc, (p[1] - y0) * sc)
    d = ImageDraw.Draw(fr)
    for lab, t0 in regions:
        a = fade(t, t0, 1e9, .5)
        if a > 0:
            sx, sy = to_s(geo_px(*REGION_LABELS[lab]))
            col = (60, 110, 140) if "البحر" in lab or "النيل" in lab else (95, 65, 35)
            paste(fr, text_img(lab, 44, "Cairo-Bold.ttf", fill=col, shadow=False), sx, sy, a * .9)
    for (a_lab, b_lab, t0, t1) in routes:
        u = eout((t - t0) / (t1 - t0))
        if u <= 0: continue
        pa = to_s(geo_px(*PLACES[a_lab])); pb = to_s(geo_px(*PLACES[b_lab]))
        mid = ((pa[0] + pb[0]) / 2 - 140, (pa[1] + pb[1]) / 2)
        pts = []
        for k in range(int(60 * u) + 1):
            s = k / 60
            pts.append(((1 - s) ** 2 * pa[0] + 2 * (1 - s) * s * mid[0] + s * s * pb[0],
                        (1 - s) ** 2 * pa[1] + 2 * (1 - s) * s * mid[1] + s * s * pb[1]))
        if len(pts) > 1:
            for k in range(0, len(pts) - 1, 2):
                d.line((pts[k], pts[k + 1]), fill=GOLD + (255,), width=7)
    for lab, t0, primary in marks:
        a = fade(t, t0, 1e9, .3)
        if a <= 0: continue
        sx, sy = to_s(geo_px(*PLACES[lab]))
        pulse = (t - t0) % 1.4 / 1.4
        rr = 18 + 40 * pulse
        ring = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse((100 - rr, 100 - rr, 100 + rr, 100 + rr), outline=GOLD + (int(255 * (1 - pulse) * a),), width=5)
        fr.alpha_composite(ring, (int(sx - 100), int(sy - 100)))
        r = 16 if primary else 11
        d.ellipse((sx - r, sy - r, sx + r, sy + r), fill=(170, 30, 20, int(255 * a)) if primary else (30, 20, 10, int(255 * a)),
                  outline=(255, 240, 210, int(255 * a)), width=4)
        im = text_img(lab, 58 if primary else 44, "Cairo-Black.ttf" if primary else "Cairo-Bold.ttf", fill=(255, 246, 225),
                      stroke=3, stroke_fill=(40, 25, 10), maxw=900)
        lx = sx - im.width / 2 - 26 if sx > W * .45 else sx + im.width / 2 + 26
        lx = min(max(lx, SAFE_SIDE + im.width / 2 - 20), W - SAFE_SIDE - im.width / 2 + 20)
        paste(fr, im, lx, sy - 6, a * eout((t - t0) / .4), 1)
    return fr

MEROE = geo_px(33.749, 16.938)
def scene_map1(t, sc):
    t0 = sc["t0"]; K = sc.get("k", 1.0)
    keys = [(t0, 3600, 4700, 4300), (t0 + 2.2 * K, 3800, 5500, 2600), (t0 + 4.4 * K, MEROE[0] - 60, MEROE[1] + 160, 900), (sc["t1"], MEROE[0] - 30, MEROE[1] + 130, 760)]
    marks = [("القاهرة", t0 + .6 * K, False), ("الخرطوم", t0 + 4.1 * K, False), ("مروي (البجراوية)", t0 + 5.9 * K, True)]
    regs = [("مصر", t0 + .3 * K), ("السودان", t0 + .9 * K), ("البحر الأحمر", t0 + .5 * K), ("البحر المتوسط", t0 + .2 * K), ("نهر النيل", t0 + 1.6 * K)]
    fr = map_frame(t, keys, marks, regions=regs)
    # distance callout
    a = fade(t, t0 + 5.0 * K, sc["t1"], .4)
    if a > 0:
        im = text_img("≈ 200 كم شمال شرقي الخرطوم", 44, "Cairo-Bold.ttf", fill=SAND, maxw=W - 200)
        box = Image.new("RGBA", (im.width, im.height - 10), (20, 14, 8, 170))
        paste(fr, box, W / 2, 480, a); paste(fr, im, W / 2, 480, a)
    return fr

def scene_map2(t, sc):
    t0 = sc["t0"]; K = sc.get("k", 1.0); mp, meta = basemap()
    mid = ((MEROE[0] + 1500) / 2, (MEROE[1] + 1100) / 2)
    keys = [(t0, MEROE[0], MEROE[1] + 150, 1000), (t0 + 1.8 * K, mid[0] - 150, mid[1] + 400, 7400), (t0 + 3.4 * K, 1700, 2150, 4200), (sc["t1"], 1650, 1980, 3900)]
    marks = [("مروي (البجراوية)", t0, True), ("ميونخ", t0 + 2.4 * K, False), ("برلين", t0 + 3.8 * K, False)]
    routes = [("مروي (البجراوية)", "ميونخ", t0 + 1.0 * K, t0 + 2.5 * K), ("مروي (البجراوية)", "برلين", t0 + 2.2 * K, t0 + 3.9 * K)]
    regs = [("البحر المتوسط", t0 + 1.0 * K), ("مصر", t0 + 1.2 * K), ("السودان", t0 + .6 * K), ("ألمانيا", t0 + 2.0 * K)]
    return map_frame(t, keys, marks, routes, regs)

def pyramid_icon(size, fill):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.polygon([(size * .5, size * .08), (size * .95, size * .92), (size * .05, size * .92)], fill=fill)
    d.polygon([(size * .5, size * .08), (size * .95, size * .92), (size * .5, size * .92)], fill=tuple(int(c * .75) for c in fill[:3]) + (fill[3],))
    return im

def scene_counter(t, sc):
    t0, ce, rv, t1 = sc["t0"], sc["count_end"], sc["reveal"], sc["t1"]
    bg = kenburns("P03_meroe_ahmed_amir.jpg", (t - t0) / (t1 - t0), dict(z0=1.1, z1=1.2, x0=.5, x1=.5, y0=.5, y1=.5))
    bg = ImageEnhance.Brightness(bg.filter(ImageFilter.GaussianBlur(14))).enhance(.32)
    u = (t - (t0 + .5)) / (ce - t0 - .5)
    val = int(round(40 * (1 - (1 - min(max(u, 0), 1)) ** 2)))
    # icon grid 8 x 5
    ic_on = pyramid_icon(84, GOLD + (255,)); ic_off = pyramid_icon(84, (90, 75, 55, 255))
    gx0, gy0, step = W / 2 - 3.5 * 104, 940, 80
    for k in range(40):
        r, c = divmod(k, 8)
        x = gx0 + c * 104; y = gy0 + r * step
        x = W - x  # RTL fill order
        if t < rv:
            if k < val: paste(bg, ic_on, x, y, 1.0, 1 + .3 * max(0, 1 - (t - (t0 + .5 + (ce - t0 - .5) * (1 - math.sqrt(1 - (k + 1) / 40)))) * 6))
        else:
            keep = k < 6
            a = 1 if keep else max(.0, 1 - (t - rv) / .6) * .9 + .1
            ic = ic_on if keep else ic_off
            if k == 5: ic = pyramid_icon(84, GOLD + (120,))
            paste(bg, ic, x, y, a)
    if t < rv:
        num = text_img(str(val), 300, "Cairo-Black.ttf", fill=GOLD, stroke=5)
        pop = 1 + .15 * max(0, 1 - (t - ce) * 3) if t >= ce else 1
        paste(bg, num, W / 2, 620, 1, pop)
        if t >= ce:
            paste(bg, text_img("هرمًا؟", 90, "Cairo-Black.ttf", fill=SAND), W / 2, 820, ease((t - ce) / .3))
            paste(bg, text_img("رقم شائع… لكنه غير مثبت", 46, "Cairo-Bold.ttf", fill=(235, 200, 160)), W / 2, 380, ease((t - ce - .4) / .4))
    else:
        a = ease((t - rv) / .4)
        old = text_img("40", 150, "Cairo-Black.ttf", fill=(150, 130, 100), stroke=3)
        o = Image.new("RGBA", old.size, (0, 0, 0, 0)); o.alpha_composite(old)
        ImageDraw.Draw(o).line((10, o.height * .75, o.width - 10, o.height * .25), fill=(190, 40, 30, 255), width=12)
        paste(bg, o, W / 2 + 300, 430, .9)
        paste(bg, text_img("5 أو 6", 230, "Cairo-Black.ttf", fill=GOLD, stroke=5), W / 2 - 40, 640, a, 1.15 - .15 * eout((t - rv) / .5))
        paste(bg, text_img("بحسب رواية فرليني نفسه", 56, "Cairo-Bold.ttf", fill=SAND), W / 2, 830, ease((t - rv - .3) / .4))
    return bg

_logo = {}
def logo(size):
    if size not in _logo:
        im = Image.open(os.path.join(ROOT, "LOGOS_AND_BRANDING", "logo.png")).convert("RGBA")
        _logo[size] = im.resize((size, size), Image.LANCZOS)
    return _logo[size]

def scene_end(t, sc):
    t0, t1 = sc["t0"], sc["t1"]
    e1, e2, e3 = sc.get("end_times", [t0 + 1.0, t0 + 2.6, t0 + 4.0])
    bg = kenburns("P01_meroe_portrait_ahmed_amir.jpg", (t - t0) / (t1 - t0), dict(z0=1.0, z1=1.08, x0=.5, x1=.5, y0=.55, y1=.5))
    bg = ImageEnhance.Brightness(bg.filter(ImageFilter.GaussianBlur(3))).enhance(.38)
    # series logo: scale-in with overshoot, warm glow pulse, light sweep
    u = (t - t0 - .25) / .9
    if u > 0:
        sc_ = 0.6 + 0.4 * eout(u) + 0.06 * math.sin(min(u, 1) * math.pi)
        size = 600
        lg = logo(size).copy()
        k = (t - t0 - 1.0) / 1.1   # light sweep across the badge
        if 0 < k < 1:
            sweep = Image.new("L", (size, size), 0); dsw = ImageDraw.Draw(sweep)
            x = -size * .3 + k * size * 1.6
            dsw.polygon([(x, 0), (x + 90, 0), (x - 110, size), (x - 200, size)], fill=120)
            sweep = sweep.filter(ImageFilter.GaussianBlur(25))
            white = Image.new("RGBA", (size, size), (255, 240, 200, 0))
            white.putalpha(Image.fromarray((np.asarray(sweep).astype(np.float32) * np.asarray(lg.getchannel("A")).astype(np.float32) / 255).astype(np.uint8)))
            lg.alpha_composite(white)
        glow_a = .35 + .15 * math.sin((t - t0) * 2.4)
        glow = Image.new("RGBA", (900, 900), (0, 0, 0, 0)); ImageDraw.Draw(glow).ellipse((150, 150, 750, 750), fill=(255, 180, 70, int(255 * glow_a)))
        paste(bg, glow.filter(ImageFilter.GaussianBlur(90)), W / 2, 560, ease(u))
        paste(bg, lg, W / 2, 560, ease(u * 1.5), sc_)
    paste(bg, text_img("الذهب اليوم في متاحف أوروبا", 54, "Cairo-Bold.ttf", fill=SAND), W / 2, 960, ease((t - e1) / .4))
    paste(bg, text_img("فلمن يجب أن يكون؟", 80, "Cairo-Black.ttf", fill=GOLD, stroke=3), W / 2, 1075, ease((t - e2) / .4))
    paste(bg, text_img("اكتب رأيك في التعليقات… وتابعنا للحلقة القادمة", 40, "Cairo-Bold.ttf", fill=SAND), W / 2, 1195, ease((t - e3) / .4))
    return bg

# ---------- scene dispatcher ----------
CREDITS = {}
def load_credits():
    p = os.path.join(PH, "_meta.json")
    if os.path.exists(p):
        for x in json.load(open(p)):
            art = x["artist"].replace("Unknown authorUnknown author", "مجهول").strip() or "—"
            CREDITS[x["local"]] = f"صورة: {art} • {x['lic']} • Wikimedia Commons"
load_credits()

def photo_layer(sc, t):
    segs = [(sc["t0"], sc["img"], sc["move"])]
    for k in ("cut", "cut2"):
        if k in sc: segs.append((sc[k]["at"], sc[k]["img"], sc[k]["move"]))
    segs.append((sc["t1"], None, None))
    for (a, img, mv), (b, _, _) in zip(segs, segs[1:]):
        if a <= t < b or (t >= b and _ is None and t <= sc["t1"]):
            u = (t - a) / (b - a)
            fr = framed(img, u) if graded(img).width < 700 else kenburns(img, u, mv)
            # quick flash-cut: 3-frame brightness pop on hard cuts within a scene
            if a != sc["t0"] and t - a < 0.1:
                fr = ImageEnhance.Brightness(fr).enhance(1.35 - (t - a) * 3.5)
            return fr, img, a, b
    return kenburns(segs[-2][1], 1.0, segs[-2][2]), segs[-2][1], segs[-2][0], sc["t1"]

def render_scene(sc, t):
    k = sc["kind"]
    if k == "photo":
        fr, img, a, b = photo_layer(sc, t)
        fr.alpha_composite(vignette())
        credit(fr, CREDITS.get(img, ""), t, a, b)
        if sc.get("big"): big(fr, sc["big"], t, sc.get("big_at", sc["t0"] + .1), sc["t1"] if sc["id"] != "S08" else sc["t0"] + 2.2,
                              y=700 if sc["id"] == "S01" else 760, size=200 if sc["id"] == "S01" else 170, small=sc.get("small"))
        if sc.get("lower"):
            l1, l2 = sc["lower"].split("|")
            tag(fr, l1, t, sc["t0"] + .6, sc["t1"] - .2, y=SAFE_TOP + 110)
            tag(fr, l2, t, sc["t0"] + 1.0, sc["t1"] - .2, y=SAFE_TOP + 190)
        if sc.get("timeline"): timeline(fr, t, sc["t0"], sc["t1"], sc["timeline"])
        if sc.get("tag"):
            if sc["id"] == "S07":
                tag(fr, sc["tag"], t, sc["t0"] + .4, sc["cut"]["at"], y=SAFE_TOP + 110)
                tag(fr, sc["tag2"], t, sc["cut"]["at"] + .3, sc["t1"], y=SAFE_TOP + 110)
            else:
                tag(fr, sc["tag"], t, sc["t0"] + .5, sc["t1"] - .1, y=SAFE_TOP + (430 if sc.get("timeline") else 110))
        return fr
    if k == "portrait":
        fr = framed(sc["img"], (t - sc["t0"]) / (sc["t1"] - sc["t0"]))
        credit(fr, CREDITS.get(sc["img"], ""), t, sc["t0"], sc["t1"])
        timeline(fr, t, sc["t0"], sc["t1"], sc["timeline"])
        n1, n2 = sc["name_card"].split("|")
        a = fade(t, sc["t0"] + 1.0, sc["t1"], .4)
        paste(fr, text_img(n1, 72, "Cairo-Black.ttf", fill=GOLD, stroke=3), W / 2, 1060, a)
        paste(fr, text_img(n2, 42, "Cairo-Bold.ttf", fill=SAND), W / 2, 1150, fade(t, sc["t0"] + 1.3, sc["t1"], .4))
        return fr
    if k == "map1": fr = scene_map1(t, sc)
    elif k == "map2": fr = scene_map2(t, sc)
    elif k == "counter": fr = scene_counter(t, sc)
    elif k == "end": return scene_end(t, sc)
    if k in ("map1", "map2"):
        fr.alpha_composite(vignette())
        if k == "map2": timeline(fr, t, sc["t0"], sc["t1"], 1844) if False else None
    return fr

TRANS = 0.35  # crossfade between scenes
def frame_at(t):
    cur = [s for s in SCENES if s["t0"] <= t < s["t1"]] or [SCENES[-1]]
    sc = cur[0]
    fr = render_scene(sc, t)
    i = SCENES.index(sc)
    if i > 0 and t - sc["t0"] < TRANS:  # crossfade from previous scene's tail
        prev = render_scene(SCENES[i - 1], t)
        fr = Image.blend(prev, fr, ease((t - sc["t0"]) / TRANS))
    # subtitles
    st = SUBS.at(t) if t < SCENES[-1]["t0"] + TRANS else None   # end card already shows the spoken lines
    if st:
        a = min(ease((t - st[0]) / .12), ease((st[1] - t) / .12))
        im = text_img(st[2], 54, "Cairo-Bold.ttf", fill=(255, 255, 255), stroke=0, maxw=W - 2 * SAFE_SIDE - 40)
        bx = Image.new("RGBA", (im.width - 10, im.height - 18), (0, 0, 0, 120))
        paste(fr, bx, W / 2, 1340, a); paste(fr, im, W / 2, 1340, a)
    # grain + global fade in/out
    g = _grain[int(t * FPS) % len(_grain)]
    rgb = fr.convert("RGB")
    rgb = Image.blend(rgb, Image.merge("RGB", (g, g, g)), .045)
    if t > DURATION - .8: rgb = ImageEnhance.Brightness(rgb).enhance(max(0, (DURATION - t) / .8))
    return rgb

def main():
    out = sys.argv[1]
    if "--stills" not in sys.argv:
        a = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
        b = float(sys.argv[3]) if len(sys.argv) > 3 else DURATION
    else:
        os.makedirs(out, exist_ok=True)
        for tt in [float(x) for x in sys.argv[sys.argv.index("--stills") + 1].split(",")]:
            frame_at(tt).save(os.path.join(out, f"still_{tt:06.2f}.jpg"), quality=88)
        return
    p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", out],
                         stdin=subprocess.PIPE)
    n0, n1 = int(round(a * FPS)), int(round(b * FPS))
    for n in range(n0, n1):
        p.stdin.write(frame_at(n / FPS).tobytes())
        if n % 150 == 0: print(f"{n / FPS:6.1f}s", flush=True)
    p.stdin.close(); p.wait()

if __name__ == "__main__":
    main()
