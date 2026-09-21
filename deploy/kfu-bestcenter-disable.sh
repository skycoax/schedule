#!/usr/bin/env bash
# Выключить kfu.bestcenter.uz (410 Gone). Спросит sudo-пароль один раз.
set -e
sudo cp ~/kfu-bestcenter-disable.nginx /etc/nginx/sites-available/kfu.bestcenter.uz
sudo nginx -t && sudo systemctl reload nginx
echo ""
echo "ГОТОВО — kfu.bestcenter.uz выключен. Живёт https://kfu.skycoax.uz"
