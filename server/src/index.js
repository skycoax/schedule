// HTTP-слой: один сервер на все вузы. Какой вуз — решает адрес запроса
// (kfu.skycoax.uz, tsue.skycoax.uz…), вузы описаны в tenants/<id>/tenant.json.
// Исключение — Para (para.skycoax.uz, см. hub.js): там вуз выбирает сам человек.
// Адрес вуза — та же Para с уже выбранным вузом и его брендом: расписание, вкладки, вход
// и «Обсуждения» работают одинаково (social/), отличаются только бренд и то, откуда берётся вуз.
// Отдаёт API и саму страницу приложения с брендом вуза. Запуск: npm start (Node 22+).
import Fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import { config } from './config.js';
import { metaGet } from './db.js';
import { loadTenants, tenantFor, shortName } from './tenants.js';
import { loadHub, isHubHost, isDevHub, devTenantOf, hubTenant } from './hub.js';
import { pageHtml, hubPageHtml, manifest, hubManifest, redirectHtml, brandFile, assetFile, unknownHostHtml } from './site.js';
import { scheduleResponse } from './schedule.js';
import { teachersList, teacherSchedule } from './teachers.js';
import { logHit, aggregate, summary, pulse, scrubCoarseIp } from './analytics.js';
import { addReview, listReviews, ReviewError } from './reviews.js';
import { startPoller, pollOnce } from './poller.js';
import { registerSocial, corsOptions, logSerializers } from './social/index.js';

// Отдельные страницы Para (публичные ссылки для Google Play и правила «Обсуждений»): одни на все адреса.
const HUB_PAGES = { '/policy': 'policy.html', '/rules': 'rules.html', '/delete-account': 'delete-account.html' };

const app = Fastify({
  // Доверяем только своему nginx (127.0.0.1): иначе X-Forwarded-For подделывается клиентом.
  trustProxy: '127.0.0.1',
  // В журнале запросов — без IP и без параметров адреса (там code, state, поиск, ПИН, группа, cid).
  logger: { level: process.env.LOG_LEVEL || 'info', serializers: logSerializers },
});

// API расписания открыто всем сайтам; вход, обсуждения и фото — только со своей страницы.
await app.register(cors, corsOptions);

const tenants = loadTenants();
tenants.forEach((t) => scrubCoarseIp(t.db));   // IP с обнулённым октетом больше не храним
app.log.info({ tenants: tenants.map((t) => `${t.id} → ${t.hosts.join(', ')}`) }, 'вузы загружены');
const hub = loadHub();
if (hub) app.log.info({ hosts: hub.hosts, redirectOldHosts: hub.redirectOldHosts }, 'Para подключена');

// На адресе Para вуз выбирает человек (?uni= или кука), на адресе вуза — сам адрес.
app.decorateRequest('tenant', null);
app.decorateRequest('hub', false);
app.addHook('onRequest', async (req) => {
  const devUni = devTenantOf(tenants, req.headers.host);   // разработка: kfu.localhost — адрес вуза
  req.hub = !devUni && (isHubHost(hub, req.headers.host) || isDevHub(hub, req.headers.host));
  req.tenant = req.hub ? hubTenant(tenants, req) : devUni || tenantFor(tenants, req.headers.host);
});

// Маршруты API работают только на адресе подключённого вуза.
const api = (handler) => async (req, reply) => {
  if (!req.tenant) {
    reply.code(404);
    return { ok: false, error: req.hub ? 'Вуз не выбран' : 'Этот адрес не подключён ни к одному вузу' };
  }
  return handler(req.tenant, req, reply);
};

// ─── Здоровье: общее и по каждому вузу ───
app.get('/api/health', async (req) => ({
  ok: true,
  tenant: req.tenant ? req.tenant.id : null,
  lastPoll: req.tenant ? metaGet(req.tenant.db, 'last_poll') : null,
  tenants: tenants.map((t) => ({ id: t.id, hosts: t.hosts, lastPoll: metaGet(t.db, 'last_poll') })),
  now: new Date().toISOString(),
}));

// ─── Все подключённые вузы — для выбора вуза ───
// Логотипы — через /brand-of/<id>/…: с того же адреса, иначе CSS-маска упрётся в CORS.
// people/today/spark — сколько людей пользуется расписанием вуза (см. pulse).
app.get('/api/universities', async () => ({
  ok: true,
  data: tenants.map((t) => ({
    id: t.id,
    short: shortName(t),
    university: t.brand.university,
    url: `https://${t.hosts[0]}`,
    logo: `/brand-of/${t.id}/logo-mark.png`,
    ...pulse(t),
  })),
}));

// ─── Расписание для приложения ───
// ?group=KEY — пары только выбранной группы (у EduPage-вуза групп больше тысячи).
app.get('/api/schedule', api(async (t, req) => scheduleResponse(t, req.query || {})));

// ─── Преподаватели: список вуза и расписание одного (тот же снимок, другой угол) ───
app.get('/api/teachers', api(async (t) => teachersList(t)));
app.get('/api/teacher', api(async (t, req, reply) => {
  const r = teacherSchedule(t, (req.query || {}).key);
  if (!r.ok) reply.code(404);
  return r;
}));

// ─── Заход (аналитика). Принимаем и POST (JSON), и GET (beacon no-cors). ───
function hitFrom(req) {
  const s = { ...(req.query || {}), ...(req.body || {}) };
  return {
    ip: req.ip,
    ua: req.headers['user-agent'] || '',
    // Настоящая модель Android — только отсюда (см. Accept-CH в index.html);
    // обычный User-Agent Chrome с 2024 года отдаёт заглушку "K".
    chModel: req.headers['sec-ch-ua-model'] || '',
    cid: s.cid, first: s.first === '1' || s.first === 1 || s.first === true,
    from: s.from, ref: s.ref, grp: s.grp, scr: s.scr, lang: s.lang,
  };
}
app.post('/api/hit', api(async (t, req) => { logHit(t, hitFrom(req)); return { ok: true }; }));
app.get('/api/hit', api(async (t, req) => { logHit(t, hitFrom(req)); return { ok: true }; }));

// ─── Статистика — открыта всем, без пароля ───
// Приложение ничего не скрывает: данные и так обезличены (см. analytics.js).
app.get('/api/stats', api(async (t) => ({ ok: true, data: aggregate(t) })));
// Короткая сводка для блока на главном экране (минуту кешируется).
app.get('/api/stats/summary', api(async (t) => ({ ok: true, data: summary(t) })));

// ─── Отзывы: без регистрации, оценка + текст. Текст выводится на фронте как
// обычный текст JSX, не через innerHTML — этим и защищаемся от XSS по-настоящему;
// очистка на сервере (reviews.js) — вторым слоем, на случай другого потребителя.
app.get('/api/reviews', api(async (t) => ({ ok: true, data: listReviews(t) })));

app.post('/api/reviews', api(async (t, req, reply) => {
  const b = req.body || {};
  try {
    const saved = addReview(t, { cid: b.cid, name: b.name, rating: b.rating, text: b.text, ip: req.ip });
    return { ok: true, data: saved };
  } catch (err) {
    reply.code(err instanceof ReviewError ? 400 : 500);
    return { ok: false, error: err instanceof ReviewError ? err.message : 'Ошибка сервера' };
  }
}));

// ─── Ручная сверка — действие, а не просмотр, поэтому всё ещё по ПИНу ───
function pinOk(pin) {
  return !!config.adminPin && String(pin || '') === config.adminPin;
}
app.get('/api/refresh', api(async (t, req, reply) => {
  if (!pinOk(req.query.pin)) { reply.code(403); return { ok: false, error: 'Неверный ПИН' }; }
  return { ok: true, data: await pollOnce(t, app.log.child({ tenant: t.id })) };
}));

// Неизвестный адрес или метод: ответ как у Fastify, но в журнал — без строки запроса
// (в ней бывают code, state, cid, группа).
app.setNotFoundHandler((req, reply) => {
  const line = `Route ${req.raw.method}:${String(req.raw.url || '').split('?')[0]} not found`;
  req.log.info(line);
  reply.code(404).send({ message: line, error: 'Not Found', statusCode: 404 });
});

// ─── Аккаунты и обсуждения (на адресе Para и на адресах вузов, см. social/index.js) ───
if (hub) await app.register(registerSocial, { hub, tenants });

// ─── Сама страница, манифест и картинки бренда ───
async function site(req, reply) {
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')) {
    reply.code(404);
    return { ok: false, error: 'Нет такого адреса API' };
  }

  const asset = path.startsWith('/assets/') && assetFile(path);
  if (asset) {
    reply.header('cache-control', 'public, max-age=31536000, immutable').type(asset.type);
    return asset.body;
  }

  // Логотип любого вуза — для списка вузов (с любого адреса).
  const other = path.match(/^\/brand-of\/([a-z0-9-]+)\/([^/]+)$/);
  if (other) {
    const ot = tenants.find((x) => x.id === other[1]);
    const file = ot && brandFile(ot, other[2]);
    if (!file) { reply.code(404); return { ok: false, error: 'Нет такой картинки' }; }
    reply.header('cache-control', 'public, max-age=86400').type(file.type);
    return file.body;
  }

  // На адресе Para бренд, манифест и картинки — свои, общие для всех вузов.
  const t = req.tenant;
  const own = req.hub ? hub : t;
  if (!own) {
    reply.code(404).type('text/html; charset=utf-8');
    return unknownHostHtml();
  }

  if (path === '/manifest.json') {
    reply.header('cache-control', 'public, max-age=86400');
    return req.hub ? hubManifest(hub) : manifest(t);
  }

  // Политика, правила обсуждений и удаление аккаунта отдельными страницами: на них нужны
  // публичные ссылки в Google Play. Тот же смысл есть внутри приложения («Условия и данные»).
  // Страницы одни на все адреса: аккаунт и «Обсуждения» тоже одни.
  const doc = hub && HUB_PAGES[path.replace(/\/+$/, '')];
  if (doc) {
    const file = join(hub.dir, doc);
    if (existsSync(file)) {
      reply.header('cache-control', 'public, max-age=3600').type('text/html; charset=utf-8');
      return readFileSync(file);
    }
  }

  if (path === '/robots.txt') {
    reply.header('cache-control', 'public, max-age=86400').type('text/plain; charset=utf-8');
    return 'User-agent: *\nDisallow: /api/\n';
  }

  // Связь сайта с Android-приложением (TWA): без неё сверху видна адресная строка.
  if (req.hub && path === '/.well-known/assetlinks.json') {
    const file = join(hub.dir, 'assetlinks.json');
    if (!existsSync(file)) { reply.code(404); return []; }
    reply.header('cache-control', 'public, max-age=3600').type('application/json');
    return readFileSync(file);
  }

  // Значок вкладки: браузер сам просит /favicon.ico, в странице ссылки на него нет.
  if (path === '/favicon.ico') {
    const file = brandFile(own, 'icon-192.png');
    if (!file) { reply.code(404); return { ok: false, error: 'Файл не найден' }; }
    reply.header('cache-control', 'public, max-age=86400').type(file.type);
    return file.body;
  }

  if (path.startsWith('/brand/')) {
    const file = brandFile(own, path.slice('/brand/'.length));
    if (!file) { reply.code(404); return { ok: false, error: 'Нет такой картинки' }; }
    reply.header('cache-control', 'public, max-age=86400').type(file.type);
    return file.body;
  }

  // Работа без интернета: service worker из сборки сайта. Всегда свежий — иначе
  // исправление в нём дойдёт до людей только через сутки.
  if (path === '/sw.js') {
    const file = join(config.webDir, 'sw.js');
    if (!existsSync(file)) { reply.code(404); return { ok: false, error: 'Файл не найден' }; }
    reply.header('cache-control', 'no-cache').type('text/javascript; charset=utf-8');
    return readFileSync(file);
  }

  // Любой другой путь с расширением — это отсутствующий файл, а не страница.
  if (/\.[a-z0-9]+$/i.test(path)) { reply.code(404); return { ok: false, error: 'Файл не найден' }; }

  // Ссылки на пост или профиль не для поисковиков: содержимое там от людей, а не от Para.
  if (req.query && (req.query.post || req.query.user)) reply.header('x-robots-tag', 'noindex');
  reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8');
  if (req.hub) return hubPageHtml(hub, t);
  // Старый адрес вуза: люди переезжают в Para вместе со своими настройками.
  if (hub && hub.redirectOldHosts) return redirectHtml(t, hub);
  return pageHtml(t, hub);
}
app.get('/', site);
app.get('/*', site);

// ─── Старт ───
// Опрос источников — вразнобой, чтобы вузы не читали расписание в одну секунду.
// NO_POLL=1 — только для локальной проверки: берём снимки из DATA_DIR и не дёргаем EduPage.
if (process.env.NO_POLL !== '1') {
  tenants.forEach((t, i) => {
    setTimeout(() => startPoller(t, app.log.child({ tenant: t.id })), i * 5000).unref();
  });
}
app.listen({ port: config.port, host: config.host })
  .then(() => app.log.info(`Расписания на http://${config.host}:${config.port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
