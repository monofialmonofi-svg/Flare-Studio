"""Original score for the Alwan Mohammed Al-Amin documentary (no melodies from his songs).
Plucked-oud (Karplus-Strong), string-orchestra pads, light Sudanese-style hand percussion.
Usage: score_amin.py OUT_DIR"""
import sys, numpy as np, soundfile as sf
from scipy import signal
OUT = sys.argv[1]; SR = 48000; DUR = 240.0; N = int(DUR * SR); rng = np.random.default_rng(7)
def lp(x, fc): return signal.sosfilt(signal.butter(2, fc, "low", fs=SR, output="sos"), x)
def hp(x, fc): return signal.sosfilt(signal.butter(2, fc, "high", fs=SR, output="sos"), x)
def bp(x, a, b): return signal.sosfilt(signal.butter(2, [a, b], "band", fs=SR, output="sos"), x)
def midi(m): return 440 * 2 ** ((m - 69) / 12)
def env(n, a, r):
    e = np.ones(n); na, nr = min(n, int(a * SR)), min(n, int(r * SR)); e[:na] = np.linspace(0, 1, na); e[n - nr:] *= np.linspace(1, 0, nr); return e
def put(buf, x, t, g=1.0, pan=0.0):
    i = int(t * SR); x = x[: max(0, len(buf) - i)]
    if x.ndim == 1: x = np.stack([x * (1 - pan) ** 0.5, x * (1 + pan) ** 0.5], 1) / 1.0
    buf[i:i + len(x)] += x * g

# ---- oud: Karplus-Strong with a body resonance, double courses (slight detune)
_oc={}
def oud_note(m, dur=1.6, vel=1.0):
    k=(m,round(dur,1),round(vel,2))
    if k in _oc: return _oc[k]
    _oc[k]=_oud(m,dur,vel); return _oc[k]
def _oud(m, dur, vel):
    out = np.zeros(int(dur * SR))
    for det in (0.0, 0.08):
        f = midi(m + det); L = int(SR / f); buf = rng.uniform(-1, 1, L) * vel
        buf = lp(buf, 2500 + 2500 * vel); y = np.zeros(len(out)); idx = 0
        for i in range(len(out)):
            y[i] = buf[idx]; nxt = (idx + 1) % L
            buf[idx] = 0.4985 * (buf[idx] + buf[nxt]); idx = nxt
        out += y
    body = bp(out, 180, 1400) * 0.6 + out * 0.5
    return body * np.exp(-np.arange(len(out)) / SR * 1.4) * 0.5
# Sudanese music is largely pentatonic: use an anhemitonic pentatonic on D (D E F# A B)
PENT = [50, 52, 54, 57, 59, 62, 64, 66, 69, 71, 74]
mus = np.zeros((N, 2), np.float32)
def oud_phrase(t0, notes, step=0.36, vel=0.9, pan=0.15):
    t = t0
    for k, (deg, ln) in enumerate(notes):
        put(mus, oud_note(PENT[deg], 1.4 + ln, vel * (0.8 + 0.2 * (k % 2 == 0))), t, 0.9, pan); t += step * ln
    return t
# original phrases (composed for this film)
A = [(5, 2), (6, 1), (7, 1), (6, 1), (5, 2), (3, 1), (4, 1), (5, 3)]
B = [(7, 1), (8, 1), (9, 2), (8, 1), (7, 1), (6, 2), (5, 1), (6, 1), (5, 3)]
C = [(3, 1), (5, 1), (6, 1), (5, 1), (3, 1), (2, 1), (3, 2), (1, 1), (2, 1), (0, 3)]

# ---- strings pad
def strings(chord, t0, t1, amp, fc=1600):
    n = int((t1 - t0) * SR); tt = np.arange(n) / SR; x = np.zeros(n)
    for m in chord:
        for d in (-7, 0, 7):
            ph = np.cumsum(np.full(n, midi(m) * 2 ** (d / 1200) * (1 + 0.002 * np.sin(2 * np.pi * 5.2 * tt)) / SR)) % 1
            x += 2 * ph - 1
    x = lp(x / (3 * len(chord)), fc) * env(n, 2.5, 2.5) * amp
    put(mus, x, t0, 1.0, 0.0)
# ---- light hand percussion (dalouka-like low + slap, and shaker)
def drum(low=True, amp=0.3):
    n = int(0.35 * SR); tt = np.arange(n) / SR
    if low: x = np.sin(2 * np.pi * (85 + 60 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 9)
    else: x = bp(rng.standard_normal(n), 900, 4000) * np.exp(-tt * 40) + np.sin(2 * np.pi * 320 * tt) * np.exp(-tt * 25) * 0.5
    return x * amp
def groove(t0, t1, bpm, amp):
    step = 60 / bpm / 2; pat = "L.sL.ss." ; t = t0; k = 0
    while t < t1:
        c = pat[k % len(pat)]
        if c == "L": put(mus, drum(True, amp), t, 1, -0.1)
        elif c == "s": put(mus, drum(False, amp * 0.55), t, 1, 0.2)
        n = int(0.05 * SR); put(mus, hp(rng.standard_normal(n), 6000) * np.exp(-np.arange(n) / SR * 80) * amp * 0.12, t, 1, 0.4)
        t += step; k += 1

# ---------------- cue sheet (matches the brief's scene timings)
# 0-20 opening: solo oud only
t = oud_phrase(1.5, A, 0.42, 0.85); oud_phrase(t + 0.6, C, 0.42, 0.75)
# 20-45 departure: strings enter, sparse oud
strings([50, 57, 62], 18, 46, 0.10, 1100); oud_phrase(26, A, 0.5, 0.6, -0.2)
# 45-75 beginnings: warmer, pentatonic movement
strings([47, 54, 59], 44, 60, 0.09, 1300); strings([52, 57, 64], 59, 76, 0.09, 1300); oud_phrase(48, B, 0.4, 0.75); oud_phrase(62, A, 0.38, 0.75)
# 75-105 stardom: light groove enters
groove(75, 105, 104, 0.32); strings([50, 57, 62, 66], 74, 106, 0.08, 1800); oud_phrase(77, B, 0.29, 0.85); oud_phrase(88, A, 0.29, 0.85); oud_phrase(97, C, 0.29, 0.8)
# 105-140 October: solemn, stronger strings, low pulse
strings([45, 52, 57, 62], 104, 141, 0.12, 1500)
for tp in np.arange(106, 140, 1.15): put(mus, drum(True, 0.22), tp, 1)
oud_phrase(112, C, 0.48, 0.7); oud_phrase(126, A, 0.44, 0.75)
# 140-175 masterpieces: fullest, groove, build
groove(140, 175, 112, 0.38); strings([50, 57, 62, 66], 139, 158, 0.11, 2200); strings([52, 59, 64, 71], 157, 176, 0.12, 2400)
oud_phrase(141, B, 0.27, 0.95); oud_phrase(150, A, 0.27, 0.95); oud_phrase(158, B, 0.27, 0.95); oud_phrase(167, C, 0.27, 0.9)
# 175-205 the musician: oud foreground, light strings
strings([47, 54, 59, 62], 174, 206, 0.07, 1200); oud_phrase(176, A, 0.33, 0.9); oud_phrase(186, B, 0.33, 0.9); oud_phrase(196, C, 0.36, 0.85)
# 205-225 legacy & honours: warm, resolved
strings([50, 57, 62, 69], 204, 226, 0.10, 1600); groove(205, 222, 96, 0.2); oud_phrase(207, A, 0.4, 0.8)
# 225-240 closing: back to solo oud
oud_phrase(226, C, 0.5, 0.7); strings([50, 57], 224, 240, 0.05, 900)
n = int(1.5 * SR); mus[-n:] *= np.linspace(1, 0, n)[:, None]
# light room reverb
ir = np.exp(-np.arange(int(1.4 * SR)) / SR * 3.2) * rng.standard_normal(int(1.4 * SR)) * 0.02
wet = np.stack([signal.fftconvolve(mus[:, c], ir)[:N] for c in range(2)], 1)
mix = mus + wet * 0.8; mix /= np.abs(mix).max() / 0.7
sf.write(f"{OUT}/score_amin.wav", mix.astype(np.float32), SR, subtype="FLOAT"); print("score ok", DUR)
