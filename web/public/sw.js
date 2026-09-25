// Para без интернета. Страница и расписание — «сначала сеть, иначе сохранённое»:
// пока связь есть, человек всегда видит свежее, а без неё — последнее загруженное.
// Сборка (/assets/, в именах хеш) не меняется — её берём из кеша. Заходы и отзывы
// (POST) идут только в сеть. Сохранённый ответ помечен заголовком x-para-saved
// (когда сохранён) — по нему приложение показывает «Без интернета» и само считает «сейчас».
// «Обсуждения», вход и фото (/api/auth, /api/social, /api/media) сюда не попадают никогда:
// это личные данные, их отдаёт только сеть, а фото кеширует сам браузер.
const CACHE = 'para-v1';
const PAGE = '/__page';                 // последняя удачно загруженная страница приложения — одна на всё
const WAIT_MS = 6000;                   // дольше этого ждать сеть не станем, если есть сохранённое
const API = /^\/api\/(schedule|teachers|teacher|universities|reviews|stats\/summary)$/;
const APP_PAGE = /^\/(index\.html)?$/;  // сохраняем как «страницу приложения» только её саму

const ASSET_TTL = 30 * 864e5;           // файл сборки, которым не пользовались 30 дней, выбрасываем
const ASSET_TOUCH = 7 * 864e5;          // дату использования обновляем не чаще раза в неделю

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    // Раньше как страница приложения сохранялся любой переход (например, /policy) — такую копию выбрасываем.
    const cache = await caches.open(CACHE);
    const page = await cache.match(PAGE);
    const html = page ? await page.clone().text() : '';
    if (page && !html.includes('id="root"')) await cache.delete(PAGE);
    // Старые файлы сборки копятся с каждой выкладкой. Те, на которые ссылается сохранённая страница, не трогаем;
    // без даты (сохранены прежней версией) — ставим дату сейчас.
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (!path.startsWith('/assets/') || html.includes(path)) continue;
      const res = await cache.match(req);
      if (!res) continue;
      const at = Date.parse(res.headers.get('x-para-saved') || '');
      if (!at) await save(req, res);
      else if (Date.now() - at > ASSET_TTL) await cache.delete(req);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    // /policy, /rules, /delete-account, /api/auth/* — обычные переходы, только сеть.
    if (APP_PAGE.test(url.pathname)) networkFirst(event, PAGE);
    return;
  }
  if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(req));
  else if (API.test(url.pathname) || url.pathname.startsWith('/brand/') || url.pathname === '/manifest.json') {
    networkFirst(event, req.url);
  }
  // /api/auth/*, /api/social/*, /api/media/* — не перехватываем (фото кеширует сам браузер, до 7 дней).
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) {
    // Файлом пользуются — продлеваем ему жизнь (не чаще раза в неделю).
    const at = Date.parse(hit.headers.get('x-para-saved') || '');
    if (!at || Date.now() - at > ASSET_TOUCH) save(req, hit.clone()).catch(() => {});
    return hit;
  }
  const res = await fetch(req);
  if (res.ok) save(req, res.clone()).catch(() => {});
  return res;
}

/**
 * Сеть; если её нет или она молчит дольше WAIT_MS — сохранённое (когда оно есть).
 * Свежий ответ сохраняем в любом случае, даже если человеку уже отдали сохранённое.
 */
function networkFirst(event, key) {
  const net = fetch(event.request);
  // Копию снимаем раньше, чем ответ уйдёт странице (обработчики then идут по порядку).
  event.waitUntil(net.then((res) => (res.ok ? save(key, res.clone()) : null)).catch(() => {}));
  event.respondWith((async () => {
    const hit = await caches.open(CACHE).then((c) => c.match(key));
    if (!hit) return net;
    const late = new Promise((resolve) => setTimeout(() => resolve(null), WAIT_MS));
    try {
      const res = await Promise.race([net, late]);
      // Ответ сервера отдаём как есть, кроме его поломки (5xx) — тогда лучше сохранённое.
      if (res && res.status < 500) return res;
    } catch { /* сети нет — ниже отдадим сохранённое */ }
    return hit;
  })());
}

/** Сохранить ответ с меткой x-para-saved (когда сохранён). key — Request или адрес строкой. */
async function save(key, res) {
  const headers = new Headers(res.headers);
  headers.set('x-para-saved', new Date().toISOString());
  const body = await res.blob();
  const cache = await caches.open(CACHE);
  await cache.put(key, new Response(body, { status: res.status, statusText: res.statusText, headers }));
}
