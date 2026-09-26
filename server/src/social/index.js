// «Обсуждения» Para: аккаунты (вход через Google), лента, профили, друзья, жалобы и модерация.
// Работает на адресе Para (para.skycoax.uz; при DEV_HUB=1 — localhost, *.localhost, 127.0.0.1) и на адресах
// вузов (kfu.skycoax.uz…): адрес вуза — та же Para с уже выбранным вузом. База одна, аккаунт один,
// а вход (кука) у каждого адреса свой; Google возвращает только на Para, оттуда вход передаётся адресу вуза (auth.js).
// Контракт — CONTRACT.md (§B API, §C база, §F подключение). Модули:
//   db.js — social.db и схема · http.js — ошибки, проверки, куки, CSRF · auth.js — вход и сессии
//   users.js — Me, имена, профили, друзья · posts.js — лента и ветки · media.js — фото
//   jpeg.js — очистка JPEG · text.js — очистка текста и мат · moderation.js — жалобы и модератор
//   limits.js — пределы частоты · jobs.js — фоновые задачи
import { mkdirSync } from 'node:fs';
import { social, googleConfigured } from '../config.js';
import { openSocialDb } from './db.js';
import { configureHttp, hostGuard, csrfGate, socialHeaders, errorHandler, notFoundRoute, parseJson, JSON_LIMIT } from './http.js';
import { authRoutes, sessionLoader } from './auth.js';
import { postRoutes } from './posts.js';
import { instantRoutes } from './instants.js';
import { userRoutes, accountRoutes } from './users.js';
import { mediaRoutes } from './media.js';
import { adminRoutes } from './moderation.js';
import { startJobs } from './jobs.js';

export const SOCIAL_PATH = /^\/api\/(auth|social|media)(\/|$)/;

/**
 * Путь запроса так, как его видит маршрутизатор (find-my-way декодирует %xx до сопоставления):
 * «/%61pi/auth/me» → «/api/auth/me». Без запроса и фрагмента; нераскодируемый — как есть.
 */
export function routePath(url) {
  const raw = String(url || '').split('?')[0].split('#')[0];
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** Адрес «Обсуждений» (/api/auth|social|media) — по раскодированному пути, как у маршрутизатора. */
export const isSocialPath = (url) => SOCIAL_PATH.test(routePath(url));

/** @fastify/cors options: the public schedule API stays open to all origins; social paths get no CORS. */
export const corsOptions = { delegator: (req, cb) => cb(null, { origin: !isSocialPath(req.url) }) };

/** Request log without IP/port and without query strings (code, state, search, PIN, group, cid). */
export const logSerializers = {
  req: (req) => ({ method: req.method, url: String(req.url || '').split('?')[0], host: req.headers && req.headers.host }),
};

/**
 * Accounts and «Обсуждения». A Fastify plugin, registered only when hub/hub.json exists; serves Para and every tenant host.
 * SOCIAL_MODE=off → registers only the deletion subset (§F.2 step 1); everything else under /api/auth|social → 404 JSON.
 * @param {import('fastify').FastifyInstance} app  encapsulated child instance (via app.register)
 * @param {{ hub: { hosts: string[], dir: string }, tenants: Array<{ id: string, hosts: string[], brand: object, enabled?: boolean }> }} opts
 */
export async function registerSocial(app, { hub, tenants }) {
  // 1) База открывается в любом режиме: в off остаётся удаление аккаунта.
  const db = openSocialDb();
  mkdirSync(social.mediaDir, { recursive: true });
  const log = app.log.child({ part: 'social' });
  const ctx = { db, hub, tenants, origin: social.origin || 'https://' + hub.hosts[0], log };
  configureHttp(ctx);

  // 2) Строка при старте — без значений настроек.
  log.info({ mode: social.mode, google: googleConfigured() ? 'настроен' : 'не настроен',
    admins: social.adminEmails.size, dev: social.devLogin, minAge: social.minAge }, 'обсуждения');
  if (social.devLoginIgnored) log.error('DEV_LOGIN=1 в production игнорируется');
  if (social.google.clientId && !social.google.clientId.endsWith('.apps.googleusercontent.com')) {
    log.warn('GOOGLE_CLIENT_ID выглядит странно');
  }

  // 3) Всё остальное — в своём контексте: парсеры, хуки и обработчик ошибок не касаются расписания.
  await app.register(async (inst) => {
    inst.decorateRequest('user', null);
    inst.decorateRequest('sid', null);

    inst.addHook('onRequest', hostGuard);           // Para или адрес вуза; no-store + noindex
    inst.addHook('onRequest', csrfGate);            // X-Para + своя страница
    inst.addHook('onRequest', sessionLoader(ctx));  // req.user, req.sid
    inst.addHook('onSend', socialHeaders);          // без CORS; no-store + noindex, кроме выдачи фото

    inst.removeContentTypeParser('application/json');
    inst.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: JSON_LIMIT }, parseJson);
    inst.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: 921_600 }, (req, body, done) => done(null, body));
    inst.setErrorHandler(errorHandler);

    authRoutes(inst, ctx);
    accountRoutes(inst, ctx);                        // DELETE /api/social/me — во всех режимах
    if (social.mode !== 'off') {
      postRoutes(inst, ctx);
      instantRoutes(inst, ctx);
      userRoutes(inst, ctx);
      mediaRoutes(inst, ctx);
      adminRoutes(inst, ctx);
    }

    // Неизвестные адреса — 404 JSON (не setNotFoundHandler: он общий с корнем).
    inst.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/auth/*', handler: notFoundRoute });
    inst.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/social/*', handler: notFoundRoute });
    inst.route({
      // В off фото тоже нет: GET /api/media/* — тот же 404 JSON.
      method: social.mode === 'off' ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] : ['POST', 'PUT', 'PATCH', 'DELETE'],
      url: '/api/media/*',
      handler: notFoundRoute,
    });
  });

  // 4) Фоновые задачи.
  startJobs(ctx);
}
