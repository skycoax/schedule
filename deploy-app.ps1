# Обновление нового стека (React + бэкенд) на kfu.bestcenter.uz — Windows.
#
#   .\deploy-app.ps1            — собрать и выложить фронт и бэкенд
#   .\deploy-app.ps1 -WebOnly   — только фронт (быстро, если бэкенд не менялся)
#
# Работает БЕЗ пароля: /var/www/kfu принадлежит ubuntu, а перезапуск службы
# kfu-api разрешён без пароля узким правилом sudoers (ставится один раз при
# первичной настройке — см. deploy/SETUP.md). Первичную настройку с sudo
# нужно сделать один раз вручную; дальше — только этот скрипт.

param([switch]$WebOnly)

$ErrorActionPreference = 'Stop'
$HostName = 'ubuntu@46.8.195.171'
Set-Location $PSScriptRoot

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { throw 'Нет ssh (OpenSSH Client).' }
$tmp = $env:TEMP

Write-Host '→ собираю фронт' -ForegroundColor Cyan
Push-Location web
npm run build
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw 'Сборка фронта упала — на сервер ничего не отправлено.' }

Write-Host '→ выкладываю фронт' -ForegroundColor Cyan
tar -czf "$tmp\kfu-web.tgz" -C web/dist .
scp "$tmp\kfu-web.tgz" "${HostName}:/tmp/kfu-web.tgz"
if ($LASTEXITCODE -ne 0) { throw 'scp фронта не удался.' }
ssh $HostName "rm -rf ~/kfu-web-new && mkdir -p ~/kfu-web-new && tar -xzf /tmp/kfu-web.tgz -C ~/kfu-web-new && rm -rf /var/www/kfu/assets && cp -r ~/kfu-web-new/* /var/www/kfu/ && echo web-ok"
if ($LASTEXITCODE -ne 0) { throw 'Раскладка фронта на сервере не удалась.' }

if (-not $WebOnly) {
    Write-Host '→ выкладываю бэкенд' -ForegroundColor Cyan
    tar -czf "$tmp\kfu-server.tgz" -C server --exclude=node_modules --exclude=data --exclude=.env .
    scp "$tmp\kfu-server.tgz" "${HostName}:/tmp/kfu-server.tgz"
    if ($LASTEXITCODE -ne 0) { throw 'scp бэкенда не удался.' }
    ssh $HostName 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; tar -xzf /tmp/kfu-server.tgz -C ~/kfu-server && cd ~/kfu-server && npm install --omit=dev >/tmp/npm.log 2>&1 && sudo systemctl restart kfu-api && echo api-ok'
    if ($LASTEXITCODE -ne 0) { throw 'Обновление/перезапуск бэкенда не удались.' }
}

Write-Host ''
Write-Host 'Готово: https://kfu.skycoax.uz' -ForegroundColor Green
