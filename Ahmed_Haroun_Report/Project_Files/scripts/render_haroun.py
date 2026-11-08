"""Alwan newspaper news reel renderer: 'أحمد هارون.. ماذا قال قبل اعتقاله؟'
Usage: render_haroun.py SCRATCH EDL_JSON OUT_DIR [wK | preview times...]
The EDL (edit decision list) holds scene timing, interview clip in/out points and subtitle text.
"""
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S, EDL_PATH, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ARGS = sys.argv[4:]
WORKER = ARGS[0] if ARGS and ARGS[0].startswith("w") else None
PREVIEW = [] if WORKER else [float(x) for x in ARGS]
W, H, FPS = 1080, 1920, 30
EDL = json.load(open(EDL_PATH))
DUR = EDL["duration"]
X = f"{S}/haroun"

# brand palette — sampled from the official Alwan logo
RED = np.array([215, 36, 41], np.float32) / 255      # #D72429 (logo dot)
CHAR = np.array([64, 64, 64], np.float32) / 255      # #404040 (logo letters)
GREY = np.array([216, 218, 217], np.float32) / 255   # #D8DAD9 (logo map)
WHITE = np.ones(3, np.float32)
INK = np.array([18, 18, 19], np.float32) / 255       # near-black base (darkened charcoal)

FONT = {"cairo": f"{S}/fonts/Cairo%5Bslnt,wght%5D.ttf", "oswald": f"{S}/fonts/Oswald%5Bwght%5D.ttf"}

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_io(x): x = clamp(x); return x * x * (3 - 2 * x)
def lerp(a, b, u): return a + (b - a) * u
def fade(t, t0, t1, fi=0.35, fo=0.3):
    if t < t0 or t > t1: return 0.0
    return min(ease_out((t - t0) / fi), ease_io((t1 - t) / fo))

def font(name, size, wght=None):
    f = ImageFont.truetype(FONT[name], size)
    if wght is not None:
        axes = f.get_variation_axes(); f.set_variation_by_axes([wght] + [0] * (len(axes) - 1))
    return f

_cache = {}
def text(txt, size, wght=700, color=(255, 255, 255), fname="cairo", ar=True, maxw=None, stroke=0, stroke_fill=(0, 0, 0), align="center", spacing=14):
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
def grade_frame(rgb):
    """Gentle news grade: neutral WB, slight lift of shadows, contrast, mild saturation, skin-safe."""
    x = rgb.astype(np.float32) / 255
    m = x.reshape(-1, 3).mean(0); x = x * (m.mean() / np.maximum(m, 1e-3)) ** 0.35        # partial grey-world WB
    x = np.clip((x - 0.5) * 1.08 + 0.52, 0, 1)
    lum = (x * np.array([0.299, 0.587, 0.114])).sum(2, keepdims=True)
    return np.clip(lum + (x - lum) * 1.04, 0, 1)

class Clip:
    """Reads the 360x640 interview video at native fps, upscales (Lanczos + unsharp), cached per source frame."""
    def __init__(s, path):
        s.path = path
        pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height,r_frame_rate",
                             "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip().split(",")
        s.w, s.h = int(pr[0]), int(pr[1]); n, d = pr[2].split("/"); s.fps = float(n) / float(d)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        s.frames = np.frombuffer(raw, np.uint8).reshape(-1, s.h, s.w, 3); s.cache = {}
    def get(s, t):
        i = min(len(s.frames) - 1, max(0, int(round(t * s.fps))))
        if i not in s.cache:
            im = Image.fromarray(s.frames[i]).resize((W, int(W * s.h / s.w)), Image.LANCZOS)
            im = im.filter(ImageFilter.UnsharpMask(radius=2.0, percent=60, threshold=2))
            s.cache = {i: grade_frame(np.asarray(im))}
        return s.cache[i]

CLIP = Clip(f"{X}/dl_altabia/altabia_clip.mp4")
COVER = Image.open(f"{X}/work/podcast_cover.jpg").convert("RGB")
cov = COVER.crop((24, 24, 576, 576))          # inside the decorative frame
COVER_BIG = grade_frame(np.asarray(cov.resize((1500, 1500), Image.LANCZOS).filter(ImageFilter.UnsharpMask(2, 50, 2))))
COVER_BLUR = np.asarray(Image.fromarray((COVER_BIG * 255).astype(np.uint8)).resize((1200, 2133)).filter(ImageFilter.GaussianBlur(28))).astype(np.float32) / 255

def place_clip(fr, t_src, zoom=1.0, dy=0):
    img = CLIP.get(t_src)
    if zoom != 1.0:
        hh, ww = img.shape[:2]; cw, ch = int(ww / zoom), int(hh / zoom)
        x0 = (ww - cw) // 2; y0 = max(0, min(hh - ch, int((hh - ch) * 0.42)))
        img = np.asarray(Image.fromarray((img[y0:y0 + ch, x0:x0 + cw] * 255).astype(np.uint8)).resize((ww, hh), Image.BILINEAR)).astype(np.float32) / 255
    y0 = (H - img.shape[0]) // 2 + dy
    fr[max(0, y0):max(0, y0) + img.shape[0]] = img[:H]

def place_cover(fr, t, t0, t1, blur_bg=True, dim=1.0, z0=1.0, z1=1.08, cy=330):
    """Ken-Burns on the verified photo over its own blurred extension."""
    u = (t - t0) / max(1e-3, t1 - t0)
    fr[:] = COVER_BLUR[:H, 60:60 + W] * 0.55
    z = lerp(z0, z1, ease_io(u)); size = int(1080 * z)
    im = np.asarray(Image.fromarray((COVER_BIG * 255).astype(np.uint8)).resize((size, size), Image.BILINEAR)).astype(np.float32) / 255
    x0 = (W - size) // 2; y0 = cy - (size - 1080) // 2
    xs, ys = max(0, -x0), max(0, -y0)
    sub = im[ys:ys + H, xs:xs + W]
    fr[max(0, y0):max(0, y0) + sub.shape[0], max(0, x0):max(0, x0) + sub.shape[1]] = sub * dim

# ---------------------------------------------------------------- map
REG = json.load(open(f"{X}/work/region.json"))
def map_layer():
    lon0, lon1, lat0, lat1 = 19.0, 41.5, 2.0, 25.5
    sx = 900 / (lon1 - lon0); ox, oy = 90, 520
    def P(lon, lat): return (ox + (lon - lon0) * sx, oy + (lat1 - lat) * sx)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for code, g in REG.items():
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            pts = [P(*c) for c in poly[0]]
            if code == "SDN":
                d.polygon(pts, fill=(64, 64, 64, 235), outline=(215, 36, 41, 255), width=5)
            else:
                d.polygon(pts, fill=(40, 40, 42, 120), outline=(216, 218, 217, 60), width=2)
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    a = np.asarray(im).astype(np.float32) / 255
    return np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2)
MAP = map_layer()

LOGO_IM = Image.open(f"{S}/assets/logo_white.png").convert("RGBA")
def logo_sprite(h, alpha=1.0):
    k = ("logo", h)
    if k not in _cache:
        im = LOGO_IM.resize((int(LOGO_IM.width * h / LOGO_IM.height), h), Image.LANCZOS)
        a = np.asarray(im).astype(np.float32) / 255; _cache[k] = np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2)
    return _cache[k]

# ---------------------------------------------------------------- graphic elements
def source_label(fr, t, t0, t1, label, y=1610):
    a = fade(t, t0, t1, 0.3, 0.25)
    if not a: return
    sp = text(label, 34, 600, (230, 230, 230), fname="oswald" if label.isascii() else "cairo", ar=not label.isascii())
    w = sp.shape[1] + 40; x1 = W - 60
    rect(fr, x1 - w, y - 30, x1, y + 30, CHAR, 0.85 * a); rect(fr, x1 - 8, y - 30, x1, y + 30, RED, a)
    blit(fr, sp, x1 - 22 - sp.shape[1] / 2, y, a)

def headline(fr, t, t0, t1, txt, y, size=86, bar=True, maxw=940):
    a = fade(t, t0, t1, 0.35, 0.3)
    if not a: return
    sp = text(txt, size, 800, (255, 255, 255), maxw=maxw)
    slide = 40 * (1 - ease_out((t - t0) / 0.45))
    pad = 34; h, w = sp.shape[:2]
    rect(fr, 540 - w / 2 - pad, y - h / 2 - pad * 0.7, 540 + w / 2 + pad, y + h / 2 + pad * 0.7, INK, 0.78 * a)
    if bar:
        bw = (w + 2 * pad) * ease_out((t - t0) / 0.5)
        rect(fr, 540 + (w / 2 + pad) - bw, y + h / 2 + pad * 0.7, 540 + w / 2 + pad, y + h / 2 + pad * 0.7 + 10, RED, a)
    blit(fr, sp, 540 + slide, y, a)

def kicker(fr, t, t0, t1, txt, y):
    a = fade(t, t0, t1, 0.3, 0.3)
    if not a: return
    sp = text(txt, 40, 800, (255, 255, 255)); w = sp.shape[1] + 44
    rect(fr, 540 - w / 2, y - 32, 540 + w / 2, y + 32, RED, a); blit(fr, sp, 540, y, a)

def lower_third(fr, t, t0, t1, name, role, y=1290):
    a = fade(t, t0, t1, 0.35, 0.3)
    if not a: return
    sn = text(name, 60, 800, (255, 255, 255)); sr = text(role, 38, 600, (40, 40, 40))
    w = max(sn.shape[1], sr.shape[1]) + 70; x1 = W - 50; grow = ease_out((t - t0) / 0.45)
    rect(fr, x1 - w * grow, y - 52, x1, y + 34, CHAR, 0.92 * a); rect(fr, x1 - w * grow, y + 34, x1, y + 92, GREY, 0.95 * a)
    rect(fr, x1 - 12, y - 52, x1, y + 92, RED, a)
    blit(fr, sn, x1 - 36 - sn.shape[1] / 2, y - 9, a * grow); blit(fr, sr, x1 - 36 - sr.shape[1] / 2, y + 63, a * grow)

def subtitle(fr, t, subs):
    for s in subs:
        if s["start"] <= t < s["end"]:
            a = min(1, (t - s["start"]) / 0.12, (s["end"] - t) / 0.12)
            parts = s["text"].split("|")   # words between |...| get the brand red highlight line
            sp = text(s["text"].replace("|", ""), 54, 700, (255, 255, 255), maxw=900, stroke=3, stroke_fill=(0, 0, 0))
            blit(fr, sp, 540, s.get("y", 1500), a)
            if len(parts) >= 3:
                hl = text(parts[1], 54, 800, (215, 36, 41), maxw=900, stroke=3, stroke_fill=(255, 255, 255))
                blit(fr, hl, 540, s.get("y", 1500) + sp.shape[0] / 2 + 38, a)

def card(fr, t, t0, t1, year, txt, y, side=1):
    a = fade(t, t0, t1, 0.35, 0.25)
    if not a: return
    sy = text(year, 42, 800, (215, 36, 41)); st = text(txt, 38, 600, (255, 255, 255), maxw=740, spacing=6)
    slide = 60 * (1 - ease_out((t - t0) / 0.4))
    h = max(sy.shape[0] + st.shape[0] + 30, 120); x1 = W - 70 + slide; x0 = 150 + slide
    rect(fr, x0, y - h / 2, x1, y + h / 2, INK, 0.82 * a); rect(fr, x1 - 8, y - h / 2, x1, y + h / 2, RED, a)
    blit(fr, sy, x1 - 30 - sy.shape[1] / 2, y - h / 2 + 15 + sy.shape[0] / 2, a)
    blit(fr, st, x1 - 30 - st.shape[1] / 2, y - h / 2 + 25 + sy.shape[0] + st.shape[0] / 2, a)

def ticker(fr, t, txt):
    rect(fr, 0, 1820, W, 1880, INK, 0.9); rect(fr, W - 230, 1820, W, 1880, RED, 1)
    blit(fr, text("صحيفة ألوان", 32, 800, (255, 255, 255)), W - 115, 1850)
    sp = text(txt, 32, 600, (230, 230, 230)); w = sp.shape[1]
    x = ((t * 90) % (w + W)) - w / 2           # right-to-left scroll
    blit(fr, sp, W - 230 - x + w / 2 - w, 1850)
    rect(fr, W - 232, 1820, W - 230, 1880, GREY, 1)

# ---------------------------------------------------------------- frame
SUBS = EDL["subs"]; SEGS = EDL["segments"]
WHIPS = EDL.get("whips", []); PUSH = EDL.get("push", [])

def seg_at(t):
    for g in SEGS:
        if g["t0"] <= t < g["t1"]: return g
    return None

def make_frame(t):
    fr = np.zeros((H, W, 3), np.float32); fr[:] = INK
    g = seg_at(t)
    if g:
        u = (t - g["t0"]) / max(1e-3, g["t1"] - g["t0"])
        if g["kind"] == "clip":
            z = lerp(g.get("z0", 1.0), g.get("z1", 1.04), ease_io(u))
            place_clip(fr, g["src"] + (t - g["t0"]) * g.get("speed", 1.0), zoom=z)
        elif g["kind"] == "cover":
            place_cover(fr, t, g["t0"], g["t1"], dim=g.get("dim", 1.0), z0=g.get("z0", 1.0), z1=g.get("z1", 1.08), cy=g.get("cy", 330))
        elif g["kind"] == "map":
            place_cover(fr, t, g["t0"], g["t1"], dim=0.35); fr *= 0.55
            mz = lerp(0.96, 1.0, ease_out(u * 2))
            blit(fr, scale_sprite(MAP, mz) if mz != 1 else MAP, 540, 960, fade(t, g["t0"], g["t1"], 0.5, 0.3))
        elif g["kind"] == "dark":
            fr[:] = COVER_BLUR[:H, 60:60 + W] * 0.18 + INK * 0.6
    # cinematic push transition: short zoom-blend between segments
    for tp in PUSH:
        d = t - tp
        if -0.12 < d < 0.18:
            k = 1 - abs(d) / 0.18; z = 1 + 0.06 * k
            ch, cw = int(H / z), int(W / z)
            fr = np.asarray(Image.fromarray((np.clip(fr, 0, 1) * 255).astype(np.uint8)).crop(((W - cw) // 2, (H - ch) // 2, (W - cw) // 2 + cw, (H - ch) // 2 + ch)).resize((W, H), Image.BILINEAR)).astype(np.float32) / 255
    for tw in WHIPS:
        d = abs(t - tw)
        if d < 0.1:
            n = int(70 * (1 - d / 0.1)) + 1
            cs = np.cumsum(np.pad(fr, ((0, 0), (n, 0), (0, 0)), mode="edge"), 1); fr = (cs[:, n:] - cs[:, :-n]) / n
    fr = fr * (1 - 0.65 * BOTTOM)
    for e in EDL["graphics"]:
        k = e["type"]
        if k == "headline": headline(fr, t, e["t0"], e["t1"], e["text"], e["y"], e.get("size", 86))
        elif k == "kicker": kicker(fr, t, e["t0"], e["t1"], e["text"], e["y"])
        elif k == "source": source_label(fr, t, e["t0"], e["t1"], e["text"], e.get("y", 1610))
        elif k == "lower": lower_third(fr, t, e["t0"], e["t1"], e["name"], e["role"], e.get("y", 1290))
        elif k == "card": card(fr, t, e["t0"], e["t1"], e["year"], e["text"], e["y"])
        elif k == "body":
            a = fade(t, e["t0"], e["t1"], 0.35, 0.3)
            if a: blit(fr, text(e["text"], e.get("size", 48), e.get("w", 600), tuple(e.get("color", (235, 235, 235))), maxw=e.get("maxw", 900)), 540, e["y"] + 20 * (1 - ease_out((t - e["t0"]) / 0.45)), a)
        elif k == "note":
            a = fade(t, e["t0"], e["t1"], 0.35, 0.3)
            if a:
                sp = text(e["text"], 42, 700, (255, 255, 255), maxw=860); h_, w_ = sp.shape[:2]
                rect(fr, 540 - w_ / 2 - 30, e["y"] - h_ / 2 - 22, 540 + w_ / 2 + 30, e["y"] + h_ / 2 + 22, RED, 0.92 * a); blit(fr, sp, 540, e["y"], a)
        elif k == "logo_big":
            a = fade(t, e["t0"], e["t1"], 0.5, 0.4)
            if a: blit(fr, logo_sprite(200), 540, e["y"], a)
    subtitle(fr, t, SUBS)
    # brand watermark (subtle), hidden while the big end logo shows
    if t < EDL["watermark_until"]:
        blit(fr, logo_sprite(64), W - 70 - logo_sprite(64).shape[1] / 2, 120, 0.55)
    if EDL.get("ticker") and EDL["ticker"]["t0"] <= t < EDL["ticker"]["t1"]: ticker(fr, t, EDL["ticker"]["text"])
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
