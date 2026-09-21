#!/usr/bin/env bash
# Выкладывает подготовленную карточку University Schedule Network на skycoax.uz.
# Запускать владельцу сервера: bash ~/deploy-skycoax-network.sh
set -euo pipefail

source_dir="$HOME/skycoax.uz-site"
target_dir="/var/www/skycoax"
backup_dir="$HOME/skycoax-network-backup-$(date +%Y%m%d-%H%M%S)"
files=(
  "schedule-network.css"
  "schedule-network.js"
  "portfolio-covers.js"
  "university-schedules.css"
  "university-schedules.js"
  "projects/university-schedules-cover-v2.png"
  "projects/humogram-cover-v2.png"
  "projects/games-cover-v2.png"
  "index.html"
  "about/index.html"
  "contact/index.html"
  "work/games/index.html"
  "work/humogram/index.html"
  "ru/index.html"
  "ru/about/index.html"
  "ru/contact/index.html"
  "ru/work/games/index.html"
  "ru/work/humogram/index.html"
  "uz/index.html"
  "uz/about/index.html"
  "uz/contact/index.html"
  "uz/work/games/index.html"
  "uz/work/humogram/index.html"
  "work/university-schedules/index.html"
  "ru/work/university-schedules/index.html"
  "uz/work/university-schedules/index.html"
  "work/kfu-schedule/index.html"
  "ru/work/kfu-schedule/index.html"
  "uz/work/kfu-schedule/index.html"
  "university-logos/emu.png"
  "university-logos/iut.png"
  "university-logos/kfu.png"
  "university-logos/newuu.png"
  "university-logos/nordic.png"
  "university-logos/taqu.png"
  "university-logos/tdtu.png"
  "university-logos/tiiame.png"
  "university-logos/time.png"
  "university-logos/tiue.png"
  "university-logos/tkti.png"
  "university-logos/tmuni.png"
  "university-logos/tsue.png"
  "university-logos/utas.png"
)

# Next.js uses these RSC text files for client-side navigation. They must be
# published together with index.html or an internal transition can show stale UI.
while IFS= read -r -d '' file; do
  files+=("${file#./}")
done < <(cd "$source_dir" && find . -type f -name '*.txt' -print0)

for file in "${files[@]}"; do
  test -f "$source_dir/$file"
done

for file in "${files[@]}"; do
  if test -f "$target_dir/$file"; then
    mkdir -p "$(dirname "$backup_dir/$file")"
    sudo cp "$target_dir/$file" "$backup_dir/$file"
  fi
done

for file in "${files[@]}"; do
  sudo install -D -m 0644 "$source_dir/$file" "$target_dir/$file"
  sudo chown www-data:www-data "$target_dir/$file"
done

echo 'Готово: https://skycoax.uz, https://skycoax.uz/ru/ и https://skycoax.uz/uz/'
