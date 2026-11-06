# -*- coding: utf-8 -*-
"""Generates Voiceover_Script.txt (full text + timed version + sync table) and Arabic_Subtitles.srt from episode.py"""
import os, sys, re
sys.path.insert(0, os.path.dirname(__file__))
from episode import SCENES, DURATION, TITLE, SUBTITLE
import subs

OUT = sys.argv[1]
def mmss(x): return f"{int(x // 60):02d}:{x % 60:05.2f}"

L = []
L.append(f"«{TITLE}» — {SUBTITLE}")
L.append(f"نص التعليق الصوتي | المدة: {DURATION:.0f} ثانية | 1080×1920 | 30 إطارًا/ث")
L.append("=" * 60)
L.append("العلامات:  /  سكتة قصيرة (~0.25 ث)   //  سكتة متوسطة (~0.5 ث)   ///  سكتة طويلة (~1 ث)")
L.append("[بهدوء] [بتشويق] [بتأكيد] [ببطء] [توقف]  = تعليمات أداء لا تُقرأ.")
L.append("سرعة القراءة المقترحة: هادئة (نحو 2–2.3 كلمة في الثانية). ابدأ كل مقطع عند التوقيت المكتوب.")
L.append("")
L.append("١) النص الكامل (للقراءة المتصلة)")
L.append("-" * 60)
for sc in SCENES: L.append(sc["vo"])
L.append("")
L.append("٢) النسخة المقسمة بالثواني")
L.append("-" * 60)
for sc in SCENES:
    L.append(f"[{mmss(sc['t0'])} – {mmss(sc['t1'])}]  ({sc['id']})")
    L.append(f"المشهد: {sc['scene_desc']}")
    L.append(f"التعليق الصوتي: {sc['vo']}")
    L.append(f"الأداء: {sc['perf']}")
    L.append(f"السكتة: {sc['pause']}")
    L.append("")
L.append("٣) جدول مزامنة الكلام والمشاهد والعناصر")
L.append("-" * 60)
L.append("المقطع | من | إلى | العنصر البصري | نص على الشاشة | مؤثرات صوتية")
for sc in SCENES:
    vis = sc.get("img") or sc["kind"]
    for k in ("cut", "cut2"):
        if k in sc: vis += f" ← {sc[k]['img']} @{sc[k]['at']}"
    txt = " / ".join(x for x in [sc.get("big"), sc.get("small"), sc.get("lower", "").replace("|", " – "), sc.get("tag"), sc.get("tag2"),
                                  sc.get("name_card", "").replace("|", " – ")] if x)
    if sc.get("timeline"): txt += f" / خط زمني: {sc['timeline']}"
    L.append(f"{sc['id']} | {mmss(sc['t0'])} | {mmss(sc['t1'])} | {vis} | {txt or '—'} | {', '.join(sc.get('sfx', [])) or '—'}")
L.append("")
L.append("٤) توقيت ظهور الترجمة (تقديري حتى تسجيل الصوت؛ يُعاد ضبطه على تسجيلك الفعلي)")
L.append("-" * 60)
for a, b, s in subs.CUES: L.append(f"{mmss(a)} → {mmss(b)}   {s}")
L.append("")
L.append("ملاحظات تسجيل:")
L.append("- سجّل في غرفة هادئة، الميكروفون على بعد 15–20 سم، بصيغة WAV 48kHz/24bit إن أمكن.")
L.append("- اترك 3 ثوانٍ صمت في بداية التسجيل (لأخذ بصمة الضوضاء عند التنقية).")
L.append("- يمكنك تسجيل كل مقطع في ملف مستقل (S01.wav … S12.wav) لتسهيل المزامنة.")
L.append("- الأرقام تُقرأ كاملة: «ألف وثمانمئة وأربعة وثلاثين»، وتظهر في الترجمة بالأرقام.")
open(os.path.join(OUT, "Voiceover_Script.txt"), "w", encoding="utf-8").write("\n".join(L) + "\n")
subs.write_srt(os.path.join(OUT, "Arabic_Subtitles.srt"))
print("docs ok")
