import sys
S0 = sys.argv[1]; sys.argv = [sys.argv[0], S0, "x", sys.argv[2]]
exec(open(f"{S0}/render_sfa_head.py", encoding="utf-8").read())
R = "/home/user/Flare-Studio/SFA_MUTASIM_JAAFAR_INVESTIGATION/03_ASSETS/PHOTOS"
im = Image.open(f"{R}/merrikh_stadium_1.jpg").convert("RGB")
s = H / im.height * 1.0; im = im.resize((int(im.width * s), H), Image.LANCZOS); x0 = (im.width - W) // 2 + 60
x = np.asarray(im.crop((x0, 0, x0 + W, H))).astype(np.float32) / 255
lum = (x * np.array([0.299, 0.587, 0.114])).sum(2, keepdims=True); x = lum + (x - lum) * 0.55
fr = x * 0.55; fr = fr * (1 - 0.75 * np.clip((yy - 700) / 900, 0, 1)[..., None] ** 1.1) * VIG
rect(fr, 0, 0, W, 230, INK, 0.55)
blit(fr, logo_sprite(90), W - 70 - logo_sprite(90).shape[1] / 2, 115, 1.0)
kicker(fr, 5, 0, 10, "تحقيق | صحيفة ألوان السودانية", 1010)
l1 = T("من المنتخب إلى خزينة الاتحاد..", 66, 900, (255, 255, 255), "alex", maxw=1000, stroke=2); y = 1080
blit(fr, l1, 540, y + l1.shape[0] / 2, 1); y += l1.shape[0] + 30
sp = T("ماذا يحدث داخل اتحاد الكرة السوداني؟", 60, 900, (255, 255, 255), "alex", maxw=940)
rect(fr, 540 - sp.shape[1] / 2 - 30, y, 540 + sp.shape[1] / 2 + 30, y + sp.shape[0] + 40, RED, 0.95); blit(fr, sp, 540, y + 20 + sp.shape[0] / 2, 1); y += sp.shape[0] + 80
s3 = T("خمس سنوات من عهد معتصم جعفر: المنتخب · المال · التسجيلات · الحوكمة", 36, 0, (230, 230, 230), "tajm", maxw=940)
blit(fr, s3, 540, y + s3.shape[0] / 2, 1)
blit(fr, T("ملعب المريخ – أم درمان (2022)", 24, 0, (170, 170, 170), "tajm"), 540, 1860, 1)
Image.fromarray((np.clip(fr, 0, 1) * 255).astype(np.uint8)).save(sys.argv[3], quality=93)
