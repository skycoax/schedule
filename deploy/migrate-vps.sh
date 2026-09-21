#!/usr/bin/env bash
# Однократное восстановление на ПУСТОМ Ubuntu/Debian VPS. Не обычный deploy.
set -Eeuo pipefail
umask 022

die() { printf 'ОШИБКА: %s\n' "$*" >&2; exit 1; }
bundle=''
https=0
email=''
while (($#)); do
  case "$1" in
    --bundle) (($# >= 2)) || die 'Нужен путь после --bundle'; bundle=$2; shift 2 ;;
    --https) https=1; shift ;;
    --email) (($# >= 2)) || die 'Нужен адрес после --email'; email=$2; shift 2 ;;
    *) die 'Запуск: bash migrate-vps.sh --bundle /root/skycoax-migration [--https] [--email EMAIL]' ;;
  esac
done
[[ $EUID -eq 0 ]] || die 'Запусти от root.'
[[ -n "$bundle" && -d "$bundle" ]] || die 'Укажи папку с архивами через --bundle.'
bundle=$(realpath "$bundle")
[[ -f /etc/debian_version && -d /run/systemd/system ]] || die 'Нужен Ubuntu/Debian с systemd.'

node_version=v22.23.2
# SHA256 из https://nodejs.org/en/blog/release/v22.23.2/ (официальный выпуск).
case "$(uname -m)" in
  x86_64) node_arch=x64; node_sha=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307 ;;
  aarch64) node_arch=arm64; node_sha=fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8 ;;
  *) die 'Поддерживаются только x86_64 и aarch64.' ;;
esac
node_name="node-$node_version-linux-$node_arch"
node_dir="/opt/$node_name"
server_dir=/home/ubuntu/schedule-server
web_dir=/var/www/schedule
portfolio_dir=/var/www/skycoax
nginx_conf=/etc/nginx/sites-available/skycoax-migration
nginx_link=/etc/nginx/sites-enabled/skycoax-migration

# Никаких перезаписей существующего приложения, БД или конфигурации.
for path in "$server_dir" "$web_dir" "$portfolio_dir" "$node_dir" \
  "$nginx_conf" "$nginx_link" /etc/systemd/system/schedule-api.service \
  /etc/sudoers.d/schedule-api /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx; do
  [[ ! -e "$path" && ! -L "$path" ]] || die "Уже существует $path; требуется ручная миграция с резервной копией."
done
[[ $(systemctl show schedule-api.service -p LoadState --value) == not-found ]] \
  || die 'Служба schedule-api уже существует.'
for archive in server.tgz web.tgz portfolio.tgz; do
  [[ -s "$bundle/$archive" ]] || die "Нет архива $archive."
done
if id ubuntu >/dev/null 2>&1; then
  [[ $(getent passwd ubuntu | cut -d: -f6) == /home/ubuntu ]] || die 'У ubuntu нестандартная домашняя папка.'
fi

backup=$(mktemp -d /root/skycoax-migration-backup.XXXXXXXX)
chmod 700 "$backup"
trap 'printf "Остановлено на строке %s. Файлы и диагностика сохранены: %s. Повторный запуск намеренно защищён от перезаписи.\n" "$LINENO" "$backup" >&2' ERR
[[ ! -d /etc/nginx ]] || cp -a /etc/nginx "$backup/nginx-before-packages"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends nginx certbot python3-certbot-nginx \
  ca-certificates curl xz-utils python3 openssl openssh-client sudo
nginx -t
nginx -T >"$backup/nginx-before.txt" 2>&1
python3 - "$backup/nginx-before.txt" <<'PY'
import re, sys
text = open(sys.argv[1], encoding='utf-8').read()
text = re.sub(r'#.*', '', text)
for names in re.findall(r'\bserver_name\s+([^;]+);', text):
    if 'skycoax.uz' in names:
        sys.exit('В nginx уже есть skycoax.uz; остановка, чтобы не затронуть существующий сайт.')
PY
cp -a /etc/nginx "$backup/nginx-before-sites"

# До распаковки исключаем выход за каталог, ссылки и случайно упакованные секреты/БД.
python3 - "$bundle" <<'PY'
import pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
for name in ('server.tgz', 'web.tgz', 'portfolio.tgz'):
    with tarfile.open(root / name, 'r:gz') as archive:
        for entry in archive:
            path = pathlib.PurePosixPath(entry.name)
            if path.is_absolute() or '..' in path.parts or not (entry.isfile() or entry.isdir()):
                sys.exit(f'Недопустимый путь/тип записи в {name}')
            if any(p == '.git' or p.startswith('.env') for p in path.parts):
                sys.exit(f'Служебные файлы или .env в {name}; перепакуйте без них.')
            if name == 'server.tgz' and any(p in ('data', 'node_modules') for p in path.parts):
                sys.exit('server.tgz должен быть без data и node_modules.')
PY

node_archive="$bundle/$node_name.tar.xz"
if [[ ! -f "$node_archive" ]]; then
  node_archive="$backup/$node_name.tar.xz"
  curl --proto '=https' --tlsv1.2 --fail --show-error --location --retry 3 \
    "https://nodejs.org/dist/$node_version/$node_name.tar.xz" --output "$node_archive"
fi
printf '%s  %s\n' "$node_sha" "$node_archive" | sha256sum --check --status \
  || die 'SHA256 Node.js не совпадает с официальным выпуском.'
tar -xJf "$node_archive" -C /opt --no-same-owner
"$node_dir/bin/node" --version
for binary in node npm npx; do ln -s "$node_dir/bin/$binary" "/usr/local/bin/$binary"; done

id ubuntu >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ubuntu
ubuntu_group=$(id -gn ubuntu)
install -d -m 0755 -o ubuntu -g "$ubuntu_group" /home/ubuntu "$server_dir" "$web_dir"
if [[ -f "$bundle/admin-key.pub" ]]; then
  ssh-keygen -lf "$bundle/admin-key.pub" >/dev/null || die 'Некорректный admin-key.pub.'
  [[ ! -L /home/ubuntu/.ssh && ! -L /home/ubuntu/.ssh/authorized_keys ]] || die 'SSH-каталог не должен быть ссылкой.'
  install -d -m 0700 -o ubuntu -g "$ubuntu_group" /home/ubuntu/.ssh
  python3 - "$bundle/admin-key.pub" /home/ubuntu/.ssh/authorized_keys <<'PY'
import pathlib, sys
lines = pathlib.Path(sys.argv[1]).read_text().strip().splitlines()
if len(lines) != 1 or len(lines[0].split()) < 2:
    sys.exit('В admin-key.pub нужен ровно один публичный ключ.')
key = lines[0].split()
if not key[0].startswith(('ssh-', 'ecdsa-')):
    sys.exit('Ожидается публичный OpenSSH ключ без опций.')
target = pathlib.Path(sys.argv[2])
existing = target.read_text() if target.exists() else ''
if not any(line.split()[:2] == key[:2] for line in existing.splitlines()):
    with target.open('a') as output:
        output.write(('\n' if existing and not existing.endswith('\n') else '') + lines[0] + '\n')
PY
  chmod 0600 /home/ubuntu/.ssh/authorized_keys
  chown ubuntu:"$ubuntu_group" /home/ubuntu/.ssh/authorized_keys
fi
install -d -m 0755 -o www-data -g www-data "$portfolio_dir"
tar -xzf "$bundle/server.tgz" -C "$server_dir" --no-same-owner --no-same-permissions
tar -xzf "$bundle/web.tgz" -C "$web_dir" --no-same-owner --no-same-permissions
tar -xzf "$bundle/portfolio.tgz" -C "$portfolio_dir" --no-same-owner --no-same-permissions
[[ -f "$server_dir/src/index.js" && -f "$server_dir/package-lock.json" \
  && -f "$web_dir/index.html" && -f "$portfolio_dir/index.html" ]] || die 'Неверная структура архивов.'
chown -R ubuntu:"$ubuntu_group" "$server_dir" "$web_dir"
chown -R www-data:www-data "$portfolio_dir"
install -d -m 0700 -o ubuntu -g "$ubuntu_group" "$server_dir/data"
(
  umask 077
  printf 'IP_SALT=' >"$server_dir/.env"
  openssl rand -hex 32 >>"$server_dir/.env"
)
chown ubuntu:"$ubuntu_group" "$server_dir/.env"
# ADMIN_PIN намеренно не задан: ручная принудительная сверка закрыта.
(cd "$server_dir" && runuser -u ubuntu -- env PATH="$node_dir/bin:/usr/bin:/bin" \
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
for file in "$server_dir"/src/*.js; do "$node_dir/bin/node" --check "$file"; done

# Из tenant.json берём все адреса nginx и только основные адреса сертификата.
python3 - "$server_dir/tenants" "$backup" <<'PY'
import json, pathlib, re, sys
all_hosts, primary = [], []
for path in sorted(pathlib.Path(sys.argv[1]).glob('*/tenant.json')):
    if path.parent.name.startswith('_'):
        continue
    tenant = json.loads(path.read_text(encoding='utf-8-sig'))
    if tenant.get('enabled') is False:
        continue
    hosts = tenant['hosts']
    if not hosts:
        sys.exit('У вуза нет hosts.')
    for host in hosts:
        if not re.fullmatch(r'[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?\.skycoax\.uz', host):
            sys.exit('Неподдерживаемый адрес в tenant.json.')
        if host in all_hosts:
            sys.exit('Повтор адреса в tenant.json.')
        all_hosts.append(host)
    primary.append(hosts[0])
if not primary:
    sys.exit('Нет включённых вузов.')
out = pathlib.Path(sys.argv[2])
(out / 'tenant-hosts').write_text('\n'.join(all_hosts) + '\n')
# Оба адреса проверены перед подготовкой миграции; DNS должен вести на новый VPS.
portfolio = ['skycoax.uz', 'www.skycoax.uz']
(out / 'portfolio-hosts').write_text('\n'.join(portfolio) + '\n')
(out / 'certificate-hosts').write_text('\n'.join(portfolio + primary) + '\n')
PY
mapfile -t tenant_hosts <"$backup/tenant-hosts"
mapfile -t certificate_hosts <"$backup/certificate-hosts"
mapfile -t portfolio_hosts <"$backup/portfolio-hosts"

cat > /etc/systemd/system/schedule-api.service <<EOF
[Unit]
Description=University schedules API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$server_dir
ExecStart=$node_dir/bin/node --experimental-sqlite src/index.js
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8792
Environment=WEB_DIR=$web_dir
Environment=DATA_DIR=$server_dir/data
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$server_dir/data

[Install]
WantedBy=multi-user.target
EOF
chmod 644 /etc/systemd/system/schedule-api.service
systemd-analyze verify /etc/systemd/system/schedule-api.service
systemctl daemon-reload
systemctl enable --now schedule-api
healthy=0
for attempt in {1..30}; do
  if curl --fail --silent --max-time 3 -H "Host: ${tenant_hosts[0]}" \
    http://127.0.0.1:8792/api/health >"$backup/health.json"; then healthy=1; break; fi
  sleep 1
done
[[ $healthy == 1 ]] || die 'API не запустился. Проверь systemctl status schedule-api.'

cat >"$nginx_conf" <<EOF
server {
    listen 80;
    server_name ${portfolio_hosts[*]};
    root $portfolio_dir;
    index index.html;
    location / { try_files \$uri \$uri/ \$uri.html =404; }
}
server {
    listen 80;
    server_name ${tenant_hosts[*]};
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:8792;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
ln -s "$nginx_conf" "$nginx_link"
if ! nginx -t; then
  mv "$nginx_link" "$backup/disabled-nginx-link"
  die "Проверка nginx не прошла; новый сайт отключён, старые конфиги сохранены в $backup."
fi
systemctl enable --now nginx
systemctl reload nginx

# Только две команды для последующих обычных выкладок, не общий доступ sudo.
systemctl_bin=$(command -v systemctl)
printf 'ubuntu ALL=(root) NOPASSWD: %s restart schedule-api, %s status schedule-api\n' \
  "$systemctl_bin" "$systemctl_bin" >"$backup/schedule-api.sudoers"
visudo -cf "$backup/schedule-api.sudoers"
install -m 0440 "$backup/schedule-api.sudoers" /etc/sudoers.d/schedule-api

curl --fail --silent --output /dev/null -H 'Host: skycoax.uz' http://127.0.0.1/
for host in "${tenant_hosts[@]}"; do
  curl --fail --silent --output /dev/null --max-time 5 -H "Host: $host" http://127.0.0.1/api/health
done
if ((https)); then
  cp -a /etc/nginx "$backup/nginx-before-certbot"
  certbot_args=(--nginx --non-interactive --agree-tos --redirect --cert-name skycoax-network)
  if [[ -n "$email" ]]; then certbot_args+=(--email "$email");
  else certbot_args+=(--register-unsafely-without-email); fi
  for host in "${certificate_hosts[@]}"; do certbot_args+=(-d "$host"); done
  certbot "${certbot_args[@]}"
  nginx -t
  systemctl reload nginx
fi
printf '\nHTTP и API запущены. Вузов: %s. Резервная копия конфигурации: %s\n' "${#tenant_hosts[@]}" "$backup"
printf 'Первые расписания загружаются автоматически; прежние отзывы/статистика требуют старых БД.\n'
if ((!https)); then printf 'HTTPS пока НЕ настроен. Следующий шаг — certbot по deploy/MIGRATION.md.\n'; fi
