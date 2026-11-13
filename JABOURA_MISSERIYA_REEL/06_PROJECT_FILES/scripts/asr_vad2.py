"""VAD-segmented Whisper transcription with timestamps. Usage: asr_vad.py WHISPER_DIR VAD_ONNX AUDIO [start_s] [dur_s] > out.tsv"""
import sys, subprocess, numpy as np, sherpa_onnx
W, VAD, AUD = sys.argv[1:4]
import os; P = os.environ.get("WPREFIX", "small")
st = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
du = float(sys.argv[5]) if len(sys.argv) > 5 else None
cmd = ["ffmpeg", "-v", "error", "-ss", str(st)] + (["-t", str(du)] if du else []) + ["-i", AUD, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]
a = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32)
cfg = sherpa_onnx.VadModelConfig(); cfg.silero_vad.model = VAD; cfg.silero_vad.min_silence_duration = 0.35
cfg.silero_vad.min_speech_duration = 0.4; cfg.silero_vad.max_speech_duration = 14; cfg.sample_rate = 16000
vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=120)
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f"{W}/{P}-encoder.int8.onnx", decoder=f"{W}/{P}-decoder.int8.onnx",
        tokens=f"{W}/{P}-tokens.txt", language="ar", task="transcribe", num_threads=4)
win = cfg.silero_vad.window_size; i = 0
def flush():
    while not vad.empty():
        seg = vad.front; t0 = st + seg.start / 16000; t1 = t0 + len(seg.samples) / 16000
        s = rec.create_stream(); s.accept_waveform(16000, seg.samples); rec.decode_stream(s)
        print(f"{t0:.2f}\t{t1:.2f}\t{s.result.text.strip()}", flush=True); vad.pop()
while i + win <= len(a):
    vad.accept_waveform(a[i:i + win]); i += win; flush()
vad.flush(); flush()
