#!/usr/bin/env bash
# Обновить расписания ВСЕХ вузов на сервере: сборка сайта + сервер + папки вузов (tenants).
# Без пароля: /var/www/schedule принадлежит ubuntu, перезапуск schedule-api разрешён sudoers.
# Запуск из корня проекта (Git Bash): bash deploy/deploy.sh
set -euo pipefail

# При переезде: DEPLOY_HOST=ubuntu@185.217.131.245 bash deploy/deploy.sh
HOST="${DEPLOY_HOST:-ubuntu@46.8.195.171}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== сборка сайта =="
(cd "$ROOT/web" && npm run build)

echo "== упаковка =="
tar --force-local -czf "$TMP/web.tgz" -C "$ROOT/web/dist" .
tar --force-local -czf "$TMP/server.tgz" -C "$ROOT/server" --exclude=node_modules --exclude=data --exclude=.env .

echo "== выкладка =="
scp "$TMP/web.tgz" "$TMP/server.tgz" "$HOST:/tmp/"
ssh "$HOST" 'set -e
  mkdir -p ~/schedule-server
  tar -xzf /tmp/server.tgz -C ~/schedule-server 2>/dev/null; rm /tmp/server.tgz
  cd ~/schedule-server
  export NVM_DIR="$HOME/.nvm"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
  fi
  command -v node >/dev/null
  command -v npm >/dev/null
  npm install --omit=dev --no-audit --no-fund >/tmp/schedule-npm.log 2>&1
  rm -rf /var/www/schedule/assets
  tar -xzf /tmp/web.tgz -C /var/www/schedule 2>/dev/null; rm /tmp/web.tgz
  sudo systemctl restart schedule-api
  sleep 3
  systemctl is-active schedule-api
  curl -fsS -H "Host: kfu.skycoax.uz" http://127.0.0.1:8792/api/health'
echo
echo "Готово"
