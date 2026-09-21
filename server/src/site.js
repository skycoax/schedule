// Страница приложения для конкретного вуза. Сборка React одна на всех: сервер
// подставляет в её index.html название, описание и превью ссылки вуза, а бренд
// для интерфейса кладёт туда же JSON-ом (<script id="brand">). Картинки бренда —
// /brand/* из папки вуза, манифест для «На главный экран» — /manifest.json.
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

// Шаблон перечитываем, когда меняется файл: выкладка сайта не требует перезапуска.
let tpl = { mtime: 0, html: '' };
function template() {
  const file = join(config.webDir, 'index.html');
  const mtime = statSync(file).mtimeMs;
  if (mtime !== tpl.mtime) tpl = { mtime, html: readFileSync(file, 'utf8') };
  return tpl.html;
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function pageHtml(t) {
  // Telegram и другие мессенджеры кэшируют превью по URL. Версия из mtime файла
  // меняется после пересборки бренда, поэтому исправленная картинка подхватывается
  // сразу, а не остаётся прежней в карточке ссылки.
  const ogVersion = Math.round(statSync(join(t.dir, 'og.jpg')).mtimeMs);
  const values = {
    URL: `https://${t.hosts[0]}`,
    OG_IMAGE: `https://${t.hosts[0]}/brand/og.jpg?v=${ogVersion}`,
    SITE_NAME: t.site.name,
    TITLE: t.site.title,
    DESCRIPTION: t.site.description,
  };
  // JSON внутри <script>: «<» экранируем, чтобы текст бренда не мог закрыть тег.
  const brandJson = JSON.stringify(t.brand).replace(/</g, '\\u003c');
  return template()
    .replace(/\{\{BRAND_JSON\}\}/g, () => brandJson)
    .replace(/\{\{(URL|OG_IMAGE|SITE_NAME|TITLE|DESCRIPTION)\}\}/g, (_, k) => esc(values[k]));
}

export function manifest(t) {
  return {
    name: t.site.title,
    short_name: 'Расписание',
    description: t.site.appDescription,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    lang: 'ru',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

/** Картинка бренда: только плоское имя файла из папки вуза — никаких «../». */
export function brandFile(t, name) {
  const m = String(name || '').match(/^[a-z0-9-]+\.(png|jpe?g|webp|svg)$/i);
  if (!m) return null;
  const file = join(t.dir, name);
  if (!existsSync(file)) return null;
  return { body: readFileSync(file), type: IMAGE_TYPES[m[1].toLowerCase()] };
}

const ASSET_TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.map': 'application/json',
};

/** Файл сборки из /assets/. В проде их отдаёт nginx; это — запасной путь и для разработки. */
export function assetFile(urlPath) {
  const m = String(urlPath).match(/^\/assets\/([A-Za-z0-9._-]+)$/);
  if (!m) return null;
  const file = join(config.webDir, 'assets', m[1]);
  if (!existsSync(file)) return null;
  const ext = (m[1].match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  return { body: readFileSync(file), type: ASSET_TYPES[ext] || 'application/octet-stream' };
}

export function unknownHostHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Расписание не найдено</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#fff;
font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;text-align:center;padding:24px}
p{color:rgba(235,235,245,.6);margin:8px 0 0}</style></head>
<body><div><h1 style="font-size:22px;margin:0">Такого расписания нет</h1>
<p>По этому адресу вуз не подключён.</p></div></body></html>`;
}
