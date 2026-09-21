# Выкладка расписания на kfu.bestcenter.uz — версия для Windows.
#
#   .\deploy.ps1          — обновить страницу (обычный случай)
#   .\deploy.ps1 -Full    — первый раз для домена: + иконки, манифест, конфиг nginx, сертификат
#
# /var/www/kfu уже принадлежит ubuntu (настроено один раз раньше, для другого
# домена на этом же содержимом), поэтому обычная заливка файлов идёт вообще
# без sudo и без пароля. Единственное, что скрипт не умеет и не пытается
# делать сам, — включить НОВЫЙ домен в nginx и получить для него сертификат:
# это sudo, а sudo спрашивает пароль интерактивно, и через ssh "команда" без
# живого терминала это физически не проходит ("a terminal is required to
# authenticate"). Если для $Domain это уже сделано — -Full просто зальёт файлы.

param([switch]$Full)

$ErrorActionPreference = 'Stop'

$HostName = 'ubuntu@46.8.195.171'
$Dir      = '/var/www/kfu'
$Domain   = 'kfu.bestcenter.uz'          # держать в паре с SITE в build_site.py
$Conf     = "site/$Domain.nginx"

Set-Location $PSScriptRoot

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    throw 'Не найден ssh. Windows 10/11: Параметры → Приложения → Дополнительные компоненты → OpenSSH Client.'
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Не найден python — он нужен, чтобы собрать страницу.'
}

Write-Host '→ собираю страницу' -ForegroundColor Cyan
python build_site.py
if ($LASTEXITCODE -ne 0) { throw 'build_site.py упал — на сервер ничего не отправлено.' }

# Папка на сервере — своя, поэтому содержимое льётся прямо туда, без /tmp и без sudo.
Write-Host '→ заливаю страницу' -ForegroundColor Cyan
scp site/index.html "${HostName}:${Dir}/index.html"
if ($LASTEXITCODE -ne 0) { throw 'Не удалось скопировать index.html.' }

if ($Full) {
    Write-Host '→ заливаю иконки и манифест' -ForegroundColor Cyan
    scp site/manifest.json site/icon-192.png site/icon-512.png site/icon-maskable-512.png "${HostName}:${Dir}/"
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось скопировать иконки/манифест.' }

    Write-Host "→ проверяю, включён ли $Domain в nginx" -ForegroundColor Cyan
    $enabled = ssh $HostName "test -e /etc/nginx/sites-enabled/$Domain && echo yes || echo no"
    if ($enabled.Trim() -eq 'yes') {
        Write-Host "→ $Domain уже настроен, менять nginx не нужно" -ForegroundColor Cyan
        Write-Host ''
        Write-Host "Готово: https://$Domain" -ForegroundColor Green
        exit 0
    }

    Write-Host "→ заливаю конфиг nginx для $Domain во временную папку (без sudo)" -ForegroundColor Cyan
    scp $Conf "${HostName}:/tmp/"
    if ($LASTEXITCODE -ne 0) { throw "Не удалось скопировать $Conf." }

    Write-Host ''
    Write-Host "Файл лежит в /tmp на сервере. $Domain ещё не включён в nginx —" -ForegroundColor Yellow
    Write-Host 'это разовый шаг с sudo, его нужно выполнить самому.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '1) Зайди на сервер:' -ForegroundColor White
    Write-Host '   ssh ubuntu@46.8.195.171'
    Write-Host ''
    Write-Host '2) Вставь одной командой (спросит пароль один раз):' -ForegroundColor White
    Write-Host @"
   sudo mv /tmp/$Domain.nginx /etc/nginx/sites-available/$Domain && \
   sudo ln -sf /etc/nginx/sites-available/$Domain /etc/nginx/sites-enabled/ && \
   sudo nginx -t && sudo systemctl reload nginx
"@
    Write-Host ''
    Write-Host '3) Сертификат (тоже спросит пароль):' -ForegroundColor White
    Write-Host "   sudo certbot --nginx -d $Domain"
    Write-Host ''
    Write-Host 'После этого .\deploy.ps1 -Full ещё раз покажет "уже настроен" и просто' -ForegroundColor Yellow
    Write-Host 'зальёт файлы — без единого пароля.' -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host "Готово: https://$Domain" -ForegroundColor Green
