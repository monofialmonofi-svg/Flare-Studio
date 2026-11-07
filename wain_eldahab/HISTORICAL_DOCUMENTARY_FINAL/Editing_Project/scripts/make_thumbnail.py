# -*- coding: utf-8 -*-
"""Thumbnail 1080x1920.  usage: make_thumbnail.py OUT.jpg [YOUR_PHOTO_CUTOUT.png]
Without a photo -> TEMPLATE with a marked area for the presenter (never substitutes another person).
With a photo (ideally a PNG cut-out with transparent background) -> composited as-is: no face/expression edits."""
import sys, os
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
sys.path.insert(0, os.path.dirname(__file__))
import render as R
out = sys.argv[1]; photo = sys.argv[2] if len(sys.argv) > 2 else None
# background: broken-top pyramids (real photo of Meroe, truncated pyramids), dramatic grade
bg = R.kenburns("P05_meroe_de_walick_2.jpg", 0, dict(z0=1.0, z1=1.0, x0=.12, x1=.12, y0=.5, y1=.5))
bg = ImageEnhance.Contrast(bg.convert("RGB")).enhance(1.25).convert("RGBA")
bg.alpha_composite(R.vignette())
# warm rim light glow from right
glow = Image.new("RGBA", (R.W, R.H), (0, 0, 0, 0)); ImageDraw.Draw(glow).ellipse((500, 200, 1500, 1300), fill=(255, 170, 60, 70))
bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(160)))
if photo:
    # photo used unaltered: crop + scale only (no retouching, no expression changes)
    from PIL import ImageOps
    src = ImageOps.exif_transpose(Image.open(photo)).convert("RGB")
    if src.mode != "RGBA" and not photo.lower().endswith(".png"):
        cx = float(os.environ.get('THUMB_CX', '.6')); cyt = float(os.environ.get('THUMB_Y0', '.17'))
        cw = int(src.width * .87); ch = int(cw / .72); x0 = int(min(max(src.width * cx - cw / 2, 0), src.width - cw)); y0 = int(src.height * cyt)
        src = src.crop((x0, y0, x0 + cw, min(src.height, y0 + ch)))
        tw = 640; th = int(src.height * tw / src.width)
        ph = src.resize((tw, th), Image.LANCZOS).convert("RGBA")
        fr = Image.new("RGBA", (tw + 20, th + 20), R.GOLD + (255,)); fr.alpha_composite(ph, (10, 10))
        sh = Image.new("RGBA", (fr.width + 100, fr.height + 100), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rectangle((50, 60, fr.width + 50, fr.height + 60), fill=(0, 0, 0, 190))
        sh = sh.filter(ImageFilter.GaussianBlur(25))
        fr = fr.rotate(-3, expand=True, resample=Image.BICUBIC); sh = sh.rotate(-3, expand=True, resample=Image.BICUBIC)
        X, Y = R.W - fr.width - 30, R.H - fr.height - 110
        bg.alpha_composite(sh, (X - 50, Y - 40)); bg.alpha_composite(fr, (X, Y))
    else:
        p = Image.open(photo).convert("RGBA"); s = 1150 / p.height
        p = p.resize((int(p.width * s), int(p.height * s)), Image.LANCZOS)
        bg.alpha_composite(p, (R.W - p.width - 40, R.H - p.height - 120))
else:
    d = ImageDraw.Draw(bg)
    box = (380, 900, 1000, 1760)
    for i in range(0, 2 * (box[2] - box[0] + box[3] - box[1]), 40):  # dashed rectangle
        pass
    d.rounded_rectangle(box, 40, outline=(255, 255, 255, 200), width=6)
    R.paste(bg, R.text_img("مكان صورتك هنا", 60, "Cairo-Black.ttf", fill=(255, 255, 255)), (box[0] + box[2]) / 2, (box[1] + box[3]) / 2 - 40)
    R.paste(bg, R.text_img("(صورة واضحة للوجه بتعبير فضول)", 34, "Cairo-Bold.ttf", fill=(235, 225, 205)), (box[0] + box[2]) / 2, (box[1] + box[3]) / 2 + 40)
R.paste(bg, R.text_img("وين الدهب؟", 210, "Cairo-Black.ttf", fill=R.GOLD, stroke=7, stroke_fill=(20, 10, 0), maxw=R.W - 100), R.W / 2, 420)
bg.convert("RGB").save(out, quality=92)
print("ok", out)
