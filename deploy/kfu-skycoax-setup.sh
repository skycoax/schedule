#!/usr/bin/env bash
# Подключить kfu.skycoax.uz к тому же приложению. Спросит sudo-пароль один раз.
set -e
echo "== 1/3 nginx-блок для kfu.skycoax.uz =="
sudo cp ~/kfu-skycoax.nginx /etc/nginx/sites-available/kfu.skycoax.uz
sudo ln -sf /etc/nginx/sites-available/kfu.skycoax.uz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
echo "== 2/3 сертификат (certbot) =="
sudo certbot --nginx -d kfu.skycoax.uz --non-interactive --agree-tos --redirect
echo "== 3/3 перезагрузка nginx =="
sudo systemctl reload nginx
echo ""
echo "ГОТОВО — https://kfu.skycoax.uz"
