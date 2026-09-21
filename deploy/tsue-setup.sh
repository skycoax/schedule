#!/usr/bin/env bash
# Разовая установка расписания ТГЭУ (второй вуз на том же сервере). Запусти на
# сервере — спросит sudo-пароль один раз. Бэкенд (~/tsue-server) и сборка сайта
# (~/tsue-web-new) уже должны быть на месте — это делает Claude заранее.
set -e
echo "== 1/4 служба бэкенда (порт 8791) =="
sudo cp ~/tsue-api.service /etc/systemd/system/tsue-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now tsue-api

echo "== 2/4 будущие деплои без пароля =="
echo 'ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart tsue-api, /usr/bin/systemctl status tsue-api' | sudo tee /etc/sudoers.d/tsue-api >/dev/null

echo "== 3/4 nginx + TLS =="
sudo mkdir -p /var/www/tsue
sudo chown ubuntu:ubuntu /var/www/tsue
sudo cp ~/tsue-skycoax.nginx /etc/nginx/sites-available/tsue.skycoax.uz
sudo ln -sf /etc/nginx/sites-available/tsue.skycoax.uz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d tsue.skycoax.uz --non-interactive --agree-tos --redirect

echo "== 4/4 выкладываю сайт =="
cp -r ~/tsue-web-new/* /var/www/tsue/

echo ""
echo "ГОТОВО — https://tsue.skycoax.uz"
