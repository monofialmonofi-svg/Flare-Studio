مشروع المونتاج — «وين الدهب؟»
المشروع كله مبني بالكود (قابل لإعادة التصدير (من داخل WORK/):
  python3 scripts/process_voice.py ../VOICEOVER/voiceover_original.m4a ../VOICEOVER/voiceover_processed.wav   # تنقية + قص الإعادات + EQ + ضغط + -16 LUFS
  python3 scripts/make_audio.py audio                                       # المؤثرات الصوتية
  python3 scripts/render.py renders/full_noaudio.mp4                        # الصورة
  python3 scripts/mix_final.py renders/full_noaudio.mp4 ../VOICEOVER/voiceover_processed.wav ../HISTORICAL_DOCUMENTARY_FINAL/Final_Video.mp4
  python3 scripts/make_docs.py ../HISTORICAL_DOCUMENTARY_FINAL               # SRT + نص التعليق
scripts/timing.py: محاذاة كل جملة على تسجيلك، ومواضع القص (الإعادات)، وتقصير السكتات.
المتطلبات: Python 3 + Pillow (libraqm) + numpy + scipy + basemap + noisereduce + soundfile، و ffmpeg.
