"""Alwan cinematic documentary: Mohammed Al-Amin (based on Salah Al-Din Abdel-Hafeez's article).
On-screen narration (no voiceover), original score. Two layouts designed separately: h = 1920x1080, v = 1080x1920.
Usage: render_amin.py SCRATCH ORIENT(h|v) OUT_DIR [wK | preview times...]"""
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S, ORI, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ARGS = sys.argv[4:]; WORKER = ARGS[0] if ARGS and ARGS[0].startswith("w") else None
PREVIEW = [] if WORKER else [float(x) for x in ARGS]
V = ORI == "v"; W, H = (1080, 1920) if V else (1920, 1080); FPS = 30; DUR = 240.0
def L(v, h): return v if V else h
R = "/home/user/Flare-Studio/MOHAMMED_ALAMIN_DOCUMENTARY/03_ASSETS/PHOTOS"

# palette: cinematic black, quiet gold, warm browns
INK = np.array([10, 9, 8], np.float32) / 255
GOLD = np.array([201, 162, 92], np.float32) / 255
GOLD_L = (226, 196, 140)
BROWN = np.array([74, 52, 36], np.float32) / 255
CREAM = (240, 230, 212)
RED = np.array([215, 36, 41], np.float32) / 255
FONT = {"amiri": f"{S}/fonts/Amiri-Bold.ttf", "alex": f"{S}/fonts/Alexandria%5Bwght%5D.ttf", "taj": f"{S}/fonts/Tajawal-Bold.ttf",
        "tajm": f"{S}/fonts/Tajawal-Medium.ttf", "tajx": f"{S}/fonts/Tajawal-ExtraBold.ttf", "oswald": f"{S}/fonts/Oswald%5Bwght%5D.ttf"}

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def eo(x): x = clamp(x); return 1 - (1 - x) ** 3
def eio(x): x = clamp(x); return x * x * (3 - 2 * x)
def lerp(a, b, u): return a + (b - a) * u
def fade(t, t0, t1, fi=0.6, fo=0.5):
    if t < t0 or t > t1: return 0.0
    return min(eo((t - t0) / fi), eio((t1 - t) / fo))

_c = {}
def text(txt, size, color=CREAM, fname="taj", wght=None, maxw=None, stroke=0, spacing=12, ar=True):
    key = (txt, size, color, fname, wght, maxw, stroke, ar)
    if key in _c: return _c[key]
    f = ImageFont.truetype(FONT[fname], size)
    if wght is not None and fname in ("alex", "oswald"):
        f.set_variation_by_axes([wght] + [0] * (len(f.get_variation_axes()) - 1))
    kw = dict(direction="rtl", language="ar") if ar else {}
    d0 = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    def wd(s): return d0.textbbox((0, 0), s, font=f, stroke_width=stroke, **kw)[2]
    lines = []
    for para in txt.split("\n"):
        cur = ""
        for w_ in para.split(" "):
            c = (cur + " " + w_).strip()
            if maxw and wd(c) > maxw and cur: lines.append(cur); cur = w_
            else: cur = c
        lines.append(cur)
    asc, desc = f.getmetrics(); lh = asc + desc + spacing; tw = max(wd(l) for l in lines) + 2 * stroke + 8
    im = Image.new("RGBA", (tw + 40, lh * len(lines) + 40), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for i, l in enumerate(lines):
        d.text((20 + (tw - wd(l)) // 2, 20 + i * lh), l, font=f, fill=tuple(color) + (255,), stroke_width=stroke, stroke_fill=(0, 0, 0), **kw)
    im = im.crop(im.getbbox() or (0, 0, 1, 1)); a = np.asarray(im).astype(np.float32) / 255
    out = np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2); _c[key] = out; return out

def blit(fr, sp, cx, cy, a=1.0):
    if a <= 0.003: return
    h, w = sp.shape[:2]; x0 = int(round(cx - w / 2)); y0 = int(round(cy - h / 2))
    fx0, fy0, fx1, fy1 = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if fx1 <= fx0 or fy1 <= fy0: return
    s = sp[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0]; reg = fr[fy0:fy1, fx0:fx1]
    reg *= (1 - s[..., 3:4] * a); reg += s[..., :3] * a

def rect(fr, x0, y0, x1, y1, col, a=1.0):
    x0, y0, x1, y1 = [int(round(v)) for v in (max(0, x0), max(0, y0), min(W, x1), min(H, y1))]
    if x1 > x0 and y1 > y0: fr[y0:y1, x0:x1] = fr[y0:y1, x0:x1] * (1 - a) + col * a

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = (1 - 0.62 * np.clip(((xx - W / 2) / (W * 0.72)) ** 2 + ((yy - H / 2) / (H * 0.68)) ** 2, 0, 1) ** 1.3)[..., None].astype(np.float32)
GRAIN = [np.random.default_rng(k).normal(0, 0.022, (H, W, 1)).astype(np.float32) for k in range(6)]
LOWER = np.clip((yy - H * 0.55) / (H * 0.35), 0, 1)[..., None] ** 1.4

# ---------------------------------------------------------------- photos (warm cinematic grade)
def grade(im, warmth=1.0, mono=0.0):
    x = np.asarray(im.convert("RGB")).astype(np.float32) / 255
    x = np.clip((x - 0.5) * 1.08 + 0.5, 0, 1); lum = (x * np.array([0.299, 0.587, 0.114])).sum(2, keepdims=True)
    x = lum + (x - lum) * (0.75 * (1 - mono)); x = x * np.array([1.0 + 0.06 * warmth, 1.0 + 0.01 * warmth, 1.0 - 0.08 * warmth])
    x = x ** 1.05
    return np.clip(x, 0, 1).astype(np.float32)
def load(name): return Image.open(f"{R}/{name}").convert("RGB")
ART = load("mohamed_elamin_commons.png")
# upscale the small archive photo once (Lanczos + gentle sharpen), it is shown as a framed print, never full-bleed
ART_UP = ART.resize((ART.width * 3, ART.height * 3), Image.LANCZOS).filter(ImageFilter.UnsharpMask(2.0, 60, 3))
PH = {"nile": load("wad_medani_blue_nile.jpg"), "road": load("wad_madani_road_rain.jpg"), "road1": load("wad_madani_road.jpg")}
_g = {}
def gimg(key, warmth=1.0, mono=0.0):
    k = (key, warmth, mono)
    if k not in _g: _g[k] = grade(ART_UP if key == "art" else PH[key], warmth, mono)
    return _g[k]

def cover(fr, key, u, z0, z1, fx=0.5, fy=0.5, dim=1.0, mono=0.0):
    x = gimg(key, 1.0, mono); ih, iw = x.shape[:2]
    z = lerp(z0, z1, eio(u)); s = max(W / iw, H / ih) * z
    cw, ch = W / s, H / s; cx = fx * iw; cy = fy * ih
    x0 = clamp(cx - cw / 2, 0, iw - cw); y0 = clamp(cy - ch / 2, 0, ih - ch)
    im = Image.fromarray((x * 255).astype(np.uint8)).crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((W, H), Image.BILINEAR)
    fr[:] = np.asarray(im).astype(np.float32) / 255 * dim

_blur = {}
def print_photo(fr, u, z0, z1, dim=1.0, mono=0.0, cx=None, cy=None, wfrac=None, tilt=0.0):
    """The archive photo as a framed print over its own blurred, darkened extension."""
    x = gimg("art", 1.0, mono); kb = (mono,)
    if kb not in _blur:
        _blur[kb] = np.asarray(Image.fromarray((x * 255).astype(np.uint8)).resize((W, H)).filter(ImageFilter.GaussianBlur(40))).astype(np.float32) / 255
    fr[:] = _blur[kb] * 0.32 * dim
    z = lerp(z0, z1, eio(u)); wfrac = wfrac or L(0.92, 0.46)
    pw = int(W * wfrac * z); ph = int(pw * x.shape[0] / x.shape[1])
    im = Image.fromarray((x * 255).astype(np.uint8)).resize((pw, ph), Image.BILINEAR)
    a = np.asarray(im).astype(np.float32) / 255 * dim
    cx = W / 2 if cx is None else cx; cy = L(H * 0.36, H * 0.40) if cy is None else cy
    x0, y0 = int(cx - pw / 2), int(cy - ph / 2); b = 14
    rect(fr, x0 - b, y0 - b, x0 + pw + b, y0 + ph + b, np.array([0.93, 0.89, 0.82], np.float32) * dim, 1.0)
    sx0, sy0 = max(0, x0), max(0, y0); sub = a[sy0 - y0:sy0 - y0 + H - sy0, sx0 - x0:sx0 - x0 + W - sx0]
    fr[sy0:sy0 + sub.shape[0], sx0:sx0 + sub.shape[1]] = sub

# ---------------------------------------------------------------- maps (Natural Earth; Sudan per its official position, Halaib included)
NE = json.load(open(f"{S}/haroun/dl_map/ne50.geojson"))
SDN = json.load(open(f"{S}/haroun/work/africa_sudan_official.json"))["SDN"]
def polys(g): return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
def make_map(lon0, lon1, lat0, lat1, rect_, hl, hl2=(), fill_other=(46, 40, 34, 255)):
    X0, Y0, X1, Y1 = rect_; sx = (X1 - X0) / (lon1 - lon0); sy = (Y1 - Y0) / (lat1 - lat0); s = min(sx, sy)
    ox = X0 + ((X1 - X0) - s * (lon1 - lon0)) / 2; oy = Y0 + ((Y1 - Y0) - s * (lat1 - lat0)) / 2
    def P(lon, lat): return (ox + (lon - lon0) * s, oy + (lat1 - lat) * s)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for f in NE["features"]:
        code = f["properties"]["ADM0_A3"]
        if code in ("SDN", "ATA"): continue
        col = (201, 162, 92, 235) if code in hl else ((120, 92, 60, 235) if code in hl2 else fill_other)
        for p in polys(f["geometry"]):
            pts = [P(*c) for c in p[0]]
            if len(pts) > 2: d.polygon(pts, fill=col, outline=(20, 18, 16, 255))
    for p in polys(SDN):
        pts = [P(*c) for c in p[0]]
        if len(pts) > 2: d.polygon(pts, fill=(201, 162, 92, 255) if "SDN" in hl else (150, 110, 70, 255), outline=(240, 230, 212, 255), width=2)
    a = np.asarray(im).astype(np.float32) / 255
    return np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2), P
MAP_W, PW = make_map(-100, 50, -5, 62, L((40, 360, 1040, 1300), (160, 90, 1760, 960)), {"SDN", "USA"})
MAP_S, PS = make_map(21.5, 39.5, 8.5, 23.5, L((90, 330, 990, 1280), (560, 90, 1360, 930)), {"SDN"})
MAP_F, PF = make_map(-20, 62, 8, 64, L((30, 380, 1050, 1250), (300, 140, 1620, 860)), {"DZA", "RUS", "NLD", "DEU", "QAT", "BHR"}, {"SDN"})

# ---------------------------------------------------------------- graphic devices
def oud_strings(fr, t, t0, alpha=1.0, energy=1.0):
    """Abstract oud: six double courses vibrating in warm light, with a geometric rosette (design, not footage)."""
    if alpha <= 0: return
    cy0 = L(H * 0.40, H * 0.42); gap = L(46, 40); xs = np.arange(0, W, 3, dtype=np.float32)
    for k in range(6):
        y = cy0 + (k - 2.5) * gap; amp = energy * (5 + 3 * math.sin(t * 1.3 + k)) * math.exp(-((t - t0) % 1.6) * 1.2)
        disp = amp * np.sin(xs / W * math.pi) * np.sin(t * (40 + 7 * k))
        for dd in (-5, 5):
            ys = (y + dd + disp).astype(int)
            for g, a_ in ((3, 0.18), (1, 0.85)):
                for o in range(-g, g + 1):
                    yy_ = np.clip(ys + o, 0, H - 1); fr[yy_, xs.astype(int)] = fr[yy_, xs.astype(int)] * (1 - a_ * alpha) + GOLD * a_ * alpha
    # rosette
    rx, ry = L((W / 2, H * 0.40 - 420), (W * 0.18, H * 0.42))
    r = L(150, 170); n = 12
    for i in range(n):
        ang = 2 * math.pi * i / n + t * 0.05
        for rr in np.linspace(r * 0.35, r, 28):
            x = int(rx + rr * math.cos(ang)); y = int(ry + rr * math.sin(ang))
            if 0 <= x < W - 2 and 0 <= y < H - 2: fr[y:y + 2, x:x + 2] = fr[y:y + 2, x:x + 2] * (1 - 0.6 * alpha) + GOLD * 0.6 * alpha
    for rr in (r * 0.35, r * 0.7, r):
        for i in range(240):
            ang = 2 * math.pi * i / 240; x = int(rx + rr * math.cos(ang)); y = int(ry + rr * math.sin(ang))
            if 0 <= x < W - 2 and 0 <= y < H - 2: fr[y:y + 2, x:x + 2] = fr[y:y + 2, x:x + 2] * (1 - 0.7 * alpha) + GOLD * 0.7 * alpha

def title(fr, t, t0, t1, txt, y, size, color=GOLD_L, fname="amiri", maxw=None, rise=30):
    a = fade(t, t0, t1, 1.0, 0.8)
    if not a: return
    sp = text(txt, size, color, fname, maxw=maxw or L(980, 1600)); blit(fr, sp, W / 2, y + rise * (1 - eo((t - t0) / 1.2)), a)

def rule(fr, t, t0, t1, y, w=None):
    a = fade(t, t0, t1, 0.8, 0.5)
    if not a: return
    w = (w or L(520, 640)) * eo((t - t0) / 1.2); rect(fr, W / 2 - w / 2, y, W / 2 + w / 2, y + 3, GOLD, a)

def caption(fr, t, t0, t1, txt, y=None):
    a = fade(t, t0, t1, 0.5, 0.4)
    if not a: return
    sp = text(txt, L(28, 26), (205, 190, 165), "tajm"); y = y or (H - L(70, 44))
    blit(fr, sp, L(W / 2, W - 60 - sp.shape[1] / 2), y, a * 0.9)

def card(fr, t, t0, t1, top, main, sub, cx, cy, wcard=None, gold_top=True):
    a = fade(t, t0, t1, 0.6, 0.5)
    if not a: return
    wcard = wcard or L(860, 520); slide = 40 * (1 - eo((t - t0) / 0.7))
    st = text(top, L(34, 30), GOLD_L if gold_top else CREAM, "tajx", maxw=wcard - 60)
    sm = text(main, L(46, 40), CREAM, "taj", maxw=wcard - 60, spacing=8)
    ss = text(sub, L(28, 25), (180, 168, 150), "tajm", maxw=wcard - 60) if sub else None
    h = st.shape[0] + sm.shape[0] + (ss.shape[0] + 14 if ss is not None else 0) + 64
    x0, y0 = cx - wcard / 2 + slide, cy - h / 2
    rect(fr, x0, y0, x0 + wcard, y0 + h, np.array([0.07, 0.06, 0.05], np.float32), 0.86 * a); rect(fr, x0 + wcard - 6, y0, x0 + wcard, y0 + h, GOLD, a)
    c = y0 + 26 + st.shape[0] / 2; blit(fr, st, cx + slide, c, a); c += st.shape[0] / 2 + 12 + sm.shape[0] / 2; blit(fr, sm, cx + slide, c, a)
    if ss is not None: blit(fr, ss, cx + slide, c + sm.shape[0] / 2 + 12 + ss.shape[0] / 2, a)

def song(fr, t, t0, t1, name, y, size=None, sub=None):
    a = fade(t, t0, t1, 0.35, 0.4)
    if not a: return
    sc = 1.0 + 0.08 * (1 - eo((t - t0) / 0.5)); size = size or L(92, 96)
    sp = text("«" + name + "»", int(size * sc), GOLD_L, "amiri", maxw=L(1000, 1700)); blit(fr, sp, W / 2, y, a)
    if sub: blit(fr, text(sub, L(32, 30), (200, 186, 160), "tajm"), W / 2, y + sp.shape[0] / 2 + 34, a)

def medal(fr, t, t0, t1, cx, cy, big, label, sub):
    a = fade(t, t0, t1, 0.6, 0.5)
    if not a: return
    r = L(100, 96) * eo((t - t0) / 0.6)
    for i in range(int(2 * math.pi * r * 1.2)):
        ang = 2 * math.pi * i / (2 * math.pi * r * 1.2)
        for dr in range(0, 4):
            x = int(cx + (r - dr) * math.cos(ang)); y = int(cy + (r - dr) * math.sin(ang))
            if 0 <= x < W and 0 <= y < H: fr[y, x] = fr[y, x] * (1 - a) + GOLD * a
    blit(fr, text(big, L(54, 54), GOLD_L, "amiri"), cx, cy - 6, a)
    blit(fr, text(label, L(30, 30), CREAM, "tajx", maxw=L(300, 420)), cx, cy + r + 46, a)
    if sub: blit(fr, text(sub, L(26, 26), (185, 172, 150), "tajm", maxw=L(300, 420)), cx, cy + r + L(110, 92), a)

def counter(fr, t, t0, t1, val, y, suffix):
    a = fade(t, t0, t1, 0.5, 0.5)
    if not a: return
    v = int(round(val * eo((t - t0) / 1.6)))
    blit(fr, text(f"+{v}", L(200, 190), GOLD_L, "oswald", wght=500, ar=False), W / 2, y, a)
    blit(fr, text(suffix, L(46, 44), CREAM, "tajx"), W / 2, y + L(150, 140), a)

def narr(fr, t):
    for s0, s1, txt in NARR:
        if s0 <= t < s1:
            a = min(1, (t - s0) / 0.35, (s1 - t) / 0.3); y = L(1500, H - 150); mw = L(940, 1500); sz = L(48, 46)
            parts = txt.split("|")
            if len(parts) < 3:
                blit(fr, text(txt, sz, CREAM, "taj", maxw=mw, stroke=2, spacing=8), W / 2, y, a); return
            full = parts[0].strip() + " " + parts[1].strip() + " " + parts[2].strip()
            blit(fr, text(full.strip(), sz, CREAM, "taj", maxw=mw, stroke=2, spacing=8), W / 2, y, a)
            hl = text(parts[1].strip(), L(40, 38), (20, 16, 12), "tajx")
            hy = y - text(full.strip(), sz, CREAM, "taj", maxw=mw, stroke=2, spacing=8).shape[0] / 2 - L(52, 46)
            rect(fr, W / 2 - hl.shape[1] / 2 - 18, hy - hl.shape[0] / 2 - 10, W / 2 + hl.shape[1] / 2 + 18, hy + hl.shape[0] / 2 + 10, GOLD, 0.95 * a)
            blit(fr, hl, W / 2, hy, a); return

LOGO = Image.open(f"{S}/assets/logo_white.png").convert("RGBA")
def logo(h):
    k = ("logo", h)
    if k not in _c:
        im = LOGO.resize((int(LOGO.width * h / LOGO.height), h), Image.LANCZOS); a = np.asarray(im).astype(np.float32) / 255
        _c[k] = np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2)
    return _c[k]

# ---------------------------------------------------------------- narration (from the article; condensed, meaning unchanged)
NARR = [
 (21.0, 26.8, "في الثاني عشر من نوفمبر 2023.. رحل الموسيقار والمطرب |محمد الأمين حمد النيل|"),
 (27.0, 32.8, "في أحد مستشفيات ولاية فرجينيا بالولايات المتحدة الأمريكية"),
 (33.0, 38.8, "لم يكن رحيله حدثاً عادياً.. فقد غاب صوت |ارتبط بتاريخ السودان الحديث|"),
 (39.0, 44.6, "وفقدت الأغنية السودانية |واحداً من أبرز مجدديها|"),
 (45.6, 50.8, "وُلد في قرية ود النعيم، بالقرب من |ود مدني| بولاية الجزيرة"),
 (51.0, 56.8, "بتأثير من خاله |بله يوسف الأزيرق|.. تعلّم المزمار ثم اتجه إلى العود"),
 (57.0, 61.8, "وأجاد العود وهو في |الثانية عشرة| من عمره"),
 (62.0, 67.8, "في 1960 التحق بالفرقة الموسيقية لشرطة النيل الأزرق، بقيادة |محمد آدم المنصوري|"),
 (68.0, 74.6, "وفي 1962 انتقل إلى |الخرطوم|.. لتبدأ مرحلة جديدة وسط منافسة فنية قوية"),
 (75.6, 81.8, "وكانت «وحياة ابتسامتك» من المحطات المبكرة |التي لفتت الانتباه إلى موهبته|"),
 (82.0, 88.8, "خاصة قدرته على توظيف |العود في المقدمات الموسيقية| والعزف المنفرد"),
 (89.0, 95.8, "ثم برز اسمه أكثر مع «أنا وحبيبي».. التي عُرفت أيضاً باسم |«يا حاسدين غرامنا»|"),
 (96.0, 104.6, "كان يدرك أن نجاح الأغنية |يبدأ من الكلمة| التي تحمل الفكرة والصورة والإحساس"),
 (105.6, 111.4, "وشكّلت |ثورة أكتوبر 1964| محطة مفصلية في مسيرته"),
 (111.6, 117.4, "حين قدّم نشيد «أكتوبر 21» من كلمات الشاعر |فضل الله محمد|"),
 (117.6, 123.8, "نشيد تفاعل مع الثورة التي أطاحت بنظام الفريق إبراهيم عبود.. واستلهم |استشهاد الطالب أحمد القرشي طه|"),
 (124.0, 129.8, "ومن هنا بدأت |واحدة من أنجح الثنائيات| في تاريخ الأغنية السودانية"),
 (130.0, 139.6, "ثم قدّم ملحمة «قصة ثورة» من كلمات |هاشم صديق|.. المعروفة شعبياً باسم «الملحمة»"),
 (140.6, 146.8, "وارتبط اسمه بأبرز الشعراء: فضل الله محمد، هاشم صديق، |محجوب شريف، بدوي بانقا|"),
 (170.0, 174.6, "أغنيات |ظلت حاضرة في ذاكرة الأجيال|"),
 (175.6, 181.4, "لم يكن مطرباً يعتمد على جمال صوته فحسب.. |كان موسيقاراً يمتلك أدواته|"),
 (181.6, 187.4, "صوت ينتقل بين الطبقات.. ويطيل الجملة الغنائية |دون أن يفقد الإحساس|"),
 (187.6, 193.4, "وفي حفلاته.. ينتظر الجمهور |مقدماته الموسيقية| ويردد الكلمات معه"),
 (193.6, 199.4, "جدّد الأغنية السودانية |انطلاقاً من معرفة عميقة بالموروث|.. لا قطيعة معه"),
 (199.6, 204.6, "وشارك في مهرجانات داخل السودان وخارجه.. |في الجزائر وموسكو وهولندا وألمانيا وقطر والبحرين|"),
 (205.6, 211.4, "ترك أكثر من خمسين عملاً فنياً.. |وفق تقارير تناولت تجربته|"),
 (211.6, 217.8, "ونال |وسام الآداب والفنون|، والدكتوراه الفخرية من جامعة النيلين عام 2010"),
 (218.0, 224.6, "ووسام الاستحقاق في ذكرى استقلال السودان |عام 2014|"),
 (225.4, 230.4, "رحل محمد الأمين.. لكن |أغنياته لم ترحل معه|"),
]
SONGS = ["قلنا ما ممكن تسافر", "زاد الشجون", "الجريدة", "أسمر يا ساحر المنظر", "بتتعلم من الأيام", "طائر الأحلام", "عويناتك", "ذات الشامة", "خمسة سنين"]
BEAT = 60 / 112.0; SONG_T0 = 147.5; SONG_STEP = 5 * BEAT   # titles land on the groove (score: 112 bpm from 140 s)
CUTS = [20.0, 33.0, 45.0, 51.0, 62.0, 75.0, 96.0, 105.0, 140.0, 147.0, 170.0, 175.0, 199.6, 205.0, 225.0]

def make_frame(t):
    fr = np.zeros((H, W, 3), np.float32); fr[:] = INK
    # ---------------- picture
    if t < 20.0:
        a = fade(t, 2.0, 25, 3.5, 0.5); print_photo(fr, t / 20, 1.0, 1.08, dim=a * 0.9, mono=0.25)
    elif t < 33.0:
        a = fade(t, 20.2, 40, 1.0, 0.5); blit(fr, MAP_W, W / 2, H / 2, a)
        x0, y0 = PW(33.5, 14.4); x1, y1 = PW(-77.05, 38.8); g = eo((t - 21.5) / 4.5)
        for i in range(int(160 * g)):
            u = i / 160; x = lerp(x0, x1, u); y = lerp(y0, y1, u) - math.sin(math.pi * u) * L(260, 230)
            rect(fr, x - 3, y - 3, x + 3, y + 3, np.array(GOLD_L, np.float32) / 255, a)
        for (x, y, lab) in ((x0, y0, "ود مدني"), (x1, y1, "فرجينيا")):
            r = 9 + 3 * math.sin(t * 5); rect(fr, x - r, y - r, x + r, y + r, np.array(CREAM, np.float32) / 255, a)
            blit(fr, text(lab, L(38, 36), CREAM, "tajx", stroke=3), x, y + L(48, 44), a)
    elif t < 45.0: print_photo(fr, (t - 33) / 12, 1.04, 1.12, dim=0.85, mono=0.55)
    elif t < 51.0:
        a = fade(t, 45.1, 60, 0.8, 0.5); blit(fr, MAP_S, W / 2, H / 2, a)
        x, y = PS(33.52, 14.3); r = 11 + 4 * math.sin(t * 5); rect(fr, x - r, y - r, x + r, y + r, np.array(CREAM, np.float32) / 255, a)
        blit(fr, text("ود النعيم – قرب ود مدني", L(40, 38), CREAM, "tajx", stroke=3), x, y - L(56, 52), a)
    elif t < 62.0: cover(fr, "nile", (t - 51) / 11, 1.0, 1.15, fx=0.48, fy=0.55, dim=0.8)
    elif t < 75.0: cover(fr, "road", (t - 62) / 13, 1.05, 1.18, fx=0.5, fy=0.4, dim=0.35)
    elif t < 96.0:
        fr[:] = INK + BROWN * 0.25 * (1 - np.clip(np.abs(yy - H * 0.4) / (H * 0.5), 0, 1))[..., None]
        oud_strings(fr, t, 75.0, fade(t, 75.1, 96, 1.0, 0.5), 1.0)
    elif t < 105.0: print_photo(fr, (t - 96) / 9, 1.05, 1.14, dim=0.8, mono=0.15)
    elif t < 140.0:
        fr[:] = INK + BROWN * 0.18 * (1 - np.clip(np.abs(yy - H * 0.35) / (H * 0.6), 0, 1))[..., None]
    elif t < 147.0: fr[:] = INK
    elif t < 170.0:
        fr[:] = INK + BROWN * 0.22 * (1 - np.clip(np.abs(yy - H * 0.42) / (H * 0.5), 0, 1))[..., None]
        k = int((t - SONG_T0) / SONG_STEP); beat_phase = ((t - 140.0) % BEAT) / BEAT
        oud_strings(fr, t, SONG_T0 + k * SONG_STEP, 0.35 * fade(t, 147.1, 170, 0.6, 0.5), 0.6 + 0.4 * (1 - beat_phase))
    elif t < 175.0: print_photo(fr, (t - 170) / 5, 1.1, 1.16, dim=0.85, mono=0.1)
    elif t < 199.6:
        fr[:] = INK + BROWN * 0.25 * (1 - np.clip(np.abs(yy - H * 0.4) / (H * 0.5), 0, 1))[..., None]
        oud_strings(fr, t, 175.0 + int((t - 175) / 2.4) * 2.4, fade(t, 175.1, 199.6, 0.8, 0.4), 1.2)
    elif t < 205.0:
        a = fade(t, 199.7, 210, 0.7, 0.5); blit(fr, MAP_F, W / 2, H / 2, a)
    elif t < 225.0:
        fr[:] = INK + BROWN * 0.15 * (1 - np.clip(np.abs(yy - H * 0.45) / (H * 0.6), 0, 1))[..., None]
    else:
        a = fade(t, 225.1, DUR, 1.2, 1.4); print_photo(fr, (t - 225) / 15, 1.0, 1.1, dim=a * lerp(0.9, 0.22, clamp((t - 233.5) / 2.5)), mono=lerp(0.3, 1.0, clamp((t - 228) / 4)))
    for tw in CUTS:
        d = abs(t - tw)
        if d < 0.25: fr = fr * (0.55 + 0.45 * d / 0.25)   # soft dip, no flashy transitions
    fr = fr * (1 - 0.6 * LOWER)
    # ---------------- graphics
    if t < 20.0:
        title(fr, t, 6.0, 13.2, "محمد الأمين.. قلنا ما ممكن تسافر", L(1180, H * 0.80), L(84, 92))
        rule(fr, t, 7.0, 13.2, L(1290, H * 0.80 + 70))
        title(fr, t, 13.6, 19.6, "غاب الباشكاتب.. وبقي اللحن", L(1200, H * 0.80), L(80, 86), color=CREAM)
        title(fr, t, 14.6, 19.6, "عن مقال: صلاح الدين عبد الحفيظ", L(1310, H * 0.80 + 80), L(34, 32), color=(190, 175, 150), fname="tajm", rise=0)
        if t > 2.5: caption(fr, t, 3.0, 19.6, "محمد الأمين على المسرح (أرشيف · ويكيميديا كومنز)")
    elif t < 33.0:
        title(fr, t, 21.0, 32.6, "12 نوفمبر 2023", L(250, 120), L(72, 68), fname="oswald" if False else "amiri")
        caption(fr, t, 20.5, 32.8, "خريطة: Natural Earth · السودان بحدوده الرسمية")
    elif t < 45.0:
        caption(fr, t, 33.2, 44.8, "محمد الأمين على المسرح (أرشيف · ويكيميديا كومنز)")
    elif t < 51.0:
        title(fr, t, 45.3, 50.8, "البدايات", L(220, 90), L(70, 64))
    elif t < 62.0:
        card(fr, t, 51.3, 61.8, "الخال", "بله يوسف الأزيرق", "جذبه إلى عالم العزف", L(W / 2, W * 0.24), L(420, H * 0.30))
        card(fr, t, 53.5, 61.8, "المزمار ثم العود", "أجاد العود في الثانية عشرة", "مدرسة الشرقية بود مدني", L(W / 2, W * 0.24), L(680, H * 0.62))
        caption(fr, t, 51.3, 61.8, "ود مدني – النيل الأزرق (صورة حديثة، 2008)")
    elif t < 75.0:
        for i, (yr, main, sub) in enumerate([("1960", "الفرقة الموسيقية لشرطة النيل الأزرق", "بقيادة الموسيقار محمد آدم المنصوري"), ("1962", "الانتقال إلى الخرطوم", "مرحلة جديدة وسط منافسة فنية قوية")]):
            t0 = 62.3 + i * 6.0; a = fade(t, t0, 74.8, 0.6, 0.5)
            if a:
                cy = L(380 + i * 380, H * (0.32 + i * 0.32)); cx = L(W / 2, W * 0.5)
                blit(fr, text(yr, L(120, 120), GOLD_L, "oswald", wght=500, ar=False), cx, cy - L(60, 50), a)
                blit(fr, text(main, L(46, 46), CREAM, "tajx", maxw=L(940, 1300)), cx, cy + L(50, 50), a)
                blit(fr, text(sub, L(32, 30), (190, 176, 152), "tajm", maxw=L(940, 1300)), cx, cy + L(110, 104), a)
        rule(fr, t, 62.3, 74.8, L(700, H * 0.48))
        caption(fr, t, 62.3, 74.8, "طريق في ود مدني (صورة حديثة، 2019)")
    elif t < 96.0:
        song(fr, t, 76.0, 88.8, "وحياة ابتسامتك", L(860, 190), sub="من المحطات المبكرة")
        song(fr, t, 89.2, 95.8, "أنا وحبيبي", L(800, 190), sub="عُرفت أيضاً باسم «يا حاسدين غرامنا»")
        caption(fr, t, 75.5, 95.8, "تصميم توضيحي: أوتار العود")
    elif t < 105.0:
        caption(fr, t, 96.2, 104.8, "محمد الأمين على المسرح (أرشيف · ويكيميديا كومنز)")
    elif t < 140.0:
        title(fr, t, 105.4, 123.8, "21 أكتوبر 1964", L(330, 200), L(120, 120))
        rule(fr, t, 106.0, 123.8, L(430, 290))
        a = fade(t, 106.5, 123.8, 0.8, 0.5)
        if a: blit(fr, text("ثورة شعبية أطاحت بنظام الفريق إبراهيم عبود", L(40, 40), CREAM, "tajm", maxw=L(960, 1500)), W / 2, L(500, 350), a)
        card(fr, t, 111.8, 129.8, "الشاعر", "فضل الله محمد", "نشيد «أكتوبر 21»", L(W / 2, W * 0.70), L(720, H * 0.62))
        card(fr, t, 118.0, 123.8, "الشهيد", "أحمد القرشي طه", "استلهم النشيد استشهاده", L(W / 2, W * 0.30), L(1010, H * 0.62))
        card(fr, t, 124.2, 129.8, "ثنائية", "محمد الأمين × فضل الله محمد", "من أنجح الثنائيات في تاريخ الأغنية السودانية", L(W / 2, W * 0.30), L(1010, H * 0.62), wcard=L(900, 620))
        song(fr, t, 130.2, 139.6, "قصة ثورة", L(680, H * 0.47), size=L(110, 110), sub="«الملحمة» · كلمات الشاعر هاشم صديق · شارك فيها عدد من المطربين")
        caption(fr, t, 105.5, 139.6, "تصميم طباعي · لا تتوفر لدينا صور أرشيفية مرخصة للثورة")
    elif t < 147.0:
        title(fr, t, 140.4, 146.8, "شعراء رفدوا تجربته", L(260, 140), L(64, 60))
        for i, nm in enumerate(["فضل الله محمد", "هاشم صديق", "محجوب شريف", "بدوي بانقا"]):
            a = fade(t, 141.0 + i * 0.6, 146.8, 0.5, 0.4)
            if a:
                cx, cy = L((W / 2, 440 + i * 170), (W * (0.80 - i * 0.20), H * 0.48))
                blit(fr, text(nm, L(58, 52), GOLD_L if i == 0 else CREAM, "amiri"), cx, cy, a)
    elif t < 170.0:
        a = fade(t, 147.1, 170, 0.5, 0.4)
        if a: blit(fr, text("من أشهر أعماله", L(40, 38), (200, 186, 160), "tajx"), W / 2, L(250, 130), a)
        for i, s in enumerate(SONGS):
            t0 = SONG_T0 + i * SONG_STEP; song(fr, t, t0, t0 + SONG_STEP - 0.05, s, L(820, H * 0.48), size=L(110, 120))
        a = fade(t, SONG_T0, 170, 0.5, 0.4)
        if a:   # progress dots
            n = len(SONGS); k = min(n - 1, int((t - SONG_T0) / SONG_STEP))
            for i in range(n):
                x = W / 2 + (i - (n - 1) / 2) * 34; y = L(1080, H * 0.72)
                rect(fr, x - 6, y - 6, x + 6, y + 6, GOLD if i <= k else np.array([0.3, 0.27, 0.23], np.float32), a)
    elif t < 175.0:
        caption(fr, t, 170.2, 174.8, "محمد الأمين على المسرح (أرشيف · ويكيميديا كومنز)")
    elif t < 199.6:
        title(fr, t, 175.4, 199.4, "عبقرية الموسيقار", L(800, 120), L(76, 70))
        items = ["التلحين", "العزف على العود", "التحكم في الطبقات", "المقدمات الطويلة", "التفاعل مع الجمهور", "التجديد"]
        for i, it in enumerate(items):
            a = fade(t, 176.5 + i * 2.6, 199.4, 0.5, 0.4)
            if a:
                cx, cy = L((W * (0.73 - 0.46 * (i % 2)), 960 + (i // 2) * 100), (W * (0.885 - 0.154 * i), 690))
                blit(fr, text(it, L(38, 34), CREAM, "tajx"), cx, cy, a)
        caption(fr, t, 175.5, 199.4, "تصميم توضيحي: أوتار العود")
    elif t < 205.0:
        title(fr, t, 199.8, 204.8, "مهرجانات خارج السودان", L(260, 70), L(60, 56), rise=0)
        caption(fr, t, 199.8, 204.8, "خريطة: Natural Earth")
    elif t < 225.0:
        title(fr, t, 205.4, 224.6, "البصمة والتكريم", L(220, 110), L(70, 64))
        counter(fr, t, 205.8, 224.6, 50, L(470, 290), "عملاً فنياً")
        med = [("وسام", "وسام الآداب والفنون", ""), ("2010", "الدكتوراه الفخرية", "جامعة النيلين"), ("2014", "وسام الاستحقاق", "في ذكرى استقلال السودان")]
        for i, (big, lab, sub) in enumerate(med):
            t0 = [211.8, 213.6, 218.2][i]
            cx, cy = L((W * [0.80, 0.5, 0.20][i], 880), (W * [0.72, 0.5, 0.28][i], 590))
            medal(fr, t, t0, 224.6, cx, cy, big, lab, sub)
    else:
        title(fr, t, 230.6, 234.3, "يرحل الجسد.. ويبقى اللحن", L(H * 0.62, H * 0.80), L(84, 90))
        title(fr, t, 234.5, DUR, "رحم الله الباشكاتب محمد الأمين", L(H * 0.40, H * 0.36), L(70, 74), color=CREAM)
        a = fade(t, 235.4, DUR, 0.8, 0.6)
        if a:
            blit(fr, logo(L(150, 130)), W / 2, L(H * 0.52, H * 0.56), a)
            blit(fr, text("إنتاج وثائقي | صحيفة ألوان السودانية", L(40, 38), GOLD_L, "tajx"), W / 2, L(H * 0.52 + 130, H * 0.56 + 115), a)
    narr(fr, t)
    if 2.0 < t < 234.4: blit(fr, logo(L(56, 50)), W - L(70, 80) - logo(L(56, 50)).shape[1] / 2, L(100, 70), 0.45)
    fr = fr * VIG + GRAIN[int(t * FPS) % 6]
    fr = fr * np.array([1.02, 1.0, 0.96], np.float32)    # warm overall tone
    if t < 0.5: fr *= t / 0.5
    if t > DUR - 1.0: fr *= max(0, (DUR - t) / 1.0)
    return fr

def to8(f): return (np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8)
if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    if PREVIEW:
        for t in PREVIEW: Image.fromarray(to8(make_frame(t))).save(f"{OUT}/{ORI}_{t:06.2f}.png")
        sys.exit()
    NF = int(round(DUR * FPS)); NW = 4
    if "_" in WORKER:   # partial re-render: wA_B_k renders frames [A, B) split into 4
        A, B_, k = [int(x) for x in WORKER[1:].split("_")]; b = [A + round((B_ - A) * i / NW) for i in range(NW + 1)]
    else:
        k = int(WORKER[1:]); b = [round(NF * i / NW) for i in range(NW + 1)]
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-threads", "1", "-pix_fmt", "yuv420p", (f"{OUT}/part_{k}.mp4" if "_" in WORKER else f"{OUT}/seg_{k}.mp4")], stdin=subprocess.PIPE)
    for fi in range(b[k], b[k + 1]):
        p.stdin.write(to8(make_frame(fi / FPS)).tobytes())
        if fi % 150 == 0: print(f"w{k} {fi}/{b[k + 1]}", flush=True)
    p.stdin.close(); p.wait(); print(f"w{k} DONE", flush=True)
