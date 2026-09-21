# -*- coding: utf-8 -*-
"""
Собирает site/index.html — версию страницы для своего сервера.

Отличие от версии в Apps Script ровно одно: сверху дописывается конфиг с адресом
JSON-API и токеном на запись. Сама разметка и логика — тот же файл, поэтому
править нужно только apps-script/Index.html.

Запуск:  python build_site.py
"""
import io, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'apps-script', 'Index.html')
OUT_DIR = os.path.join(HERE, 'site')
OUT = os.path.join(OUT_DIR, 'index.html')

# ── заполнить перед выкладкой ────────────────────────────────────────────────
API = 'https://script.google.com/macros/s/AKfycbw3Q_91thWAajWY1YVjOSrBrDA4tzjfmCYN7W3x4NSV_cGo-u4VF-Z5dvjjUXJFiRGg/exec'
TOKEN = ''   # значение из makeApiToken() в Apps Script; пустой — страница только читает
SITE = 'https://kfu.bestcenter.uz'   # адрес, по которому страница будет жить
# ─────────────────────────────────────────────────────────────────────────────

html = io.open(SRC, encoding='utf-8').read()

config = (
    '<script>\n'
    '/* Адрес JSON-API и токен на запись. Без токена страница работает в режиме\n'
    '   чтения: расписание видно, но выбор группы и уведомления не сохраняются\n'
    '   на сервере (только в этом браузере). */\n'
    "window.RASPISANIE_API = '%s';\n"
    "window.RASPISANIE_TOKEN = '%s';\n"
    '</script>\n'
) % (API, TOKEN)

# <base target="_top"> нужен только внутри Apps Script — на своём домене он мешает.
html = html.replace('<base target="_top">\n', '')

# Шаблонную вставку Apps Script подменяем: на своём домене метку источника
# читаем прямо из адреса (?from=tg), а referrer там виден по-настоящему.
html = html.replace(
    "var FROM='<?= from ?>';",
    "var FROM=(location.search.match(/[?&]from=([\\w-]+)/) || [])[1] || '';")

# Настройки в адресе: на своём домене читаем их прямо из location.search.
html = html.replace(
    "var URL_GRP='<?= grp0 ?>';",
    "var URL_GRP=decodeURIComponent((location.search.match(/[?&]group=([^&]*)/) || [])[1] || '');")
html = html.replace(
    "var URL_OK='<?= ok0 ?>';",
    "var URL_OK=/[?&]ok=1/.test(location.search) ? '1' : '';")
html = html.replace(
    "var URL_CID='<?= cid0 ?>';",
    "var URL_CID=(location.search.match(/[?&]u=([a-z0-9]+)/i) || [])[1] || '';")

# На своём домене подключаем манифест: без него Chrome не предложит установку.
# Плюс карточка ссылки — расписание раздают в Telegram, и там видно превью.
head_extra = (
    '<link rel="manifest" href="manifest.json">\n'
    '<link rel="apple-touch-icon" href="icon-192.png">\n'
    '<link rel="canonical" href="%(site)s/">\n'
    '<meta property="og:type" content="website">\n'
    '<meta property="og:site_name" content="Расписание КФУ">\n'
    '<meta property="og:title" content="Расписание КФУ · Джизак">\n'
    '<meta property="og:description" content="Пары своей группы, обратный отсчёт '
    'до начала и правки расписания — сразу на телефоне.">\n'
    '<meta property="og:url" content="%(site)s/">\n'
    '<meta property="og:image" content="%(site)s/icon-512.png">\n'
    '<meta name="twitter:card" content="summary">\n'
) % {'site': SITE}
html = html.replace('</head>', head_extra + config + '</head>', 1)

if not os.path.isdir(OUT_DIR):
    os.makedirs(OUT_DIR)
io.open(OUT, 'w', encoding='utf-8', newline='\n').write(html)
print('written:', OUT, len(html), 'bytes')
print('API   :', API)
print('TOKEN :', TOKEN or '(пусто — только чтение)')
