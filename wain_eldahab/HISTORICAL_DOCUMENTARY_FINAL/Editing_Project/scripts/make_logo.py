# -*- coding: utf-8 -*-
"""Series logo «وين الدهب؟» — original design (own work).
Badge: dark sand disc, double gold ring, stepped Meroitic-style pyramid with its apex missing; a gold «؟» floats
where the apex should be (the missing top / the missing gold). Title + «سلسلة وثائقية» under it.
Outputs transparent PNGs: logo.png (badge, 1200²), logo_wordmark.png (horizontal), logo_preview.jpg"""
import os, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FONTS = os.path.join(ROOT, "fonts"); OUT = os.path.join(ROOT, "LOGOS_AND_BRANDING")
os.makedirs(OUT, exist_ok=True)
S = 2400  # supersampled canvas, downsized to 1200
GOLD_HI, GOLD, GOLD_LO = (255, 222, 140), (232, 182, 72), (150, 100, 30)
DARK = (34, 22, 12); DARK2 = (58, 38, 20)
def F(n, s): return ImageFont.truetype(os.path.join(FONTS, n), s)

def gold_fill(size, angle_v=True):
    """vertical metallic gradient with a soft specular band"""
    w, h = size; y = np.linspace(0, 1, h)[:, None]
    stops = np.array([[255, 230, 160], [240, 190, 80], [190, 130, 40], [250, 210, 120], [160, 105, 30]], float)
    pos = np.array([0, .3, .55, .72, 1])
    rgb = np.stack([np.interp(y[:, 0], pos, stops[:, c]) for c in range(3)], 1)
    img = np.repeat(rgb[:, None, :], w, 1).astype(np.uint8)
    return Image.fromarray(img, "RGB").convert("RGBA")

def text_mask(s, font, size):
    m = Image.new("L", size, 0); d = ImageDraw.Draw(m)
    bb = d.textbbox((0, 0), s, font=font, direction="rtl", language="ar")
    d.text(((size[0] - (bb[2] - bb[0])) / 2 - bb[0], (size[1] - (bb[3] - bb[1])) / 2 - bb[1]), s, font=font, fill=255,
           direction="rtl", language="ar")
    return m

def gold_text(s, font, size, stroke=0):
    m = text_mask(s, font, size)
    g = gold_fill(size); g.putalpha(m)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    if stroke:
        sm = m.filter(ImageFilter.MaxFilter(stroke * 2 + 1))
        dark = Image.new("RGBA", size, DARK + (255,)); dark.putalpha(sm); out.alpha_composite(dark)
    out.alpha_composite(g)
    return out

def pyramid(size):
    """stepped pyramid, apex removed (flat broken top), gold with darker right face"""
    w, h = size; im = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    base_y, top_y = h * .96, h * .30
    bl, br = w * .24, w * .76
    apex_x = w * .5
    def x_at(y, side):  # pyramid edge at height y (steep Nubian slope)
        t = (base_y - y) / (base_y - h * .02)
        return apex_x + (br - apex_x) * (1 - t) if side > 0 else apex_x - (apex_x - bl) * (1 - t)
    # silhouette (left lit face, right shaded face)
    L = [(bl, base_y), (x_at(top_y, -1), top_y), (apex_x, top_y), (apex_x, base_y)]
    R = [(apex_x, base_y), (apex_x, top_y), (x_at(top_y, 1), top_y), (br, base_y)]
    mask_l = Image.new("L", size, 0); ImageDraw.Draw(mask_l).polygon(L, fill=255)
    mask_r = Image.new("L", size, 0); ImageDraw.Draw(mask_r).polygon(R, fill=255)
    g = gold_fill(size)
    lit = g.copy(); lit.putalpha(mask_l); im.alpha_composite(lit)
    sh = Image.blend(g.convert("RGB"), Image.new("RGB", size, GOLD_LO), .55).convert("RGBA"); sh.putalpha(mask_r); im.alpha_composite(sh)
    # stone courses
    d = ImageDraw.Draw(im); n = 9
    for k in range(1, n):
        y = top_y + (base_y - top_y) * k / n
        d.line((x_at(y, -1), y, x_at(y, 1), y), fill=(110, 70, 20, 200), width=max(3, w // 260))
        off = (k % 2) * .5
        for j in range(-6, 7):
            xx = apex_x + (j + off) * w * .075
            yy0 = y - (base_y - top_y) / n
            if x_at(y, -1) + 8 < xx < x_at(y, 1) - 8:
                d.line((xx, yy0 + 4, xx, y - 4), fill=(110, 70, 20, 150), width=max(2, w // 400))
    # broken jagged top edge + a few fallen blocks
    jag = [(x_at(top_y, -1), top_y)]
    xs = np.linspace(x_at(top_y, -1), x_at(top_y, 1), 9)
    for i, xx in enumerate(xs[1:-1]): jag.append((xx, top_y + (14 if i % 2 else -10) * w / 1000))
    jag.append((x_at(top_y, 1), top_y))
    d.line(jag, fill=(255, 235, 180, 255), width=max(4, w // 220))
    return im

def badge():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    c = S / 2; R = S * .48
    # drop shadow
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0)); ImageDraw.Draw(sh).ellipse((c - R, c - R + 30, c + R, c + R + 30), fill=(0, 0, 0, 160))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(40)))
    # disc with radial gradient
    y, x = np.mgrid[0:S, 0:S]; r = np.sqrt((x - c) ** 2 + (y - c * .85) ** 2) / R
    base = np.clip(1 - r * .55, 0, 1)[..., None]
    disc = (np.array(DARK, float) + (np.array(DARK2, float) - np.array(DARK, float)) * base * 1.6).clip(0, 255).astype(np.uint8)
    disc = Image.fromarray(disc, "RGB").convert("RGBA")
    m = Image.new("L", (S, S), 0); ImageDraw.Draw(m).ellipse((c - R, c - R, c + R, c + R), fill=255); disc.putalpha(m)
    im.alpha_composite(disc)
    # gold rings
    ring = gold_fill((S, S)); rm = Image.new("L", (S, S), 0); dr = ImageDraw.Draw(rm)
    dr.ellipse((c - R, c - R, c + R, c + R), outline=255, width=int(S * .022))
    dr.ellipse((c - R * .90, c - R * .90, c + R * .90, c + R * .90), outline=255, width=int(S * .007))
    # small diamond studs on inner ring (N, S, E, W)
    for a in (0, 90, 180, 270):
        px, py = c + R * .95 * math.cos(math.radians(a)), c + R * .95 * math.sin(math.radians(a)); q = S * .014
        dr.polygon([(px, py - q), (px + q, py), (px, py + q), (px - q, py)], fill=255)
    ring.putalpha(rm); im.alpha_composite(ring)
    # pyramid
    pw, ph = int(S * .52), int(S * .40)
    py_img = pyramid((pw, ph)); px0, py0 = int(c - pw / 2), int(S * .20)
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0)); ImageDraw.Draw(glow).ellipse((c - S * .2, S * .14, c + S * .2, S * .42), fill=(255, 190, 80, 90))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))
    im.alpha_composite(py_img, (px0, py0))
    # floating gold «؟» where the apex should be
    q = gold_text("؟", F("Cairo-Black.ttf", int(S * .17)), (int(S * .25), int(S * .25)), stroke=10)
    qg = Image.new("RGBA", (S, S), (0, 0, 0, 0)); qg.alpha_composite(q, (int(c - q.width / 2), int(S * .065)))
    halo = qg.getchannel("A").filter(ImageFilter.GaussianBlur(40)).point(lambda v: int(v * .7))
    hl = Image.new("RGBA", (S, S), (255, 200, 90, 0)); hl.putalpha(halo); im.alpha_composite(hl); im.alpha_composite(qg)
    # title + subtitle
    t = gold_text("وين الدهب؟", F("Cairo-Black.ttf", int(S * .135)), (int(S * .86), int(S * .22)), stroke=8)
    im.alpha_composite(t, (int(c - t.width / 2), int(S * .58)))
    st = text_mask("سلسلة وثائقية", F("Cairo-Bold.ttf", int(S * .052)), (int(S * .6), int(S * .09)))
    stl = Image.new("RGBA", st.size, (240, 222, 190, 255)); stl.putalpha(st)
    im.alpha_composite(stl, (int(c - st.width / 2), int(S * .775)))
    dd = ImageDraw.Draw(im)  # ornamental lines either side of subtitle
    yy = S * .765
    dd.line((c - S * .22, yy, c + S * .22, yy), fill=GOLD + (200,), width=int(S * .004))
    return im.resize((1200, 1200), Image.LANCZOS)

def wordmark(b):
    W, H = 2000, 600; im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sm = b.resize((560, 560), Image.LANCZOS); im.alpha_composite(sm, (W - 580, 20))
    t = gold_text("وين الدهب؟", F("Cairo-Black.ttf", 230), (1400, 340), stroke=6); im.alpha_composite(t, (0, 40))
    st = text_mask("سلسلة وثائقية تاريخية", F("Cairo-Bold.ttf", 80), (1400, 140))
    stl = Image.new("RGBA", st.size, (240, 222, 190, 255)); stl.putalpha(st); im.alpha_composite(stl, (0, 380))
    return im

if __name__ == "__main__":
    b = badge(); b.save(os.path.join(OUT, "logo.png"))
    wordmark(b).save(os.path.join(OUT, "logo_wordmark.png"))
    pv = Image.new("RGB", (2400, 1300), (245, 238, 225)); pv.paste(b, (40, 50), b)
    dk = Image.new("RGB", (1100, 1300), (18, 12, 8)); dk.paste(b.resize((1000, 1000)), (50, 150), b.resize((1000, 1000)))
    pv.paste(dk, (1300, 0)); pv.save(os.path.join(OUT, "logo_preview.jpg"), quality=90)
    print("ok")
