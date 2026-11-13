"""No-voiceover score + sound design for 'CR7 – THE END OF AN ERA?'. Instrumental + SFX only.
Usage: build_audio_novo.py SCRATCH OUT_DIR  -> OUT/music.wav, OUT/sfx.wav, OUT/mix_premaster.wav, OUT/timeline.json"""
import sys, json, os
import numpy as np
from scipy import signal
import soundfile as sf
S, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, S)
from timeline_novo import *
SR = 48000
rng = np.random.default_rng(7)
N = int(DUR * SR)
# ---------------------------------------------------------------- dsp helpers
def env_adsr(n, a, r, sus=1.0):
    e = np.ones(n, np.float32) * sus
    na, nr = int(a * SR), int(r * SR)
    na = min(na, n); nr = min(nr, n - na)
    if na: e[:na] = np.linspace(0, sus, na)
    if nr: e[n - nr:] *= np.linspace(1, 0, nr)
    return e

def lp(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos"); return signal.sosfilt(sos, x)
def hp(x, fc, order=2):
    sos = signal.butter(order, fc, "high", fs=SR, output="sos"); return signal.sosfilt(sos, x)
def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, min(hi, SR * 0.45)], "band", fs=SR, output="sos"); return signal.sosfilt(sos, x)

def saw(freq, n, phase=0.0):
    ph = (phase + np.cumsum(np.full(n, freq / SR))) % 1.0
    return (2 * ph - 1).astype(np.float32)

def midi(m): return 440.0 * 2 ** ((m - 69) / 12)

def place(buf, x, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= buf.shape[0]: return
    x = x[: buf.shape[0] - i]
    if x.ndim == 2:
        buf[i:i + len(x)] += x * gain; return
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(x), 0] += x * gain * l * 1.414
    buf[i:i + len(x), 1] += x * gain * r * 1.414

def make_ir(sec=2.8, decay=3.2, bright=6000):
    n = int(sec * SR)
    tt = np.arange(n) / SR
    ir = np.stack([rng.standard_normal(n), rng.standard_normal(n)], 1) * np.exp(-decay * tt)[:, None]
    ir = np.stack([lp(ir[:, 0], bright), lp(ir[:, 1], bright)], 1)
    ir[: int(0.012 * SR)] = 0
    return (ir / np.sqrt((ir ** 2).sum(0))).astype(np.float32)

def reverb(x, ir, wet=0.3):
    y = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)
    return x * (1 - wet) + y * wet

# ---------------------------------------------------------------- instruments
def pad(chord, t0, t1, amp, cutoff, attack=1.2, release=1.5, oct_shift=0):
    n = int((t1 - t0 + release) * SR)
    out = np.zeros((n, 2), np.float32)
    for k, m in enumerate(chord):
        f = midi(m + 12 * oct_shift)
        for d, pan in ((-7, -0.6), (0, 0.0), (6, 0.6)):
            fd = f * 2 ** (d / 1200)
            vib = 1 + 0.0025 * np.sin(2 * np.pi * 5.1 * np.arange(n) / SR + k)
            ph = np.cumsum(fd * vib / SR) % 1.0
            x = (2 * ph - 1).astype(np.float32)
            place(out, x, 0, 1.0 / (len(chord) * 3), pan)
    out = np.stack([lp(out[:, c], cutoff, 2) for c in range(2)], 1)
    e = env_adsr(n, attack, release)
    hold = int((t1 - t0) * SR)
    e[hold:] = np.linspace(e[hold - 1] if hold else 0, 0, n - hold)
    return out * e[:, None] * amp

def sub(m, t0, t1, amp):
    n = int((t1 - t0 + 0.6) * SR); f = midi(m)
    x = np.sin(2 * np.pi * f * np.arange(n) / SR).astype(np.float32)
    x += 0.25 * np.sin(4 * np.pi * f * np.arange(n) / SR)
    return x * env_adsr(n, 0.4, 0.8) * amp

def piano(m, dur, vel=0.5):
    n = int((dur + 2.5) * SR); tt = np.arange(n) / SR; f = midi(m)
    x = np.zeros(n, np.float32)
    for h in range(1, 9):
        fh = f * h * np.sqrt(1 + 0.0004 * h * h)
        x += (1 / h ** 1.3) * np.sin(2 * np.pi * fh * tt) * np.exp(-tt * (1.2 + 0.6 * h))
    hammer = lp(rng.standard_normal(n) * np.exp(-tt * 120), 3000)
    x = x + 0.03 * hammer
    x *= np.minimum(1, tt / 0.004)
    return (x * vel * 0.35).astype(np.float32)

def brass(chord, t0, t1, amp):
    n = int((t1 - t0 + 0.8) * SR); out = np.zeros(n, np.float32)
    for m in chord:
        for d in (-5, 5):
            out += saw(midi(m) * 2 ** (d / 1200), n)
    e = env_adsr(n, 0.35, 0.8)
    # swelling filter: blend dark & bright versions
    dark, bright = lp(out, 700), lp(out, 2600)
    sw = np.clip(np.linspace(0, 1.4, n), 0, 1)
    return ((dark * (1 - sw) + bright * sw) * e * amp / len(chord)).astype(np.float32)

def string_ostinato(root, t0, t1, bpm, amp):
    step = 60 / bpm / 4
    n = int((t1 - t0 + 0.3) * SR); out = np.zeros(n, np.float32)
    pattern = [0, 0, 12, 0, 0, 7, 0, 12]
    k = 0; tt = 0.0
    while tt < t1 - t0:
        m = root + pattern[k % 8]; ln = int(step * 0.8 * SR)
        x = (saw(midi(m), ln) + saw(midi(m) * 1.004, ln)) * env_adsr(ln, 0.005, 0.06)
        i = int(tt * SR); out[i:i + ln] += x[: n - i]
        tt += step; k += 1
    return lp(out, 1800) * amp

def taiko(vel=1.0, f0=95, f1=48):
    n = int(1.1 * SR); tt = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-tt * 18)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 5.5)
    x += 0.35 * lp(rng.standard_normal(n), 900) * np.exp(-tt * 30)
    return (x * vel).astype(np.float32)

def snare_ens(vel=0.5):
    n = int(0.6 * SR); tt = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 180, 4500) * np.exp(-tt * 14) + 0.4 * np.sin(2 * np.pi * 190 * tt) * np.exp(-tt * 25)
    return (x * vel).astype(np.float32)

# ---------------------------------------------------------------- sfx
def heartbeat(vel=1.0):
    def thump(f0, dec):
        n = int(0.35 * SR); tt = np.arange(n) / SR
        f = 38 + (f0 - 38) * np.exp(-tt * 25)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * dec) * np.minimum(1, tt / 0.006)
    n = int(0.75 * SR); x = np.zeros(n)
    a = thump(70, 16); x[: len(a)] += a
    b = thump(62, 20) * 0.7; i = int(0.24 * SR); x[i:i + len(b)] += b
    return lp(x, 160).astype(np.float32) * vel

def impact(vel=1.0, length=2.5):
    n = int(length * SR); tt = np.arange(n) / SR
    f = 30 + 110 * np.exp(-tt * 7)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 1.8)
    crack = hp(rng.standard_normal(n), 600) * np.exp(-tt * 22) * 0.5
    body = lp(rng.standard_normal(n), 400) * np.exp(-tt * 4) * 0.6
    return np.tanh(1.6 * (boom + crack + body)).astype(np.float32) * vel * 0.8

def whoosh(dur=0.7, vel=0.5):
    n = int(dur * SR); tt = np.linspace(0, 1, n)
    e = np.sin(np.pi * tt) ** 2
    lo = bp(rng.standard_normal(n), 300, 1400); hi = bp(rng.standard_normal(n), 1500, 7000)
    x = lo * e * (1 - tt) + hi * e * tt
    return (x * vel).astype(np.float32)

def riser(dur=2.0, vel=0.4):
    n = int(dur * SR); tt = np.linspace(0, 1, n)
    x = hp(rng.standard_normal(n), 1500) * tt ** 2.2
    f = 200 + 1400 * tt ** 2
    x = x + 0.4 * np.sin(2 * np.pi * np.cumsum(f) / SR) * tt ** 2
    return (x * vel).astype(np.float32)

def reverse_hit(dur=1.4, vel=0.5):
    x = impact(1.0, dur)[::-1].copy()
    n = len(x); x *= np.linspace(0, 1, n) ** 1.5
    return hp(x, 120).astype(np.float32) * vel

def kick_ball(vel=0.6):
    n = int(0.25 * SR); tt = np.arange(n) / SR
    x = np.sin(2 * np.pi * (180 * tt - 300 * tt * tt)) * np.exp(-tt * 40)
    x += bp(rng.standard_normal(n), 1200, 5000) * np.exp(-tt * 160) * 0.8
    return (x * vel).astype(np.float32)

def crowd(dur, vel=0.3, swell=None):
    n = int(dur * SR)
    lay = np.zeros((n, 2), np.float32)
    for c in range(2):
        x = bp(rng.standard_normal(n), 350, 2600, 2) * 0.6 + bp(rng.standard_normal(n), 150, 700, 2) * 0.5
        mod = lp(rng.standard_normal(n), 3.0); mod = 1 + 2.5 * mod / (np.abs(mod).max() + 1e-9)
        # sparse "voices": short formant-ish blips
        for _ in range(int(dur * 25)):
            i = rng.integers(0, max(1, n - SR)); ln = int(rng.uniform(0.15, 0.6) * SR)
            f = rng.uniform(250, 700)
            tt = np.arange(ln) / SR
            v = np.sin(2 * np.pi * f * tt + 3 * np.sin(2 * np.pi * 5 * tt)) * np.sin(np.pi * tt / tt[-1]) * 0.05
            x[i:i + ln] += v
        lay[:, c] = x * np.clip(mod, 0.3, 3)
    e = np.ones(n) if swell is None else swell(np.linspace(0, 1, n))
    return (lay * e[:, None] * vel).astype(np.float32)

# ---------------------------------------------------------------- extra instruments
def lead(m, dur, amp, bright=2200, vib=5.2):
    """Expressive string/horn lead: detuned saws, slow attack, vibrato, filtered."""
    n = int((dur + 0.6) * SR); tt = np.arange(n) / SR
    v = 1 + 0.004 * np.sin(2 * np.pi * vib * tt) * np.minimum(1, tt / 0.4)
    f = midi(m)
    x = np.zeros(n, np.float32)
    for d in (-6, 0, 7):
        ph = np.cumsum(f * 2 ** (d / 1200) * v / SR) % 1.0; x += (2 * ph - 1)
    x = lp(x / 3, bright)
    return (x * env_adsr(n, min(0.18, dur / 3), 0.55) * amp).astype(np.float32)

def melody(notes, t0, step, amp, bright=2200, pan=0.0, octave=0, inst="lead"):
    """notes: list of (midi or None, beats)."""
    t = t0
    for m, beats in notes:
        d = beats * step
        if m is not None:
            x = lead(m + 12 * octave, d * 0.95, amp, bright) if inst == "lead" else piano(m + 12 * octave, d, amp)
            place(music, x, t, pan=pan)
        t += d

def bass_hit(vel=1.0):
    n = int(1.6 * SR); tt = np.arange(n) / SR
    f = 32 + 60 * np.exp(-tt * 9)
    return (np.tanh(2.2 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 2.2)) * vel).astype(np.float32)

def echo(x, delay=0.32, fb=0.38, taps=4):
    out = np.zeros(len(x) + int(delay * SR * taps), np.float32); out[:len(x)] += x
    for k in range(1, taps + 1):
        i = int(delay * SR * k); out[i:i + len(x)] += lp(x, 2500 - 400 * k) * fb ** k
    return out

# ---------------------------------------------------------------- compose
music = np.zeros((N, 2), np.float32)
sfx = np.zeros((N, 2), np.float32)
D, Bb, F, C, Gm, A, Dsus = [62, 65, 69], [58, 62, 65], [57, 60, 65], [55, 60, 64], [55, 58, 62], [57, 61, 64], [62, 67, 69]
beat = BEAT

def progression(t0, t1, chords, amp, cutoff0, cutoff1, ost=0.0, drums=0.0, brass_amp=0.0, snare=True):
    seg = (t1 - t0) / len(chords)
    for k, ch in enumerate(chords):
        a = t0 + k * seg; b = a + seg
        cut = cutoff0 + (cutoff1 - cutoff0) * (k / max(1, len(chords) - 1))
        place(music, pad(ch, a, b, amp, cut, attack=0.35, release=0.9), a)
        place(music, pad([n - 12 for n in ch], a, b, amp * 0.7, cut * 0.6, attack=0.3, release=0.9), a)
        place(music, sub(ch[0] - 24 if ch[0] > 50 else ch[0] - 12, a, b, 0.24), a)
        if ost: place(music, string_ostinato(ch[0] - 12, a, b, BPM, ost), a, pan=0.2)
        if brass_amp: place(music, brass([n - 12 for n in ch], a, b, brass_amp), a, pan=-0.15)
    if drums:
        tt = t0; k = 0
        while tt < t1 - 0.05:
            pos = k % 8
            if pos in (0, 3, 4, 6): place(music, taiko(drums * (1.0 if pos == 0 else 0.7)), tt, pan=-0.1)
            if snare and pos in (2, 6) and drums > 0.5: place(music, snare_ens(drums * 0.45), tt, pan=0.2)
            tt += beat / 2; k += 1

# S1 hook: black, heartbeat, suspense, deep bass
place(music, pad([38, 45, 50], 0, S2, 0.30, 360, attack=1.0), 0)
place(music, sub(26, 0, S2, 0.30), 0)
for h in HEARTBEATS: place(sfx, heartbeat(1.0), h)
place(sfx, impact(1.0, 3.0), HOOK_IMPACT); place(sfx, bass_hit(0.9), HOOK_IMPACT)
place(sfx, crowd(S2, 0.04, lambda u: u ** 2), 0.8)
place(sfx, reverse_hit(1.6, 0.55), S2 - 1.6)
place(sfx, riser(2.4, 0.35), S2 - 2.4)

# S2 legend: gradual orchestral build
progression(S2, S3, [D, Bb, F, C], 0.22, 600, 1500, ost=0.05, drums=0.35, snare=False)
melody([(69, 4), (70, 2), (72, 2), (74, 6), (72, 2)], S2 + BAR, beat, 0.09, 1600, pan=-0.2)
place(sfx, crowd(S3 - S2, 0.07, lambda u: 0.3 + 0.7 * u), S2)

# S3 numbers: heavier, impacts on numbers, goal roars
progression(S3, S4, [D, Bb, F, C], 0.24, 1200, 2000, ost=0.075, drums=0.7)
melody([(74, 2), (72, 2), (70, 2), (69, 2), (70, 4), (65, 4), (69, 8)], S3 + BAR, beat, 0.10, 2000, pan=-0.2)
place(sfx, riser(2.2, 0.4), S4 - 2.2)

# S4 glory: anthem — full drums, brass, soaring lead
progression(S4, S5, [Bb, F, C, D], 0.27, 1700, 2800, ost=0.08, drums=1.05, brass_amp=0.14)
melody([(74, 3), (76, 1), (77, 4), (76, 2), (74, 2), (72, 4), (74, 6), (69, 2), (74, 8)], S4, beat, 0.13, 2600, pan=-0.1)
melody([(62, 4), (65, 4), (64, 4), (62, 4), (60, 8), (62, 8)], S4, beat, 0.07, 1500, pan=0.3)  # harmony
place(sfx, reverse_hit(1.3, 0.5), S5 - 1.3)

# S5 emotional: piano + soft strings, percussion out
seg5 = (S6 - S5) / 4
for k, ch in enumerate([D, Bb, Gm, A]):
    a = S5 + k * seg5
    place(music, pad(ch, a, a + seg5, 0.12, 900, attack=1.0, release=1.6), a)
    place(music, sub(ch[0] - 24, a, a + seg5, 0.12), a)
    arp = [ch[0] - 12, ch[1], ch[2], ch[0] + 12, ch[2], ch[1], ch[2], ch[0] + 12]
    step = seg5 / 8
    for j, m in enumerate(arp):
        place(music, piano(m, step, 0.5 if j == 0 else 0.34), a + j * step, pan=-0.25 + 0.06 * j)
melody([(None, 4), (77, 4), (76, 2), (74, 2), (72, 4), (70, 4), (69, 6), (None, 2), (74, 4), (73, 4)], S5, beat, 0.42, inst="piano")
melody([(69, 8), (70, 8), (67, 8), (69, 8)], S5, beat, 0.05, 1200, pan=0.25)  # cello-ish line
place(sfx, crowd(S6 - S5, 0.035, lambda u: 0.6 - 0.3 * u), S5)

# S6 climax
place(sfx, impact(1.0, 2.5), S6)
progression(S6, S7, [D, Bb, F, C], 0.29, 1600, 3400, ost=0.09, drums=1.2, brass_amp=0.17)
melody([(74, 2), (77, 2), (81, 4), (79, 2), (77, 2), (76, 4), (77, 2), (76, 2), (74, 4), (72, 4), (76, 4)], S6, beat, 0.14, 3000, pan=-0.1)
place(sfx, riser(2.8, 0.5), S7 - 2.8)

# S7 ending: final hit, held chord, crowd echo, emotional close
place(sfx, impact(1.15, 4.0), S7); place(sfx, bass_hit(1.0), S7)
place(music, taiko(1.3), S7)
place(music, pad([50, 57, 62, 65, 69], S7, FADE_BLACK[1], 0.24, 1500, attack=0.05, release=2.0), S7)
place(music, sub(26, S7, FADE_BLACK[1], 0.25), S7)
melody([(69, 4), (74, 8), (72, 4), (74, 8)], S7 + 0.6, beat, 0.10, 1800, pan=-0.1)
place(sfx, crowd(DUR - S7, 0.12, lambda u: np.exp(-u * 2.5)), S7)
# final emotional chord on the title card
place(music, pad([50, 57, 62, 66, 69], NAME_T - 0.2, DUR - 0.5, 0.2, 1300, attack=1.2, release=2.0), NAME_T - 0.2)
for m, dt in ((62, 0), (69, 0.25), (74, 0.5), (78, 0.8)):
    place(music, echo(piano(m, 2.5, 0.45)), NAME_T + dt, pan=-0.2 + 0.13 * (dt * 3))
place(music, echo(piano(74, 3.0, 0.4)), THANKS_T)
place(sfx, impact(0.5, 3.0), NAME_T - 0.05)

# synced SFX
for t in WHIP: place(sfx, whoosh(0.55, 0.45), t - 0.3, pan=0.3)
for t in IMPACTS:
    if t not in (S2, S6, S7):
        place(sfx, impact(0.85, 2.2), t - 0.02); place(sfx, bass_hit(0.6), t - 0.02)
for t in KICKS: place(sfx, kick_ball(0.6), t - 0.04)
for t, d in ROARS:
    place(sfx, crowd(d + 1.2, 0.22, lambda u: np.minimum(1, u * 6) * np.exp(-u * 1.6)), t)
place(sfx, echo(kick_ball(0.5), 0.28, 0.45, 5), S6 + 0.05)   # subtle echo accent

# reverb, fades, mix (no voice -> no ducking)
music = reverb(music, make_ir(3.0, 2.4, 5000), 0.32)
sfx = reverb(sfx, make_ir(2.2, 3.5, 6000), 0.2)
fo = int(2.2 * SR); music[-fo:] *= np.linspace(1, 0, fo)[:, None]; sfx[-fo:] *= np.linspace(1, 0, fo)[:, None]
fi = int(0.05 * SR); music[:fi] *= np.linspace(0, 1, fi)[:, None]
def norm(x, peak): return x * (peak / (np.abs(x).max() + 1e-9))
music = norm(music, 0.8); sfx = norm(sfx, 0.7)
sf.write(f"{OUT}/music.wav", music, SR); sf.write(f"{OUT}/sfx.wav", sfx, SR)
mix = music * 0.85 + sfx * 0.7
sf.write(f"{OUT}/mix_premaster.wav", mix.astype(np.float32), SR, subtype="FLOAT")
json.dump(dict(duration=DUR, cuts={"1": S1, "2": S2, "3": S3, "4": S4, "5": S5, "6": S6, "7": S7, "8": DUR}, lines=[]),
          open(f"{OUT}/timeline.json", "w"), indent=1)
print("audio done", DUR)
