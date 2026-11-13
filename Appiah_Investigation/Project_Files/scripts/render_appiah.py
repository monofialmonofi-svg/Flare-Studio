"""Alwan newspaper investigative sports reel: «منتخب السودان.. من يدير المشهد خلف الكواليس؟»
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


# ---------------------------------------------------------------- media
DUR = 85.0
def load_photo(name, grade_kind="news"):
    im = Image.open(f"{PH}/{name}.jpg").convert("RGB")
    x = np.asarray(im).astype(np.float32) / 255
    m = x.reshape(-1, 3).mean(0); x = x * (m.mean() / np.maximum(m, 1e-3)) ** 0.35     # partial WB
    x = np.clip((x - 0.5) * 1.1 + 0.5, 0, 1)
    lum = (x * np.array([0.299, 0.587, 0.114])).sum(2, keepdims=True)
    x = lum + (x - lum) * (0.92 if grade_kind == "news" else 0.25)
    x = x * np.array([0.98, 0.99, 1.02])                                                    # cool investigative tone
    return Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(1.6, 50, 2))
P = {n: load_photo(n) for n in ("appiah_sudan", "kigali_pele_stadium", "kigali_pele_side", "sudan_team_2011")}
P["appiah_mono"] = load_photo("appiah_sudan", "mono")
P_BLUR = {k: np.asarray(v.resize((W, H)).filter(ImageFilter.GaussianBlur(30))).astype(np.float32) / 255 for k, v in P.items()}

def place_photo(fr, key, u, z0, z1, fx=0.5, fy=0.4, dim=1.0, fit="cover", y_off=0):
    """Ken Burns over a blurred extension of the same photo (no letterbox bars)."""
    im = P[key]; iw, ih = im.size
    fr[:] = P_BLUR[key] * 0.45 * dim
    z = lerp(z0, z1, ease_io(u))
    base = max(W / iw, H / ih) if fit == "cover" else W / iw
    s = base * z; nw, nh = int(iw * s), int(ih * s)
    x0 = int(W / 2 - fx * nw); y0 = int(H / 2 - fy * nh) + y_off
    x0 = min(0, max(W - nw, x0)) if nw >= W else (W - nw) // 2
    if fit == "cover": y0 = min(0, max(H - nh, y0))
    arr = np.asarray(im.resize((nw, nh), Image.BILINEAR)).astype(np.float32) / 255 * dim
    xs, ys = max(0, -x0), max(0, -y0); sub = arr[ys:ys + H - max(0, y0), xs:xs + W - max(0, x0)]
    fr[max(0, y0):max(0, y0) + sub.shape[0], max(0, x0):max(0, x0) + sub.shape[1]] = sub

# ---------------------------------------------------------------- Africa map (Sudan drawn per its official position: Halaib included)
AFR = json.load(open(f"{X}/work/africa_sudan_official.json"))
def make_map():
    lon0, lat1, sc = -19.0, 38.5, 1040 / 72.0
    def Pt(lon, lat): return (20 + (lon - lon0) * sc, 380 + (lat1 - lat) * sc)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for code, g in AFR.items():
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            pts = [Pt(*c) for c in poly[0]]
            if len(pts) < 3: continue
            if code == "SDN": d.polygon(pts, fill=(215, 36, 41, 235), outline=(255, 255, 255, 255), width=3)
            elif code in ("RWA", "SEN"): d.polygon(pts, fill=(216, 218, 217, 240), outline=(255, 255, 255, 255), width=3)
            else: d.polygon(pts, fill=(64, 64, 64, 200), outline=(110, 110, 110, 200), width=1)
    a = np.asarray(im).astype(np.float32) / 255
    return np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2), Pt
MAP, MAPPT = make_map()

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
def T(txt, size, wght=700, color=(255, 255, 255), fname="alex", maxw=None, stroke=0, spacing=14):
    return text(txt, size, wght, color, fname=fname, maxw=maxw, stroke=stroke, spacing=spacing)

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

# ---------------------------------------------------------------- timeline
A1, A2, A3, A4, A5 = 0.0, 12.0, 30.0, 45.0, 70.0
CUTS = [A2, 20.0, A3, 37.5, A4, 56.0, 63.0, A5, 77.0]
NARR = [
 (2.6, 6.2, "تخيّل إنك مدرب منتخب وطني.. وقبل أيام من مواجهة مهمة"),
 (6.3, 11.8, "تلقى نفسك وسط أزمة |ما عندها علاقة بالكورة| داخل الملعب!"),
 (12.6, 16.0, "القصة المرة دي مع كواسي أبياه، مدرب صقور الجديان"),
 (20.3, 24.6, "لكن رئيس لجنة المنتخبات أكد إن |القرار الفني بيد المدرب|"),
 (24.8, 29.6, "طيب.. إذا كان المدرب هو المسؤول عن الاختيار.. |من المسؤول عن المجموعة في المعسكر؟|"),
 (30.4, 36.8, "والقصة ما وقفت هنا.. أزمة الحوافز وصلت لمرحلة |رفض لاعبين أداء تمرين| في قطر"),
 (45.6, 50.4, "وفي المقابل.. ظهرت تقارير عن |تدخلات في صلاحيات أبياه|"),
 (63.3, 69.6, "كل ده بيحصل.. والمنتخب محتاج |للاستقرار| مش لصراعات إدارية جديدة!"),
 (70.4, 75.6, "السؤال ما بقى عن أبياه وحده.. هل المشكلة في المدرب؟ |ولا في طريقة إدارة الكورة؟|"),
]
SFX = {"impacts": [0.6, A2, 17.0, A3, A4, 56.0, A5, 72.0, 74.0, 75.8], "whooshes": CUTS, "risers": [A2, A4, A5], "paper": [12.4, 30.6, 37.6, 46.0], "digital": [17.0, 20.3, 33.0, 52.0]}

def make_frame(t):
    fr = np.zeros((H, W, 3), np.float32); fr[:] = INK
    # --------- picture layer
    if t < A2:                                                       # S1: Appiah portrait slow push, then Kigali
        if t < 7.6: place_photo(fr, "appiah_sudan", t / 7.6, 1.08, 1.22, fx=0.58, fy=0.4, dim=lerp(0.25, 1.0, ease_out(t / 1.2)), fit="width", y_off=-330)
        else: place_photo(fr, "kigali_pele_stadium", (t - 7.6) / 4.4, 1.05, 1.15, fx=0.5, fy=0.5)
    elif t < 20.0:                                                   # S2a: map Kigali / Senegal, then claim
        fr[:] = INK; fr += P_BLUR["kigali_pele_side"] * 0.25
        a = fade(t, A2, 20.0, 0.5, 0.4); blit(fr, MAP, 540, 960, a)
        x, y = MAPPT(30.06, -1.95)                                   # Kigali
        r = 10 + 6 * math.sin(t * 6)
        rect(fr, x - r, y - r, x + r, y + r, RED, a); blit(fr, T("كيغالي", 40, 800, (255, 255, 255), "tajx"), x + 95, y - 40, a)
        xs, ys = MAPPT(-14.5, 14.5); blit(fr, T("السنغال", 34, 800, (255, 255, 255), "tajx"), xs + 80, ys - 70, a)
        xd, yd = MAPPT(30.0, 15.5); blit(fr, T("السودان", 38, 800, (255, 255, 255), "tajx"), xd, yd, a)
    elif t < A3:                                                     # S2b: split-screen versus
        place_photo(fr, "appiah_mono", (t - 20) / 10, 1.05, 1.12, fx=0.58, fy=0.4, dim=0.35, fit="width", y_off=-200)
    elif t < A4:                                                     # S3: incentives
        place_photo(fr, "sudan_team_2011", (t - A3) / 15, 1.0, 1.12, fx=0.5, fy=0.45, dim=0.45)
    elif t < A5:                                                     # S4: powers
        if t < 56.0: fr[:] = INK; fr += P_BLUR["appiah_sudan"] * 0.2
        elif t < 63.0: place_photo(fr, "appiah_sudan", (t - 56) / 7, 1.05, 1.15, fx=0.58, fy=0.4, dim=0.55, fit="width", y_off=330)
        else: place_photo(fr, "kigali_pele_side", (t - 63) / 7, 1.0, 1.1, dim=0.5)
    else:                                                            # S5: flag + questions + logo
        if t < 77.0:
            place_photo(fr, "sudan_team_2011", (t - A5) / 7, 1.12, 1.22, dim=0.35)
            wave = int(6 * math.sin(t * 2))
            fh, fw = FLAG.shape[:2]; y0 = 250 + wave
            fr[y0:y0 + fh, 90:90 + fw] = fr[y0:y0 + fh, 90:90 + fw] * 0.15 + FLAG * 0.85 * fade(t, A5, 77.0, 0.6, 0.3)
        else:
            fr[:] = INK
    # whip blur on cuts
    for tw in CUTS:
        d = abs(t - tw)
        if d < 0.09:
            n = int(60 * (1 - d / 0.09)) + 1
            cs = np.cumsum(np.pad(fr, ((0, 0), (n, 0), (0, 0)), mode="edge"), 1); fr = (cs[:, n:] - cs[:, :-n]) / n
    fr = fr * (1 - 0.6 * BOTTOM)
    # --------- graphics layer
    if t < A2:
        kicker(fr, t, 0.5, A2 - 0.2, "تقرير خاص | صحيفة ألوان السودانية", 170)
        box_text(fr, t, 0.9, 7.4, "منتخب السودان.. من يدير المشهد خلف الكواليس؟", 960, 78)
        box_text(fr, t, 7.7, A2 - 0.2, "المدرب المسؤول عن المنتخب.. هل أصبح آخر من يعلم بمن تم استدعاؤهم؟", 960, 58)
        source(fr, t, 1.2, 7.4, "كواسي أبياه – مدرب منتخب السودان", 1790)
        source(fr, t, 7.8, A2 - 0.2, "ملعب كيغالي بيليه – رواندا", 1790)
    elif t < 20.0:
        kicker(fr, t, A2 + 0.2, 19.8, "معسكر كيغالي.. قبل مواجهتي السنغال", 170)
        if t >= 16.2:
            box_text(fr, t, 16.2, 19.8, "منشور منسوب للمهندس بدرالدين البطل: أبياه لم يحدد اللاعبين الموجودين في معسكر كيغالي", 1320, 46, "taj", 700, maxw=900)
            caveat(fr, t, 16.6, 19.8, "منشور متداول.. لم تتحقق منه «ألوان» بشكل مستقل، وليس بياناً من أبياه", 1500)
    elif t < A3:
        kicker(fr, t, 20.2, A3 - 0.2, "روايتان.. وسؤال واحد", 170)
        quote_card(fr, t, 20.3, A3 - 0.2, "بدرالدين البطل", "منشور منسوب – غير مؤكد", "أبياه لم يحدد اللاعبين الموجودين في معسكر كيغالي", 300, +1, GREY)
        quote_card(fr, t, 21.0, A3 - 0.2, "أسامة عطا المنان", "نائب رئيس الاتحاد – تصريحات سابقة بصفته رئيساً للجنة المنتخبات", "سلطة القرار الفني تظل بيد المدرب.. واللجنة لا تتدخل في الجوانب الفنية", 300, -1, RED)
        big_q(fr, t, 25.0, 27.2, "من اختار المجموعة الموجودة في كيغالي؟", 1020, 74)
        big_q(fr, t, 27.3, A3 - 0.2, "هل وصلت الدعوات بموافقة المدرب؟", 1020, 74)
    elif t < A4:
        kicker(fr, t, A3 + 0.2, A4 - 0.2, "ملف الحوافز والمستحقات", 170)
        source(fr, t, A3 + 0.4, A4 - 0.2, "منتخب السودان – صورة أرشيفية (2011)", 1790)
        stamp_card(fr, t, A3 + 0.6, 41.8, "نوفمبر 2025 – الدوحة", "لاعبو المنتخب رفضوا أداء التمرين الختامي قبل مواجهة لبنان في كأس العرب، احتجاجاً على تأخر حوافز التأهل", "المصدر: النيلين", 330)
        stamp_card(fr, t, 37.6, 41.8, "ديسمبر 2025", "استياء وسط نجوم المنتخب لعدم تسلّم مكافآت متأخرة من اتحاد الكرة", "المصدر: winwin", 700)
        stamp_card(fr, t, 39.8, 41.8, "2026", "تقرير: الاتحاد يستبعد لاعبين نجوماً من تصفيات 2027 بعد خلاف حول المكافآت", "المصدر: Panafrica Football", 1010)
        box_text(fr, t, 42.0, A4 - 0.2, "الحوافز والمستحقات.. ملف لم يُغلق دون أسئلة", 960, 64, bar=True)
    elif t < A5:
        kicker(fr, t, A4 + 0.2, A5 - 0.2, "صراع الصلاحيات", 170)
        if t < 56.0:
            org_chart(fr, t, A4, 50.8)
            big_q(fr, t, 51.0, 53.4, "من يملك القرار الفني؟", 960, 84)
            big_q(fr, t, 53.5, 55.8, "أين تنتهي الصلاحيات الإدارية؟", 960, 84)
        elif t < 63.0:
            source(fr, t, 56.3, 62.8, "كواسي أبياه – مدرب منتخب السودان", 1790)
            stamp_card(fr, t, 56.2, 62.8, "19 أكتوبر 2026", "رئيس الاتحاد معتصم جعفر: عقد أبياه مستمر حتى 2029", "تصريحات صحفية", 360)
            stamp_card(fr, t, 57.6, 62.8, "أواخر أكتوبر 2026", "تقرير: أبياه يرى أن تحركات تستهدف تقليص صلاحياته تمهيداً لإبعاده", "المصدر: الترا سودان", 700)
            caveat(fr, t, 59.0, 62.8, "رواية منقولة عن مصادر.. ولا إعلان رسمي عن رحيل أبياه", 1050)
        else:
            source(fr, t, 63.3, A5 - 0.2, "كيغالي – رواندا", 1790)
            big_q(fr, t, 63.2, A5 - 0.2, "وهل أصبح مستقبل أبياه جزءاً من الأزمة؟", 960, 78)
    else:
        if t < 77.0:
            source(fr, t, A5 + 0.3, 76.9, "منتخب السودان – صورة أرشيفية (2011)", 1790)
            big_q(fr, t, 71.6, 73.5, "من يختار اللاعبين؟", 960, 84)
            big_q(fr, t, 73.6, 75.4, "من يدير المنتخب؟", 960, 84)
            big_q(fr, t, 75.5, 76.9, "ومن يتحمل المسؤولية؟", 960, 84)
        else:
            box_text(fr, t, 77.2, 80.6, "صقور الجديان بحاجة إلى الاستقرار.. لا مزيد من الأزمات", 960, 62, bar=True)
            a = fade(t, 80.6, DUR, 0.5, 0.4)
            if a:
                blit(fr, logo_sprite(200), 540, 800, a)
                blit(fr, T("تقرير خاص | صحيفة ألوان السودانية", 50, 800, (255, 255, 255), "tajx"), 540, 990, a)
                blit(fr, T("إنتاج صحيفة ألوان السودانية", 40, 0, (216, 218, 217), "tajm"), 540, 1075, a)
                blit(fr, T("المصادر: الترا سودان · winwin · النيلين · Panafrica Football", 26, 0, (160, 160, 160), "tajm", maxw=960), 540, 1230, a)
    narr(fr, t, NARR)
    if 1.0 < t < 80.4: blit(fr, logo_sprite(62), W - 70 - logo_sprite(62).shape[1] / 2, 110, 0.6)
    fr = fr * VIG + GRAIN[int(t * FPS) % 5]
    if t < 0.15: fr *= t / 0.15
    if t > DUR - 0.4: fr *= max(0, (DUR - t) / 0.4)
    return fr

def to8(f): return (np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    if PREVIEW:
        for t in PREVIEW: Image.fromarray(to8(make_frame(t))).save(f"{OUT}/prev_{t:05.2f}.png")
        sys.exit()
    NF = int(round(DUR * FPS)); NW = 4; k = int(WORKER[1:]); b = [round(NF * i / NW) for i in range(NW + 1)]
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-threads", "2", "-pix_fmt", "yuv420p", f"{OUT}/seg_{k}.mp4"], stdin=subprocess.PIPE)
    for fi in range(b[k], b[k + 1]):
        p.stdin.write(to8(make_frame(fi / FPS)).tobytes())
        if fi % 90 == 0: print(f"w{k} {fi}/{b[k + 1]}", flush=True)
    p.stdin.close(); p.wait(); print(f"w{k} DONE", flush=True)
