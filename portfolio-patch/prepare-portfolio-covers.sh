#!/usr/bin/env bash
set -euo pipefail

site_dir="${1:-$HOME/skycoax.uz-site}"

while IFS= read -r -d '' file; do
  sed -i \
    -e 's#/projects/humogram\.jpg#/projects/humogram-cover-v2.png#g' \
    -e 's#/projects/game-vigilance\.png#/projects/games-cover-v2.png#g' \
    -e 's#/projects/university-schedules-cover\.png#/projects/university-schedules-cover-v2.png#g' \
    "$file"
done < <(find "$site_dir" -type f \( -name '*.html' -o -name '*.txt' \) -print0)

while IFS= read -r -d '' file; do
  if ! grep -q '/portfolio-covers.js' "$file"; then
    sed -i 's#</body>#<script defer src="/portfolio-covers.js"></script></body>#' "$file"
  fi
done < <(find "$site_dir" -type f -name '*.html' -print0)

echo 'Prepared portfolio covers and navigation fallback.'
