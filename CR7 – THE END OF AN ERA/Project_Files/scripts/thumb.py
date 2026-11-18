"""Cinematic thumbnail / Reels cover 1080x1920. Usage: thumb.py SCRATCH BUILD OUT.jpg"""
import sys
S, B, OUT = sys.argv[1:4]
sys.argv = [sys.argv[0], S, B]
sys.path.insert(0, S)
import numpy as np
from PIL import Image
import render as R

f = np.zeros((R.H, R.W, 3), np.float32)
R.background("climax", 3.0, f)
rgb, al = R.render_subject("main", R.cam("FULL", 0.9, dy=150))
f *= (1 - al); f += rgb
R.blit(f, R.STREAK["red"], 300, 1350, 0.5, add=True)
R.blit(f, R.STREAK["green"], 800, 1550, 0.35, add=True)
R.EMBER.draw(f, 2.0, 1.0)
f *= np.clip(0.30 + 0.70 * (R.yy / 820), 0, 1)[..., None]
f *= np.clip(0.35 + 0.65 * ((R.H - R.yy) / 620), 0, 1)[..., None]
R.blit(f, R.fit(R.ar("نهاية حقبة؟", 190, 1000, glow=(220, 20, 30, 30, 0.9))), 540, 300)
R.blit(f, R.fit(R.en("THE END OF AN ERA?", 104, tracking=6, glow=(0, 0, 0, 16, 0.8))), 540, 470)
f *= np.clip(0.25 + 0.75 * ((R.H - 120 - R.yy) / 520), 0.25, 1)[..., None]
for x, num, lab in ((800, "234", "مباراة دولية"), (280, "146", "هدفاً دولياً")):
    R.blit(f, R.en(num, 170, glow=(220, 20, 30, 24, 0.9)), x, 1600)
    R.blit(f, R.ar(lab, 52, 800, glow=None, fill=(235, 235, 235)), x, 1715)
f *= R.VIG
f += R.GRAIN[0] * 0.6
Image.fromarray(R.to8(f)).save(OUT, quality=95, subsampling=0)
print("thumb ok")
