#!/usr/bin/env bash
# Final mix + mux.  usage:
#   mix_and_export.sh VIDEO_NOAUDIO.mp4 OUT.mp4 [VOICEOVER.wav]
# Without a voiceover: music + SFX bed only (animatic / preview).
# With a voiceover: VO cleanup chain (HPF, denoise, EQ, de-ess, compression), music ducked under the voice
# (sidechain), loudness normalised to -14 LUFS / -1 dBTP (suitable for Facebook Reels on phone speakers).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; A="$HERE/../audio"
V="$1"; OUT="$2"; VO="${3:-}"
if [[ -z "$VO" ]]; then
  ffmpeg -y -loglevel error -i "$V" -i "$A/music.wav" -i "$A/sfx.wav" -filter_complex \
   "[1:a]volume=0.85[m];[2:a]volume=0.9[s];[m][s]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
   -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
else
  ffmpeg -y -loglevel error -i "$V" -i "$A/music.wav" -i "$A/sfx.wav" -i "$VO" -filter_complex \
   "[3:a]aresample=48000,pan=stereo|c0=c0|c1=c0,highpass=f=80,afftdn=nf=-25:tn=1,\
equalizer=f=250:t=q:w=1.2:g=-2,equalizer=f=3200:t=q:w=1.0:g=3,equalizer=f=6500:t=q:w=2:g=-2,\
acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=4,alimiter=limit=0.9,asplit=2[vo][key];\
[1:a]volume=0.8[m];[m][key]sidechaincompress=threshold=0.03:ratio=8:attack=40:release=500:makeup=1[mduck];\
[2:a]volume=0.7[s];[vo][mduck][s]amix=inputs=3:normalize=0:weights=1 0.55 0.6,loudnorm=I=-14:TP=-1:LRA=9[a]" \
   -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
fi
echo "exported $OUT"
