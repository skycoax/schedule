# Вузы

Один сервер обслуживает все вузы. Какой показать, он решает по адресу:
`kfu.skycoax.uz` → папка `kfu/`, `tsue.skycoax.uz` → папка `tsue/`.
У каждого вуза своя база (`data/<id>.db`): расписание, отзывы и статистика не смешиваются.

## Как добавить вуз

Пример — вуз с адресом `tatu.skycoax.uz`.

**1. Папка и настройки.** Скопируй `tsue/tenant.json` в новую папку `tatu/` и поменяй:

- `hosts` — адрес: `["tatu.skycoax.uz"]`. Имя папки — латиница в нижнем регистре, цифры, дефис;
- `source` — откуда брать расписание:
  - EduPage: `{ "type": "edupage", "host": "tatu.edupage.org" }`
    (проверь, что `https://tatu.edupage.org/timetable/` открывается без входа);
  - Google-таблица через Apps Script: `{ "type": "sheets", "url": "https://script.google.com/macros/s/…/exec" }`;
- `pollMinutes` — как часто сверять: 30 для EduPage (данные тяжёлые), 5 для таблицы;
- `site` — название, заголовок и описание для превью ссылки и главного экрана;
- `brand` — тексты в приложении: подпись, полное название вуза, «Что это», «Откуда данные», подсказка поиска.

**2. Картинки.** Нужен знак вуза без надписи по кругу — цветной на белом или прозрачном фоне
(всё, что темнее фона, станет формой логотипа; цвет потом даёт тема приложения).

```bash
python server/tenants/_tools/brand-images.py --logo знак.png --out server/tenants/tatu \
  --title "Расписание ТАТУ" --subtitle "Пары своей группы и отсчёт до начала — на телефоне" \
  --host tatu.skycoax.uz --og-logo полный-логотип.png
```

Скрипт кладёт в папку: `logo-mark.png`, `og.jpg`, `icon-192.png`, `icon-512.png`,
`icon-maskable-512.png`, `apple-touch-icon-dark.png`, `apple-touch-icon-light.png`.
Если берёшь логотип с Wikimedia Commons — впиши его лицензию в `brand.logoCredit`.

**3. Выкладка.**

```bash
bash deploy/deploy.sh
```

Всё. DNS и HTTPS для `*.skycoax.uz` уже настроены один раз на все поддомены, так что
новый адрес заработает сразу, а вуз сам появится в списке по нажатию на логотип.

## Отключить вуз

В его `tenant.json` добавь `"enabled": false` и выложи. База остаётся на сервере.
