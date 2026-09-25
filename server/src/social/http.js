// Общее для маршрутов «Обсуждений»: ошибки с кодами (CONTRACT.md §B.3), проверки доступа (§B.2),
// куки сессии (§C.5), CSRF (§B.1), разбор JSON и обработчик ошибок (backend.md §8.11).
import { createHash, timingSafeEqual } from 'node:crypto';
import { social } from '../config.js';

// ─── Ошибки ───

/** Ошибка API: статус, код из §B.3, русский текст; field — для ошибок полей (§B.4). */
export class SocialError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'SocialError';
    this.status = status;
    this.code = code;
    if (extra.field) this.field = extra.field;
    if (extra.retryAfter) this.retryAfter = extra.retryAfter;
  }
}

/** Тексты ошибок по умолчанию (§B.3), дословно. */
export const TEXT = {
  invalid: 'Неверный запрос',
  uni: 'Сначала выбери вуз',
  auth: 'Войди через Google, чтобы продолжить',
  profile: 'Сначала заполни профиль',
  rules: 'Сначала прими правила обсуждений',
  readonly: 'Обсуждения временно доступны только для чтения',
  forbidden: 'Недостаточно прав',
  csrf: 'Запрос отклонён — обнови страницу и попробуй ещё раз',
  notFound: 'Нет такого адреса API',
  conflict: 'Это имя уже занято',
  tooLargeMedia: 'Фото больше 900 КБ — уменьши его',
  tooLargeJson: 'Слишком большой запрос',
  mediaType: 'Нужна фотография в формате JPEG',
  server: 'Ошибка сервера — попробуй чуть позже',
  disk: 'Сейчас нельзя загрузить фото — попробуй позже',
  postGone: 'Публикация удалена или скрыта',
  profileGone: 'Профиль не найден',
  mediaGone: 'Фото не найдено',
  requestGone: 'Заявка не найдена',
};

export const invalid = (message = TEXT.invalid, field) => new SocialError(400, 'invalid', message, { field });
export const notFound = (message = TEXT.notFound) => new SocialError(404, 'not_found', message);
export const forbidden = () => new SocialError(403, 'forbidden', TEXT.forbidden);
export const blocked = (message) => new SocialError(403, 'blocked', message);
export const mediaTypeError = () => new SocialError(415, 'media_type', TEXT.mediaType);

/** Успешный ответ. */
export const ok = (data = null) => ({ ok: true, data });

// ─── Бан: одна формулировка на сервере и в приложении (format.ts) ───
const DAY_MONTH = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'Asia/Tashkent' });
/**
 * «Публикация ограничена до 3 октября. Причина: …» / «Публикация ограничена навсегда. Причина: …».
 * Точка после причины — только если причина сама не кончается на . ! ? … (как banText в web/src/social/format.ts).
 */
export function banText(ban) {
  const t = ban.until ? Date.parse(ban.until) : NaN;
  const head = Number.isFinite(t)
    ? `Публикация ограничена до ${DAY_MONTH.format(t)}.`
    : 'Публикация ограничена навсегда.';
  const reason = String(ban.reason || '').trim();
  if (!reason) return head;
  return `${head} Причина: ${reason}${/[.!?…]$/.test(reason) ? '' : '.'}`;
}
/** Бан пользователя из строки users, или null. */
export const banOf = (u) => (u && u.status === 'banned' ? { until: u.banned_until || null, reason: u.ban_reason || '' } : null);

// ─── Проверки доступа (§B.2): порядок в обработчике — S, P, N, M, A, U ───

/** Модератор: подтверждённая почта из SOCIAL_ADMIN_EMAILS. Считается при каждом запросе, не хранится. */
export const isAdmin = (u) => !!u && Number(u.email_verified) === 1 && social.adminEmails.has(String(u.email || '').toLowerCase());

/** S — есть сессия. */
export function needUser(req) {
  if (!req.user) throw new SocialError(401, 'auth', TEXT.auth);
  return req.user;
}
/** P — профиль заполнен и текущие правила приняты. */
export function needProfile(req) {
  const u = needUser(req);
  if (!u.username) throw new SocialError(403, 'profile', TEXT.profile);
  if (Number(u.rules_version) !== social.rulesVersion) throw new SocialError(403, 'rules', TEXT.rules);
  return u;
}
/** N — не заблокирован. */
export function notBanned(req) {
  const ban = banOf(req.user);
  if (ban) throw new SocialError(403, 'banned', banText(ban) + ' Читать можно.');
}
/** M — запись разрешена (SOCIAL_MODE=on). */
export function writable() {
  if (social.mode !== 'on') throw new SocialError(403, 'readonly', TEXT.readonly);
}
/** A — модератор. */
export function needAdmin(req) {
  if (!isAdmin(req.user)) throw new SocialError(403, 'forbidden', TEXT.forbidden);
  return req.user;
}
/** U — выбран вуз: на адресе вуза — сам адрес, на Para — ?uni= или кука uni (см. hubTenant). */
export function needUni(req) {
  if (!req.tenant) throw new SocialError(400, 'uni', TEXT.uni);
  return req.tenant;
}

/**
 * Проверки маршрута буквами §B.2 в порядке таблицы: 'S' сессия, 'P' профиль и правила, 'N' не ограничен,
 * 'M' запись разрешена, 'A' модератор, 'U' выбран вуз. Возвращает строку users (или null для гостя).
 */
export function guard(req, spec) {
  for (const g of spec) {
    if (g === 'S') needUser(req);
    else if (g === 'P') needProfile(req);
    else if (g === 'N') notBanned(req);
    else if (g === 'M') writable();
    else if (g === 'A') needAdmin(req);
    else if (g === 'U') needUni(req);
  }
  return req.user || null;
}

/** Тело JSON-запроса: только обычный объект; без тела (Content-Length: 0) — {}. */
export function bodyOf(req) {
  const b = req.body;
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b) || Buffer.isBuffer(b)) throw invalid();
  return b;
}

// ─── Параметры адреса ───

const ID_RE = /^\d{1,12}$/;
const CURSOR_RE = /^\d{1,15}$/;

/** :id публикации; не число — «Публикация удалена или скрыта». */
export function postIdParam(raw) {
  const s = String(raw ?? '');
  if (!ID_RE.test(s) || Number(s) < 1) throw notFound(TEXT.postGone);
  return Number(s);
}
/** :userId (§B.5: ^\d{1,12}$), иначе 400. */
export function userIdParam(raw) {
  const s = String(raw ?? '');
  if (!ID_RE.test(s) || Number(s) < 1) throw invalid();
  return Number(s);
}
/** Курсор страницы: пусто — null (первая страница), иначе id последней записи. */
export function cursorParam(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw);
  if (!CURSOR_RE.test(s)) throw invalid();
  return Number(s);
}
/** ?limit= в пределах [1, max], по умолчанию def. */
export function limitParam(raw, def, max) {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw invalid();
  return Math.min(n, max);
}
/** Целое id в теле запроса (1…10^12), иначе 400 с полем. */
export function intField(v, field) {
  if (!Number.isInteger(v) || v < 1 || v > 999_999_999_999) throw invalid(TEXT.invalid, field);
  return v;
}
/** «?, ?, ?» для IN (…) — только для уже проверенных чисел и id. */
export const marks = (list) => list.map(() => '?').join(',');

// ─── Адрес, куки, IP ───

/**
 * Настройки, которые зависят от адресов и не меняются после запуска (configureHttp).
 * origin — адрес Para: PARA_ORIGIN или https://<первый адрес hub.json>; на него возвращает Google.
 * secure — куки с __Host- и Secure. allowedOrigins — страницы Para, с которых можно писать на адрес Para
 * (адрес вуза принимает запись только со своей страницы, см. csrfGate).
 */
export const web = {
  origin: '',
  secure: true,
  sid: '__Host-para_sid',
  oauth: '__Host-para_oauth',
  allowedOrigins: new Set(),
};

export function configureHttp(ctx) {
  web.origin = ctx.origin;
  web.secure = ctx.origin.startsWith('https://');
  web.sid = web.secure ? '__Host-para_sid' : 'para_sid';
  web.oauth = web.secure ? '__Host-para_oauth' : 'para_oauth';
  web.allowedOrigins = new Set(ctx.hub.hosts.map((h) => 'https://' + h).concat(social.origin ? [social.origin] : []));
}

/**
 * Адрес страницы, с которой пришёл запрос: Para — web.origin; адрес вуза — https://<его адрес>.
 * Сюда возвращают после входа, и куки у каждого адреса свои (__Host-: только этот адрес).
 * Вызывать после hostGuard: адрес уже сверен со списком Para и вузов, чужого Host здесь нет.
 */
export function originOf(req) {
  if (req.hub) return web.origin;
  const host = String(req.headers.host || '').toLowerCase();
  return web.secure ? 'https://' + host.replace(/:\d+$/, '') : 'http://' + host;
}

export const SESSION_MAX_AGE = 15_552_000;   // 180 дней
export const OAUTH_MAX_AGE = 600;            // 10 минут

/**
 * Куки «Обсуждений» из заголовка Cookie. Читаем ТОЛЬКО имена сессии и входа (первое вхождение):
 * cid, uni и остальные настройки приложения этот код не видит. Заголовок cookie в журнал не пишется.
 */
export function readCookies(req) {
  const wanted = web.secure
    ? ['__Host-para_sid', '__Host-para_oauth']
    : ['__Host-para_sid', '__Host-para_oauth', 'para_sid', 'para_oauth'];
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!wanted.includes(name) || name in out) continue;
    out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/** Добавить Set-Cookie (Fastify копит несколько заголовков в массив). */
export function setCookie(reply, name, value, maxAge) {
  reply.header('set-cookie',
    `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${web.secure ? '; Secure' : ''}`);
}
export const clearCookie = (reply, name) => setCookie(reply, name, '', 0);

/** Настоящий IP: nginx кладёт X-Real-IP; без nginx (разработка) — адрес сокета. */
export const clientIp = (req) => String(req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '');

/** Запрос пришёл с этой же машины и не через nginx (для входа разработчика). */
export function isLocalDirect(req) {
  const a = String((req.socket && req.socket.remoteAddress) || '');
  return !req.headers['x-real-ip'] && (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1');
}

export const sha256hex = (s) => createHash('sha256').update(String(s)).digest('hex');
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ─── Хуки плагина ───

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEV_ORIGIN = /^http:\/\/(?:[a-z0-9-]+\.)?localhost(:\d+)?$|^http:\/\/127\.0\.0\.1(:\d+)?$/;
const JSON_PATH = /^\/api\/(auth|social)(\/|$|\?)/;

const deny = (reply, status, code, error) =>
  reply.code(status).header('cache-control', 'no-store').send({ ok: false, error, code });

/** Путь маршрута без %xx (find-my-way сопоставляет уже раскодированный путь). */
function decodedPath(url) {
  const raw = String(url || '').split('?')[0];
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/**
 * 1) Заголовки no-store + noindex для /api/auth и /api/social (ставим сразу, чтобы они были и у отказов);
 * 2) только адрес Para или подключённого вуза: на незнакомом адресе этих маршрутов «нет».
 */
export async function hostGuard(req, reply) {
  if (JSON_PATH.test(decodedPath(req.url))) reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex');
  if (!req.hub && !req.tenant) return deny(reply, 404, 'not_found', TEXT.notFound);
}

/**
 * onSend всех маршрутов плагина — по маршруту, а не по сырому адресу («/%61pi/auth/me» — тот же маршрут):
 * CORS-заголовков нет никогда; no-store + noindex у всего, кроме выдачи фото (GET /api/media/*: свой кеш).
 */
export async function socialHeaders(req, reply, payload) {
  reply.removeHeader('access-control-allow-origin');
  reply.removeHeader('access-control-allow-credentials');
  reply.removeHeader('access-control-expose-headers');
  const route = String((req.routeOptions && req.routeOptions.url) || '');
  const photo = req.method === 'GET' && route.startsWith('/api/media/') && reply.statusCode < 400;
  if (!photo) reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex');
  return payload;
}

/**
 * CSRF (§B.1): X-Para: 1 и своя страница — Origin этого же адреса (у Para — из списка), либо без Origin и не
 * с чужого сайта. Para и адреса вузов для SameSite — один сайт (кука уходит и с соседнего адреса),
 * поэтому Origin сверяется с точным адресом.
 */
export async function csrfGate(req, reply) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  const originOk = origin
    ? (req.hub ? web.allowedOrigins.has(origin) : origin === originOf(req)) || (!social.production && DEV_ORIGIN.test(origin))
    : (!site || site === 'same-origin' || site === 'none');
  if (req.headers['x-para'] !== '1' || !originOk) return deny(reply, 403, 'csrf', TEXT.csrf);
}

/** Неизвестный адрес под /api/auth, /api/social и запись в /api/media — 404 JSON. */
export async function notFoundRoute(req, reply) {
  return deny(reply, 404, 'not_found', TEXT.notFound);
}

/** JSON-парсер плагина: пустое тело — {}, без __proto__/constructor.prototype, ошибка — 400 invalid. */
export function parseJson(req, body, done) {
  if (body === '' || /^\s*$/.test(body)) return done(null, {});
  try {
    done(null, JSON.parse(body, (k, v) => (k === '__proto__' ? undefined : v)));
  } catch {
    done(invalid());
  }
}
export const JSON_LIMIT = 16_384;

// Маршруты загрузки фото: их 413/415 — про фото, у остальных — «Слишком большой запрос» / «Неверный запрос».
const MEDIA_ROUTES = new Set(['/api/social/media', '/api/social/media/:id/thumb']);

/** Обработчик ошибок плагина (backend.md §8.11 + code и field). Тело запроса в журнал не пишется. */
export function errorHandler(err, req, reply) {
  const send = (status, code, error, extra = {}) =>
    reply.code(status).header('cache-control', 'no-store').send({ ok: false, error, code, ...extra });
  const media = MEDIA_ROUTES.has(req.routeOptions && req.routeOptions.url);
  if (err instanceof SocialError) {
    const extra = {};
    if (err.field) extra.field = err.field;
    if (err.retryAfter) { extra.retryAfter = err.retryAfter; reply.header('retry-after', String(err.retryAfter)); }
    return send(err.status, err.code, err.message, extra);
  }
  if (err && err.name === 'JpegError') return send(400, 'invalid', err.message);
  if (err && err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return send(413, 'too_large', media ? TEXT.tooLargeMedia : TEXT.tooLargeJson);
  }
  if (err && err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return media ? send(415, 'media_type', TEXT.mediaType) : send(400, 'invalid', TEXT.invalid);
  }
  if (err && (err.validation || /^FST_ERR_CTP_/.test(err.code || ''))) return send(400, 'invalid', TEXT.invalid);
  if (err && /UNIQUE constraint failed: users\.username/.test(err.message || '')) return send(409, 'conflict', TEXT.conflict);
  req.log.error({ code: err && err.code, msg: err && err.message }, 'обсуждения: ошибка');
  return send(500, 'server', TEXT.server);
}
