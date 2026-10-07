#!/usr/bin/env bash
# Финальная сборка: видео (Remotion, без звука) + звук (tools/audio.py) → out/para-promo.mp4
#   bash promo/tools/render.sh <mix-raw.wav> [--draft]
# --draft: 960×540 для быстрой проверки движения.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIX="$1"; DRAFT="${2:-}"
cd "$ROOT"
mkdir -p out
if [ "$DRAFT" = "--draft" ]; then
  npx remotion render src/index.ts Para out/video-draft.mp4 --scale=0.5 --crf=22 --concurrency=3 --log=error
  V=out/video-draft.mp4; OUT=out/para-promo-draft.mp4
else
  npx remotion render src/index.ts Para out/video.mp4 --crf=14 --x264-preset=slow --concurrency=3 --log=error
  V=out/video.mp4; OUT=out/para-promo.mp4
fi
# громкость: −14 LUFS, пик −1 dBTP (два прохода loudnorm)
J=$(ffmpeg -hide_banner -i "$MIX" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
mi=$(echo "$J" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log([j.input_i,j.input_tp,j.input_lra,j.input_thresh,j.target_offset].join(' '))})")
read -r II ITP ILRA ITH OFF <<< "$mi"
ffmpeg -v error -y -i "$V" -i "$MIX" -map 0:v -map 1:a -c:v copy \
  -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$II:measured_TP=$ITP:measured_LRA=$ILRA:measured_thresh=$ITH:offset=$OFF:linear=true,aresample=48000" \
  -c:a aac -b:a 320k -shortest -movflags +faststart "$OUT"
echo "$OUT"
