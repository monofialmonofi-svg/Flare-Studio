"""Frame renderer for 'CR7 – THE END OF AN ERA?' (1080x1920 @30fps).
Usage: python3 render.py SCRATCH BUILD_DIR [preview_times...]
Writes BUILD_DIR/seg_clean_K.mp4 and seg_subs_K.mp4 per worker, or preview PNGs.
"""
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from multiprocessing import Process

S, B = sys.argv[1], sys.argv[2]
WORKER = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3].startswith("w") else None
PREVIEW = [] if WORKER else [float(x) for x in sys.argv[3:]]
W, H, FPS = 1080, 1920, 30
TL = json.load(open(f"{B}/timeline.json"))
DUR = TL["duration"]; CUT = {int(k): v for k, v in TL["cuts"].items()}
LN = {l["id"]: l for l in TL["lines"]}
FONT = {
    "cairo": f"{S}/fonts/Cairo%5Bslnt,wght%5D.ttf",
    "bebas": f"{S}/fonts/BebasNeue-Regular.ttf",
    "oswald": f"{S}/fonts/Oswald%5Bwght%5D.ttf",
    "emoji": "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
}
rng = np.random.default_rng(11)
sys.path.insert(0, S)
import timeline_novo as TN

# ------------------------------------------------------------------ helpers
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def ease_io(x): x = clamp(x); return x * x * (3 - 2 * x)
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_in(x): x = clamp(x); return x ** 2.2
def lerp(a, b, u): return a + (b - a) * u

def font(name, size, wght=None):
    f = ImageFont.truetype(FONT[name], size)
    if wght is not None:
        try:
            axes = f.get_variation_axes()
            f.set_variation_by_axes([wght] + [0] * (len(axes) - 1))
        except Exception:
            pass
    return f

_cache = {}
def text_sprite(text, fname, size, wght=None, fill=(255, 255, 255), tracking=0, stroke=0, stroke_fill=(0, 0, 0), ar=False, glow=None):
    """RGBA float32 premultiplied sprite. glow=(r,g,b,radius,strength)."""
    key = (text, fname, size, wght, fill, tracking, stroke, ar, glow)
    if key in _cache: return _cache[key]
    f = font(fname, size, wght)
    kw = dict(direction="rtl", language="ar") if ar else {}
    pad = 40 + (glow[3] * 3 if glow else 0)
    if tracking and not ar:
        widths = [f.getlength(ch) for ch in text]
        tw = int(sum(widths) + tracking * (len(text) - 1))
        asc, desc = f.getmetrics(); th = asc + desc
        im = Image.new("RGBA", (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        x = pad
        for ch, w_ in zip(text, widths):
            d.text((x, pad), ch, font=f, fill=fill + (255,), stroke_width=stroke, stroke_fill=stroke_fill)
            x += w_ + tracking
    else:
        bb = ImageDraw.Draw(Image.new("RGBA", (10, 10))).textbbox((0, 0), text, font=f, stroke_width=stroke, **kw)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        im = Image.new("RGBA", (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        d.text((pad - bb[0], pad - bb[1]), text, font=f, fill=fill + (255,), stroke_width=stroke, stroke_fill=stroke_fill, **kw)
    im = im.crop(im.getbbox()); im = pad_img(im, pad)
    a = np.asarray(im).astype(np.float32) / 255
    rgb = a[..., :3] * a[..., 3:4]
    out = np.concatenate([rgb, a[..., 3:4]], 2)
    if glow:
        gr, gg, gb, rad, st = glow
        al = Image.fromarray((a[..., 3] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad))
        ga = np.asarray(al).astype(np.float32)[..., None] / 255 * st
        gcol = np.array([gr, gg, gb], np.float32) / 255 * ga
        # glow under text: screen-ish combine
        out_rgb = out[..., :3] + gcol * (1 - out[..., 3:4])
        out_a = np.clip(out[..., 3:4] + ga * (1 - out[..., 3:4]), 0, 1)
        out = np.concatenate([out_rgb, out_a], 2)
    _cache[key] = out
    return out

def pad_img(im, p):
    n = Image.new("RGBA", (im.width + 2 * p, im.height + 2 * p), (0, 0, 0, 0)); n.paste(im, (p, p)); return n

def emoji_sprite(ch, h):
    key = ("emoji", ch, h)
    if key in _cache: return _cache[key]
    f = ImageFont.truetype(FONT["emoji"], 109)
    im = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((10, 10), ch, font=f, embedded_color=True)
    im = im.crop(im.getbbox()); im = im.resize((int(im.width * h / im.height), h), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    out = np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], 2); _cache[key] = out; return out

def scale_sprite(sp, s):
    if abs(s - 1) < 1e-3: return sp
    h, w = sp.shape[:2]; nw, nh = max(1, int(w * s)), max(1, int(h * s))
    chans = [np.asarray(Image.fromarray(sp[..., c]).resize((nw, nh), Image.BILINEAR)) for c in range(4)]
    return np.stack(chans, 2)

def blit(frame, sp, cx, cy, alpha=1.0, add=False):
    """Composite premultiplied sprite centered at (cx,cy)."""
    if alpha <= 0.002: return
    h, w = sp.shape[:2]; x0 = int(round(cx - w / 2)); y0 = int(round(cy - h / 2))
    fx0, fy0 = max(0, x0), max(0, y0); fx1, fy1 = min(W, x0 + w), min(H, y0 + h)
    if fx1 <= fx0 or fy1 <= fy0: return
    s = sp[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0]
    reg = frame[fy0:fy1, fx0:fx1]
    if add:
        reg += s[..., :3] * alpha
    else:
        reg *= (1 - s[..., 3:4] * alpha); reg += s[..., :3] * alpha

def glow_dot(r, color):
    n = int(r * 4) | 1; c = n // 2
    y, x = np.mgrid[0:n, 0:n]; d2 = ((x - c) ** 2 + (y - c) ** 2) / (r * r)
    g = np.exp(-d2 * 1.6)[..., None] * np.array(color, np.float32)
    return np.concatenate([g, np.zeros((n, n, 1), np.float32)], 2)

# ------------------------------------------------------------------ source + grades
SRC = Image.open(f"{S}/assets/poster_cut.png").convert("RGBA")
SW, SH = SRC.size
src = np.asarray(SRC).astype(np.float32) / 255
# soften bottom edge so the crop line never shows
fade = np.ones(SH, np.float32); fade[-160:] = np.linspace(1, 0, 160) ** 1.5
src[..., 3] *= fade[:, None]

def grade(rgb, contrast=1.15, sat=1.05, shadows=(0, 0, 0), highs=(0, 0, 0), gain=1.0, lift=0.0):
    x = rgb
    lum = (x * np.array([0.299, 0.587, 0.114])).sum(2, keepdims=True)
    x = lum + (x - lum) * sat
    x = np.clip((x - 0.5) * contrast + 0.5, 0, 1)
    x = x * x * (3 - 2 * x) * 0.35 + x * 0.65          # gentle S-curve
    lum = (x * np.array([0.299, 0.587, 0.114])).sum(2, keepdims=True)
    x = x + np.array(shadows) * (1 - lum) ** 2 + np.array(highs) * lum ** 2
    return np.clip(x * gain + lift, 0, 1)

def mk(rgb_fn):
    rgb = rgb_fn(src[..., :3]); a = src[..., 3:4]
    return Image.fromarray((np.concatenate([rgb, a], 2) * 255).astype(np.uint8), "RGBA")

G = {
    "main": mk(lambda x: grade(x, 1.18, 1.0, shadows=(-0.02, 0.01, 0.04), highs=(0.04, 0.015, -0.03))),
    "gold": mk(lambda x: grade(x, 1.12, 1.08, shadows=(0.0, 0.0, 0.02), highs=(0.08, 0.05, -0.05), gain=1.04)),
    "mono": mk(lambda x: grade(x, 0.95, 0.30, shadows=(-0.01, 0.0, 0.03), highs=(0.02, 0.02, 0.02), lift=0.02)),
    "red":  mk(lambda x: grade(x, 1.2, 0.9, shadows=(0.03, -0.02, -0.02), highs=(0.06, -0.02, -0.03), gain=0.95)),
}
GRADE_FN = {
    "main": lambda x: grade(x, 1.18, 1.0, shadows=(-0.02, 0.01, 0.04), highs=(0.04, 0.015, -0.03)),
    "photo": lambda x: grade(x, 1.16, 0.88, shadows=(-0.03, 0.0, 0.035), highs=(0.03, 0.01, -0.03), gain=0.86),
    "gold": lambda x: grade(x, 1.12, 1.0, shadows=(0.0, 0.0, 0.02), highs=(0.08, 0.05, -0.05), gain=0.92),
    "mono": lambda x: grade(x, 0.95, 0.22, shadows=(-0.01, 0.0, 0.03), highs=(0.02, 0.02, 0.02), gain=0.88, lift=0.02),
    "red": lambda x: grade(x, 1.2, 0.85, shadows=(0.05, -0.02, -0.02), highs=(0.06, -0.02, -0.03), gain=0.8),
}
PHOTO_DIR = f"{S}/ext/photos"
PHOTO_SIZE = {}
def get_img(key):
    """key = 'grade' (poster) or 'grade:photo_name' (Commons photo)."""
    if key in G: return G[key]
    gname, name = key.split(":")
    im = Image.open(f"{PHOTO_DIR}/{name}.jpg").convert("RGB")
    rgb = np.asarray(im).astype(np.float32) / 255
    blur = gname == "redblur"
    out = GRADE_FN["red" if blur else gname](rgb)
    if blur: out = out * 0.5
    pi = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).convert("RGBA")
    if blur: pi = pi.filter(ImageFilter.GaussianBlur(9))
    G[key] = pi; PHOTO_SIZE[name] = im.size
    return pi
def pcam(name, fx, fy, z):
    w, h = Image.open(f"{PHOTO_DIR}/{name}.jpg").size
    return (fx * w, fy * h, z)
G["redblur"] = Image.fromarray((np.asarray(G["red"]).astype(np.float32) * np.array([0.55, 0.45, 0.45, 1])).astype(np.uint8), "RGBA").filter(ImageFilter.GaussianBlur(7))

# key points in source pixels (2x upscaled poster)
P = dict(FULL=(736, 1250), FACE=(690, 1330), EYES=(735, 1295), CREST=(804, 1985), ARM7=(1230, 2215),
         J7=(420, 2190), GOAT=(1090, 1020), GOATEYE=(1045, 920), TOP7=(760, 620), CHEST=(720, 1650))
def cam(pt, z, dx=0, dy=0): return (P[pt][0] + dx, P[pt][1] + dy, z)

def render_subject(gname, c, shake=(0, 0)):
    cx, cy, z = c
    img = get_img(gname)
    if ":" in gname:   # photos must always cover the frame
        iw, ih = img.size
        z = max(z, W / iw * 1.001, H / ih * 1.001)
        hw, hh = W / 2 / z + 20 / z, H / 2 / z + 20 / z
        cx = min(max(cx, hw), iw - hw); cy = min(max(cy, hh), ih - hh)
    # output->source affine
    a = 1 / z; ox = cx - (W / 2 + shake[0]) * a; oy = cy - (H / 2 + shake[1]) * a
    im = img.transform((W, H), Image.AFFINE, (a, 0, ox, 0, a, oy), resample=Image.BICUBIC)
    arr = np.asarray(im).astype(np.float32) / 255
    return arr[..., :3] * arr[..., 3:4], arr[..., 3:4]

# ------------------------------------------------------------------ background layers
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
def radial(cx, cy, r): return np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (r * r)))
BASE = (np.stack([lerp(0.025, 0.06, yy / H), lerp(0.025, 0.03, yy / H), lerp(0.035, 0.035, yy / H)], 2)).astype(np.float32)
REDGLOW = (radial(540, 900, 700)[..., None] * np.array([0.35, 0.03, 0.04])).astype(np.float32)
FLOOD = ((radial(-60, 120, 380) + radial(1140, 120, 380))[..., None] * np.array([0.55, 0.6, 0.7])
         + (np.exp(-((yy - 140) / 10) ** 2) * np.exp(-((xx - 540) / 900) ** 2))[..., None] * np.array([0.07, 0.08, 0.1])).astype(np.float32)
# god rays from top centre
ang = np.arctan2(xx - 540, yy + 300); rays = (0.5 + 0.5 * np.cos(ang * 46)) ** 6 * np.exp(-yy / 1300)
RAYS = (np.asarray(Image.fromarray((rays * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)[..., None] / 255 * np.array([0.65, 0.48, 0.18])).astype(np.float32)
# crowd bokeh band
BOK_W = 1600
bok = np.zeros((900, BOK_W, 3), np.float32)
for _ in range(420):
    r = rng.uniform(5, 22); col = [(1, 0.9, 0.75), (0.9, 0.1, 0.12), (0.1, 0.65, 0.3), (0.8, 0.85, 1.0)][rng.choice(4, p=[0.5, 0.2, 0.12, 0.18])]
    sp = glow_dot(r, np.array(col) * rng.uniform(0.15, 0.6))
    x, y = rng.uniform(0, BOK_W), rng.uniform(80, 900) ** 1.0
    h_, w_ = sp.shape[:2]; x0, y0 = int(x - w_ / 2), int(y - h_ / 2)
    xs0, ys0 = max(0, x0), max(0, y0); xs1, ys1 = min(BOK_W, x0 + w_), min(900, y0 + h_)
    if xs1 > xs0 and ys1 > ys0: bok[ys0:ys1, xs0:xs1] += sp[ys0 - y0:ys1 - y0, xs0 - x0:xs1 - x0, :3]
bok = np.asarray(Image.fromarray(np.clip(bok * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))).astype(np.float32) / 255
SCRIM = np.clip(0.42 + 0.58 * (yy / 720), 0, 1)[..., None].astype(np.float32)
VIG = (1 - 0.62 * np.clip(((xx - 540) / 760) ** 2 + ((yy - 960) / 1250) ** 2, 0, 1) ** 1.3)[..., None].astype(np.float32)
GRAIN = [rng.normal(0, 0.022, (H, W, 1)).astype(np.float32) for _ in range(6)]

def streak_sprite(color, length=1500, thick=9, angle=-22):
    im = Image.new("L", (length, 80), 0); d = ImageDraw.Draw(im)
    for i in range(14):
        k = i / 13; d.line([(length * 0.05 + k * 0, 40), (length * 0.95, 40)], fill=int(255 * (1 - k) ** 2), width=max(1, int(thick * (1 - k) + 1)))
    im = im.filter(ImageFilter.GaussianBlur(4)).rotate(angle, expand=True, resample=Image.BICUBIC)
    a = np.asarray(im).astype(np.float32) / 255
    taper = np.ones_like(a)
    g = a[..., None] * np.array(color, np.float32)
    return np.concatenate([g, np.zeros_like(a)[..., None]], 2)
STREAK = {"red": streak_sprite((1.0, 0.12, 0.12)), "green": streak_sprite((0.1, 0.9, 0.35)), "gold": streak_sprite((1.0, 0.75, 0.3)), "white": streak_sprite((0.9, 0.92, 1.0), thick=6)}

class Particles:
    def __init__(s, n, color, rmin, rmax, vy, vx=0.0, seed=1, bright=(0.3, 0.9)):
        r = np.random.default_rng(seed)
        s.x = r.uniform(0, W, n); s.y = r.uniform(0, H, n); s.vy = r.uniform(*vy, n); s.vx = r.uniform(-vx, vx, n) if vx else np.zeros(n)
        s.ph = r.uniform(0, 6.28, n); s.rad = r.uniform(rmin, rmax, n); s.b = r.uniform(*bright, n)
        s.sprites = {}; s.color = np.array(color, np.float32)
    def draw(s, frame, t, amt=1.0):
        if amt <= 0.01: return
        for i in range(len(s.x)):
            x = (s.x[i] + s.vx[i] * t + 18 * math.sin(t * 0.7 + s.ph[i])) % W
            y = (s.y[i] - s.vy[i] * t) % H
            r = round(s.rad[i] * 2) / 2
            if r not in s.sprites: s.sprites[r] = glow_dot(r, s.color)
            tw = 0.6 + 0.4 * math.sin(t * 2.3 + s.ph[i] * 3)
            blit(frame, s.sprites[r], x, y, alpha=amt * s.b[i] * tw, add=True)
DUST = Particles(55, (0.85, 0.85, 0.9), 1.2, 3.2, (8, 25), 10, 3, (0.15, 0.5))
EMBER = Particles(80, (1.0, 0.35, 0.12), 1.5, 4.0, (60, 160), 20, 5, (0.3, 0.9))
GOLD = Particles(90, (1.0, 0.78, 0.35), 1.5, 4.5, (-40, 90), 30, 7, (0.25, 0.9))

# ------------------------------------------------------------------ shots
L = lambda i: LN[i]["start"]
c = CUT
SHOTS = [
 # t0, t1, grade[:photo], cam_a, cam_b, ease, bg, tag
 (0.0, TN.S2, "photo:hook_2026wc_closeup", (902, 547 + 260 / 1.6, 1.6), (902, 547 + 260 / 1.32, 1.32), "io", "dark", "CROATIA v PORTUGAL  ·  2026 FIFA WORLD CUP"),
 (TN.S2, 8.4, "photo:walkout_2013", pcam("walkout_2013", 0.47, 0.52, 0.74), pcam("walkout_2013", 0.47, 0.32, 0.95), "io", "photo_fx", "CROATIA v PORTUGAL  ·  2013"),
 (8.4, 10.8, "photo:fans_lisbon_euro2016", pcam("fans_lisbon_euro2016", 0.30, 0.62, 0.80), pcam("fans_lisbon_euro2016", 0.55, 0.60, 0.86), "io", "photo_fx", "PORTUGUESE FANS  ·  LISBON  ·  EURO 2016"),
 (10.8, 13.2, "photo:ball_2011_argentina", pcam("ball_2011_argentina", 0.53, 0.42, 0.80), pcam("ball_2011_argentina", 0.54, 0.38, 1.0), "io", "photo_fx", "PORTUGAL v ARGENTINA  ·  2011"),
 (13.2, TN.S3, "photo:young_2007_brazil", pcam("young_2007_brazil", 0.72, 0.52, 2.05), pcam("young_2007_brazil", 0.73, 0.52, 2.5), "io", "photo_fx", "PORTUGAL v BRAZIL  ·  2007"),
 (TN.S3, 20.4, "redblur:ball_2011_argentina", pcam("ball_2011_argentina", 0.53, 0.45, 0.80), pcam("ball_2011_argentina", 0.53, 0.45, 0.95), "io", "photo", None),
 (20.4, 23.4, "redblur:celebration_2025_armenia", pcam("celebration_2025_armenia", 0.46, 0.40, 1.5), pcam("celebration_2025_armenia", 0.46, 0.40, 1.62), "io", "photo", None),
 (23.4, 24.3, "photo:celebration_2025_armenia", pcam("celebration_2025_armenia", 0.46, 0.38, 1.55), pcam("celebration_2025_armenia", 0.46, 0.36, 1.75), "io", "photo_fx", "ARMENIA v PORTUGAL  ·  2025"),
 (24.3, TN.S4, "photo:armsout_2025_armenia", pcam("armsout_2025_armenia", 0.36, 0.42, 1.5), pcam("armsout_2025_armenia", 0.36, 0.40, 1.7), "io", "photo_fx", "ARMENIA v PORTUGAL  ·  2025"),
 (TN.S4, 29.0, "gold:euro2016_poland", pcam("euro2016_poland", 0.30, 0.36, 0.95), pcam("euro2016_poland", 0.30, 0.33, 1.25), "io", "glory", "EURO 2016  ·  PORTUGAL v POLAND"),
 (29.0, 32.4, "gold", cam("CREST", 2.5), cam("CREST", 2.1, dy=-40), "io", "glory", None),
 (32.4, TN.S5, "gold:thumbsup_2025_armenia", pcam("thumbsup_2025_armenia", 0.42, 0.42, 0.80), pcam("thumbsup_2025_armenia", 0.45, 0.42, 0.95), "io", "glory", "ARMENIA v PORTUGAL  ·  2025"),
 (TN.S5, 39.6, "mono:dejected_2026wc", pcam("dejected_2026wc", 0.52, 0.42, 0.78), pcam("dejected_2026wc", 0.52, 0.40, 0.92), "io", "soft", "CROATIA v PORTUGAL  ·  2026 FIFA WORLD CUP"),
 (39.6, TN.S6, "mono:closeup_2026wc", pcam("closeup_2026wc", 0.40, 0.27, 1.12), pcam("closeup_2026wc", 0.40, 0.25, 1.4), "io", "soft", None),
 (TN.S6, 46.8, "red", cam("GOATEYE", 2.0), cam("GOAT", 1.25, dy=60), "io", "climax", None),
 (46.8, 49.2, "main", cam("FULL", 0.76, dy=-40), cam("FULL", 0.84, dy=40), "io", "climax", None),
 (49.2, 51.6, "photo:walking_2026wc", pcam("walking_2026wc", 0.50, 0.40, 0.75), pcam("walking_2026wc", 0.52, 0.32, 0.98), "io", "photo_fx", "CROATIA v PORTUGAL  ·  2026 FIFA WORLD CUP"),
 (51.6, TN.S7, "photo:hook_2026wc_closeup", (902, 547 + 260 / 1.2, 1.2), (902, 547 + 260 / 1.7, 1.7), "in", "photo_fx", None),
 (TN.S7, TN.FADE_BLACK[1], "photo:walkaway_2026wc", pcam("walkaway_2026wc", 0.53, 0.42, 0.76), pcam("walkaway_2026wc", 0.53, 0.36, 0.88), "io", "final", "CROATIA v PORTUGAL  ·  2026 FIFA WORLD CUP"),
 (TN.FADE_BLACK[1], DUR + 1, None, None, None, "io", "end", None),
]
DISSOLVE = TN.DISSOLVE
WHIP = TN.WHIP
HARD = [t for t in TN.IMPACTS]
FLASH = [(TN.HOOK_IMPACT, 0.35, (1, 0.25, 0.25))] + [(t, 0.3, (1, 1, 1)) for t in TN.IMPACTS if t not in (TN.S4, TN.S6, TN.S7)] + [
         (TN.S4, 0.6, (1, 0.95, 0.85)), (TN.S6, 0.45, (1, 0.2, 0.15)), (TN.S7, 0.7, (1, 1, 1)), (TN.NAME_T - 0.05, 0.4, (0.9, 0.2, 0.2))]
SHAKE = TN.IMPACTS
HB = TN.HEARTBEATS
LEAKS = sorted(set(WHIP + [TN.S4, TN.S6, TN.S7]))

def shot_at(t):
    for s in SHOTS:
        if s[0] <= t < s[1]: return s
    return SHOTS[-1]

def background(kind, t, frame):
    frame[:] = BASE
    if kind == "dark":
        frame += REDGLOW * 0.25 * ease_io((t - 0.6) / 4)
        return
    if kind == "end":
        frame += REDGLOW * 0.35
        return
    if kind.startswith("photo"): return
    k = {"stadium": 1.0, "numbers": 0.6, "numbers2": 0.7, "glory": 1.0, "soft": 0.35, "climax": 1.0, "final": 0.85}[kind]
    frame += FLOOD * k * (0.9 + 0.1 * math.sin(t * 1.3))
    frame += REDGLOW * (1.4 if kind in ("climax", "numbers") else 0.8)
    off = int((t * 22) % (BOK_W - W))
    tw = 0.75 + 0.25 * math.sin(t * 3.1)
    frame[1000:1900] += bok[:, off:off + W] * k * tw
    if kind == "glory": frame += RAYS * (0.85 + 0.15 * math.sin(t * 2))

# ------------------------------------------------------------------ typography timeline
def ar(text, size, wght=900, glow=(200, 20, 30, 18, 0.55), fill=(255, 255, 255), stroke=0):
    return text_sprite(text, "cairo", size, wght, fill=fill, ar=True, glow=glow, stroke=stroke)
def en(text, size, tracking=0, fill=(255, 255, 255), glow=(200, 20, 30, 16, 0.5), fname="bebas", wght=None):
    return text_sprite(text, fname, size, wght, fill=fill, tracking=tracking, glow=glow)

def fit(sp, maxw=960):
    return scale_sprite(sp, maxw / sp.shape[1]) if sp.shape[1] > maxw else sp

def anim_in_out(t, t0, t1, fin=0.35, fout=0.3):
    if t < t0 or t > t1: return 0.0
    return min(ease_out((t - t0) / fin), ease_io((t1 - t) / fout))

def draw_tag(frame, t):
    s_ = shot_at(t); tag = s_[7]
    if not tag: return
    a = anim_in_out(t, s_[0] + 0.35, s_[1] - 0.05, 0.4, 0.2) * 0.85
    if a:
        sp = en(tag, 36, tracking=4, fname="oswald", wght=600, glow=(0, 0, 0, 8, 0.7), fill=(240, 240, 240))
        x = 540; y = 1335
        frame[y - 2:y + 2, x - 18:x + 18] = frame[y - 2:y + 2, x - 18:x + 18] * (1 - a) + np.array([0.85, 0.08, 0.1]) * a
        blit(frame, sp, x, y + 30, a)

def slam(frame, sp, x, y, t, t0, t1, fin=0.14, fout=0.25, amt=0.38):
    a = anim_in_out(t, t0, t1, fin, fout)
    if a: blit(frame, scale_sprite(sp, 1.0 + amt * (1 - ease_out((t - t0) / 0.3))), x, y, a)

def rise(frame, sp, x, y, t, t0, t1, fin=0.5, fout=0.3):
    a = anim_in_out(t, t0, t1, fin, fout)
    if a: blit(frame, sp, x, y + 34 * (1 - ease_out((t - t0) / 0.6)), a)

GOLDGLOW = (255, 170, 40, 24, 0.75); REDGLOW_T = (220, 20, 30, 26, 0.8)
def draw_titles(frame, t):
    rise(frame, fit(ar("هل دي فعلاً آخر مرة؟", 100)), 540, 330, t, 2.4, TN.S2 - 0.15)
    slam(frame, fit(ar("23 عاماً من المجد", 112, glow=REDGLOW_T)), 540, 330, t, TN.S2 + 0.6, 10.6)
    rise(frame, en("2003  —  2026", 64, tracking=10, fill=(240, 240, 240), glow=(220, 20, 30, 12, 0.8)), 540, 455, t, TN.S2 + 0.95, 10.6)
    rise(frame, fit(ar("حلم أصبح أسطورة", 110, glow=REDGLOW_T)), 540, 330, t, 13.35, TN.S3 - 0.1)
    slam(frame, fit(ar("الأرقام تتكلم", 150, glow=REDGLOW_T)), 540, 880, t, TN.S3 + 0.02, 17.3, amt=0.5)
    for num, lab, t0, t1 in ((234, "مباراة دولية", 17.4, 20.3), (146, "هدفاً", 20.4, 23.3)):
        if t0 <= t <= t1:
            val = int(round(num * ease_out((t - t0) / 0.6)))
            slam(frame, en(str(val), 340, glow=(220, 20, 30, 30, 0.9)), 540, 800, t, t0, t1, 0.12, 0.18, 0.35)
            rise(frame, ar(lab, 96, 900, glow=(0, 0, 0, 14, 0.7)), 540, 1030, t, t0 + 0.25, t1, 0.3, 0.18)
    slam(frame, fit(ar("بطل أوروبا 2016", 116, fill=(255, 244, 220), glow=GOLDGLOW)), 540, 340, t, TN.S4 + 0.05, 28.9)
    rise(frame, en("UEFA EURO 2016", 54, tracking=10, fname="oswald", wght=600, fill=(255, 205, 100), glow=None), 540, 460, t, TN.S4 + 0.4, 28.9)
    slam(frame, fit(ar("بطل دوري الأمم الأوروبية", 100, fill=(255, 244, 220), glow=GOLDGLOW)), 540, 340, t, 29.05, 32.3)
    rise(frame, en("2019   •   2025", 64, tracking=8, fname="oswald", wght=600, fill=(255, 205, 100), glow=None), 540, 455, t, 29.4, 32.3)
    t0 = 47.0
    a = anim_in_out(t, t0, TN.S7 - 0.1, 0.16, 0.15)
    if a:
        sl = (1.0 + 0.4 * (1 - ease_out((t - t0) / 0.3))) * (1 + 0.025 * math.sin((t - t0) * 5))
        blit(frame, scale_sprite(fit(ar("الحكاية ما انتهت", 130, glow=(230, 20, 30, 30, 0.95))), sl), 540, 360, a)
    # end card
    t0 = TN.NAME_T
    if t >= t0:
        u = ease_out((t - t0) / 1.6)
        sp = fit(en("CRISTIANO RONALDO", 132, tracking=int(lerp(46, 12, u)), glow=(200, 20, 30, 22, 0.6)), 1000)
        blit(frame, sp, 540, 820, ease_out((t - t0) / 0.8))
        lw = int(620 * ease_out((t - t0 - 0.3) / 1.0))
        if lw > 2:
            frame[905:909, 540 - lw // 2:540 + lw // 2] = frame[905:909, 540 - lw // 2:540 + lw // 2] * 0.2 + np.array([0.85, 0.08, 0.1]) * 0.9
    t0 = TN.THANKS_T
    if t >= t0:
        a = ease_out((t - t0) / 0.6)
        sp = ar("شكراً على الحكاية", 92, 800, glow=(200, 20, 30, 16, 0.4)); hrt = emoji_sprite("❤️", 78)
        wt = sp.shape[1] - 80 + 20 + hrt.shape[1]; cx_text = 540 + (wt - (sp.shape[1] - 80)) / 2; yo = 20 * (1 - a)
        blit(frame, sp, cx_text, 995 + yo, a)
        blit(frame, hrt, cx_text - (sp.shape[1] - 80) / 2 - 20 - hrt.shape[1] / 2, 1000 + yo, a)
    t0 = TN.FACTS_T
    if t >= t0:
        a = ease_out((t - t0) / 0.6) * 0.9
        blit(frame, ar("234 مباراة  ·  146 هدفاً  ·  2003 – 2026", 42, 600, glow=None, fill=(200, 200, 200)), 540, 1115, a)
        blit(frame, ar("أعلن اعتزاله اللعب الدولي في 5 نوفمبر 2026", 38, 500, glow=None, fill=(170, 170, 170)), 540, 1175, a)
        blit(frame, LOGO, 540, 1300, a)
        blit(frame, en("PHOTOS: WIKIMEDIA COMMONS CONTRIBUTORS (CC BY / CC BY-SA) · KEY ART: ALWAN", 26, tracking=2, fname="oswald", wght=400, glow=None, fill=(150, 150, 150)), 540, 1385, a * 0.9)

LOGO_IM = Image.open(f"{S}/assets/logo_white.png").convert("RGBA")
LOGO_IM = LOGO_IM.resize((int(LOGO_IM.width * 0.75), int(LOGO_IM.height * 0.75)), Image.LANCZOS)
_la = np.asarray(LOGO_IM).astype(np.float32) / 255
LOGO = np.concatenate([_la[..., :3] * _la[..., 3:4], _la[..., 3:4]], 2)

# ------------------------------------------------------------------ captions
def chunk_caption(text, maxc=34):
    words = text.split(); out = []; cur = ""
    for w_ in words:
        cand = (cur + " " + w_).strip()
        if len(cand) > maxc and cur:
            out.append(cur); cur = w_
        else:
            cur = cand
            if cur[-1] in "،,." and len(cur) >= 16: out.append(cur); cur = ""
    if cur: out.append(cur)
    return out

CAPS = []
for l in TL["lines"]:
    parts = chunk_caption(l["text"]); tot = sum(len(p) for p in parts); t = l["start"]; d = l["end"] - l["start"]
    for p in parts:
        dd = d * len(p) / tot
        CAPS.append(dict(id=l["id"], text=p, start=round(t, 3), end=round(t + dd, 3))); t += dd
# keep each caption on screen until the next one (if the gap is short)
for i in range(len(CAPS) - 1):
    gap = CAPS[i + 1]["start"] - CAPS[i]["end"]
    if 0 < gap < 0.6: CAPS[i]["end"] = CAPS[i + 1]["start"] - 0.03
CAPS = []

def cap_sprite(text):
    key = ("cap", text)
    if key in _cache: return _cache[key]
    sp = text_sprite(text, "cairo", 56, 700, fill=(255, 255, 255), ar=True, stroke=3, stroke_fill=(0, 0, 0))
    h, w = sp.shape[:2]
    box = np.zeros((h - 40, w - 30, 4), np.float32); box[..., 3] = 0.42
    _cache[key] = (sp, box); return _cache[key]

def draw_caption(frame, t):
    for cp in CAPS:
        if cp["id"] in ("19", "20"): continue        # end card shows these as titles
        if cp["start"] <= t < cp["end"]:
            sp, box = cap_sprite(cp["text"])
            a = min(1, (t - cp["start"]) / 0.08, (cp["end"] - t) / 0.08)
            blit(frame, box, 540, 1450, a); blit(frame, sp, 540, 1450, a)

# ------------------------------------------------------------------ frame
def render_shot(s, t, frame):
    t0, t1, gname, ca, cb, ez, bg, tag = s
    background(bg, t, frame)
    if gname is None: return
    u = (t - t0) / max(1e-3, t1 - t0)
    u = ease_in(u) if ez == "in" else ease_io(u) * 0.85 + u * 0.15
    cm = list(lerp(a_, b_, u) for a_, b_ in zip(ca, cb))
    if any(abs(t0 - h) < 1e-3 for h in HARD + WHIP) and t0 > 0:
        cm[2] *= 1 + 0.07 * math.exp(-(t - t0) * 9)          # punch-in that settles
    cm[0] += 3 * math.sin(t * 1.7) / cm[2]; cm[1] += 3 * math.cos(t * 1.3) / cm[2]   # subtle handheld drift
    cm = tuple(cm)
    sh = (0, 0)
    for ts in SHAKE:
        if 0 <= t - ts < 0.35:
            k = (1 - (t - ts) / 0.35) ** 2 * 16
            sh = (k * math.sin(t * 91), k * math.cos(t * 77))
    rgb, al = render_subject(gname, cm, sh)
    if t < c[2]:
        # S1: light reveal from darkness + rim sweep + heartbeat pulse
        r = lerp(0, 1500, ease_out((t - TN.HOOK_IMPACT) / 2.6)) if t >= TN.HOOK_IMPACT else 0
        lm = np.clip((r - np.sqrt((xx - 540) ** 2 + (yy - 700) ** 2)) / 520, 0, 1)[..., None]
        light = 0.08 + 0.92 * lm
        hb = sum(math.exp(-(t - h) * 9) for h in HB if t >= h) * 0.12
        rgb = rgb * light * (1 + hb)
        if TN.HOOK_IMPACT <= t < TN.HOOK_IMPACT + 1.7:
            band = np.exp(-(((xx + yy * 0.45) - lerp(-200, 2000, (t - TN.HOOK_IMPACT) / 1.7)) / 90) ** 2)[..., None]
            rgb = rgb + al * band * np.array([0.5, 0.42, 0.38]) * 0.6
    frame *= (1 - al); frame += rgb
    # streaks & particles
    if bg in ("stadium", "climax", "numbers2", "final", "photo_fx"):
        for k_, (col, period, ph) in enumerate((("red", 3.2, 0.0), ("green", 3.9, 1.3), ("white", 5.0, 2.1))):
            if bg == "final" and col != "white": continue
            p_ = ((t + ph) % period) / period
            blit(frame, STREAK[col], lerp(-700, W + 700, p_), lerp(H * 0.85, H * 0.15, p_) + k_ * 120, 0.55 * math.sin(math.pi * p_), add=True)
    if bg in ("dark", "soft", "final", "stadium", "photo", "photo_fx"): DUST.draw(frame, t, 0.8 if bg != "dark" else ease_io((t - 1) / 3) * 0.6)
    if bg == "climax": EMBER.draw(frame, t, 1.0)
    if bg == "glory": GOLD.draw(frame, t, 1.0)

def make_frame(t):
    frame = np.zeros((H, W, 3), np.float32)
    s = shot_at(t)
    render_shot(s, t, frame)
    for tc, dd in DISSOLVE.items():
        if tc - dd / 2 <= t < tc + dd / 2:
            prev = next(x for x in SHOTS if x[1] == tc); nxt = next(x for x in SHOTS if x[0] == tc)
            fa = np.zeros_like(frame); fb = np.zeros_like(frame)
            render_shot(prev, t, fa); render_shot(nxt, t, fb)
            k = ease_io((t - (tc - dd / 2)) / dd); frame = fa * (1 - k) + fb * k
    # whip-pan motion blur around cuts
    for tw in WHIP:
        dt = abs(t - tw)
        if dt < 0.12:
            n = int(90 * (1 - dt / 0.12)) + 1
            cs = np.cumsum(np.pad(frame, ((0, 0), (n, 0), (0, 0)), mode="edge"), 1)
            frame = (cs[:, n:] - cs[:, :-n]) / n
    # final shot -> black
    f0_, f1_ = TN.FADE_BLACK
    if f0_ <= t < f1_: frame *= 1 - ease_io((t - f0_) / (f1_ - f0_))
    for tl in LEAKS:   # warm light leak sweeping across on big cuts
        d_ = t - tl
        if -0.15 < d_ < 0.5:
            k_ = math.sin(math.pi * (d_ + 0.15) / 0.65) * 0.55
            frame += (radial(lerp(-200, 1300, (d_ + 0.15) / 0.65), 500, 650)[..., None] * np.array([1.0, 0.45, 0.15], np.float32) * k_)
    if t < TN.FADE_BLACK[0]: frame *= SCRIM
    draw_titles(frame, t)
    draw_tag(frame, t)
    for tf, d_, col in FLASH:
        if 0 <= t - tf < d_:
            k = (1 - (t - tf) / d_) ** 2 * 0.8
            frame = frame * (1 - k * 0.5) + np.array(col, np.float32) * k * 0.5
    frame *= VIG
    frame += GRAIN[int(t * FPS) % len(GRAIN)]
    if t < 0.08: frame *= t / 0.08
    if t > DUR - 0.5: frame *= max(0, (DUR - t) / 0.5)
    return frame

def to8(f): return (np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8)

def ff(path):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                             "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-threads", "2", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2",
                             "-x264-params", "keyint=60:min-keyint=30", path], stdin=subprocess.PIPE)

def worker(k, f0, f1):
    pc = ff(f"{B}/seg_final_{k}.mp4")
    for fi in range(f0, f1):
        t = fi / FPS
        fr = make_frame(t)
        pc.stdin.write(to8(fr).tobytes())
        if fi % 90 == 0: print(f"w{k} {fi}/{f1}", flush=True)
    pc.stdin.close(); pc.wait()

if __name__ == "__main__":
    if PREVIEW:
        for t in PREVIEW:
            fr = make_frame(t)
            Image.fromarray(to8(fr)).save(f"{B}/prev_{t:05.2f}.png")
        sys.exit()
    NF = int(round(DUR * FPS)); NW = 4
    bounds = [round(NF * i / NW) for i in range(NW + 1)]
    k = int(WORKER[1:]); worker(k, bounds[k], bounds[k + 1])
    print(f"w{k} DONE frames {bounds[k]}-{bounds[k+1]}", flush=True)
