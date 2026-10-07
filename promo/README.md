# Рекламный ролик Para (≈100 с, 1920×1080, английская озвучка)

Не выкладывается на сервер (`deploy/deploy.sh` берёт только `server/` и `web/dist`). Всё, что тяжёлое или
собирается заново (`public/`, `out/`, `node_modules/`), в git не кладётся.

Как устроено:

1. **Экраны** — настоящее приложение: локальный сервер (как в `AGENTS.md`, с `DEV_LOGIN=1 DEV_HUB=1`) и Chromium
   в размере iPhone 393×852 @3x. `capture/shoot.mjs` снимает покадрово (часы страницы и CSS-анимации двигаются
   ровно на 1/30 с за кадр), касания пишет в `.json`.
   - время «15:45, идёт пара» подставляется в ответ `/api/schedule` (`now`);
   - правки группы и активность вузов — из ответов прода: `capture/prod-kfu.json`
     (`/api/schedule?uni=kfu&group=<ключ ИСиТ 1 курс>`) и `capture/prod-unis.json` (`/api/universities`);
   - «Обсуждения» — только демо-люди: `tools/promo-seed.mjs` (фото — Pexels, лицензия Pexels).
2. **Покер** — кусок записи владельца (`clips/poker.mp4`, 30 к/с), его строка состояния закрыта своей.
3. **Строка состояния** — `tools/statusbar.py`.
4. **Кадры для Remotion** — `tools/prepare.sh <клипы> <строки состояния>` → `public/frames/…`, `src/clips.json`.
5. **3D и титры** — Remotion + three.js: `src/Video.tsx` (сцены и камера), `src/Phone.tsx` (модель),
   `src/screen.ts` (экран — 2D-холст: кадр + строка состояния + уведомление/касания), `src/timeline.ts` (тайминг).
6. **Звук** — всё синтезировано кодом, без чужих сэмплов:
   - озвучка: `tools/vo.py` (Kokoro-82M, Apache-2.0, голос `af_heart`), текст — `vo-script.json`;
   - щелчки часов по кадрам: `tools/flips.py`;
   - музыка, эффекты и сведение: `tools/audio.py` (тайминг — `tools/timeline-json.mjs`).
7. **Сборка** — `bash tools/render.sh <mix-raw.wav>` → `out/para-promo.mp4` (громкость −14 LUFS).

Пробные кадры: `node tools/stills.mjs <папка> <кадр…>`. В песочнице без GPU WebGL идёт через SwiftShader
(`remotion.config.ts`), полный рендер — около часа.
