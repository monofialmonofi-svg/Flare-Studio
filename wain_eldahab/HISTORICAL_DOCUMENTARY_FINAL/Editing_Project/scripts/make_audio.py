# -*- coding: utf-8 -*-
"""Original music bed + sound effects, synthesized from scratch (no third-party audio => no licence issues).
Outputs 48 kHz stereo WAV stems: music.wav, sfx.wav"""
import numpy as np, sys, os, re, wave
sys.path.insert(0, os.path.dirname(__file__))
from episode import SCENES, DURATION
SR = 48000
N = int(SR * DURATION)
t = np.arange(N) / SR
rng = np.random.default_rng(7)
OUT = sys.argv[1] if len(sys.argv) > 1 else "."

def onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); s = 0.0
    # vectorised via lfilter-like recursion in chunks
    from scipy.signal import lfilter
    return lfilter([1 - a], [1, -a], x)
try:
    from scipy.signal import lfilter, butter, sosfilt
except ImportError:
    os.system("pip install -q scipy"); from scipy.signal import lfilter, butter, sosfilt

def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)
def lp(x, f, order=2):
    return sosfilt(butter(order, f, btype="low", fs=SR, output="sos"), x)
def hp(x, f, order=2):
    return sosfilt(butter(order, f, btype="high", fs=SR, output="sos"), x)
def env_seg(points):
    """piecewise-linear envelope over whole timeline, points=[(time, value)]"""
    ts, vs = zip(*points); return np.interp(t, ts, vs)
def note(f): return 440.0 * 2 ** ((f - 69) / 12)

# ---------------- MUSIC ----------------
music = np.zeros((N, 2))
# 1) drone (D) with slow beating
for f, a in [(note(38), .35), (note(45), .22), (note(50), .14)]:
    for ch, det in [(0, -0.15), (1, 0.15)]:
        music[:, ch] += a * np.sin(2 * np.pi * (f + det) * t) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.07 * t + ch))
# 2) pad chords (Dm - Bb - Gm - A), soft additive tones, 6 s each with crossfade
chords = [[62, 65, 69], [58, 62, 65], [55, 58, 62], [57, 61, 64]]
seg = 6.0
pad = np.zeros((N, 2))
for i in range(int(DURATION / seg) + 1):
    c = chords[i % 4]; s0 = i * seg
    e = np.clip(np.minimum((t - s0 + 1.5) / 2.5, (s0 + seg + 1.5 - t) / 2.5), 0, 1)
    if not e.any(): continue
    for m in c:
        f = note(m - 12)
        for ch, det in [(0, -0.6), (1, 0.6)]:
            w = np.sin(2 * np.pi * (f + det) * t) + .3 * np.sin(4 * np.pi * (f + det) * t) + .12 * np.sin(6 * np.pi * f * t)
            pad[:, ch] += 0.06 * e * w
pad = np.stack([lp(pad[:, 0], 1800), lp(pad[:, 1], 1800)], 1)
music += pad
# 3) mysterious high motif (oud-like plucks, D hijaz flavour) at selected moments
def pluck(t0, midi, amp=.18, dur=1.6):
    i0 = int(t0 * SR); n = int(dur * SR); tt = np.arange(n) / SR; f = note(midi)
    w = (np.sin(2*np.pi*f*tt) + .5*np.sin(4*np.pi*f*tt) + .25*np.sin(6*np.pi*f*tt)) * np.exp(-tt * 3.2) * amp
    w[:200] *= np.linspace(0, 1, 200)
    j = min(N, i0 + n); music[i0:j, 0] += w[:j-i0] * .9; music[i0:j, 1] += w[:j-i0]
motif = [62, 63, 66, 67, 69, 67, 66, 63]   # D Eb F# G A (hijaz)
for k, (st, base) in enumerate([(1.0, 0), (19.5, 0), (27.0, 0), (43.0, -2), (73.0, 0), (79.0, 0)]):
    for j, m in enumerate(motif[:6 if k % 2 else 5]):
        pluck(st + j * 0.42, m + base, amp=.12)
# 4) pulse (frame drum style) building from 33 s to 65 s
def drum(t0, amp):
    i0 = int(t0*SR); n = int(.5*SR); tt = np.arange(n)/SR
    w = np.sin(2*np.pi*(70*np.exp(-tt*8)+45)*tt) * np.exp(-tt*9) * amp
    j = min(N, i0+n); music[i0:j] += w[:j-i0, None]
bt = 33.5
while bt < 65.0:
    a = 0.25 + 0.45 * (bt - 33.5) / 31.5
    drum(bt, a);
    if bt > 50: drum(bt + 0.375, a * .5)
    bt += 0.75 if bt < 50 else 0.75
for bt in np.arange(72.0, 78.0, 1.5): drum(bt, .2)
# 5) section dynamics
dyn = env_seg([(0, .55), (4.5, .5), (10.5, .45), (19, .5), (26, .55), (33.5, .6), (50, .75), (62.5, .8),
               (65.2, 1.0), (66.0, .45), (72, .5), (78, .8), (82, 1.0), (DURATION, 0)])
music *= dyn[:, None]
music[:int(.05*SR)] *= np.linspace(0, 1, int(.05*SR))[:, None]
music /= np.max(np.abs(music)) + 1e-9
music *= 0.5

# ---------------- SFX ----------------
sfx = np.zeros((N, 2))
def add(t0, w, pan=0.0, gain=1.0):
    i0 = int(t0*SR); j = min(N, i0+len(w)); w = w[:j-i0]*gain
    sfx[i0:j, 0] += w*(1-max(pan, 0)); sfx[i0:j, 1] += w*(1+min(pan, 0))
def noise(d): return rng.standard_normal(int(d*SR))
def whoosh(d=.7):
    n = noise(d); tt = np.arange(len(n))/SR
    out = np.zeros_like(n); steps = 14
    for k in range(steps):
        a, b = int(k*len(n)/steps), int((k+1)*len(n)/steps)
        fc = 300 + 3500*np.sin(np.pi*(k+.5)/steps)
        out[a:b] = bp(n, fc*.7, min(fc*1.3, 20000))[a:b]
    return out*np.sin(np.pi*tt/d)**2*.35
def impact(d=2.5, f=48):
    tt = np.arange(int(d*SR))/SR
    return (np.sin(2*np.pi*f*tt*(1+.5*np.exp(-tt*6)))*np.exp(-tt*2.2) + lp(noise(d), 500)*np.exp(-tt*12)*.6)*.9
def hit(): return impact(1.2, 70)*.7
def tick():
    tt = np.arange(int(.08*SR))/SR; return np.sin(2*np.pi*1800*tt)*np.exp(-tt*80)*.25
def ping():
    tt = np.arange(int(1.2*SR))/SR; return (np.sin(2*np.pi*1320*tt)+.4*np.sin(2*np.pi*1980*tt))*np.exp(-tt*4)*.15
def shimmer():
    d = 2.0; tt = np.arange(int(d*SR))/SR; w = np.zeros_like(tt)
    for f in [2093, 2637, 3136, 3951, 4186]:
        w += np.sin(2*np.pi*f*tt + rng.random()*6)*np.exp(-tt*2.5)*(rng.random()*.5+.5)
    return w*.05*np.minimum(1, tt*20)
def stones(d=2.4):
    w = np.zeros(int(d*SR))
    for _ in range(60):
        p = int(rng.random()**1.5*len(w)*.8); L = int(SR*(.02+.08*rng.random()))
        g = lp(rng.standard_normal(L), 900+1500*rng.random())*np.exp(-np.arange(L)/SR*40)*(.2+.8*rng.random())
        w[p:p+L] += g[:len(w)-p]
    return lp(w, 2500)*.35
def rumble(d=3.5):
    tt = np.arange(int(d*SR))/SR; return lp(noise(d), 120)*np.sin(np.pi*tt/d)*.5
def riser(d=2.7):
    n = noise(d); tt = np.arange(len(n))/SR; return hp(n, 2000)*(tt/d)**2*.15
FX = dict(whoosh=whoosh, impact=impact, hit=hit, tick=tick, ping=ping, shimmer=shimmer, stones=stones,
          map_rumble=rumble, boom=impact, riser=riser)
for sc in SCENES:
    for s in sc.get("sfx", []):
        if s == "wind": continue
        name, at = s.split("@")
        if name == "ticks":
            a, b = map(float, at.split("-")); n = 40
            for k in range(n):  # accelerate like the counter (ease-out)
                u = (k+1)/n; tt = a + (b-a)*(1-np.sqrt(1-u))  # matches easeOutQuad counter
                add(tt, tick(), pan=(k % 2-.5)*.4)
            continue
        add(float(at), FX[name](), gain=1.0)
# continuous desert wind, very low, louder in the opening
wind = bp(noise(DURATION)[:N], 250, 1400) * (0.5 + 0.5*np.sin(2*np.pi*0.11*t)**2)
wind *= env_seg([(0, .0), (.3, .35), (4.5, .22), (10.5, .12), (78, .12), (DURATION, 0)])
sfx[:, 0] += wind*.6; sfx[:, 1] += np.roll(wind, 2400)*.6
sfx /= np.max(np.abs(sfx)) + 1e-9; sfx *= .6

def write(path, x):
    x = np.clip(x, -1, 1); d = (x*32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(d.tobytes())
write(os.path.join(OUT, "music.wav"), music)
write(os.path.join(OUT, "sfx.wav"), sfx)
print("ok", DURATION)
