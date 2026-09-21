#!/usr/bin/env bash
# Выкладка расписания на kfu.bestcenter.uz.
#
#   bash deploy.sh          — обновить страницу (обычный случай)
#   bash deploy.sh --full   — первый раз для домена: + иконки, манифест, конфиг nginx, сертификат
#
# /var/www/kfu уже принадлежит ubuntu, поэтому обычная заливка идёт без sudo
# и без пароля. Включить НОВЫЙ домен в nginx и получить для него сертификат
# скрипт не умеет и не пытается — это sudo, а sudo просит пароль интерактивно,
# через `ssh host "команда"` без живого терминала это не проходит физически.
set -e

HOST=ubuntu@46.8.195.171
DIR=/var/www/kfu
DOMAIN=kfu.bestcenter.uz     # держать в паре с SITE в build_site.py
CONF="site/$DOMAIN.nginx"

cd "$(dirname "$0")"
python build_site.py

echo "→ заливаю страницу"
scp site/index.html "$HOST:$DIR/index.html"

if [ "$1" = "--full" ]; then
  echo "→ заливаю иконки и манифест"
  scp site/manifest.json site/icon-192.png site/icon-512.png site/icon-maskable-512.png "$HOST:$DIR/"

  enabled=$(ssh "$HOST" "test -e /etc/nginx/sites-enabled/$DOMAIN && echo yes || echo no")
  if [ "$enabled" = "yes" ]; then
    echo "→ $DOMAIN уже настроен, менять nginx не нужно"
    echo
    echo "Готово: https://$DOMAIN"
    exit 0
  fi

  echo "→ заливаю конфиг nginx для $DOMAIN во временную папку (без sudo)"
  scp "$CONF" "$HOST:/tmp/"

  cat <<EOF

Файл лежит в /tmp на сервере. $DOMAIN ещё не включён в nginx — это разовый
шаг с sudo, его нужно выполнить самому.

1) Зайди на сервер:
   ssh ubuntu@46.8.195.171

2) Вставь одной командой (спросит пароль один раз):
   sudo mv /tmp/$DOMAIN.nginx /etc/nginx/sites-available/$DOMAIN && \\
   sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/ && \\
   sudo nginx -t && sudo systemctl reload nginx

3) Сертификат (тоже спросит пароль):
   sudo certbot --nginx -d $DOMAIN

После этого bash deploy.sh --full ещё раз покажет «уже настроен» и просто
зальёт файлы — без единого пароля.
EOF
  exit 1
fi

echo
echo "Готово: https://$DOMAIN"
