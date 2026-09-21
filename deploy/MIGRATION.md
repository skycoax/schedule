# Восстановление на новом VPS

`migrate-vps.sh` — **однократная установка на пустой Ubuntu/Debian с systemd**,
не замена обычной выкладке `deploy/deploy.sh`. Запускается владельцем от root.
Пароль из чата в скрипты не вставлять; сменить его в консоли хостинга.

## Подготовка и запуск

1. Дождаться доступности нового VPS по SSH. В панели хостинга проверить, что
   разрешены входящие TCP 22, 80, 443. Скрипт не меняет firewall или SSH.
2. В Cloudflare все используемые A-записи должны вести на новый IP; устаревшие
   AAAA-записи мешают HTTPS-проверке. На время выпуска сертификата предпочтителен
   режим DNS only без принудительного перенаправления HTTP на HTTPS.
3. Загрузить `migrate-vps.sh` и три архива в `/root/skycoax-migration`:

   - `server.tgz`: содержимое `server/`, без `data/`, `node_modules/`, `.env`, `.git`;
   - `web.tgz`: содержимое проверенной сборки `web/dist/`;
   - `portfolio.tgz`: полный статический сайт с актуальными патчами, с `index.html`
     в корне (не только папка `portfolio-patch/`).

   Необязательно: официальный `node-v22.23.2-linux-x64.tar.xz` для x86_64 или
   `node-v22.23.2-linux-arm64.tar.xz` для ARM. Иначе скрипт скачает его с nodejs.org.
   В обоих случаях проверяется закреплённый SHA256 из
   [официального выпуска Node.js](https://nodejs.org/en/blog/release/v22.23.2/).
   `admin-key.pub` необязателен: публичный SSH-ключ для входа `ubuntu`.
   Скрипт проверит формат и добавит ключ без удаления существующих.

4. В терминале нового сервера:

   ```bash
   bash /root/skycoax-migration/migrate-vps.sh --bundle /root/skycoax-migration --https --email YOUR_EMAIL
   ```

   Вместо `YOUR_EMAIL` укажите свой адрес. Без `--email` сертификат регистрируется
   без адреса для уведомлений. `--https` принимает условия Let's Encrypt и
   выпускает сертификат для `skycoax.uz` и основных адресов включённых вузов.
   Также включён `www.skycoax.uz`: его DNS тоже должен вести на новый VPS.
   Wildcard не используется; API-токен Cloudflare не нужен. Все эти домены
   должны быть доступны снаружи по HTTP. После выпуска можно включить проксирование
   Cloudflare с SSL/TLS **Full (strict)**; режим Flexible вызывает цикл редиректов.

Для установки только HTTP опустите `--https`. Повторять bootstrap для добавления
HTTPS нельзя: скрипт специально останавливается, если приложение уже существует.
После исправления DNS запустите отдельно от root (путь к backup напечатан при установке):

```bash
mapfile -t domains </root/skycoax-migration-backup.XXXXXXXX/certificate-hosts
args=()
for domain in "${domains[@]}"; do args+=(-d "$domain"); done
certbot --nginx --redirect --cert-name skycoax-network "${args[@]}"
```

## Что создаётся

- Node.js 22.23.2 в `/opt/node-v22.23.2-linux-<arch>`, ссылки node/npm/npx в `/usr/local/bin`.
- `schedule-api` от пользователя `ubuntu`, слушающий только `127.0.0.1:8792`.
- Код `/home/ubuntu/schedule-server`, приватные БД в `data/`, сборка `/var/www/schedule`.
- Портфолио `/var/www/skycoax`, отдельный nginx-конфиг `skycoax-migration`.
- Случайный `IP_SALT` в `.env` с правами 600. `ADMIN_PIN` пока не задан;
  автоматическое обновление работает, ручной `/api/refresh` закрыт.
- Резервная копия прежней конфигурации nginx в приватной папке
  `/root/skycoax-migration-backup.XXXXXXXX`; чужие сайты не отключаются.
- Ограниченное sudo для `ubuntu`: только restart/status `schedule-api`.
  Публичный `admin-key.pub` добавляется в `ubuntu/.ssh/authorized_keys`, если передан.

При ошибке скрипт сохраняет диагностику и установленное содержимое. Не удаляйте
папки вслепую для повторного запуска: сначала устраните конкретную причину.

## Проверка и сохранность данных

```bash
systemctl is-active schedule-api nginx
curl -fsS -H 'Host: kfu.skycoax.uz' http://127.0.0.1/api/health
curl -fsS 'https://kfu.skycoax.uz/api/schedule?group='
curl -fsS 'https://tsue.skycoax.uz/api/schedule?group='
curl -I https://skycoax.uz/
certbot certificates
systemctl list-timers certbot.timer
```

Расписания заполнятся из открытых источников; первый опрос всех вузов занимает
несколько минут. **Отзывы, оценки, статистика и история правок сами не вернутся:**
они находятся в старых `data/*.db`. Пока старый VPS недоступен и резервных копий нет,
новый сервер начинает с пустых БД. Сохранённые у студентов ключи групп не меняются.
Когда старый сервер станет доступен, переносить SQLite нужно из согласованной
резервной копии или после остановки старого процесса, учитывая WAL-файлы.
Нельзя просто перезаписать новые БД: уже появившиеся отзывы потребуется объединить.

Для последующих выкладок использовать актуальный `deploy/deploy.sh`:
`DEPLOY_HOST=ubuntu@185.217.131.245 bash deploy/deploy.sh` (Git Bash).
На новом VPS Node/npm доступны через `/usr/local/bin`, NVM не требуется.
Не запускать старые корневые deploy-скрипты.
