# -*- coding: utf-8 -*-
"""Re-times the episode to the presenter's real voiceover.
Source: VOICEOVER/voiceover_original.m4a (presenter's own recording).
ALIGN = script chunks -> (start,end) in the ORIGINAL recording, measured with speech-energy analysis
and checked against an offline Whisper transcript. CUTS = false starts / retakes removed.
Long pauses are shortened to MAXPAUSE. Exports SCENES, DURATION, CUES, EDL (kept source ranges)."""
import copy, os, sys, re
sys.path.insert(0, os.path.dirname(__file__))
import episode as E

LEAD = 0.45          # video time before the first word
TAIL = 3.2           # end card hold after the last word
MAXPAUSE = 0.65      # longer pauses in the recording are shortened to this
SPEECH_END = 111.2

# (scene, subtitle text, src_start, src_end)
ALIGN = [
 ("S01", "في قلب صحراء السودان…", 6.52, 8.07), ("S01", "أهرامات مقطوعة الرؤوس", 8.91, 10.81),
 ("S02", "تقول الحكاية الشائعة:", 12.83, 14.00), ("S02", "إن رجلا واحدا هدم أربعين هرما…", 15.00, 17.09),
 ("S02", "بحثا عن الذهب", 21.17, 22.32),
 ("S03", "نحن في مروي", 24.63, 25.45), ("S03", "على بعد نحو 200 كيلومتر", 25.45, 27.98), ("S03", "شمال شرقي الخرطوم", 28.41, 29.80),
 ("S04", "هنا دفن ملوك مملكة كوش وملكاتها", 30.70, 33.85), ("S04", "منذ القرن الثالث قبل الميلاد", 34.87, 37.20),
 ("S05", "عام 1821", 40.16, 41.96), ("S05", "زارها الرحالة الفرنسي فريدريك كايو", 41.96, 44.26),
 ("S05", "ورسم عددا منها بحالة جيدة", 45.09, 47.25),
 ("S06", "وبعد ثلاث عشرة سنة", 47.25, 48.86), ("S06", "عام 1834", 49.26, 51.58),
 ("S06", "وصل طبيب إيطالي اسمه جوزيبي فرليني…", 51.58, 54.49), ("S06", "يلاحق حكاية عن ذهب مدفون", 57.53, 59.71),
 ("S07", "اختار هرم الملكة الكنداكة أماني شاخيتو", 60.63, 63.26), ("S07", "من أكبر أهرامات مروي", 64.16, 66.10),
 ("S07", "وبدأ يفككه… من القمة", 66.76, 68.70),
 ("S08", "وهناك… وجد الذهب", 69.41, 71.13), ("S08", "مجوهرات من الذهب والفضة", 71.63, 73.57), ("S08", "عمرها نحو ألفي عام", 74.68, 76.33),
 ("S09", "وانتهى الكنز في أوروبا:", 77.10, 78.61), ("S09", "جزء في ميونخ", 79.47, 80.55), ("S09", "ومعظمه في برلين", 80.55, 81.71),
 ("S10", "لكن… ماذا عن الأربعين هرما؟", 85.41, 87.56), ("S10", "فرليني نفسه ذكر أنه فكك خمسة أهرامات", 88.74, 91.52),
 ("S10", "أو ستة", 91.52, 92.16),
 ("S11", "أما عالم الآثار الألماني ليبسيوس", 92.16, 94.66), ("S11", "فكتب عام 1844", 95.13, 97.30),
 ("S11", "أن اكتشافه جر الخراب على أهرامات كثيرة", 97.30, 101.06),
 ("S12", "الذهب اليوم في متاحف أوروبا…", 102.69, 104.49), ("S12", "فلمن يجب أن يكون؟", 104.49, 108.41),
 ("S12", "اكتب رأيك… وتابعنا", 108.41, 110.95),
]
# false starts / retakes removed from the recording (src seconds)
CUTS = [(0.0, 6.30), (17.75, 21.05), (37.22, 40.08), (54.90, 57.42), (81.85, 85.30), (SPEECH_END, 1e9)]
# silences in the recording (measured, src seconds) used for pause shortening
SILENCES = [(8.07, 8.91), (10.81, 12.83), (14.00, 15.00), (22.32, 24.63), (29.80, 30.70), (33.85, 34.87),
            (44.26, 44.95), (48.86, 49.26), (59.71, 60.63), (63.26, 64.16), (66.10, 66.76), (68.70, 69.41),
            (71.13, 71.63), (73.57, 74.68), (76.33, 77.10), (78.61, 79.47), (87.56, 88.74), (94.66, 95.13),
            (101.06, 102.04), (102.32, 102.69)]

def build_edl():
    keep = [(0.0, 1e9)]
    for a, b in CUTS:
        nk = []
        for x, y in keep:
            if b <= x or a >= y: nk.append((x, y)); continue
            if x < a: nk.append((x, a))
            if b < y: nk.append((b, y))
        keep = nk
    # shorten long silences: drop the middle of each silence longer than MAXPAUSE
    for a, b in SILENCES:
        if b - a > MAXPAUSE:
            m = (b - a - MAXPAUSE) / 2
            ca, cb = a + MAXPAUSE / 2, b - MAXPAUSE / 2
            nk = []
            for x, y in keep:
                if cb <= x or ca >= y: nk.append((x, y)); continue
                if x < ca: nk.append((x, ca))
                if cb < y: nk.append((cb, y))
            keep = nk
    return [(round(x, 3), round(y, 3)) for x, y in keep if y - x > 0.02]
EDL = build_edl()

def dst(t):
    """source time -> edited-voiceover time (+LEAD = video time)"""
    acc = 0.0
    for x, y in EDL:
        if t < x: return acc + LEAD
        if t <= y: return acc + (t - x) + LEAD
        acc += y - x
    return acc + LEAD
VO_LEN = sum(y - x for x, y in EDL)

# ---- new scene boundaries ----
first = {}
for sc, tx, a, b in ALIGN: first.setdefault(sc, a)
old = {s["id"]: s for s in E.SCENES}
ids = [s["id"] for s in E.SCENES]
starts = {}
last_end = {}
for sc, tx, a, b in ALIGN: last_end[sc] = b
for i, sid in enumerate(ids):
    starts[sid] = 0.0 if i == 0 else round(max(dst(first[sid]) - 0.3, dst(last_end[ids[i - 1]]) + 0.02), 2)
last_word = max(dst(b) for _, _, _, b in ALIGN)
DURATION = round(last_word + TAIL, 2)

def anchor(sid, src):  # helper: video time of a source-time anchor
    return round(dst(src), 2)

SCENES = []
for i, sid in enumerate(ids):
    o = old[sid]; s = copy.deepcopy(o)
    t0 = starts[sid]; t1 = starts[ids[i + 1]] if i + 1 < len(ids) else DURATION
    k = (t1 - t0) / (o["t1"] - o["t0"])
    R = lambda t: round(t0 + (t - o["t0"]) * k, 2)
    s["t0"], s["t1"], s["k"] = t0, t1, k
    for c in ("cut", "cut2"):
        if c in s: s[c]["at"] = R(s[c]["at"])
    for f in ("big_at", "count_end", "reveal"):
        if f in s: s[f] = R(s[f])
    sfx = []
    for x in s.get("sfx", []):
        if "@" not in x: sfx.append(x); continue
        n, at = x.split("@")
        if "-" in at:
            a, b = map(float, at.split("-")); sfx.append(f"{n}@{R(a)}-{R(b)}")
        else: sfx.append(f"{n}@{R(float(at))}")
    s["sfx"] = sfx
    SCENES.append(s)

# speech anchors (sync visuals to the actual words)
S = {s["id"]: s for s in SCENES}
S["S02"]["big_at"] = anchor("S02", 16.1)                 # «أربعين»
S["S02"]["sfx"] = [x if not x.startswith("hit@") else f"hit@{S['S02']['big_at']}" for x in S["S02"]["sfx"]]
S["S08"]["big_at"] = anchor("S08", 70.3)                 # «الذهب»
S["S08"]["sfx"] = [x if not (x.startswith("hit@") or x.startswith("shimmer@")) else f"{x.split('@')[0]}@{S['S08']['big_at']}" for x in S["S08"]["sfx"]]
S["S10"]["count_end"] = anchor("S10", 87.3)              # end of «الأربعين هرما؟»
S["S10"]["reveal"] = anchor("S10", 90.5)                 # «خمسة»
S["S10"]["sfx"] = ["riser@%s" % S["S10"]["t0"], "ticks@%s-%s" % (round(S["S10"]["t0"] + .5, 2), S["S10"]["count_end"]),
                   "boom@%s" % S["S10"]["count_end"], "whoosh@%s" % S["S10"]["reveal"]]
S["S07"]["cut"]["at"] = anchor("S07", 64.0)              # N6 photo on «من أكبر أهرامات مروي»
S["S07"]["sfx"] = ["whoosh@%s" % S["S07"]["cut"]["at"], "stones@%s" % anchor("S07", 67.4)]

S["S12"]["end_times"] = [anchor("S12", 102.5), anchor("S12", 104.4), anchor("S12", 108.3)]
CUES = [(round(dst(a), 2), round(dst(b), 2), tx) for _, tx, a, b in ALIGN]

if __name__ == "__main__":
    print("VO edited length", round(VO_LEN, 2), "video", DURATION)
    for s in SCENES: print(s["id"], s["t0"], s["t1"], round(s["k"], 2), s.get("sfx"))
    for c in CUES: print(c)
