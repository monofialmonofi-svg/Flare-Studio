import sys
S, OUTF = sys.argv[1:3]
sys.argv = [sys.argv[0], S, "x", "/tmp/unused", "w9"]; sys.path.insert(0, S)
import numpy as np
from PIL import Image
import render_appiah as R
fr = np.zeros((R.H, R.W, 3), np.float32)
R.place_photo(fr, "appiah_portrait", 0, 1.0, 1.0, fy=0.18, y_off=140)
fr *= np.clip(0.35 + 0.65 * (R.yy / 700), 0, 1)[..., None]
R.kicker(fr, 9, 0, 99, "تحقيق خاص | صحيفة ألوان السودانية", 1095)
R.rect(fr, 0, 1150, R.W, 1690, R.INK, 0.8); R.rect(fr, 0, 1150, R.W, 1160, R.RED, 1)
R.blit(fr, R.T("منتخب السودان..", 112, 900, (255, 255, 255), "alex"), 540, 1265)
R.blit(fr, R.T("من يدير المشهد خلف الكواليس؟", 72, 900, (215, 36, 41), "alex", maxw=1020), 540, 1420)
R.blit(fr, R.T("كواليس أزمة أبياه", 46, 0, (216, 218, 217), "tajm"), 540, 1560)
R.blit(fr, R.logo_sprite(105), 540, 1770)
R.blit(fr, R.T("صورة أرشيفية: Wikimedia Commons (CC BY-SA 4.0)", 24, 0, (160, 160, 160), "tajm"), 540, 1880)
fr = fr * R.VIG
Image.fromarray(R.to8(fr)).save(OUTF, quality=95, subsampling=0); print("thumb ok")
