// Страница приложения для конкретного вуза. Сборка React одна на всех: сервер
// подставляет в её index.html название, описание и превью ссылки вуза, а бренд
// для интерфейса кладёт туда же JSON-ом (<script id="brand">). Картинки бренда —
// /brand/* из папки вуза, манифест для «На главный экран» — /manifest.json.
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, social } from './config.js';
import { shortName } from './tenants.js';
import { hubUrl } from './hub.js';

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

// Telegram и другие мессенджеры кэшируют превью по URL. Версия из mtime файла
// меняется после пересборки бренда, поэтому исправленная картинка подхватывается
// сразу, а не остаётся прежней в карточке ссылки.
const ogImage = (url, dir) => `${url}/brand/og.jpg?v=${Math.round(statSync(join(dir, 'og.jpg')).mtimeMs)}`;

function render(site, url, dir, brandObj) {
  const values = {
    URL: url,
    OG_IMAGE: ogImage(url, dir),
    SITE_NAME: site.name,
    TITLE: site.title,
    DESCRIPTION: site.description,
  };
  // JSON внутри <script>: «<» экранируем, чтобы текст бренда не мог закрыть тег.
  const brandJson = JSON.stringify(brandObj).replace(/</g, '\\u003c');
  return template()
    .replace(/\{\{BRAND_JSON\}\}/g, () => brandJson)
    .replace(/\{\{(URL|OG_IMAGE|SITE_NAME|TITLE|DESCRIPTION)\}\}/g, (_, k) => esc(values[k]));
}

export function pageHtml(t) {
  return render(t.site, `https://${t.hosts[0]}`, t.dir, t.brand);
}

/**
 * Страница Para. Бренд Para свой: в шапке её знак, а эмблемы вузов — только в списке
 * вузов (откуда они взяты, сказано в «Условиях и данных», поэтому logoCredit остаётся).
 * t — выбранный вуз, или null: тогда приложение сначала покажет список вузов.
 */
export function hubPageHtml(hub, t) {
  // social — режим «Обсуждений» (SOCIAL_MODE) для первой отрисовки вкладок; точный ответ даёт /api/auth/me.
  // moveIn — старые адреса вузов переносят сюда настройки (#m=, redirectOldHosts); иначе #m= не принимается.
  // Здесь нет ничего личного: эту страницу service worker хранит как страницу приложения.
  const moveIn = hub.redirectOldHosts === true;
  const brandObj = t
    ? { ...t.brand, hub: true, label: shortName(t), about: hub.about, social: social.mode, moveIn }
    : { hub: true, id: '', label: hub.site.name, university: '', logoCredit: '', about: hub.about,
        source: '', sourceShort: '', searchHint: '', social: social.mode, moveIn };
  return render(hub.site, hubUrl(hub), hub.dir, brandObj);
}

function manifestOf(site, shortLabel) {
  return {
    id: '/',
    name: site.title,
    short_name: shortLabel,
    description: site.appDescription,
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

export const manifest = (t) => manifestOf(t.site, 'Расписание');
export const hubManifest = (hub) => manifestOf(hub.site, hub.site.name);

/**
 * Старый адрес вуза → Para. Настройки (группа, тема, согласие…) живут в браузере
 * у старого адреса, серверу их не видно — поэтому переезд делает страница: собирает
 * их и уносит во фрагменте #m= (он не уходит на сервер и не попадает в логи).
 */
export function redirectHtml(t, hub) {
  const target = `${hubUrl(hub)}/?uni=${encodeURIComponent(t.id)}`;
  // Без agreed и cid: условия Para человек принимает сам, номер для статистики у Para свой.
  const keys = ['group', 'role', 'teacher', 'seenTs', 'theme', 'homeShown', 'reviewedAt', 'myRating', 'reviewPromptAt'];
  const script = `(function(){
var keys=${JSON.stringify(keys)},m={};
function get(k){try{var v=localStorage.getItem(k);if(v)return v}catch(e){}
var c=document.cookie.match(new RegExp('(?:^|; )'+k+'=([^;]*)'));return c?decodeURIComponent(c[1]):''}
keys.forEach(function(k){var v=get(k);if(v)m[k]=v});
var q=new URLSearchParams(location.search);
if(!m.group&&q.get('group'))m.group=q.get('group');
var url=${JSON.stringify(target)};
if(q.get('from'))url+='&from='+encodeURIComponent(q.get('from'));
if(Object.keys(m).length)url+='#m='+encodeURIComponent(JSON.stringify(m));
location.replace(url)})();`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><link rel="canonical" href="${esc(target)}">
<meta property="og:title" content="${esc(hub.site.title)}">
<meta property="og:description" content="${esc(hub.site.description)}">
<meta property="og:image" content="${esc(ogImage(hubUrl(hub), hub.dir))}">
<meta name="twitter:card" content="summary_large_image">
<title>${esc(hub.site.title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#fff;
font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;text-align:center;padding:24px}
a{color:#0A84FF}</style></head>
<body><div>Расписание теперь в Para.<br><a href="${esc(target)}">Открыть ${esc(hubUrl(hub).replace('https://', ''))}</a></div>
<script>${script}</script></body></html>`;
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
