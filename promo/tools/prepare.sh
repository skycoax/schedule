#!/usr/bin/env bash
# Подготовить public/ для Remotion из снятых клипов (capture/shoot.mjs) и записи владельца:
#   bash promo/tools/prepare.sh <папка с клипами .mp4/.json> <папка со строками состояния>
# → public/frames/<клип>/00001.jpg…, public/ui/*, src/clips.json (число кадров и касания каждого клипа).
set -euo pipefail
CLIPS="$1"; SB="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/public/frames" "$ROOT/public/ui"
cp "$SB"/statusbar-*.png "$ROOT/public/ui/"
cp "$ROOT/../server/hub/icon-512.png" "$ROOT/public/ui/"
echo '{' > "$ROOT/src/clips.json.tmp"
first=1
for f in "$CLIPS"/*.mp4; do
  name="$(basename "$f" .mp4)"
  [ "$name" = "test" ] && continue
  out="$ROOT/public/frames/$name"
  rm -rf "$out"; mkdir -p "$out"
  ffmpeg -v error -y -i "$f" -q:v 2 "$out/%05d.jpg"
  n=$(ls "$out" | wc -l)
  taps='[]'
  [ -f "$CLIPS/$name.json" ] && taps=$(node -e "console.log(JSON.stringify(require('$CLIPS/$name.json').taps||[]))")
  [ $first = 1 ] || echo ',' >> "$ROOT/src/clips.json.tmp"
  first=0
  printf '"%s": {"frames": %s, "taps": %s}' "$name" "$n" "$taps" >> "$ROOT/src/clips.json.tmp"
  echo "$name: $n кадров"
done
echo '}' >> "$ROOT/src/clips.json.tmp"
node -e "const fs=require('fs');const p='$ROOT/src/clips.json';fs.writeFileSync(p, JSON.stringify(JSON.parse(fs.readFileSync(p+'.tmp','utf8')), null, 1));fs.unlinkSync(p+'.tmp')"
