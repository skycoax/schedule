#!/usr/bin/env bash
# HTTPS для skycoax.uz. Сейчас у сайта есть только HTTP-блок nginx, поэтому
# https://skycoax.uz попадает на чужой сайт этого сервера (сертификат
# adminkiber.unistart-hub.uz) — браузер предупреждает и открывает не тот сайт.
# Запусти на сервере: ssh -t ubuntu@46.8.195.171 "bash ~/skycoax-ssl.sh"
set -e
sudo nginx -t
sudo certbot --nginx -d skycoax.uz -d www.skycoax.uz --non-interactive --agree-tos --redirect
echo ""
echo "ГОТОВО — https://skycoax.uz"
