# Cuts false starts / shortens long pauses per timing.EDL; 10 ms fades at every edit; prepends LEAD silence.
import sys, os, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from timing import EDL, LEAD, INSERTS
src, out = sys.argv[1], sys.argv[2]
parts = []; fl = []
for i, (a, b) in enumerate(EDL):
    d = b - a
    fl.append(f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st={max(0, d-0.01):.3f}:d=0.01[p{i}]")
    parts.append(f"[p{i}]")
    for k, (pt, dur) in enumerate(INSERTS):
        if abs(pt - b) < 0.02:   # silence right after this kept range
            fl.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{dur}[z{i}_{k}]")
            parts.append(f"[z{i}_{k}]")
fl.append(f"{''.join(parts)}concat=n={len(parts)}:v=0:a=1,pan=mono|c0=0.5*c0+0.5*c1,adelay={int(LEAD*1000)},aresample=48000[o]")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-filter_complex", ";".join(fl), "-map", "[o]", "-c:a", "pcm_s24le", out], check=True)
print("ok", out)
