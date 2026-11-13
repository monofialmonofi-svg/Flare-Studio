import sys
S, OUTF = sys.argv[1:3]
sys.argv = [sys.argv[0], S, "x", "/tmp/unused", "w9"]; sys.path.insert(0, S)
import numpy as np
from PIL import Image, ImageFilter
import render_jaboura as R
fr = np.zeros((R.H, R.W, 3), np.float32)
img = R.V.frame(R.SEG["DECL"] + 3.0, 1.0)
sc = 1.35; big = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((int(1080 * sc), int(464 * sc)), Image.LANCZOS).filter(ImageFilter.UnsharpMask(2, 60, 2))).astype(np.float32) / 255
bg = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((R.W, R.H)).filter(ImageFilter.GaussianBlur(30))).astype(np.float32) / 255
fr[:] = bg * 0.4
crop = big[:, big.shape[1] - 1080:]          # right-aligned: the Al-Hadath bug stays in frame
y0 = 380; fr[y0:y0 + crop.shape[0]] = crop
R.rect(fr, 0, y0 - 4, R.W, y0, R.RED, 1); R.rect(fr, 0, y0 + crop.shape[0], R.W, y0 + 4 + crop.shape[0], R.RED, 1)
R.source(fr, 9, 0, 99, "المصدر: قناة الحدث", y0 + crop.shape[0] + 50)
R.rect(fr, 0, 1190, R.W, 1700, R.INK, 0.85); R.rect(fr, 0, 1190, R.W, 1200, R.RED, 1)
R.kicker(fr, 9, 0, 99, "تقرير خاص | صحيفة ألوان السودانية", 1250)
R.blit(fr, R.T("انشقاق جديد", 128, 900, (255, 255, 255), "alex"), 540, 1370)
R.blit(fr, R.T("أمير المسيرية بوسط دارفور يغادر الميليشيا", 60, 900, (215, 36, 41), "alex", maxw=1000), 540, 1520)
R.blit(fr, R.T("ويعلن اصطفافه مع القوات المسلحة", 46, 0, (216, 218, 217), "tajm"), 540, 1640)
R.blit(fr, R.logo_sprite(105), 540, 1780)
fr = fr * R.VIG
Image.fromarray(R.to8(fr)).save(OUTF, quality=95, subsampling=0); print("thumb ok")
