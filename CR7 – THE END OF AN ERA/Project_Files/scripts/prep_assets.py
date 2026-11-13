import sys, numpy as np
from PIL import Image, ImageFilter
UP = "/root/.claude/uploads/62a655d1-6d66-5dd9-94fa-b411a95fecf6"
OUT = sys.argv[1]

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

# --- poster: 2x lanczos upscale + gentle sharpen, then key out the white backdrop
im = Image.open(f"{UP}/ac1cd8ed-image.jpg").convert("RGB")
im2 = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
im2 = im2.filter(ImageFilter.UnsharpMask(radius=2.2, percent=70, threshold=2))
a = np.asarray(im2).astype(np.float32)
mn = a.min(2); mx = a.max(2)
d = 255 - mn                     # distance from white
sat = mx - mn
alpha = np.maximum(smooth(14, 46, d), smooth(10, 30, sat))
al = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
alpha = np.asarray(al).astype(np.float32) / 255
from scipy import ndimage
fg = ndimage.binary_fill_holes(alpha > 0.35)
fg = ndimage.binary_erosion(fg, iterations=3)
fillm = np.asarray(Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255
alpha = np.maximum(alpha, fillm)
# decontaminate white fringe: un-premultiply against white
rgb = a.copy()
am = np.clip(alpha, 0.05, 1)[..., None]
rgb = np.clip((rgb - 255 * (1 - am)) / am, 0, 255)
rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
Image.fromarray(rgba, "RGBA").save(f"{OUT}/poster_cut.png")
im2.save(f"{OUT}/poster_up.png")

# --- logo: dark letters -> white, red dot keeps red, grey map removed
lg = np.asarray(Image.open(f"{UP}/0398b7f3-image.jpg").convert("RGB")).astype(np.float32)
r, g, b = lg[..., 0], lg[..., 1], lg[..., 2]
red = smooth(60, 120, r - (g + b) / 2)
dark = smooth(150, 90, lg.max(2)) * (1 - red)
out = np.zeros(lg.shape[:2] + (4,), np.float32)
out[..., :3] = 255
out[..., 0] = 255 * (1 - red) + 226 * red; out[..., 1] = 255 * (1 - red) + 32 * red; out[..., 2] = 255 * (1 - red) + 40 * red
out[..., 3] = np.clip(dark + red, 0, 1) * 255
L = Image.fromarray(out.astype(np.uint8), "RGBA")
L = L.crop(L.getbbox())
L.save(f"{OUT}/logo_white.png")
print("ok", im2.size, L.size)
