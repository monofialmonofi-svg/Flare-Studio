مشروع المونتاج — «وين الدهب؟»
المشروع كله مبني بالكود (قابل لإعادة التصدير بدقة)، والمصدر الحقيقي هو مجلد WORK/ في المستودع.

الملفات:
  scripts/episode.py          المشاهد، التوقيتات، نص التعليق، النصوص على الشاشة، المؤثرات  ← عدّل هنا
  scripts/render.py           محرك المونتاج: حركة الصور، التلوين، الخرائط، الخط الزمني، العدّاد، الترجمة
  scripts/subs.py             توليد الترجمة SRT من النص
  scripts/make_map.py         رسم الخريطة الأساسية
  scripts/make_audio.py       الموسيقى والمؤثرات (مولّدة أصليًا)
  scripts/mix_and_export.sh   المكساج والتصدير (مع أو بدون تعليقك الصوتي)
  scripts/make_thumbnail.py   الصورة المصغرة
  scripts/make_docs.py        نص التعليق + جدول المزامنة + SRT

إعادة التصدير (من داخل WORK/):
  python3 scripts/make_audio.py audio
  python3 scripts/render.py renders/full_noaudio.mp4
  scripts/mix_and_export.sh renders/full_noaudio.mp4 ../HISTORICAL_DOCUMENTARY_FINAL/Final_Video.mp4 ../VOICEOVER/voiceover.wav
المتطلبات: Python 3 + Pillow (مع libraqm) + numpy + scipy + basemap، و ffmpeg.

بعد تسجيل صوتك: ضع الملف في VOICEOVER/ وسأضبط توقيتات المشاهد والترجمة على كلامك الفعلي ثم أصدّر Final_Video.mp4.
