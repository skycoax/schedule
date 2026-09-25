// Вход и сессии (CONTRACT.md §B.5 #1–#5, §C.5): GET /api/auth/me, вход через Google (OAuth 2.0 code flow
// на сервере: PKCE S256, nonce, одноразовый state, привязанный к куке браузера), выход, вход для разработки.
// Итог входа уходит во фрагменте адреса (#auth=…) — в журналы сервера он не попадает.
import { randomBytes, createHash } from 'node:crypto';
import { social, googleConfigured } from '../config.js';
import { tx, nowIso, today, DAY } from './db.js';
import {
  SocialError, ok, bodyOf, invalid, notFound, web, readCookies, setCookie, clearCookie, sha256hex, safeEqual,
  isLocalDirect, SESSION_MAX_AGE, OAUTH_MAX_AGE,
} from './http.js';
import { limit, limited, keyOf, ipKey } from './limits.js';
import { cleanText, graphemes, fold } from './text.js';
import { audit } from './moderation.js';
import { meOf } from './users.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SESSION_DAYS = 180;
const MAX_SESSIONS = 20;

/** Пределы и настройки для приложения (AuthState.config). */
export function authConfig() {
  return {
    rulesVersion: social.rulesVersion,
    minAge: social.minAge,
    limits: {
      text: 1000, lines: 30, links: 3, media: 4, replyMedia: 1,
      mediaBytes: 921_600, thumbBytes: 153_600, mediaSide: 2048, thumbSide: 640, avatarSide: 1024,
      name: 40, bio: 160, usernameMin: 3, usernameMax: 20, note: 300,
    },
  };
}

/** AuthState для GET /api/auth/me. */
export function authState(ctx, user) {
  return {
    user: user ? meOf(ctx, user) : null,
    google: googleConfigured(),
    dev: social.devLogin,
    mode: social.mode,
    config: authConfig(),
  };
}

/**
 * Хук: сессия из куки (только имя сессии, первое вхождение). Неверная или истёкшая — кука стирается.
 * Раз в сутки продлевает сессию на 180 дней; истёкший временный бан снимает сразу.
 */
export function sessionLoader(ctx) {
  const find = ctx.db.prepare(`
    SELECT s.id AS sid, s.seen_at AS session_seen, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`);
  const slide = ctx.db.prepare('UPDATE sessions SET seen_at = ?, expires_at = ? WHERE id = ?');
  const unban = ctx.db.prepare(
    "UPDATE users SET status = 'active', banned_until = NULL, ban_reason = '' WHERE id = ? AND status = 'banned'");
  return async function loadSession(req, reply) {
    const token = readCookies(req)[web.sid];
    if (token === undefined) return;
    const row = TOKEN_RE.test(token) ? find.get(sha256hex(token), nowIso()) : null;
    if (!row) { clearCookie(reply, web.sid); return; }
    if (row.session_seen < today()) {
      slide.run(today(), nowIso(Date.now() + SESSION_DAYS * DAY), row.sid);
      setCookie(reply, web.sid, token, SESSION_MAX_AGE);
    }
    if (row.status === 'banned' && row.banned_until && row.banned_until <= nowIso()) {
      if (unban.run(row.id).changes === 1) audit(ctx.db, null, 'user.unban', 'u:' + row.id, null, { expired: true });
      row.status = 'active'; row.banned_until = null; row.ban_reason = '';
    }
    req.sid = row.sid;
    delete row.sid;
    delete row.session_seen;
    req.user = row;
  };
}

/** Имя для нового аккаунта: given_name, иначе первое слово name; очищенное, до 40 графем. */
function firstName(claims) {
  const raw = claims.givenName || String(claims.name || '').trim().split(/\s+/)[0] || '';
  let n = cleanText(raw, { multiline: false });
  while (n && graphemes(n) > 40) n = Array.from(n).slice(0, -1).join('');
  return n;
}

/**
 * Найти аккаунт по google_sub (никогда по почте) или создать его (§B.5 #3 шаг 8).
 * Общий для входа через Google и POST /api/auth/dev.
 * @param {{ sub: string, email: string, emailVerified: boolean, givenName?: string, name?: string }} claims
 * @param {{ intent: 'signin'|'delete', age: 'minor'|'adult'|null, accepted: 0|1, uni: string|null }} state
 * @returns {object|null} строка users; null — intent=delete, а аккаунта нет (ничего не создано)
 */
export function findOrCreateUser(ctx, claims, state) {
  const db = ctx.db;
  return tx(db, () => {
    const now = nowIso();
    const found = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(claims.sub);
    if (found) {
      db.prepare('UPDATE users SET email = ?, email_verified = ? WHERE id = ?')
        .run(claims.email, claims.emailVerified ? 1 : 0, found.id);
      if (state.intent === 'signin' && state.accepted === 1) {
        db.prepare('UPDATE users SET rules_version = ?, policy_version = ?, rules_at = ? WHERE id = ?')
          .run(social.rulesVersion, social.policyVersion, now, found.id);
      }
      // Человек сказал перед входом, что ему 16–17, а аккаунт числится взрослым: переводим в «до 18»
      // с закрытыми настройками, как у нового аккаунта этого возраста (их можно снова открыть, кроме ссылок).
      // Только вниз: «18 и старше» у аккаунта «до 18» ничего не меняет — для этого есть PATCH /me { age }.
      // В журнал не пишется: возрастную группу не видят и модераторы.
      if (state.intent === 'signin' && state.age === 'minor' && found.age_group === 'adult') {
        db.prepare(`UPDATE users SET age_group = 'minor', links_vis = 'friends', searchable = 0, friend_req = 'none'
                    WHERE id = ?`).run(found.id);
      }
      return db.prepare('SELECT * FROM users WHERE id = ?').get(found.id);
    }
    if (state.intent !== 'signin') return null;

    const age = state.age === 'minor' ? 'minor' : 'adult';
    const uni = state.uni && ctx.tenants.some((t) => t.id === state.uni) ? state.uni : null;
    const name = firstName(claims);
    const mark = db.prepare('SELECT until, reason FROM ban_marks WHERE sub_hash = ? AND (until IS NULL OR until > ?)')
      .get(sha256hex(social.salt + '|' + claims.sub), now);
    // Вход через Google без accept=1 сюда не доходит (start отвечает #auth=consent); accepted=0 бывает только
    // у входа для разработки с { accept: false } — так проверяют экран «правила обновились».
    const agreed = state.accepted === 1;
    const r = db.prepare(`
      INSERT INTO users (google_sub, email, email_verified, age_group, name, name_fold, searchable, friend_req, uni,
                         status, banned_until, ban_reason, rules_version, policy_version, rules_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      claims.sub, claims.email, claims.emailVerified ? 1 : 0, age, name, fold(name),
      age === 'adult' ? 1 : 0, age === 'adult' ? 'all' : 'none', uni,
      mark ? 'banned' : 'active', mark ? mark.until : null, mark ? mark.reason : '',
      agreed ? social.rulesVersion : 0, agreed ? social.policyVersion : 0, agreed ? now : null, now);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
  });
}

/**
 * Завершить вход (§B.5 #3 шаги 9–10): старая сессия этого браузера удаляется, создаётся новая
 * (у человека не больше 20), кука. Устройство и браузер к сессии не записываются (колонка device
 * остаётся пустой), вход в журнал не пишется: ни одна функция этого не использует. Возвращает строку users.
 */
export function completeSignIn(ctx, req, reply, user) {
  const db = ctx.db;
  const token = randomBytes(32).toString('base64url');
  tx(db, () => {
    if (req.sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sid);
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, seen_at, expires_at, device)
                VALUES (?,?,?,?,?,?)`)
      .run(sha256hex(token), user.id, nowIso(), today(), nowIso(Date.now() + SESSION_DAYS * DAY), '');
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id NOT IN
                (SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT ${MAX_SESSIONS})`)
      .run(user.id, user.id);
  });
  setCookie(reply, web.sid, token, SESSION_MAX_AGE);
  req.sid = null;
  req.user = user;
  return user;
}

/**
 * Куда вернуться после входа: только путь на этом же сайте, не /api/*, без фрагмента (backend.md §3.2).
 */
export function safeReturn(raw, origin = web.origin) {
  const s = typeof raw === 'string' ? raw : '';
  if (!s || s.length > 300 || s[0] !== '/' || s[1] === '/' || s[1] === '\\' || /[\\\u0000-\u001F\u007F]/.test(s)) return '/';
  let u;
  try { u = new URL(s, origin); } catch { return '/'; }
  if (u.origin !== origin || u.pathname.startsWith('/api/')) return '/';
  return u.pathname + u.search;
}

/**
 * Переход на /api/auth/google/start пришёл со страницы Para (same-origin), а не по ссылке с другого сайта.
 * Sec-Fetch-Site есть — только same-origin. Нет (старый браузер) — Referer, если он есть, с нашего адреса.
 */
export function fromParaPage(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const ref = req.headers.referer;
  if (!ref) return true;
  let o;
  try { o = new URL(String(ref)).origin; } catch { return false; }
  return o === web.origin || web.allowedOrigins.has(o);
}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
const STATE_TTL = 10 * 60_000;
// Потолок таблицы oauth_states (~250 байт строка → ~25 МБ). Дойдя до него, сервер не отказывает во входе
// всем (так пара десятков IP заперла бы вход для всех), а убирает истёкшие и самые старые незавершённые входы.
const MAX_STATES = 100_000;
const TRIM_STATES = 1000;
const rnd = (n) => randomBytes(n).toString('base64url');

/**
 * Утверждения id_token (backend.md §3.4). Токен получен от Google напрямую по TLS в обмен на секрет клиента,
 * поэтому подпись можно не проверять (OIDC Core §3.1.3.7), но iss/aud/azp/exp/iat/nonce/sub/email — обязательно.
 * @returns {{ sub: string, email: string, emailVerified: boolean, name: string, givenName: string } | null}
 */
export function claimsFrom(idToken, { clientId, nonce }) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  let c;
  try { c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const now = Date.now() / 1000;
  const issOk = c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com';
  const audOk = Array.isArray(c.aud) ? (c.aud.includes(clientId) && c.azp === clientId) : c.aud === clientId;
  const timeOk = Number.isFinite(c.exp) && c.exp > now - 60 && Number.isFinite(c.iat) && c.iat < now + 300;
  const nonceOk = typeof c.nonce === 'string' && safeEqual(c.nonce, nonce);
  const subOk = typeof c.sub === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(c.sub);
  const emailOk = typeof c.email === 'string' && c.email.length <= 254 && c.email.includes('@');
  if (!(issOk && audOk && timeOk && nonceOk && subOk && emailOk)) return null;
  return {
    sub: c.sub,
    email: c.email.toLowerCase(),
    emailVerified: c.email_verified === true || c.email_verified === 'true',
    name: typeof c.name === 'string' ? c.name : '',
    givenName: typeof c.given_name === 'string' ? c.given_name : '',
  };
}

/**
 * Маршруты входа. mode=off: остаются /me (mode:'off'), выход, вход через Google только для удаления
 * (intent=delete) и вход разработчика (§F.2).
 * @param {import('fastify').FastifyInstance} inst
 */
export function authRoutes(inst, ctx) {
  const db = ctx.db;

  // #1 — гостю тоже; продлевает сессию и стирает неверную куку (это делает sessionLoader).
  inst.get('/api/auth/me', async (req) => {
    limit('read', keyOf(req));
    return ok(authState(ctx, req.user));
  });

  // #4 — выход; без сессии тоже 200. { all: true } — со всех устройств.
  inst.post('/api/auth/logout', async (req, reply) => {
    const b = bodyOf(req);
    if (req.user) {
      if (b.all === true) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
      else if (req.sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sid);
    }
    clearCookie(reply, web.sid);
    req.user = null;
    return ok(null);
  });

  // #2 — начало входа через Google: всегда 302 (на Google или обратно с #auth=…).
  const statesCount = db.prepare('SELECT COUNT(*) n FROM oauth_states');
  const dropOldStates = db.prepare('DELETE FROM oauth_states WHERE created_at < ?');
  const trimStates = db.prepare(`DELETE FROM oauth_states WHERE state IN
    (SELECT state FROM oauth_states ORDER BY created_at LIMIT ?)`);
  const insertState = db.prepare(`INSERT INTO oauth_states
    (state, bind_hash, verifier, nonce, return_to, uni, intent, age_group, accepted, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const makeRoom = () => {
    if (statesCount.get().n < MAX_STATES) return;
    dropOldStates.run(nowIso(Date.now() - STATE_TTL));
    const n = statesCount.get().n;
    if (n >= MAX_STATES) trimStates.run(n - MAX_STATES + TRIM_STATES);
  };
  inst.get('/api/auth/google/start', async (req, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    const q = req.query || {};
    const back = safeReturn(q.return);
    const intent = q.intent === 'delete' ? 'delete' : 'signin';
    const go = (outcome) => reply.redirect(`${web.origin}${back}#auth=${outcome}`, 302);
    if (!googleConfigured() || (social.mode === 'off' && intent === 'signin')) return go('unavailable');
    if (limited('auth', ipKey(req))) return go('limited');
    // Возраст и согласие с правилами приходят в адресе, поэтому вход (он может создать аккаунт) начинается
    // только со страницы Para: окно входа уводит сюда через location.replace — это переход same-origin.
    // Ссылка с чужого сайта (Telegram, другой вуз) возвращает на наш вопрос о возрасте и правила
    // (#auth=consent открывает окно входа). Старые браузеры без Sec-Fetch-Site проверяем по Referer,
    // если он есть. Вход ради удаления (intent=delete) аккаунт не создаёт и ничего не записывает.
    if (intent === 'signin' && !fromParaPage(req)) return go('consent');
    const age = q.age === 'minor' || q.age === 'adult' ? q.age : null;
    const accepted = q.accept === '1' ? 1 : 0;
    if (intent === 'signin' && (!age || !accepted)) return go('consent');
    makeRoom();

    const state = rnd(32);
    const verifier = rnd(32);
    const nonce = rnd(16);
    const bind = rnd(32);
    insertState.run(state, sha256hex(bind), verifier, nonce, back, req.tenant ? req.tenant.id : null, intent,
      intent === 'signin' ? age : null, intent === 'signin' ? accepted : 0, nowIso());
    setCookie(reply, web.oauth, bind, OAUTH_MAX_AGE);
    const u = new URL(GOOGLE_AUTH);
    u.search = new URLSearchParams({
      client_id: social.google.clientId,
      redirect_uri: `${web.origin}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
      access_type: 'online',
      include_granted_scopes: 'false',
      hl: 'ru',
    }).toString();
    return reply.redirect(u.toString(), 302);
  });

  /** Обмен кода на id_token. Ошибка — null; в журнал только статус и код ошибки Google (без тела, кода, секрета). */
  async function exchange(code, row) {
    let res;
    try {
      res = await fetch(social.google.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          code,
          client_id: social.google.clientId,
          client_secret: social.google.clientSecret,
          redirect_uri: `${web.origin}/api/auth/google/callback`,
          grant_type: 'authorization_code',
          code_verifier: row.verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      ctx.log.warn({ err: err && err.name }, 'вход через Google: нет связи с Google');
      return null;
    }
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok || !json || typeof json !== 'object') {
      const googleError = json && typeof json.error === 'string' ? json.error.slice(0, 40) : null;
      ctx.log.warn({ status: res.status, googleError }, 'вход через Google: код не обменялся');
      return null;
    }
    // access_token не храним и не пишем в журнал; refresh_token не запрашивается.
    return claimsFrom(json.id_token, { clientId: social.google.clientId, nonce: row.nonce });
  }

  // #3 — возврат от Google: всегда 302 на ORIGIN + return + #auth=<итог>, кука входа стирается.
  const peekState = db.prepare('SELECT intent FROM oauth_states WHERE state = ?');
  const dropState = db.prepare('DELETE FROM oauth_states WHERE state = ?');
  const takeState = db.prepare('DELETE FROM oauth_states WHERE state = ? RETURNING *');
  inst.get('/api/auth/google/callback', async (req, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    clearCookie(reply, web.oauth);
    const q = req.query || {};
    const go = (outcome, back = '/') => reply.redirect(`${web.origin}${back}#auth=${outcome}`, 302);
    const stateStr = typeof q.state === 'string' ? q.state : '';

    // 1) Недоступно: нет ключей; в off — всё, кроме входа ради удаления.
    if (!googleConfigured()) return go('unavailable');
    if (social.mode === 'off' && STATE_RE.test(stateStr)) {
      const peek = peekState.get(stateStr);
      if (peek && peek.intent !== 'delete') { dropState.run(stateStr); return go('unavailable'); }
    }
    // 2) Предел частоты.
    if (limited('auth', ipKey(req))) return go('limited');
    // 3) state: формат, одноразовость (DELETE … RETURNING), не старше 10 минут.
    if (!STATE_RE.test(stateStr)) return go('expired');
    const row = takeState.get(stateStr);
    if (!row || Date.parse(row.created_at) < Date.now() - STATE_TTL) return go('expired');
    const back = safeReturn(row.return_to);
    // 4) Отказ или ошибка на стороне Google.
    if (q.error !== undefined) {
      if (q.error === 'access_denied') return go('cancelled', back);
      ctx.log.info({ googleError: String(q.error).replace(/[^a-z_]/gi, '').slice(0, 40) }, 'вход через Google: ошибка');
      return go('failed', back);
    }
    // 5) Тот же браузер, что начинал вход (защита от подмены входа).
    const bind = readCookies(req)[web.oauth];
    if (!bind || !safeEqual(sha256hex(bind), row.bind_hash)) return go('browser', back);
    // 6) Обмен кода и проверка id_token.
    const code = typeof q.code === 'string' ? q.code : '';
    if (!code || code.length > 512) return go('failed', back);
    const claims = await exchange(code, row);
    if (!claims) return go('failed', back);
    // 7) Почта должна быть подтверждена.
    if (!claims.emailVerified) return go('unverified', back);
    // 8) Аккаунт по google_sub; при intent=delete новый не создаётся.
    const user = findOrCreateUser(ctx, claims,
      { intent: row.intent, age: row.age_group, accepted: Number(row.accepted), uni: row.uni });
    if (!user) return go('none', back);
    // 9–10) Новая сессия, запись в журнал.
    completeSignIn(ctx, req, reply, user);
    return go('ok', back);
  });

  // #5 — вход для разработки: только DEV_LOGIN=1 вне production, только с этой машины и не через nginx.
  // { accept: false } — войти, не принимая правила (для проверки экрана «правила обновились»).
  if (social.devLogin) {
    inst.post('/api/auth/dev', async (req, reply) => {
      if (!isLocalDirect(req)) throw notFound();
      const b = bodyOf(req);
      const name = typeof b.name === 'string' ? b.name.trim().toLowerCase() : '';
      if (!/^[a-z0-9_]{1,24}$/.test(name)) throw invalid(undefined, 'name');
      if (b.age !== undefined && b.age !== 'minor' && b.age !== 'adult') throw invalid(undefined, 'age');
      if (b.intent !== undefined && b.intent !== 'signin' && b.intent !== 'delete') throw invalid(undefined, 'intent');
      if (b.accept !== undefined && typeof b.accept !== 'boolean') throw invalid(undefined, 'accept');
      const intent = b.intent || 'signin';
      const signin = intent === 'signin';
      const user = findOrCreateUser(ctx,
        { sub: 'dev:' + name, email: name + '@dev.local', emailVerified: true, givenName: capitalize(name) },
        { intent, age: signin ? (b.age || 'adult') : null, accepted: signin && b.accept !== false ? 1 : 0,
          uni: req.tenant ? req.tenant.id : null });
      if (!user) throw new SocialError(404, 'not_found', 'Аккаунта Para с этим Google нет — удалять нечего');
      completeSignIn(ctx, req, reply, user);
      return ok(meOf(ctx, user));
    });
  }
}
