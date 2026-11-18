import sys
S, EDL, OUTF = sys.argv[1:4]
sys.argv = [sys.argv[0], S, EDL, "/tmp/unused", "w9"]
sys.path.insert(0, S)
import numpy as np
from PIL import Image
import render_haroun as R
fr = np.zeros((R.H, R.W, 3), np.float32)
R.place_cover(fr, 0, 0, 1, z0=1.18, z1=1.18, cy=380)
fr *= np.clip(0.35 + 0.65 * (R.yy / 700), 0, 1)[..., None]
fr = fr * (1 - 0.8 * R.BOTTOM)
R.kicker(fr, 9, 0, 99, "تقرير خاص | صحيفة ألوان السودانية", 200)
R.rect(fr, 0, 1160, R.W, 1660, R.INK, 0.72)
R.rect(fr, 0, 1160, R.W, 1170, R.RED, 1)
sp = R.text("أحمد هارون..", 140, 900, (255, 255, 255)); R.blit(fr, sp, 540, 1290)
sp2 = R.text("ماذا قال قبل اعتقاله؟", 92, 900, (215, 36, 41), maxw=1040); R.blit(fr, sp2, 540, 1480)
lg = R.logo_sprite(110); R.blit(fr, lg, 540, 1755)
R.blit(fr, R.text("الصورة: السودان بودكاست", 26, 500, (170, 170, 170)), 540, 1880)
fr = fr * R.VIG
Image.fromarray(R.to8(fr)).save(OUTF, quality=95, subsampling=0); print("thumb ok")
