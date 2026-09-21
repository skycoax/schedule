# Переезд нового стека на kfu.bestcenter.uz

Новый стек = **React-сборка** (статика в `/var/www/kfu`) + **бэкенд** (Node на
`127.0.0.1:8790`, служба `kfu-api`) + **nginx** проксирует `/api/` на бэкенд.
Тот же домен — без CORS и без второго сертификата.

## Что уже сделано (без sudo, автоматически)

- Node 22 поставлен через nvm (`~/.nvm`).
- Бэкенд в `~/kfu-server`, зависимости стоят, `.env` создан
  (`IP_SALT` сгенерирован на сервере, `ADMIN_PIN` пуст).
- Проверено: бэкенд поднимается, читает источник, отдаёт `/api/schedule`.
- React-сборка распакована в `~/kfu-web-new`.
- Подготовлены `~/kfu-api.service` (служба) и `~/kfu-new.nginx` (конфиг с `/api`).

## Разовый шаг с sudo — выполнить один раз

Зайти на сервер и вставить одним блоком:

```bash
ssh ubuntu@46.8.195.171
```

```bash
# 1) бэкенд как служба (автозапуск при ребуте)
sudo cp ~/kfu-api.service /etc/systemd/system/kfu-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now kfu-api

# 2) будущие деплои — без пароля (разрешён только перезапуск этой службы)
echo 'ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart kfu-api, /usr/bin/systemctl status kfu-api' | sudo tee /etc/sudoers.d/kfu-api >/dev/null

# 3) nginx: включить /api (SPA-раздача остаётся)
sudo cp ~/kfu-new.nginx /etc/nginx/sites-available/kfu.bestcenter.uz
sudo nginx -t && sudo systemctl reload nginx

# 4) переключить сайт на новую сборку
cp -r ~/kfu-web-new/* /var/www/kfu/
echo "ГОТОВО  https://kfu.bestcenter.uz"
```

## ПИН для админки

По умолчанию админка выключена (`ADMIN_PIN` пуст). Поставить свой (6+ цифр):

```bash
cd ~/kfu-server
sed -i 's/^ADMIN_PIN=.*/ADMIN_PIN=123456/' .env    # заменить 123456 на свой
sudo systemctl restart kfu-api
```

Потом админка открывается по `https://kfu.bestcenter.uz/?admin=1`.

## Дальнейшие обновления — без пароля

С Windows, из папки проекта:

```powershell
.\deploy-app.ps1            # фронт + бэкенд
.\deploy-app.ps1 -WebOnly   # только фронт (быстрее)
```

`/var/www/kfu` принадлежит `ubuntu`, а перезапуск `kfu-api` разрешён без пароля —
поэтому скрипт всё делает сам.

## Полезное на сервере

```bash
systemctl status kfu-api          # жив ли бэкенд
journalctl -u kfu-api -n 50       # логи бэкенда
curl -s 127.0.0.1:8790/api/health # проверка изнутри
```
