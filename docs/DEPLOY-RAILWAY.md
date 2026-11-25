# النشر على Railway

الملفات: `Dockerfile` (Node 22 + ffmpeg) · `railway.json` (البناء، فحص الصحة `/healthz`، نسخة واحدة) · `.dockerignore`.

## الخطوات
1. ارفع المشروع إلى GitHub، ثم في Railway: **New Project ← Deploy from GitHub repo** واختر الفرع.
2. **أضف Volume** (Settings ← Volumes) وحدّد **Mount path = `/data`**. بدونه تضيع القاعدة والوسائط عند كل نشر.
3. أضف المتغيرات في **Variables**:

| المتغير | القيمة |
|---|---|
| `NODE_ENV` | `production` (موجود في الصورة، ويُفضّل ضبطه) |
| `DATA_DIR` | `/data` |
| `TRUST_PROXY` | `1` (Railway خلف بروكسي) |
| `APP_URL` | رابط الخدمة النهائي، مثل `https://xxx.up.railway.app` أو دومينك |
| `SMTP_URL` | مثل `smtps://user:pass@smtp.example.com:465` — **مطلوب** (انظر التنبيه) |
| `MAIL_FROM` | `LAMMA <no-reply@دومينك>` |
| `ADMIN_EMAIL` | بريدك؛ يصبح مسؤولًا **بعد تأكيده** |

4. فعّل الدومين: **Settings ← Networking ← Generate Domain** (أو دومين خاص). ثم حدّث `APP_URL`.
5. بعد أول نشر وإنشاء حسابك، يمكنك ترقيته من الطرفية: `railway ssh` ثم
   `npm run make-admin -- بريدك@example.com`

## تنبيهات مهمة
- **البريد:** في الإنتاج يلزم تأكيد البريد قبل النشر والتعليق. بدون `SMTP_URL` لن تصل الرسائل ولن يستطيع أحد النشر. للتجربة فقط يمكنك ضبط `REQUIRE_VERIFIED_EMAIL=false`.
- **نسخة واحدة فقط:** القاعدة SQLite والمحدّد في الذاكرة، فلا ترفع `numReplicas` فوق 1.
- **الحاوية تعمل كـ root** لأن مجلد الـVolume يُركَّب بصلاحيات root؛ هذا توافق مقصود مع Railway.
- **رفع الفيديو:** يُعالَج داخل الطلب نفسه؛ الفيديوهات الكبيرة تحتاج موارد (CPU/ذاكرة) كافية في خطتك.
- **النسخ الاحتياطي:** خذ نسخًا دورية من Volume `/data` (Railway يوفّر Backups للـVolumes في بعض الخطط، تحقق من خطتك).
- لم أنشر فعليًا على Railway من هذه البيئة؛ الملفات جُهّزت واختُبر ما أمكن محليًا.
