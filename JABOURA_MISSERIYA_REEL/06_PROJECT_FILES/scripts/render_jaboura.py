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


# ---------------------------------------------------------------- media
DUR = 105.0
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


# ---------------------------------------------------------------- Jaboura media (Al-Hadath inner broadcast frame; Al-Hadath bug kept visible)
JX = f"{S}/jaboura"
class Sots:
    def __init__(s, path):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        s.fr = np.frombuffer(raw, np.uint8).reshape(-1, 464, 1080, 3); s.fps = 25.0; s.cache = {}
    def frame(s, t, zoom=1.0, mono=False):
        i = min(len(s.fr) - 1, max(0, int(round(t * s.fps)))); key = (i, round(zoom, 3), mono)
        if key in s.cache: return s.cache[key]
        im = Image.fromarray(s.fr[i])
        if zoom > 1.0:   # anchored top-right so the broadcaster's bug is never cropped
            cw, ch = int(1080 / zoom), int(464 / zoom); im = im.crop((1080 - cw, 0, 1080, ch))
        im = im.resize((1080, 464), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.4, 45, 2))
        x = np.asarray(im).astype(np.float32) / 255
        x = np.clip((x - 0.5) * 1.06 + 0.5, 0, 1)
        if mono:
            lum = (x * np.array([0.299, 0.587, 0.114])).sum(2, keepdims=True); x = lum + (x - lum) * 0.2
        s.cache = {key: x}; return x
V = Sots(f"{JX}/sots.mkv")
SEG = {"DECL": 0.0, "INTRO": 12.72, "APOL": 23.12, "FOREIGN": 34.32, "BROLL": 46.24}

def place_video(fr, src_t, zoom=1.0, y_c=740, dim=1.0, mono=False):
    img = V.frame(src_t, zoom, mono=mono)
    bg = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(28))).astype(np.float32) / 255
    fr[:] = bg * 0.42 * dim
    y0 = int(y_c - 232); fr[y0:y0 + 464] = img * dim
    rect(fr, 0, y0 - 4, W, y0, RED, 0.9 * dim); rect(fr, 0, y0 + 464, W, y0 + 468, RED, 0.9 * dim)

# ---------------------------------------------------------------- Sudan states map (Natural Earth admin-1; Halaib per Sudan's official position)
ST = json.load(open(f"{JX}/sudan_states.json"))
HAL = None
try:
    dis = json.load(open(f"{X}/dl_disputed/disputed.geojson"))
    HAL = next(f["geometry"] for f in dis["features"] if f["properties"]["NAME"] == "Halayib Triangle")
except Exception: pass
DARFUR = {"Central Darfur", "Eastern Darfur", "North Darfur", "Southern Darfur", "Western Darfur"}
KORD = {"North Kordufan", "South Kordufan"}
def states_map(mode):
    lon0, lat1, sc = 21.5, 23.6, 820 / 17.0
    def Pt(lon, lat): return (130 + (lon - lon0) * sc, 380 + (lat1 - lat) * sc)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    def poly(g, fill, outline, width):
        ps = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for p in ps:
            pts = [Pt(*c) for c in p[0]]
            if len(pts) > 2: d.polygon(pts, fill=fill, outline=outline)
            if len(pts) > 2: d.line(pts + [pts[0]], fill=outline, width=width)
    for name, g in ST.items():
        if mode == "central" and name == "Central Darfur": f = (215, 36, 41, 245)
        elif mode == "central" and name in DARFUR: f = (110, 110, 110, 235)
        elif mode == "dk" and name in DARFUR: f = (215, 36, 41, 230)
        elif mode == "dk" and name in KORD: f = (200, 120, 60, 230)
        else: f = (64, 64, 64, 225)
        poly(g, f, (20, 20, 20, 255), 2)
    if HAL: poly(HAL, (64, 64, 64, 225), (20, 20, 20, 255), 2)
    a = np.asarray(im).astype(np.float32) / 255
    return np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2), Pt
MAP_C, PT = states_map("central"); MAP_DK, _ = states_map("dk")
ZAL = np.asarray(Image.open("/home/user/Flare-Studio/JABOURA_MISSERIYA_REEL/03_ASSETS/DARFUR_KORDOFAN/zalingei_market_1961_a.jpg").convert("L").resize((1080, 1650), Image.LANCZOS)).astype(np.float32) / 255

CHIP = {"report": (np.array([230, 126, 34]) / 255, "خبر أولي"), "deny": (RED, "نفي"), "direct": (np.array([40, 110, 190]) / 255, "تصريح مباشر"),
        "unconf": (np.array([120, 120, 120]) / 255, "غير مؤكد")}
def chip(fr, t, t0, t1, kind, extra="", y=270):
    a = fade(t, t0, t1, 0.3, 0.25)
    if not a: return
    col, lab = CHIP[kind]; sp = T(lab + ("  |  " + extra if extra else ""), 38, 800, (255, 255, 255), "tajx")
    w = sp.shape[1] + 60; x1 = 540 + w / 2
    rect(fr, 540 - w / 2, y - 34, x1, y + 34, col.astype(np.float32), 0.95 * a)
    rect(fr, x1 - 14, y - 34, x1, y + 34, np.ones(3, np.float32), 0.9 * a)
    blit(fr, sp, 540 - 7, y, a)

def lower_third(fr, t, t0, t1, name, role, y=1215):
    a = fade(t, t0, t1, 0.35, 0.3)
    if not a: return
    sn = T(name, 50, 800, (255, 255, 255), "tajx"); sr = T(role, 32, 0, (40, 40, 40), "tajm")
    w = max(sn.shape[1], sr.shape[1]) + 70; x1 = W - 50; g = ease_out((t - t0) / 0.45)
    rect(fr, x1 - w * g, y - 46, x1, y + 30, CHAR, 0.92 * a); rect(fr, x1 - w * g, y + 30, x1, y + 82, GREY, 0.95 * a)
    rect(fr, x1 - 12, y - 46, x1, y + 82, RED, a)
    blit(fr, sn, x1 - 36 - sn.shape[1] / 2, y - 8, a * g); blit(fr, sr, x1 - 36 - sr.shape[1] / 2, y + 56, a * g)

def sub(fr, t, items, y=1410):
    for a0, a1, txt in items:
        if a0 <= t < a1:
            a = min(1, (t - a0) / 0.1, (a1 - t) / 0.1)
            blit(fr, T(txt, 54, 0, (255, 255, 255), "taj", maxw=940, stroke=3, spacing=8), 540, y, a)

CHIP["claim"] = (np.array([150, 90, 30]) / 255, "اتهام منسوب إليه")
CHIP["press"] = (np.array([230, 126, 34]) / 255, "بحسب تقارير صحفية")

# ---------------------------------------------------------------- timeline (seconds)
H1 = 12.72; T1 = 16.8; W1 = 27.0; I1 = 37.4; TS1 = 45.0; A1 = 56.2; F1 = 68.12; P1 = 78.5; L1 = 90.0; G1 = 99.0; Q1 = 102.6
CUTS = [H1, T1, W1, I1, TS1, A1, F1, P1, L1, G1, Q1]

SUBS = [  # verbatim (Whisper large-v3; obvious ASR slips corrected — see 04_SUBTITLES/QUOTES_AND_TIMINGS.md)
 (0.35, 1.9, "بدءاً من اليوم.."), (2.56, 6.6, "أعلن انشقاقي التام من ميليشيا الدعم السريع"), (7.17, 12.6, "وانضمامي الكامل لقوات الشعب المسلحة السودانية"),
 (27.40, 29.7, "أنا الأمير عمر عثمان جابورة"), (30.15, 33.5, "أمير عموم قبيلة المسيرية بولاية وسط دارفور"), (33.90, 37.2, "ووكيل ناظر عموم قبيلة المسيرية"),
 (45.31, 49.7, "وأقدّم الاعتذار للشعب السوداني العظيم"), (50.21, 56.0, "بما ارتُكب من جرائم وانتهاكات ضده"),
 (56.32, 60.6, "«..ما كان فيه من انتهاكات وجرائم"), (61.00, 67.9, "ارتكبتها الميليشيا بأيادٍ أجنبية وبأوامر أجنبية أيضاً»"),
]
NARR = [  # on-screen narration (no voiceover, per Alwan's decision)
 (17.0, 21.8, "يوم الخميس 12 نوفمبر، أعلن عمر عثمان جابورة انشقاقه عن |ميليشيا الدعم السريع| واصطفافه مع القوات المسلحة"),
 (22.0, 26.8, "جابورة من قيادات قبيلة المسيرية في |ولاية وسط دارفور|.. وأعلن موقفه في تسجيل مصوّر"),
 (37.6, 44.8, "وفي التسجيل نفسه، قدّم جابورة نفسه |عضواً في الحاضنة السياسية لتأسيس|.. التحالف الذي تقوده الميليشيا"),
 (68.4, 73.3, "وبحسب تقارير صحفية، دعا جابورة من جُنّدوا واستُنفروا من أبناء القبيلة |لمغادرة الميليشيا فوراً|"),
 (73.4, 78.3, "وناشد شباب المسيرية في |دارفور وكردفان|.. وهي عبارات لم ترد في المقطع الذي بثّته قناة الحدث"),
 (78.7, 84.2, "الإعلان جاء وسط موجة انشقاقات خلال 2026.. بينها |قادة ميدانيون وقوات كاملة|"),
 (84.3, 89.8, "لكن الفرق هذه المرة.. أن الإعلان صادر عن |زعيم قبلي| يخاطب أبناء قبيلته مباشرة"),
 (90.2, 98.8, "وحتى الآن.. لا استجابة موثقة للدعوة، ولا رد معلن من الميليشيا.. |والموقف موقف جابورة| لا موقف القبيلة كلها"),
]

def zal_bg(fr, t, t0, t1, dim=0.7):
    u = (t - t0) / max(1e-3, t1 - t0); off = int(lerp(0, 230, ease_io(u)))
    g = ZAL[off:off + H, :]
    if g.shape[0] < H: g = np.pad(g, ((0, H - g.shape[0]), (0, 0)), mode="edge")
    fr[:] = (g[..., None] * np.array([1.0, 0.97, 0.92], np.float32)) * dim

def make_frame(t):
    fr = np.zeros((H, W, 3), np.float32); fr[:] = INK
    # ---------------- picture
    if t < H1: place_video(fr, SEG["DECL"] + t, zoom=lerp(1.0, 1.1, ease_io(t / H1)), dim=lerp(0.2, 1.0, ease_out(t / 0.6)))
    elif t < T1: place_video(fr, SEG["BROLL"] + (t - H1), zoom=1.06, dim=0.22, mono=True)
    elif t < W1:
        if t < 22.0:
            fr[:] = INK; a = fade(t, H1 + 4.1, 22.0, 0.5, 0.35); blit(fr, MAP_C, 540, 960, a)
            x, y = PT(23.47, 12.9); r = 11 + 5 * math.sin(t * 6)
            rect(fr, x - r, y - r, x + r, y + r, np.ones(3, np.float32), a)
            blit(fr, T("وسط دارفور", 42, 800, (255, 255, 255), "tajx"), x + 30, y - 70, a)
        else: zal_bg(fr, t, 22.0, W1, 0.6)
    elif t < I1: place_video(fr, SEG["INTRO"] + (t - W1), zoom=lerp(1.0, 1.08, (t - W1) / (I1 - W1)))
    elif t < TS1: place_video(fr, SEG["BROLL"] + 2 + (t - I1) * 0.6, zoom=1.04, dim=0.25, mono=True)
    elif t < A1: place_video(fr, SEG["APOL"] + (t - TS1), zoom=lerp(1.04, 1.12, ease_io((t - TS1) / (A1 - TS1))))
    elif t < F1: place_video(fr, SEG["FOREIGN"] + (t - A1), zoom=lerp(1.0, 1.1, (t - A1) / (F1 - A1)))
    elif t < P1:
        fr[:] = INK; a = fade(t, A1 + 12.0, P1, 0.5, 0.35); blit(fr, MAP_DK, 540, 960, a)
        xd, yd = PT(24.5, 13.2); xk, yk = PT(30.2, 12.6)
        blit(fr, T("دارفور", 44, 800, (255, 255, 255), "tajx"), xd, yd, a); blit(fr, T("كردفان", 44, 800, (255, 255, 255), "tajx"), xk, yk, a)
    elif t < L1: fr[:] = INK; fr += np.asarray(Image.fromarray((V.frame(SEG["BROLL"] + 5, 1.0, mono=True) * 255).astype(np.uint8)).resize((W, H)).filter(ImageFilter.GaussianBlur(30))).astype(np.float32) / 255 * 0.15
    elif t < G1: zal_bg(fr, t, L1, G1, 0.35)
    elif t < Q1: place_video(fr, SEG["DECL"] + 11.0, zoom=lerp(1.0, 1.12, ease_io((t - G1) / (Q1 - G1))), dim=0.35, mono=True)
    else: fr[:] = INK
    for tw in CUTS:
        d = abs(t - tw)
        if d < 0.08:
            n = int(55 * (1 - d / 0.08)) + 1
            cs = np.cumsum(np.pad(fr, ((0, 0), (n, 0), (0, 0)), mode="edge"), 1); fr = (cs[:, n:] - cs[:, :-n]) / n
    fr = fr * (1 - 0.55 * BOTTOM)
    # ---------------- graphics
    if t < H1:
        chip(fr, t, 0.5, H1 - 0.1, "direct", "تسجيل مصوّر – 12 نوفمبر 2026")
        source(fr, t, 0.5, H1 - 0.1, "المصدر: قناة الحدث", 1700)
    elif t < T1:
        kicker(fr, t, H1 + 0.1, T1 - 0.1, "تقرير خاص | صحيفة ألوان السودانية", 760)
        big_q(fr, t, H1 + 0.15, T1 - 0.1, "انشقاق جديد يضرب صفوف الميليشيا", 950, 76)
        a = fade(t, H1 + 0.6, T1 - 0.1, 0.4, 0.2)
        if a: blit(fr, T("والإعلان هذه المرة من زعيم قبلي", 50, 0, (216, 218, 217), "tajm"), 540, 1100, a)
    elif t < W1:
        kicker(fr, t, T1 + 0.1, W1 - 0.1, "من هو جابورة؟", 190)
        if t >= 22.0: source(fr, t, 22.1, W1 - 0.1, "زالنجي، وسط دارفور – صورة أرشيفية (1961)", 1700)
    elif t < I1:
        lower_third(fr, t, W1 + 0.4, I1 - 0.1, "عمر عثمان جابورة", "أمير عموم قبيلة المسيرية بوسط دارفور – بحسب تعريفه لنفسه", y=1075)
        source(fr, t, W1 + 0.3, I1 - 0.1, "المصدر: قناة الحدث", 1700)
    elif t < TS1:
        chip(fr, t, I1 + 0.2, TS1 - 0.1, "direct", "من التسجيل نفسه")
        box_text(fr, t, I1 + 0.4, TS1 - 0.1, "عضو في «الحاضنة السياسية لتأسيس»", 860, 60, maxw=1000)
        a = fade(t, I1 + 0.8, TS1 - 0.1, 0.4, 0.2)
        if a: blit(fr, T("بحسب قوله في التسجيل", 36, 0, (216, 218, 217), "tajm"), 540, 990, a)
    elif t < A1:
        chip(fr, t, TS1 + 0.2, A1 - 0.1, "direct", "الاعتذار للشعب السوداني")
        source(fr, t, TS1 + 0.2, A1 - 0.1, "المصدر: قناة الحدث", 1700)
    elif t < F1:
        chip(fr, t, A1 + 0.2, F1 - 0.1, "claim")
        source(fr, t, A1 + 0.2, F1 - 0.1, "المصدر: قناة الحدث", 1700)
    elif t < P1:
        chip(fr, t, F1 + 0.2, P1 - 0.1, "press", "الوئام · عزة برس · المنشر")
    elif t < L1:
        kicker(fr, t, P1 + 0.1, L1 - 0.1, "انشقاقات 2026", 190)
        stamp_card(fr, t, P1 + 0.3, L1 - 0.1, "أبريل 2026", "النور القبة: قائد ميداني يعلن انضمامه للجيش", "سودان تربيون · الجزيرة نت", 290)
        stamp_card(fr, t, P1 + 1.3, L1 - 0.1, "مايو 2026", "السافنا: يغادر الميليشيا.. دون الانضمام لأي طرف", "سودان تربيون", 540)
        stamp_card(fr, t, P1 + 2.3, L1 - 0.1, "أغسطس 2026", "موسى خمسين: نحو 318 مقاتلاً ينضمون للجيش", "السوداني · الدستور", 790)
        stamp_card(fr, t, P1 + 3.3, L1 - 0.1, "نوفمبر 2026", "جابورة: زعيم قبلي يعلن انشقاقه", "قناة الحدث", 1040)
    elif t < G1:
        chip(fr, t, L1 + 0.2, G1 - 0.1, "unconf", "حتى 12 نوفمبر 2026", 700)
        box_text(fr, t, L1 + 0.5, G1 - 0.1, "لا استجابة موثقة للدعوة حتى الآن", 860, 58, bar=False, maxw=1000)
        box_text(fr, t, L1 + 1.1, G1 - 0.1, "لا رد معلن من الميليشيا", 1010, 58, bar=True, maxw=1000)
        source(fr, t, L1 + 0.5, G1 - 0.1, "زالنجي – صورة أرشيفية (1961)", 1700)
    elif t < Q1:
        box_text(fr, t, G1 + 0.2, Q1 - 0.1, "موقف فردي.. أم بداية تحولات أوسع داخل القبائل؟", 960, 60, maxw=980)
    else:
        a = fade(t, Q1 + 0.2, DUR, 0.5, 0.4)
        if a:
            blit(fr, logo_sprite(200), 540, 800, a)
            blit(fr, T("تقرير خاص | صحيفة ألوان السودانية", 50, 800, (255, 255, 255), "tajx"), 540, 990, a)
            blit(fr, T("المصادر: قناة الحدث · الوئام · عزة برس · سودان تربيون · الجزيرة نت", 26, 0, (160, 160, 160), "tajm", maxw=960), 540, 1140, a)
    sub(fr, t, SUBS, y=1300)
    narr(fr, t, NARR)
    if 0.8 < t < Q1: blit(fr, logo_sprite(62), W - 70 - logo_sprite(62).shape[1] / 2, 110, 0.6)
    fr = fr * VIG + GRAIN[int(t * FPS) % 5]
    if t < 0.12: fr *= t / 0.12
    if t > DUR - 0.4: fr *= max(0, (DUR - t) / 0.4)
    return fr

def to8(f): return (np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    if PREVIEW:
        for t in PREVIEW: Image.fromarray(to8(make_frame(t))).save(f"{OUT}/prev_{t:06.2f}.png")
        sys.exit()
    NF = int(round(DUR * FPS)); NW = 4; k = int(WORKER[1:]); b = [round(NF * i / NW) for i in range(NW + 1)]
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-threads", "2", "-pix_fmt", "yuv420p", f"{OUT}/seg_{k}.mp4"], stdin=subprocess.PIPE)
    for fi in range(b[k], b[k + 1]):
        p.stdin.write(to8(make_frame(fi / FPS)).tobytes())
        if fi % 90 == 0: print(f"w{k} {fi}/{b[k + 1]}", flush=True)
    p.stdin.close(); p.wait(); print(f"w{k} DONE", flush=True)
