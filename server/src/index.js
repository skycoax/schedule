// HTTP-слой: один сервер на все вузы. Какой вуз — решает адрес запроса
// (kfu.skycoax.uz, tsue.skycoax.uz…), вузы описаны в tenants/<id>/tenant.json.
// Отдаёт API и саму страницу приложения с брендом вуза. Запуск: npm start (Node 22+).
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { metaGet } from './db.js';
import { loadTenants, tenantFor } from './tenants.js';
import { pageHtml, manifest, brandFile, assetFile, unknownHostHtml } from './site.js';
import { scheduleResponse } from './schedule.js';
import { teachersList, teacherSchedule } from './teachers.js';
import { logHit, aggregate, summary } from './analytics.js';
import { addReview, listReviews, ReviewError } from './reviews.js';
import { startPoller, pollOnce } from './poller.js';

const app = Fastify({
  // За nginx настоящий IP приходит в X-Forwarded-For — доверяем ему.
  trustProxy: true,
  logger: { level: process.env.LOG_LEVEL || 'info' },
});

await app.register(cors, { origin: true });

const tenants = loadTenants();
app.log.info({ tenants: tenants.map((t) => `${t.id} → ${t.hosts.join(', ')}`) }, 'вузы загружены');

app.decorateRequest('tenant', null);
app.addHook('onRequest', async (req) => { req.tenant = tenantFor(tenants, req.headers.host); });

// Маршруты API работают только на адресе подключённого вуза.
const api = (handler) => async (req, reply) => {
  if (!req.tenant) {
    reply.code(404);
    return { ok: false, error: 'Этот адрес не подключён ни к одному вузу' };
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

// ─── Все подключённые вузы — для выбора вуза по логотипу ───
// Логотипы — через /brand-of/<id>/…: с того же адреса, иначе CSS-маска упрётся в CORS.
app.get('/api/universities', async () => ({
  ok: true,
  data: tenants.map((t) => ({
    id: t.id,
    short: t.brand.label.replace(/^Расписание\s+/i, ''),
    university: t.brand.university,
    url: `https://${t.hosts[0]}`,
    logo: `/brand-of/${t.id}/logo-mark.png`,
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

  const t = req.tenant;
  if (!t) {
    reply.code(404).type('text/html; charset=utf-8');
    return unknownHostHtml();
  }

  if (path === '/manifest.json') {
    reply.header('cache-control', 'public, max-age=86400');
    return manifest(t);
  }

  if (path.startsWith('/brand/')) {
    const file = brandFile(t, path.slice('/brand/'.length));
    if (!file) { reply.code(404); return { ok: false, error: 'Нет такой картинки' }; }
    reply.header('cache-control', 'public, max-age=86400').type(file.type);
    return file.body;
  }

  // Любой другой путь с расширением — это отсутствующий файл, а не страница.
  if (/\.[a-z0-9]+$/i.test(path)) { reply.code(404); return { ok: false, error: 'Файл не найден' }; }

  reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8');
  return pageHtml(t);
}
app.get('/', site);
app.get('/*', site);

// ─── Старт ───
// Опрос источников — вразнобой, чтобы вузы не читали расписание в одну секунду.
tenants.forEach((t, i) => {
  setTimeout(() => startPoller(t, app.log.child({ tenant: t.id })), i * 5000).unref();
});
app.listen({ port: config.port, host: config.host })
  .then(() => app.log.info(`Расписания на http://${config.host}:${config.port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
