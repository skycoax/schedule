#!/usr/bin/env bash
# Разовый переезд на единый сервер расписаний: все вузы — одна служба schedule-api,
# один сайт /var/www/schedule и один wildcard-сертификат *.skycoax.uz.
#
# Перед запуском:
#   1. В Cloudflare у skycoax.uz есть A-запись «*» → 46.8.195.171 (DNS only).
#   2. Есть API-токен Cloudflare: Zone → DNS → Edit, только зона skycoax.uz.
#      Скрипт спросит его сам (ввод скрыт) и сохранит на сервере, в чат его не присылай.
# Запуск: ssh -t ubuntu@46.8.195.171 "bash ~/schedule-setup.sh"
set -euo pipefail

echo "== 1/7 плагин certbot для Cloudflare =="
sudo apt-get install -y python3-certbot-dns-cloudflare >/dev/null

echo "== 2/7 токен Cloudflare =="
if sudo test -f /etc/letsencrypt/cloudflare.ini; then
  echo "уже сохранён"
else
  read -rsp "Вставь API-токен Cloudflare и нажми Enter (символы не отображаются): " CF_TOKEN
  echo
  printf 'dns_cloudflare_api_token = %s\n' "$CF_TOKEN" | sudo tee /etc/letsencrypt/cloudflare.ini >/dev/null
  unset CF_TOKEN
  sudo chmod 600 /etc/letsencrypt/cloudflare.ini
fi

echo "== 3/7 сертификат *.skycoax.uz (DNS-проверка, ~1 минута) =="
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  --cert-name skycoax.uz-wildcard -d '*.skycoax.uz' \
  --non-interactive --agree-tos --keep-until-expiring

echo "== 4/7 сайт и служба schedule-api =="
sudo mkdir -p /var/www/schedule
sudo chown ubuntu:ubuntu /var/www/schedule
cp -r ~/schedule-web/* /var/www/schedule/
sudo cp ~/schedule-api.service /etc/systemd/system/schedule-api.service
echo 'ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart schedule-api, /usr/bin/systemctl status schedule-api' \
  | sudo tee /etc/sudoers.d/schedule-api >/dev/null
sudo systemctl daemon-reload

echo "== 5/7 переносим базы КФУ и ТГЭУ (сайты недоступны несколько секунд) =="
sudo systemctl stop kfu-api tsue-api
mkdir -p ~/schedule-server/data
for id in kfu tsue; do
  for ext in "" "-wal" "-shm"; do
    if [ -f ~/"$id"-server/data/raspisanie.db"$ext" ]; then
      cp ~/"$id"-server/data/raspisanie.db"$ext" ~/schedule-server/data/"$id".db"$ext"
    fi
  done
done
sudo systemctl enable --now schedule-api

ok=""
for _ in $(seq 1 30); do
  if curl -fsS -H "Host: kfu.skycoax.uz" http://127.0.0.1:8792/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ -z "$ok" ]; then
  echo "!! schedule-api не поднялся — возвращаю старые службы, сайты работают как раньше"
  journalctl -u schedule-api -n 30 --no-pager || true
  sudo systemctl disable --now schedule-api || true
  sudo systemctl start kfu-api tsue-api
  exit 1
fi

echo "== 6/7 nginx: *.skycoax.uz → schedule-api =="
sudo cp /etc/nginx/sites-available/kfu.bestcenter.uz /etc/nginx/sites-available/kfu.bestcenter.uz.bak
sudo cp ~/schedule-skycoax.nginx /etc/nginx/sites-available/schedule.skycoax.uz
sudo cp ~/kfu-bestcenter-redirect.nginx /etc/nginx/sites-available/kfu.bestcenter.uz
sudo ln -sf /etc/nginx/sites-available/schedule.skycoax.uz /etc/nginx/sites-enabled/schedule.skycoax.uz
sudo rm -f /etc/nginx/sites-enabled/kfu.skycoax.uz /etc/nginx/sites-enabled/tsue.skycoax.uz
if ! sudo nginx -t; then
  echo "!! ошибка в конфиге nginx — откатываю"
  sudo rm -f /etc/nginx/sites-enabled/schedule.skycoax.uz
  sudo cp /etc/nginx/sites-available/kfu.bestcenter.uz.bak /etc/nginx/sites-available/kfu.bestcenter.uz
  sudo ln -sf /etc/nginx/sites-available/kfu.skycoax.uz /etc/nginx/sites-enabled/kfu.skycoax.uz
  sudo ln -sf /etc/nginx/sites-available/tsue.skycoax.uz /etc/nginx/sites-enabled/tsue.skycoax.uz
  sudo systemctl disable --now schedule-api || true
  sudo systemctl start kfu-api tsue-api
  exit 1
fi
sudo systemctl reload nginx

echo "== 7/7 старые службы выключены (их папки и базы остаются резервной копией) =="
sudo systemctl disable kfu-api tsue-api >/dev/null 2>&1 || true

echo ""
echo "ГОТОВО — https://kfu.skycoax.uz и https://tsue.skycoax.uz работают от одного сервера"
