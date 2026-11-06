# -*- coding: utf-8 -*-
"""Builds subtitle cues from the voiceover text (split on / // /// markers) and writes SRT.
Cue timing is estimated (characters + pause weights) until the real voiceover is recorded;
after recording, run align step / adjust CUE_OVERRIDES."""
import re, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from episode import SCENES

PAUSE = {"/": .25, "//": .5, "///": 1.0}
def clean(s): return re.sub(r"\[[^\]]*\]", "", s).strip()
SUB_REPLACE = {"ألفٍ وثمانمئةٍ وواحدٍ وعشرين": "1821", "ألفٍ وثمانمئةٍ وأربعةٍ وثلاثين": "1834",
               "ألفٍ وثمانمئةٍ وأربعةٍ وأربعين": "1844", "مئتي كيلومتر": "200 كيلومتر"}
TASHKEEL = re.compile(r"[\u064B-\u0652]")
def display(s):
    for k, v in SUB_REPLACE.items(): s = s.replace(k, v)
    return TASHKEEL.sub("", s)

def cues():
    out = []
    for sc in SCENES:
        text = clean(sc["vo"])
        parts = re.split(r"\s*(///|//|/)\s*", text)
        chunks = []  # (text, pause_after)
        for i in range(0, len(parts), 2):
            tx = parts[i].strip()
            pz = PAUSE.get(parts[i + 1], 0) if i + 1 < len(parts) else 0
            if tx: chunks.append([tx, pz])
        start = sc["t0"] + 0.25
        end = sc["t1"] - 0.1
        total_chars = sum(len(c[0]) for c in chunks)
        total_pause = sum(c[1] for c in chunks[:-1])
        speak = max(end - start - total_pause - chunks[-1][1] * .5, 1)
        t = start
        for tx, pz in chunks:
            d = speak * len(tx) / total_chars
            out.append((round(t, 2), round(t + d, 2), display(tx).strip("،. ")))
            t += d + pz
    return out

CUES = cues()
def at(t):
    for a, b, s in CUES:
        if a <= t < b: return (a, b, s)
    return None

def ts(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"

def write_srt(path):
    with open(path, "w", encoding="utf-8") as f:
        for i, (a, b, s) in enumerate(CUES, 1):
            f.write(f"{i}\n{ts(a)} --> {ts(b)}\n‫{s}‬\n\n")

if __name__ == "__main__":
    write_srt(sys.argv[1])
    for c in CUES: print(c)
