# -*- coding: utf-8 -*-
"""Professional voice chain for the presenter's recording.
1) Spectral noise reduction using a noise profile taken from the recording's own leading silence (0.5–6 s)
2) Edit (retakes removed, pauses tightened) per timing.EDL / INSERTS
3) HPF 75 Hz, mud cut, presence & air EQ, de-esser, two-stage compression, 2-pass loudness to -16 LUFS / -1.5 dBTP
usage: process_voice.py ORIGINAL.m4a OUT_PROCESSED.wav"""
import sys, os, subprocess, json, tempfile
import numpy as np, soundfile as sf, noisereduce as nr
sys.path.insert(0, os.path.dirname(__file__))
src, out = sys.argv[1], sys.argv[2]
tmp = tempfile.mkdtemp()
raw = os.path.join(tmp, "raw.wav")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", raw], check=True)
x, sr = sf.read(raw, dtype="float32")
noise = x[int(0.5 * sr):int(6.0 * sr)]
y = nr.reduce_noise(y=x, sr=sr, y_noise=noise, stationary=True, prop_decrease=0.85, n_fft=2048, freq_mask_smooth_hz=300, time_mask_smooth_ms=60)
den = os.path.join(tmp, "den.wav"); sf.write(den, y, sr, subtype="FLOAT")
ed = os.path.join(tmp, "edited.wav")
subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "edit_voiceover.py"), den, ed], check=True)
chain = ("highpass=f=75:poles=2,highpass=f=75:poles=2,"
         "equalizer=f=280:t=q:w=1.1:g=-3,equalizer=f=3500:t=q:w=0.9:g=3,highshelf=f=10000:g=2,"
         "deesser=i=0.4:m=0.5:f=0.5,agate=threshold=0.013:ratio=3:attack=10:release=250:range=0.3:knee=4,"
         "acompressor=threshold=-22dB:ratio=2.5:attack=15:release=150:knee=6:makeup=3,"
         "acompressor=threshold=-12dB:ratio=4:attack=3:release=60:makeup=1")
# pass 1: measure
r = subprocess.run(["ffmpeg", "-hide_banner", "-i", ed, "-af", chain + ",loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"],
                   capture_output=True, text=True)
j = json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])
ln = (f"loudnorm=I=-16:TP=-1.5:LRA=7:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:"
      f"measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", ed, "-af", chain + "," + ln + ",aresample=48000", "-c:a", "pcm_s24le", out], check=True)
print("ok", out, "input I", j["input_i"])
