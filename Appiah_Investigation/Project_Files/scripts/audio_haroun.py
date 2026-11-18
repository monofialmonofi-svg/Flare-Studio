"""Audio for the Alwan Haroun reel: original interview audio + investigative music bed + light SFX, with ducking.
Usage: audio_haroun.py SCRATCH EDL_JSON OUT_DIR
EDL['audio'] = list of {"t0", "src_file": "clip"|"podcast", "src", "dur"} dialogue pieces (original speech only)."""
import sys, json, subprocess, numpy as np, soundfile as sf
from scipy import signal
S, EDL_PATH, OUT = sys.argv[1:4]
E = json.load(open(EDL_PATH)); DUR = E["duration"]; SR = 48000; N = int(DUR * SR)
X = f"{S}/haroun"
SRC = {"clip": f"{X}/dl_altabia/altabia_clip.mp4", "podcast": f"{X}/dl_podcast/haroun_interview.mp3"}
rng = np.random.default_rng(3)

def lp(x, fc): return signal.sosfilt(signal.butter(2, fc, "low", fs=SR, output="sos"), x)
def hp(x, fc): return signal.sosfilt(signal.butter(2, fc, "high", fs=SR, output="sos"), x)
def bp(x, a, b): return signal.sosfilt(signal.butter(2, [a, b], "band", fs=SR, output="sos"), x)
def midi(m): return 440 * 2 ** ((m - 69) / 12)
def env(n, a, r):
    e = np.ones(n); na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    e[:na] = np.linspace(0, 1, na); e[n - nr:] *= np.linspace(1, 0, nr); return e
def put(buf, x, t, g=1.0):
    i = int(t * SR); x = x[: max(0, len(buf) - i)]
    if x.ndim == 1: x = np.stack([x, x], 1)
    buf[i:i + len(x)] += x * g

# ---------------- dialogue: original speech, cleaned (HPF, gentle denoise, compression), no alteration of words
dia = np.zeros((N, 2), np.float32)
for p in E["audio"]:
    cmd = ["ffmpeg", "-v", "error", "-ss", str(p["src"]), "-t", str(p["dur"]), "-i", SRC[p["src_file"]],
           "-af", "highpass=f=80,afftdn=nr=10:nf=-40,acompressor=threshold=-22dB:ratio=3:attack=8:release=150:makeup=3,"
                  "equalizer=f=3000:t=q:w=1.5:g=2,loudnorm=I=-16:TP=-2:LRA=7",
           "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
    a = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32).reshape(-1, 2).copy()
    f = int(0.04 * SR); a[:f] *= np.linspace(0, 1, f)[:, None]; a[-f:] *= np.linspace(1, 0, f)[:, None]
    put(dia, a, p["t0"])

# ---------------- music bed: investigative / cinematic suspense (restrained)
mus = np.zeros((N, 2), np.float32)
def pad(notes, t0, t1, amp, fc):
    n = int((t1 - t0) * SR); tt = np.arange(n) / SR; x = np.zeros(n)
    for m in notes:
        for d in (-5, 0, 6):
            ph = np.cumsum(np.full(n, midi(m) * 2 ** (d / 1200) / SR)) % 1; x += 2 * ph - 1
    x = lp(x / (3 * len(notes)), fc) * env(n, 1.5, 1.5) * amp
    put(mus, x * (1 + 0.15 * np.sin(2 * np.pi * 0.11 * tt)), t0)
def pulse(t0, t1, bpm, amp, f=55):
    step = 60 / bpm; t = t0
    while t < t1:
        n = int(0.5 * SR); tt = np.arange(n) / SR
        put(mus, np.sin(2 * np.pi * f * tt) * np.exp(-tt * 9) * amp, t); t += step
def tick(t0, t1, bpm, amp):
    step = 60 / bpm / 2; t = t0; k = 0
    while t < t1:
        n = int(0.08 * SR); x = hp(rng.standard_normal(n), 5000) * np.exp(-np.arange(n) / SR * 60)
        put(mus, x * amp * (1 if k % 2 == 0 else 0.5), t); t += step; k += 1
def drone(t0, t1, amp):
    n = int((t1 - t0) * SR); x = lp(rng.standard_normal(n), 120) * 3 + np.sin(2 * np.pi * 36.7 * np.arange(n) / SR)
    put(mus, x * env(n, 2, 2) * amp, t0)
sc = E["music_cues"]   # [hook_end, arrest_end, interview_end, bio_end, legal_end, ending_end]
h, a_, i_, b_, l_, e_ = sc
drone(0, DUR, 0.05)
pad([50, 57, 62], 0, h + 0.5, 0.10, 500)                      # hook: dark suspense
pad([46, 53, 58, 62], h, a_ + 0.5, 0.11, 700); pulse(h, a_, 84, 0.22); tick(h + 2, a_, 84, 0.04)   # arrest: pulse in
pad([50, 57, 60], a_, i_ + 0.5, 0.07, 600); pulse(a_, i_, 70, 0.10)                               # interview: sparse
pad([46, 53, 58], i_, b_ + 0.5, 0.11, 900); pulse(i_, b_, 84, 0.2); tick(i_, b_, 84, 0.05)        # bio: build
pad([43, 50, 55, 58], b_, l_ + 0.5, 0.12, 800); pulse(b_, l_, 84, 0.26); tick(b_, l_, 84, 0.06)   # legal: tension
pad([50, 57, 62, 65], l_, e_, 0.12, 1000); pulse(l_, l_ + 4, 84, 0.2)                             # ending: resolve
n = int(0.4 * SR); mus[-n:] *= np.linspace(1, 0, n)[:, None]

# ---------------- SFX: light, news-appropriate
sfx = np.zeros((N, 2), np.float32)
def impact(amp):
    n = int(2.2 * SR); tt = np.arange(n) / SR; f = 32 + 70 * np.exp(-tt * 8)
    return (np.tanh(1.8 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 2.4)) + 0.25 * lp(rng.standard_normal(n), 300) * np.exp(-tt * 6)) * amp
def whoosh(amp, d=0.5):
    n = int(d * SR); u = np.linspace(0, 1, n)
    return (bp(rng.standard_normal(n), 400, 1800) * (1 - u) + bp(rng.standard_normal(n), 1800, 7000) * u) * np.sin(np.pi * u) ** 2 * amp
def riser(amp, d=1.6):
    n = int(d * SR); u = np.linspace(0, 1, n); return hp(rng.standard_normal(n), 1200) * u ** 2.5 * amp
for t in E["sfx"]["impacts"]: put(sfx, impact(0.5), t)
for t in E["sfx"]["whooshes"]: put(sfx, whoosh(0.22), t - 0.25)
for t in E["sfx"]["risers"]: put(sfx, riser(0.12), t - 1.6)
def paper(amp):   # document / page-turn texture
    n = int(0.45 * SR); u = np.linspace(0, 1, n); x = bp(rng.standard_normal(n), 1500, 9000) * (np.sin(np.pi * u) ** 3)
    x *= 1 + 0.8 * (rng.random(n) > 0.995); return x * amp
def digital(amp):  # subtle data blips
    out = np.zeros(int(0.5 * SR))
    for k in range(4):
        n = int(0.04 * SR); tt = np.arange(n) / SR; f = 1800 + 400 * k
        out[int(k * 0.09 * SR):int(k * 0.09 * SR) + n] += np.sin(2 * np.pi * f * tt) * np.exp(-tt * 70)
    return out * amp
for t in E["sfx"].get("paper", []): put(sfx, paper(0.25), t)
for t in E["sfx"].get("digital", []): put(sfx, digital(0.12), t)

# ---------------- ducking (music & sfx under speech)
v = np.abs(dia[:, 0]); w = int(0.03 * SR); v = np.convolve(v, np.ones(w) / w, "same")
act = (v > 0.008).astype(np.float32); g = np.zeros(N, np.float32); s = 0.0
ac, rc = np.exp(-64 / (0.08 * SR)), np.exp(-64 / (0.5 * SR))
for i in range(0, N, 64):
    tg = act[i]; s = tg + (s - tg) * (ac if tg > s else rc); g[i:i + 64] = s
mix = dia * 1.0 + mus * (1 - 0.8 * g)[:, None] * 0.9 + sfx * (1 - 0.5 * g)[:, None]
sf.write(f"{OUT}/dialogue.wav", dia, SR); sf.write(f"{OUT}/music.wav", mus, SR); sf.write(f"{OUT}/sfx.wav", sfx, SR)
sf.write(f"{OUT}/mix_premaster.wav", mix.astype(np.float32), SR, subtype="FLOAT"); print("audio ok", DUR)
