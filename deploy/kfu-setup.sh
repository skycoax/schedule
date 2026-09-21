#!/usr/bin/env bash
# Разовая установка нового стека. Запусти на сервере — спросит sudo-пароль один раз.
set -e
echo "== 1/4 служба бэкенда =="
sudo cp ~/kfu-api.service /etc/systemd/system/kfu-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now kfu-api
echo "== 2/4 будущие деплои без пароля =="
echo 'ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart kfu-api, /usr/bin/systemctl status kfu-api' | sudo tee /etc/sudoers.d/kfu-api >/dev/null
echo "== 3/4 nginx /api =="
sudo cp ~/kfu-new.nginx /etc/nginx/sites-available/kfu.bestcenter.uz
sudo nginx -t && sudo systemctl reload nginx
echo "== 4/4 переключаю сайт на новую сборку =="
cp -r ~/kfu-web-new/* /var/www/kfu/
echo ""
echo "ГОТОВО — https://kfu.bestcenter.uz"
