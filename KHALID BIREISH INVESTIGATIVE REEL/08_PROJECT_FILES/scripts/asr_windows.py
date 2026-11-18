import sys, subprocess, numpy as np, sherpa_onnx
W, AUD = sys.argv[1:3]; wins = [tuple(map(float, w.split(":"))) for w in sys.argv[3:]]
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f"{W}/large-v3-encoder.int8.onnx", decoder=f"{W}/large-v3-decoder.int8.onnx",
      tokens=f"{W}/large-v3-tokens.txt", language="ar", task="transcribe", num_threads=4)
for a, b in wins:
    x = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-ss", str(a), "-t", str(b - a), "-i", AUD, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                                     capture_output=True, check=True).stdout, np.float32)
    x = np.concatenate([np.zeros(4000, np.float32), x, np.zeros(16000, np.float32)])
    s = rec.create_stream(); s.accept_waveform(16000, x); rec.decode_stream(s)
    print(f"{a:7.2f}-{b:7.2f}\t{s.result.text.strip()}", flush=True)
