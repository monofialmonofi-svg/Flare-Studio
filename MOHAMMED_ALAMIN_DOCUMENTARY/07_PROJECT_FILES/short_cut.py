import subprocess, sys, numpy as np, soundfile as sf
S = sys.argv[1]
SEG = [(5.5, 19.8), (20.6, 33.0), (45.2, 57.0), (67.7, 74.8), (105.2, 117.5), (147.2, 157.9), (211.4, 224.8), (230.3, 240.0)]
T = sum(b - a for a, b in SEG); print("short duration", round(T, 2))
for o in ("h", "v"):
    src = f"{S}/amin_out_{o}/cat3.mp4"; lst = []
    for i, (a, b) in enumerate(SEG):
        d = b - a; out = f"{S}/short/{o}_s{i}.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{a}", "-i", src, "-t", f"{d}", "-vf", f"fade=t=in:st=0:d=0.3,fade=t=out:st={d-0.3:.2f}:d=0.3",
                        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30", "-an", out], check=True)
        lst.append(f"file '{out}'")
    open(f"{S}/short/{o}_list.txt", "w").write(chr(10).join(lst) + chr(10))
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{S}/short/{o}_list.txt", "-c", "copy", f"{S}/short/pic_{o}.mp4"], check=True)
    print(o, "picture ok")
# audio: the song runs continuously from its start; the original oud returns for the closing segment
SR = 48000; N = int(T * SR)
song, _ = sf.read(f"{S}/song/song.wav", dtype="float32"); score, _ = sf.read(f"{S}/amin/master.wav", dtype="float32")
close_len = SEG[-1][1] - SEG[-1][0]; cs = int((T - close_len) * SR)
s = song[:cs + int(2.5 * SR)].copy(); fi = int(1.0 * SR); s[:fi] *= np.linspace(0, 1, fi)[:, None]
fo = int(4.0 * SR); s[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo))[:, None]
mix = np.zeros((N, 2), np.float32); mix[:len(s)] += s[:N]
c = score[int((SEG[-1][0] - 2.0) * SR):int(SEG[-1][1] * SR)].copy(); c[:int(3 * SR)] *= np.sin(np.linspace(0, np.pi / 2, int(3 * SR)))[:, None]
st = cs - int(2.0 * SR); mix[st:st + len(c)] += c[:N - st] * 0.75
fe = int(1.2 * SR); mix[-fe:] *= np.linspace(1, 0, fe)[:, None]
sf.write(f"{S}/short/mix_premaster.wav", mix, SR, subtype="FLOAT"); print("audio ok")
