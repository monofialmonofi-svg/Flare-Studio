# -*- coding: utf-8 -*-
"""Final broadcast-style mix.
VO (processed, -16 LUFS) up front; licensed music bed («Curse of the Scarab», Kevin MacLeod, CC BY 3.0) ducked under
the voice with a sidechain compressor; SFX layer; 2-pass loudness normalisation to -14 LUFS / -1 dBTP.
usage: mix_final.py VIDEO_NOAUDIO.mp4 VO_PROCESSED.wav OUT.mp4"""
import sys, os, subprocess, json
sys.path.insert(0, os.path.dirname(__file__))
from timing import DURATION, SCENES
HERE = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.path.join(HERE, "..", "..", "EXTERNAL_RESEARCH", "MUSIC", "licensed", "M02_curse_of_the_scarab.ogg")
SFX = os.path.join(HERE, "..", "audio", "sfx.wav")
video, vo, out = sys.argv[1:4]
end_card = [s for s in SCENES if s["kind"] == "end"][0]["t0"]
OFFSET = round(84.0 - end_card, 2)          # track's big section (≈84 s) lands on the end card
D = DURATION
graph = (
 f"[1:a]atrim=start={OFFSET}:duration={D},asetpts=PTS-STARTPTS,aresample=48000,"
 f"afade=t=in:d=1.2,afade=t=out:st={D - 2.5}:d=2.5,volume=-0.5dB[mus];"
 f"[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad=whole_dur={D},asplit=2[vo][key];"
 f"[mus][key]sidechaincompress=threshold=0.05:ratio=4:attack=50:release=500:knee=4:makeup=1[mduck];"
 f"[3:a]volume=-4dB[sfx];"
 f"[vo][mduck][sfx]amix=inputs=3:normalize=0:duration=first,atrim=duration={D}[pre]")
def run(extra_af, outargs):
    return subprocess.run(["ffmpeg", "-hide_banner", "-y", "-i", video, "-i", MUSIC, "-i", vo, "-i", SFX,
                           "-filter_complex", graph + f";[pre]{extra_af}[a]", "-map", "0:v", "-map", "[a]"] + outargs,
                          capture_output=True, text=True)
r = run("loudnorm=I=-14:TP=-1:LRA=9:print_format=json", ["-f", "null", "-"])
j = json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])
ln = (f"loudnorm=I=-14:TP=-1:LRA=9:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:"
      f"measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true,aresample=48000")
r = run(ln, ["-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", "-t", str(D), out])
if r.returncode: print(r.stderr[-2000:]); sys.exit(1)
print("ok", out, "music offset", OFFSET)
