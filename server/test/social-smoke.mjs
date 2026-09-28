// Дымовой тест «Обсуждений» Para: все маршруты /api/auth, /api/social, /api/media по CONTRACT.md §B.5 и §G.1.
// Сервер — локально, как в §G.0 (DEV_LOGIN=1, SOCIAL_ADMIN_EMAILS=boss@dev.local, SOCIAL_REPORTER_MIN_AGE_H=0).
// Адрес Para подставляется заголовком Host, поэтому DEV_HUB для теста не нужен.
//
//   Прогон A (основной): SOCIAL_NEW_ACCOUNT_H=0, пределы включены (без SOCIAL_RATE_LIMITS)
//     node server/test/social-smoke.mjs http://127.0.0.1:8792 kfu
//   Прогон B (правила нового аккаунта): новая база, SOCIAL_NEW_ACCOUNT_H по умолчанию (24), пределы включены
//     SMOKE_NEW_ACCOUNT=1 node server/test/social-smoke.mjs http://127.0.0.1:8792 kfu     (≈ 6 минут: ждёт ведёрко)
//   Прогон C (аварийный выключатель): после прогона A и social-seed.mjs перезапуск с SOCIAL_MODE=readonly, затем off
//     SMOKE_MODE=readonly node server/test/social-smoke.mjs http://127.0.0.1:8792 kfu
//     SMOKE_MODE=off      node server/test/social-smoke.mjs http://127.0.0.1:8792 kfu
//   Прогон D (необязательный, вход через Google с поддельным Google): сервер с
//     GOOGLE_CLIENT_ID=smoke.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=smoke
//     SOCIAL_DEV_GOOGLE_TOKEN_URL=http://127.0.0.1:9901/token, тест — SMOKE_GOOGLE_PORT=9901 (вместе с прогоном A).
//   «Покер» проверяется в прогоне A (раздел «Покер»), в readonly и off. Серверу нужны POKER_FAST=1 (быстрые
//     таймеры стола: ход 2 с, away 1,5 с), GAME_PING_MS=1000 GAME_STREAM_MAX_MS=5000 (ping раз в секунду, поток живёт 5 с).
//     Стол один на сервер: раздел ждёт, пока он опустеет (игроки прошлого прогона встают сами: away → kick).
//     Экономика фишек (§I.10) — там же: бонус, «фишки кончились» (двое играют ва-банк друг против друга, пока один
//     не проиграет всё; без помощников в базе) и рейтинг. Серию бонуса по дням проверяет poker-logic.test.mjs.
//   «Живые обновления» (GET /api/social/live, приглашения в покер) — в прогоне A после «Покера» (те же GAME_PING_MS
//     и GAME_STREAM_MAX_MS: потоки открываются на каждый шаг заново), в readonly и off. SMOKE_LIVE_SHOW=1 — напечатать
//     по одному настоящему событию каждого вида.
import http from 'node:http';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { makeJpeg, SCENES } from './social-seed.mjs';

const BASE = new URL(process.argv[2] || 'http://127.0.0.1:8792');
const UNI = process.argv[3] || 'kfu';
const HUB = 'para.skycoax.uz';
const W = { 'X-Para': '1', Origin: 'https://' + HUB };        // заголовки изменяющих запросов
const UNI_HOST = 'kfu.skycoax.uz';                             // адрес вуза: та же Para с вузом из адреса
const WU = { 'X-Para': '1', 'Sec-Fetch-Site': 'same-origin' }; // изменяющий запрос со страницы адреса вуза
const RUN = Date.now().toString(36).slice(-5);                 // повторные запуски на той же базе
const MODE = process.env.SMOKE_MODE || 'on';
const NEW_ACCOUNT = process.env.SMOKE_NEW_ACCOUNT === '1';
const GOOGLE_PORT = Number(process.env.SMOKE_GOOGLE_PORT) || 0;
let SID = 'para_sid';
const LIMITED = 'предел входа через Google (60 попыток с одного IP, +1 за 10 с) исчерпан прошлыми прогонами — подожди 10 минут или перезапусти сервер';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let step = 0;
const ok = (name) => console.log(String(++step).padStart(3, '0'), 'ok ', name);

/** Запрос с «банкой» кук (Map). Возвращает { status, headers, json, buf }. uni= добавляется, как в приложении. */
function call(jar, method, path, { json, body, type, headers = {}, host = HUB, uni = UNI, raw } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: host, ...headers };
    if (jar && jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload = null;
    if (raw !== undefined) { payload = Buffer.from(raw); if (type) h['Content-Type'] = type; }
    else if (json !== undefined) { payload = Buffer.from(JSON.stringify(json)); h['Content-Type'] = 'application/json'; }
    else if (body) { payload = body; h['Content-Type'] = type || 'image/jpeg'; }
    // Без тела — явный Content-Length: 0, иначе node:http шлёт chunked (как браузер — не шлёт).
    h['Content-Length'] = payload ? payload.length : 0;
    const full = uni && !path.startsWith('/api/media/') ? path + (path.includes('?') ? '&' : '?') + 'uni=' + uni : path;
    const rq = http.request({ hostname: BASE.hostname, port: BASE.port, method, path: full, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        for (const sc of [].concat(res.headers['set-cookie'] || [])) {
          const [nv, ...attrs] = sc.split(';');
          const i = nv.indexOf('=');
          const k = nv.slice(0, i).trim();
          const v = nv.slice(i + 1).trim();
          if (!jar) continue;
          if (!v || /max-age=0/i.test(attrs.join(';'))) jar.delete(k); else jar.set(k, v);
        }
        // Вход через Google ограничен по IP (60 попыток, +1 за 10 с): повторные прогоны подряд его исчерпывают.
        if (/#auth=limited$/.test(res.headers.location || '')) { reject(new Error(LIMITED)); return; }
        const buf = Buffer.concat(chunks);
        let data = null;
        try { data = JSON.parse(buf.toString('utf8')); } catch { /* картинка или пусто */ }
        resolve({ status: res.statusCode, headers: res.headers, json: data, buf });
      });
    });
    rq.on('error', reject);
    if (payload) rq.write(payload);
    rq.end();
  });
}

const show = (r) => `${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 400) : r.buf.toString('latin1').slice(0, 80)}`;
/** Статус (и код ошибки, и текст) ответа. */
function expect(r, status, what, code, error) {
  assert.equal(r.status, status, `${what}: ${show(r)}`);
  if (code) assert.equal(r.json && r.json.code, code, `${what}: код ${show(r)}`);
  if (error) {
    if (error instanceof RegExp) assert.match(r.json.error, error, `${what}: текст ${show(r)}`);
    else assert.equal(r.json.error, error, `${what}: текст ${show(r)}`);
  }
  return r.json ? r.json.data : null;
}
const bad = (r, what, error, field) => {
  expect(r, 400, what, 'invalid', error);
  if (field) assert.equal(r.json.field, field, `${what}: поле ${show(r)}`);
};

/** Вход для разработки. Возвращает { jar, me }. */
async function login(name, extra = {}) {
  const jar = new Map();
  const r = await call(jar, 'POST', '/api/auth/dev', { json: { name, ...extra }, headers: W });
  const me = expect(r, 200, 'вход ' + name);
  return { jar, me };
}
async function meOf(jar) {
  return expect(await call(jar, 'GET', '/api/auth/me'), 200, 'me').user;
}
async function onboard(u, username, name, extra = {}) {
  const r = await call(u.jar, 'PATCH', '/api/social/me', { json: { username, name, ...extra }, headers: W });
  u.me = expect(r, 200, 'профиль ' + username);
  return u.me;
}
const user = async (suffix, name, extra = {}) => {
  const u = await login(`sm_${RUN}_${suffix}`, extra);
  await onboard(u, `sm_${RUN}_${suffix}`, name);
  return u;
};

// ─── Фото ───
const PHOTO = makeJpeg(1600, 1200, SCENES.sunset);
const PHOTO_T = makeJpeg(640, 480, SCENES.sunset);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
function withExif(jpeg) {
  const exif = Buffer.concat([Buffer.from([0xFF, 0xE1]), u16(2 + 6 + 12), Buffer.from('Exif\0\0'), Buffer.from('GPS-SECRET!!')]);
  const com = Buffer.concat([Buffer.from([0xFF, 0xFE]), u16(2 + 9), Buffer.from('COMMENT!!')]);
  return Buffer.concat([jpeg.subarray(0, 2), exif, com, jpeg.subarray(2), Buffer.from('<html><script>x</script></html>')]);
}
async function uploadPhoto(u, { full = PHOTO, thumb = PHOTO_T } = {}) {
  const m = expect(await call(u.jar, 'POST', '/api/social/media?kind=post', { body: full, headers: W }), 201, 'фото');
  if (thumb) expect(await call(u.jar, 'PUT', `/api/social/media/${m.id}/thumb`, { body: thumb, headers: W }), 200, 'миниатюра');
  return m;
}
async function post(u, text, category = 'other', media = [], uni = UNI) {
  return expect(await call(u.jar, 'POST', '/api/social/posts', { json: { text, category, media }, headers: W, uni }), 201,
    'публикация: ' + text.slice(0, 30));
}
async function reply(u, rootId, text, extra = {}) {
  return expect(await call(u.jar, 'POST', `/api/social/posts/${rootId}/replies`, { json: { text, media: [], ...extra }, headers: W }),
    201, 'ответ: ' + text.slice(0, 30));
}
const report = (u, target, id, reason, note) =>
  call(u.jar, 'POST', '/api/social/reports', { json: { target, id, reason, ...(note ? { note } : {}) }, headers: W });
/** Все дела очереди модератора (по всем страницам): { items }. */
async function allCases(boss, status) {
  let items = [];
  let cur = null;
  for (let i = 0; i < 60; i++) {
    const pg = expect(await call(boss.jar, 'GET', `/api/social/admin/reports?status=${status}` + (cur ? '&cursor=' + cur : '')), 200, 'очередь');
    items = items.concat(pg.items);
    cur = pg.next;
    if (!cur) break;
  }
  return { items };
}
const admin = (boss, body) => call(boss.jar, 'POST', '/api/social/admin/action', { json: body, headers: W });
const feedIds = async (jar, q = '') => expect(await call(jar, 'GET', '/api/social/feed?limit=50' + q), 200, 'лента').items.map((p) => p.id);
const thread = (jar, id) => call(jar, 'GET', `/api/social/posts/${id}`);

async function commonChecks(guest) {
  let r = await call(guest, 'GET', '/api/auth/me');
  const st = expect(r, 200, 'me гостя');
  assert.equal(st.user, null);
  assert.equal(typeof st.google, 'boolean');
  assert.equal(st.dev, true, 'нужен DEV_LOGIN=1');
  assert.equal(st.mode, MODE, `сервер в режиме ${st.mode}, а тест — SMOKE_MODE=${MODE}`);
  assert.deepEqual(Object.keys(st.config.limits).sort(), ['avatarSide', 'bio', 'lines', 'links', 'media', 'mediaBytes', 'mediaSide',
    'name', 'note', 'replyMedia', 'text', 'thumbBytes', 'thumbSide', 'usernameMax', 'usernameMin'].sort());
  assert.equal(st.config.limits.mediaBytes, 921600);
  assert.equal(st.config.rulesVersion, 1);
  assert.match(r.headers['cache-control'] || '', /no-store/);
  assert.equal(r.headers['x-robots-tag'], 'noindex');
  ok(`me гостя: режим ${st.mode}, Google ${st.google ? 'настроен' : 'не настроен'}, no-store + noindex`);

  // Адрес вуза — та же Para, вуз задан адресом. Писать туда можно только с его же страницы.
  r = await call(guest, 'GET', '/api/auth/me', { host: UNI_HOST, uni: '' });
  assert.equal(expect(r, 200, 'me на адресе вуза').user, null);
  assert.equal(r.headers['x-robots-tag'], 'noindex');
  r = await call(guest, 'POST', '/api/social/posts', { host: UNI_HOST, uni: '', json: {}, headers: WU });
  if (MODE === 'off') expect(r, 404, 'пост гостя на адресе вуза в off', 'not_found');
  else expect(r, 401, 'пост гостя на адресе вуза', 'auth');
  r = await call(guest, 'POST', '/api/social/posts', { host: UNI_HOST, uni: '', json: {}, headers: W });
  expect(r, 403, 'запись на адрес вуза со страницы Para', 'csrf');
  r = await call(guest, 'POST', '/api/auth/logout', { host: UNI_HOST, uni: '', json: {},
    headers: { 'X-Para': '1', Origin: 'https://tsue.skycoax.uz' } });
  expect(r, 403, 'запись на адрес вуза со страницы другого вуза', 'csrf');
  r = await call(guest, 'GET', '/api/auth/google/callback?state=' + 'A'.repeat(43), { host: UNI_HOST, uni: '' });
  expect(r, 404, 'возврат от Google на адресе вуза', 'not_found');
  r = await call(guest, 'GET', '/api/auth/me', { host: 'nope.example', uni: '' });
  expect(r, 404, 'me на незнакомом адресе', 'not_found', 'Нет такого адреса API');
  ok('адрес вуза: me отвечает, запись — только со своей страницы, возврат от Google — только на Para; чужой адрес — 404');

  r = await call(guest, 'GET', '/api/auth/nope');
  expect(r, 404, 'GET /api/auth/nope', 'not_found', 'Нет такого адреса API');
  r = await call(guest, 'POST', '/api/social/nope', { json: {}, headers: W });
  expect(r, 404, 'POST /api/social/nope', 'not_found');
  r = await call(guest, 'PUT', '/api/media/x', { json: {}, headers: W });
  expect(r, 404, 'PUT /api/media/x', 'not_found');
  ok('неизвестные адреса — 404 JSON с code not_found');
  return st;
}

// ═══════════════════════════ Прогон A ═══════════════════════════

async function runMain() {
  const guest = new Map();
  const st = await commonChecks(guest);
  let r;

  // ── Вход через Google: начало и возврат ──
  const locOf = (res) => res.headers.location || '';
  r = await call(guest, 'GET', '/api/auth/google/start?return=' + encodeURIComponent('/?tab=profile') + '&intent=signin');
  expect(r, 302, 'google/start');
  assert.match(r.headers['cache-control'] || '', /no-store/);
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  const ORIGIN = new URL(locOf(r)).origin;
  if (/#auth=limited$/.test(locOf(r))) throw new Error(LIMITED);
  if (!st.google) {
    assert.equal(locOf(r), `${ORIGIN}/?tab=profile#auth=unavailable`);
    ok('google/start без ключей → #auth=unavailable (return сохранён)');
  } else {
    assert.equal(locOf(r), `${ORIGIN}/?tab=profile#auth=consent`);
    r = await call(guest, 'GET', '/api/auth/google/start?return=/&intent=signin&age=adult');
    assert.match(locOf(r), /#auth=consent$/);
    r = await call(guest, 'GET', '/api/auth/google/start?return=/&intent=signin&accept=1');
    assert.match(locOf(r), /#auth=consent$/);
    ok('google/start без возраста или согласия → #auth=consent');
    // Возраст и согласие — только со страницы Para: ссылка с чужого сайта ведёт на вопрос о возрасте и правила.
    const full = '/api/auth/google/start?return=/&intent=signin&age=adult&accept=1';
    r = await call(null, 'GET', full, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.match(locOf(r), /#auth=consent$/, 'Sec-Fetch-Site: cross-site');
    r = await call(null, 'GET', full, { headers: { 'Sec-Fetch-Site': 'same-site' } });
    assert.match(locOf(r), /#auth=consent$/, 'Sec-Fetch-Site: same-site (адрес вуза)');
    r = await call(null, 'GET', full, { headers: { Referer: 'https://evil.example/post' } });
    assert.match(locOf(r), /#auth=consent$/, 'старый браузер: чужой Referer');
    r = await call(null, 'GET', full, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(new URL(locOf(r)).origin, 'https://accounts.google.com', 'со страницы Para — на Google');
    r = await call(null, 'GET', '/api/auth/google/start?return=/&intent=delete', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(new URL(locOf(r)).origin, 'https://accounts.google.com', 'вход ради удаления — с любой страницы');
    ok('google/start: возраст и согласие принимаются только со страницы Para (Sec-Fetch-Site / Referer)');
  }
  for (const evil of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', '/api/social/feed', 'javascript:alert(1)',
    '/%2e%2e/api/x', '/ok\tx']) {
    r = await call(guest, 'GET', '/api/auth/google/start?intent=signin&return=' + encodeURIComponent(evil));
    const loc = new URL(locOf(r));
    assert.equal(loc.origin, ORIGIN, 'open redirect: ' + evil);
    assert.equal(loc.pathname, '/', 'open redirect: ' + evil);
  }
  ok('return не уводит на чужой сайт и не ведёт в /api/');

  if (st.google) {
    const g = new Map();
    r = await call(g, 'GET', '/api/auth/google/start?return=/&intent=signin&age=adult&accept=1');
    const u = new URL(locOf(r));
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    const p = u.searchParams;
    assert.equal(p.get('response_type'), 'code');
    assert.equal(p.get('scope'), 'openid email profile');
    assert.equal(p.get('code_challenge_method'), 'S256');
    assert.match(p.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    assert.match(p.get('state'), /^[A-Za-z0-9_-]{43}$/);
    assert.ok(p.get('nonce'));
    assert.equal(p.get('prompt'), 'select_account');
    assert.equal(p.get('access_type'), 'online');
    assert.equal(p.get('hl'), 'ru');
    assert.equal(p.get('redirect_uri'), ORIGIN + '/api/auth/google/callback');
    const oc = [].concat(r.headers['set-cookie'] || []).find((c) => /para_oauth=/.test(c));
    assert.ok(oc && /HttpOnly/i.test(oc) && /Max-Age=600/.test(oc) && /SameSite=Lax/i.test(oc), 'кука входа');
    ok('google/start → Google: PKCE S256, state, nonce, кука para_oauth');
    r = await call(g, 'GET', '/api/auth/google/start?return=/&intent=delete');
    assert.ok(locOf(r).startsWith('https://accounts.google.com/'), 'intent=delete без возраста и согласия');
    ok('google/start intent=delete не спрашивает возраст и согласие');

    // Другой браузер (без куки para_oauth) → browser; одноразовость state → expired; отмена → cancelled.
    r = await call(new Map(), 'GET', `/api/auth/google/callback?code=x&state=${p.get('state')}`);
    assert.match(locOf(r), /#auth=browser$/);
    r = await call(g, 'GET', `/api/auth/google/callback?code=x&state=${p.get('state')}`);
    assert.match(locOf(r), /#auth=expired$/);
    r = await call(g, 'GET', '/api/auth/google/start?return=/x&intent=signin&age=adult&accept=1');
    const s2 = new URL(locOf(r)).searchParams.get('state');
    r = await call(g, 'GET', `/api/auth/google/callback?error=access_denied&state=${s2}`);
    assert.equal(locOf(r), ORIGIN + '/x#auth=cancelled');
    assert.ok([].concat(r.headers['set-cookie'] || []).some((c) => /para_oauth=;/.test(c)), 'кука входа стёрта');
    ok('callback: другой браузер → browser, повтор state → expired, отказ → cancelled');
  }
  r = await call(guest, 'GET', '/api/auth/google/callback?code=x&state=' + 'A'.repeat(43));
  expect(r, 302, 'callback с чужим state');
  assert.match(locOf(r), st.google ? /\/#auth=expired$/ : /\/#auth=unavailable$/);
  r = await call(guest, 'GET', '/api/auth/google/callback?code=x&state=../../x');
  assert.match(locOf(r), st.google ? /#auth=expired$/ : /#auth=unavailable$/);
  ok('callback с чужим или кривым state');

  if (GOOGLE_PORT && st.google) await fakeGoogle(ORIGIN);
  else if (GOOGLE_PORT) console.log('     (SMOKE_GOOGLE_PORT задан, но у сервера нет ключей Google — пропускаю)');

  // ── CSRF и CORS ──
  r = await call(guest, 'POST', '/api/auth/logout', { json: {} });
  expect(r, 403, 'без X-Para', 'csrf', 'Запрос отклонён — обнови страницу и попробуй ещё раз');
  r = await call(guest, 'POST', '/api/auth/logout', { json: {}, headers: { 'X-Para': '1', Origin: 'https://evil.example' } });
  expect(r, 403, 'чужой Origin', 'csrf');
  r = await call(guest, 'POST', '/api/auth/logout', { json: {}, headers: { 'X-Para': '1', 'Sec-Fetch-Site': 'cross-site' } });
  expect(r, 403, 'без Origin, но cross-site', 'csrf');
  r = await call(guest, 'POST', '/api/auth/logout', { json: {}, headers: { 'X-Para': '1', 'Sec-Fetch-Site': 'same-origin' } });
  expect(r, 200, 'без Origin, same-origin');
  r = await call(guest, 'POST', '/api/auth/logout', { json: {}, headers: { 'X-Para': '1', Origin: 'http://be.localhost:8792' } });
  expect(r, 200, 'Origin *.localhost (разработка)');
  r = await call(guest, 'OPTIONS', '/api/social/posts', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-para' } });
  assert.ok(!r.headers['access-control-allow-origin'], 'CORS на /api/social должен быть выключен');
  r = await call(guest, 'GET', '/api/universities', { host: 'kfu.skycoax.uz', headers: { Origin: 'https://evil.example' } });
  assert.equal(r.headers['access-control-allow-origin'], 'https://evil.example', 'CORS расписания остался открытым');
  ok('CSRF: X-Para, Origin, Sec-Fetch-Site; у обсуждений нет CORS, у расписания есть');

  // ── Тело запроса ──
  r = await call(guest, 'POST', '/api/auth/logout', { raw: '{"a":', type: 'application/json', headers: W });
  bad(r, 'кривой JSON', 'Неверный запрос');
  r = await call(guest, 'POST', '/api/auth/logout', { raw: '[1,2]', type: 'application/json', headers: W });
  bad(r, 'массив вместо объекта');
  r = await call(guest, 'POST', '/api/auth/logout', { raw: 'hello', type: 'text/plain', headers: W });
  bad(r, 'text/plain');
  r = await call(guest, 'POST', '/api/auth/logout', { json: { pad: 'x'.repeat(20_000) }, headers: W });
  expect(r, 413, 'JSON 20 КБ', 'too_large', 'Слишком большой запрос');
  r = await call(guest, 'POST', '/api/auth/logout', { headers: W });
  expect(r, 200, 'без тела (Content-Length: 0)');
  ok('тело: кривой JSON, массив, text/plain → 400; 20 КБ → 413 «Слишком большой запрос»; пустое тело можно');

  // ── Вход для разработки ──
  r = await call(guest, 'POST', '/api/auth/dev', { json: { name: 'Bad Name!' }, headers: W });
  bad(r, 'кривое имя входа', undefined, 'name');
  r = await call(guest, 'POST', '/api/auth/dev', { json: { name: `sm_${RUN}_none`, intent: 'delete' }, headers: W });
  expect(r, 404, 'intent=delete без аккаунта', 'not_found', 'Аккаунта Para с этим Google нет — удалять нечего');
  r = await call(guest, 'POST', '/api/auth/dev', { json: { name: `sm_${RUN}_none`, intent: 'delete' }, headers: W });
  expect(r, 404, 'intent=delete второй раз — аккаунт так и не создан', 'not_found');
  r = await call(guest, 'POST', '/api/auth/dev', { json: { name: 'x' }, headers: { ...W, 'X-Real-IP': '1.2.3.4' } });
  expect(r, 404, 'вход разработчика через nginx', 'not_found');
  ok('вход разработчика: проверка имени; intent=delete аккаунт не создаёт; через прокси — 404');

  // ── Гость не пишет ──
  r = await call(guest, 'POST', '/api/social/posts', { json: { text: 'hi', category: 'other', media: [] }, headers: W });
  expect(r, 401, 'гость пишет', 'auth', 'Войди через Google, чтобы продолжить');
  for (const [m, p, b] of [['POST', '/api/social/posts/1/replies', { text: 'x' }], ['PUT', '/api/social/posts/1/like', {}],
    ['POST', '/api/social/reports', { target: 'post', id: 1, reason: 'spam' }], ['POST', '/api/social/friends/1', {}],
    ['POST', '/api/social/users/search', { q: 'alice' }], ['PATCH', '/api/social/me', { bio: '' }],
    ['POST', '/api/social/media?kind=post', undefined], ['DELETE', '/api/social/me', { confirm: true }]]) {
    r = await call(guest, m, p, b === undefined ? { body: PHOTO, headers: W } : { json: b, headers: W });
    expect(r, 401, `гость: ${m} ${p}`, 'auth');
  }
  r = await call(guest, 'GET', '/api/social/users/alice');
  expect(r, 401, 'гость открывает профиль', 'auth');
  r = await call(guest, 'GET', '/api/social/friends');
  expect(r, 401, 'гость: друзья', 'auth');
  ok('гость не пишет, не ищет, не открывает профили (401 auth)');

  // ── Аккаунт и профиль ──
  const boss = await login('boss');
  assert.equal(boss.me.isAdmin, true, 'boss@dev.local должен быть в SOCIAL_ADMIN_EMAILS');
  if (boss.me.needsProfile) await onboard(boss, 'boss', 'Шерзод');
  const A = await login(`sm_${RUN}_a`);
  const sc = [].concat((await call(new Map(), 'POST', '/api/auth/dev', { json: { name: `sm_${RUN}_a` }, headers: W })).headers['set-cookie'])
    .find((c) => /para_sid=/.test(c));
  assert.match(sc, /^(__Host-)?para_sid=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=15552000; HttpOnly; SameSite=Lax/);
  SID = sc.split('=')[0];
  assert.equal(A.me.needsProfile, true);
  assert.match(A.me.suggestedUsername || '', /^[a-z0-9_]{3,20}$/);
  assert.match(A.me.email, /^s•••@dev\.local$/);
  assert.equal(A.me.age, 'adult');
  assert.deepEqual(A.me.privacy, { links: 'friends', searchable: true, friendRequests: 'all' });
  assert.equal(A.me.rulesAccepted, true);
  assert.equal(A.me.uni, UNI);
  ok('вход: кука para_sid (HttpOnly, Lax, 180 дней), Me без профиля, подсказка @имени, почта замаскирована');

  r = await call(A.jar, 'POST', '/api/social/posts', { json: { text: 'hi', category: 'other', media: [] }, headers: W });
  expect(r, 403, 'пост без профиля', 'profile', 'Сначала заполни профиль');
  const avail = async (jar, u) => expect(await call(jar, 'GET', '/api/social/username?u=' + encodeURIComponent(u)), 200, 'username?u=' + u);
  assert.deepEqual(await avail(A.jar, 'admin'), { available: false, error: 'Это имя зарезервировано — выбери другое' });
  assert.deepEqual(await avail(A.jar, UNI), { available: false, error: 'Это имя зарезервировано — выбери другое' });
  assert.deepEqual(await avail(A.jar, 'para'), { available: false, error: 'Это имя зарезервировано — выбери другое' });
  assert.deepEqual(await avail(A.jar, `x_${RUN}_rektor`), { available: false, error: 'Это имя зарезервировано — выбери другое' });
  assert.deepEqual(await avail(A.jar, 'ab'), { available: false, error: 'Имя пользователя — от 3 до 20 символов: латинские буквы, цифры и знак подчёркивания' });
  assert.deepEqual(await avail(A.jar, '123456'), { available: false, error: 'Имя пользователя не может состоять только из цифр' });
  assert.deepEqual(await avail(A.jar, `sm_${RUN}_a`), { available: true });
  r = await call(guest, 'GET', '/api/social/username?u=abc');
  expect(r, 401, 'проверка имени гостем', 'auth');
  ok('проверка @имени: зарезервированные, формат, цифры, свободное');

  const patchA = (json) => call(A.jar, 'PATCH', '/api/social/me', { json, headers: W });
  bad(await patchA({ username: 'admin', name: 'A' }), 'зарезервированное', 'Это имя зарезервировано — выбери другое', 'username');
  bad(await patchA({ username: 'a b', name: 'A' }), 'пробел в имени', undefined, 'username');
  bad(await patchA({ name: 'Алиса' }), 'без @имени при заполнении', undefined, 'username');
  bad(await patchA({ username: `sm_${RUN}_a` }), 'без имени при заполнении', 'Имя — от 1 до 40 символов', 'name');
  bad(await patchA({ username: `sm_${RUN}_a`, name: 'Администрация вуза' }), 'имя-самозванец', 'Такое имя использовать нельзя', 'name');
  bad(await patchA({ username: `sm_${RUN}_a`, name: 'Команда Para' }), 'имя-самозванец 2', 'Такое имя использовать нельзя', 'name');
  bad(await patchA({ username: `sm_${RUN}_a`, name: '!!!' }), 'имя без букв', 'Имя — от 1 до 40 символов', 'name');
  bad(await patchA({ username: `sm_${RUN}_a`, name: 'Я'.repeat(41) }), 'имя длиннее 40', 'Имя — от 1 до 40 символов', 'name');
  bad(await patchA({ username: `sm_${RUN}_a`, name: 'Алиса', foo: 1 }), 'лишнее поле');
  await onboard(A, `SM_${RUN}_A`, `Алиса ${RUN}`);
  assert.equal(A.me.username, `sm_${RUN}_a`);
  assert.equal(A.me.needsProfile, false);
  assert.equal(A.me.suggestedUsername, null);
  const B = await login(`sm_${RUN}_b`);
  r = await call(B.jar, 'PATCH', '/api/social/me', { json: { username: `Sm_${RUN}_A`, name: 'Боб' }, headers: W });
  expect(r, 409, 'занятое имя', 'conflict', 'Это имя уже занято');
  assert.equal(r.json.field, 'username');
  await onboard(B, `sm_${RUN}_b`, `Боб ${RUN}`);
  ok('заполнение профиля: @имя и имя обязательны, самозванцы, регистр, занято → 409');

  r = await patchA({ bio: 'Привет‮!​', tg: 'https://t.me/Alice_TG', ig: 'https://www.instagram.com/alice.ig/?igsh=x' });
  let me = expect(r, 200, 'правка профиля');
  assert.deepEqual(me.links, { tg: 'alice_tg', ig: 'alice.ig' });
  assert.equal(me.bio, 'Привет!');
  bad(await patchA({ tg: 'https://evil.example/x' }), 'кривой Telegram', 'Telegram: укажи имя пользователя, например @username', 'tg');
  bad(await patchA({ ig: 'a..b' }), 'кривой Instagram', 'Instagram: укажи имя пользователя, например @username', 'ig');
  bad(await patchA({ bio: 'б'.repeat(161) }), 'длинное «О себе»', 'О себе — не больше 160 символов', 'bio');
  bad(await patchA({ uni: 'nope' }), 'чужой вуз', 'Такого вуза нет в Para', 'uni');
  bad(await patchA({ age: 'adult' }), 'age у взрослого', undefined, 'age');
  bad(await patchA({ searchable: 'yes' }), 'searchable не boolean', undefined, 'searchable');
  me = expect(await patchA({ uni: 'tsue' }), 200, 'мой вуз');
  assert.equal(me.uni, 'tsue');
  assert.ok(me.uniShort);
  me = expect(await patchA({ uni: '' }), 200, 'мой вуз: не показывать');
  assert.equal(me.uni, null);
  me = expect(await patchA({ uni: UNI }), 200, 'мой вуз обратно');
  ok('профиль: ссылки нормализуются, управляющие символы вырезаны, проверки полей, «мой вуз»');

  // Несовершеннолетний: строже по умолчанию.
  const F = await login(`sm_${RUN}_f`, { age: 'minor' });
  assert.equal(F.me.age, 'minor');
  assert.deepEqual(F.me.privacy, { links: 'friends', searchable: false, friendRequests: 'all' });
  await onboard(F, `sm_${RUN}_f`, `Мия ${RUN}`);
  r = await call(F.jar, 'PATCH', '/api/social/me', { json: { linksVisibility: 'signed' }, headers: W });
  bad(r, 'minor: signed', 'До 18 лет контакты видят только друзья', 'linksVisibility');
  const M2 = await login(`sm_${RUN}_m`, { age: 'minor' });
  await onboard(M2, `sm_${RUN}_m`, `Минор ${RUN}`);
  me = expect(await call(M2.jar, 'PATCH', '/api/social/me', { json: { age: 'adult', linksVisibility: 'signed' }, headers: W }), 200, 'мне уже 18');
  assert.equal(me.age, 'adult');
  assert.equal(me.privacy.links, 'signed');
  bad(await call(M2.jar, 'PATCH', '/api/social/me', { json: { age: 'adult' }, headers: W }), 'age второй раз', undefined, 'age');
  // Взрослый аккаунт, а при входе человек ответил «16–17» — становится «до 18» с закрытыми настройками; обратно — нет.
  const N = await login(`sm_${RUN}_y`);
  await onboard(N, `sm_${RUN}_y`, `Нодир ${RUN}`);
  expect(await call(N.jar, 'PATCH', '/api/social/me', { json: { linksVisibility: 'signed' }, headers: W }), 200, 'взрослый: signed');
  const N2 = await login(`sm_${RUN}_y`, { age: 'minor' });
  assert.equal(N2.me.age, 'minor', 'вход с «16–17» переводит взрослый аккаунт в «до 18»');
  assert.deepEqual(N2.me.privacy, { links: 'friends', searchable: false, friendRequests: 'all' });
  assert.equal((await login(`sm_${RUN}_y`, { age: 'adult' })).me.age, 'minor', 'вход с «18 и старше» возраст не повышает');
  ok('несовершеннолетний: searchable false, заявки открыты, signed нельзя; age → adult только один раз; «16–17» при входе понижает');

  // Правила: вход без принятия (разработка) → 403 rules; intent=delete не трогает согласие; принять.
  const R = await login(`sm_${RUN}_r`, { accept: false });
  assert.equal(R.me.rulesAccepted, false);
  await onboard(R, `sm_${RUN}_r`, `Рустам ${RUN}`);
  r = await call(R.jar, 'POST', '/api/social/posts', { json: { text: 'правила?', category: 'other', media: [] }, headers: W });
  expect(r, 403, 'пост без правил', 'rules', 'Сначала прими правила обсуждений');
  const R2 = await login(`sm_${RUN}_r`, { intent: 'delete' });
  assert.equal(R2.me.rulesAccepted, false, 'intent=delete не должен записывать согласие');
  bad(await call(R.jar, 'POST', '/api/social/me/rules', { json: { version: 0 }, headers: W }), 'старая версия правил',
    'Правила обновились — прими новую версию', 'version');
  me = expect(await call(R.jar, 'POST', '/api/social/me/rules', { json: { version: st.config.rulesVersion }, headers: W }), 200, 'принять правила');
  assert.equal(me.rulesAccepted, true);
  ok('правила: без принятия — 403 rules; вход ради удаления согласие не меняет; принятие текущей версии');

  // ── Фото ──
  const exif = withExif(PHOTO);
  r = await call(A.jar, 'POST', '/api/social/media?kind=post', { body: exif, headers: W });
  const m1 = expect(r, 201, 'загрузка фото');
  assert.match(m1.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(m1.url, `/api/media/${m1.id}.jpg`);
  assert.equal(m1.thumb, m1.url);
  assert.deepEqual([m1.w, m1.h], [1600, 1200]);
  assert.ok(m1.bytes < exif.length);
  r = await call(A.jar, 'GET', m1.url);
  expect(r, 200, 'своё неприкреплённое фото');
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['content-security-policy'], "default-src 'none'; sandbox");
  assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(r.headers['x-robots-tag'], 'noindex');
  assert.equal(r.headers['cache-control'], 'private, no-store');
  assert.ok(!r.buf.includes('GPS-SECRET') && !r.buf.includes('Exif') && !r.buf.includes('COMMENT') && !r.buf.includes('<html>'));
  assert.equal(r.buf.readUInt16BE(r.buf.length - 2), 0xFFD9);
  assert.equal(r.buf.length, m1.bytes);
  expect(await call(B.jar, 'GET', m1.url), 404, 'чужое неприкреплённое фото', 'not_found', 'Фото не найдено');
  expect(await call(guest, 'GET', m1.url), 404, 'гость: неприкреплённое фото');
  ok('фото: EXIF, комментарий и хвост после EOI вырезаны; до публикации видно только автору');

  const mism = (w, h) => call(A.jar, 'PUT', `/api/social/media/${m1.id}/thumb`, { body: makeJpeg(w, h, SCENES.sunset), headers: W });
  bad(await mism(640, 640), 'миниатюра другой формы', 'Миниатюра не совпадает с фото — загрузи фото ещё раз');
  bad(await mism(320, 240), 'миниатюра не той длины', 'Миниатюра не совпадает с фото — загрузи фото ещё раз');
  bad(await mism(480, 640), 'миниатюра повёрнута', 'Миниатюра не совпадает с фото — загрузи фото ещё раз');
  bad(await mism(700, 525), 'миниатюра больше 640', /точек по стороне/);
  expect(await call(B.jar, 'PUT', `/api/social/media/${m1.id}/thumb`, { body: PHOTO_T, headers: W }), 404, 'миниатюра к чужому фото', 'not_found');
  r = await call(A.jar, 'PUT', `/api/social/media/${m1.id}/thumb`, { body: PHOTO_T, headers: W });
  const t1 = expect(r, 200, 'миниатюра');
  assert.deepEqual(t1, { id: m1.id, url: m1.url, thumb: `/api/media/${m1.id}_t.jpg`, w: 1600, h: 1200 });
  expect(await call(A.jar, 'GET', t1.thumb), 200, 'своя миниатюра');
  expect(await call(B.jar, 'GET', t1.thumb), 404, 'чужая неприкреплённая миниатюра');
  r = await call(A.jar, 'PUT', `/api/social/media/${m1.id}/thumb`, { body: Buffer.alloc(160_000, 1), headers: W });
  expect(r, 413, 'миниатюра больше 150 КБ', 'too_large', 'Фото больше 900 КБ — уменьши его');
  ok('миниатюра: форма и длинная сторона проверяются; _t.jpg видна только автору до публикации');

  r = await call(A.jar, 'POST', '/api/social/media?kind=post', { body: Buffer.from('GIF89a' + 'x'.repeat(300)), type: 'image/gif', headers: W });
  expect(r, 415, 'не JPEG по типу', 'media_type', 'Нужна фотография в формате JPEG');
  r = await call(A.jar, 'POST', '/api/social/media?kind=post', { json: { a: 1 }, headers: W });
  expect(r, 415, 'JSON вместо фото', 'media_type');
  r = await call(A.jar, 'POST', '/api/social/media?kind=post', { body: Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47]), Buffer.alloc(300)]), headers: W });
  bad(r, 'не JPEG по содержимому', 'Это не JPEG');
  r = await call(A.jar, 'POST', '/api/social/media?kind=post', { body: PHOTO.subarray(0, PHOTO.length - 200), headers: W });
  bad(r, 'обрезанный JPEG', 'Файл обрезан — загрузи фото ещё раз');
  r = await call(A.jar, 'POST', '/api/social/media?kind=post', { body: makeJpeg(2100, 64, SCENES.sea), headers: W });
  bad(r, 'шире 2048', 'Фото больше 2048 точек по стороне — уменьши его');
  const pad = Buffer.concat([Buffer.from([0xFF, 0xFE]), u16(65535), Buffer.alloc(65533, 0x20)]);
  r = await call(A.jar, 'POST', '/api/social/media?kind=post', { body: Buffer.concat([PHOTO.subarray(0, 2), ...Array(15).fill(pad), PHOTO.subarray(2)]), headers: W });
  expect(r, 413, 'больше 900 КБ', 'too_large', 'Фото больше 900 КБ — уменьши его');
  r = await call(A.jar, 'POST', '/api/social/media?kind=gif', { body: PHOTO, headers: W });
  bad(r, 'kind=gif');
  for (const p of ['/api/media/..%2F..%2Fsocial.db', '/api/media/%2e%2e%2fsocial.db.jpg', `/api/media/${'A'.repeat(22)}.png`,
    `/api/media/${'A'.repeat(21)}.jpg`, `/api/media/${m1.id}_x.jpg`, '/api/media/social.db']) {
    expect(await call(A.jar, 'GET', p), 404, 'путь: ' + p);
  }
  ok('фото: 415, не JPEG, обрезан, >2048, >900 КБ (413), обход пути → 404');

  const m2 = expect(await call(A.jar, 'POST', '/api/social/media?kind=post', { body: PHOTO, headers: W }), 201, 'второе фото');
  expect(await call(B.jar, 'DELETE', '/api/social/media/' + m2.id, { json: {}, headers: W }), 404, 'удалить чужое фото', 'not_found');
  expect(await call(A.jar, 'DELETE', '/api/social/media/' + m2.id, { json: {}, headers: W }), 200, 'удалить неотправленное фото');
  expect(await call(A.jar, 'DELETE', '/api/social/media/' + m2.id, { json: {}, headers: W }), 404, 'удалить второй раз', 'not_found', 'Фото не найдено');
  expect(await call(A.jar, 'GET', m2.url), 404, 'удалённое фото');
  ok('удаление неотправленного фото: только своё, повтор — 404');

  // Аватар.
  r = await call(A.jar, 'POST', '/api/social/media?kind=avatar', { body: makeJpeg(512, 400, SCENES.avatar(1)), headers: W });
  bad(r, 'неквадратный аватар', 'Фото профиля должно быть квадратным');
  r = await call(A.jar, 'POST', '/api/social/media?kind=avatar', { body: makeJpeg(1100, 1100, SCENES.avatar(1)), headers: W });
  bad(r, 'аватар больше 1024', 'Фото больше 1024 точек по стороне — уменьши его');
  const av = expect(await call(A.jar, 'POST', '/api/social/media?kind=avatar', { body: makeJpeg(512, 512, SCENES.avatar(1)), headers: W }), 201, 'аватар');
  bad(await call(A.jar, 'PUT', `/api/social/media/${av.id}/thumb`, { body: makeJpeg(100, 100, SCENES.avatar(1)), headers: W }),
    'миниатюра аватара не 128', 'Миниатюра не совпадает с фото — загрузи фото ещё раз');
  expect(await call(A.jar, 'PUT', `/api/social/media/${av.id}/thumb`, { body: makeJpeg(128, 128, SCENES.avatar(1)), headers: W }), 200, 'миниатюра аватара');
  bad(await patchA({ avatar: m1.id }), 'фото поста вместо аватара', 'Фото профиля не найдено — загрузи его ещё раз', 'avatar');
  bad(await patchA({ avatar: 'x' }), 'кривой id аватара', undefined, 'avatar');
  me = expect(await patchA({ avatar: av.id }), 200, 'поставить аватар');
  assert.equal(me.avatar, `/api/media/${av.id}_t.jpg`);
  assert.equal(me.avatarFull, `/api/media/${av.id}.jpg`);
  r = await call(guest, 'GET', me.avatarFull);
  expect(r, 200, 'аватар виден всем');
  assert.equal(r.headers['cache-control'], 'public, max-age=604800');
  expect(await call(A.jar, 'DELETE', '/api/social/media/' + av.id, { json: {}, headers: W }), 404, 'удалить текущий аватар');
  expect(await call(A.jar, 'PUT', `/api/social/media/${av.id}/thumb`, { body: makeJpeg(128, 128, SCENES.avatar(1)), headers: W }), 404, 'миниатюра к текущему аватару');
  ok('аватар: квадрат ≤ 1024, миниатюра 128, ставится через PATCH, виден всем, не удаляется как неотправленный');

  // ── Публикации ──
  const C = await user('c', `Кэрол ${RUN}`);
  const D = await user('d', `Семён ${RUN}`);
  const E = await user('e', `Эрин ${RUN}`);
  const H = await user('h', `Хуршид ${RUN}`);
  const G = await user('g', `Гулноза ${RUN}`);
  const newPost = (u, json) => call(u.jar, 'POST', '/api/social/posts', { json, headers: W });
  bad(await newPost(A, { text: 'x'.repeat(1001), category: 'other', media: [] }), 'длинный текст', 'Слишком длинный текст — максимум 1000 символов', 'text');
  bad(await newPost(A, { text: '👨‍👩‍👧‍👦'.repeat(400), category: 'other', media: [] }), '4000 UTF-16', 'Слишком длинный текст — максимум 1000 символов', 'text');
  bad(await newPost(A, { text: Array(31).fill('строка').join('\n'), category: 'other', media: [] }), '31 строка', 'Слишком длинный текст — максимум 1000 символов', 'text');
  bad(await newPost(A, { text: 'Привет', category: 'market', media: [] }), 'неизвестная тема', 'Выбери тему', 'category');
  bad(await newPost(A, { text: 'Привет', media: [] }), 'без темы', 'Выбери тему', 'category');
  bad(await newPost(A, { text: '  ​ ', category: 'other', media: [] }), 'пустой пост', 'Напиши текст или добавь фото', 'text');
  bad(await newPost(A, { text: 'a https://a.uz www.b.uz t.me/c http://d.uz', category: 'other', media: [] }), '4 ссылки',
    'Не больше 3 ссылок в одном сообщении', 'text');
  bad(await newPost(A, { text: 'фото', category: 'company', media: [m1.id] }), 'Компания с фото', 'В теме «Компания» — только текст', 'media');
  bad(await newPost(A, { text: 'фото', category: 'other', media: ['A'.repeat(22), 'B'.repeat(22), 'C'.repeat(22), 'D'.repeat(22), 'E'.repeat(22)] }),
    '5 фото', 'Можно прикрепить не больше 4 фото', 'media');
  bad(await newPost(A, { text: 'фото', category: 'other', media: ['../x'] }), 'кривой id фото', 'Фото не найдено — загрузи его ещё раз', 'media');
  r = await call(A.jar, 'POST', '/api/social/posts', { json: { text: 'без вуза', category: 'other', media: [] }, headers: W, uni: '' });
  expect(r, 400, 'пост без вуза', 'uni', 'Сначала выбери вуз');
  ok('проверки публикации: длина (графемы, UTF-16, строки), тема, пустота, ссылки, «Компания», фото');

  bad(await newPost(D, { text: `чужое · ${RUN}`, category: 'other', media: ['A'.repeat(22)] }), 'несуществующее фото',
    'Фото не найдено — загрузи его ещё раз', 'media');
  const p1 = await post(A, `Кто идёт на матан? Это пиздец сложно · ${RUN}`, 'study', [m1.id]);
  assert.equal(p1.uni, UNI);
  assert.ok(p1.uniShort);
  assert.equal(p1.rootId, null);
  assert.equal(p1.category, 'study');
  assert.equal(p1.media.length, 1);
  assert.deepEqual(p1.media[0], { id: m1.id, url: m1.url, thumb: t1.thumb, w: 1600, h: 1200 });
  assert.match(p1.text, /п•••/);
  assert.ok(!p1.text.includes('пиздец'));
  assert.equal(p1.mine, true);
  assert.equal(p1.canDelete, true);
  assert.equal(p1.author.username, A.me.username);
  assert.equal(p1.author.uni, UNI);
  bad(await newPost(B, { text: 'повтор фото', category: 'other', media: [m1.id] }), 'чужое прикреплённое фото', 'Фото не найдено — загрузи его ещё раз', 'media');
  r = await call(guest, 'GET', m1.url);
  expect(r, 200, 'фото опубликованного поста');
  assert.equal(r.headers['cache-control'], 'public, max-age=604800');
  expect(await call(guest, 'GET', t1.thumb), 200, 'миниатюра опубликованного поста');
  ok('публикация: мат замаскирован, фото прикрепляется один раз, после публикации видно всем (7 дней кеша)');

  const p3 = await post(A, `Три ссылки: https://a.uz www.b.uz t.me/c · ${RUN}`, 'other');
  r = await newPost(A, { text: `Три ссылки: https://a.uz www.b.uz t.me/c · ${RUN}`, category: 'other', media: [] });
  bad(r, 'повтор текста', 'Такое сообщение уже отправлено', 'text');
  ok('три ссылки можно (аккаунт не новый); повтор того же текста за 10 минут — нельзя');

  // Ведёрко публикаций: 3 подряд, четвёртая — 429.
  const h1 = await post(H, `Ярмарка вакансий · ${RUN}`, 'events', [], 'tsue');
  const h2 = await post(H, `Перенос пары · ${RUN}`, 'schedule');
  const h3 = await post(H, `Ищу компанию на пробежку · ${RUN}`, 'company');
  r = await newPost(H, { text: `Четвёртая · ${RUN}`, category: 'other', media: [] });
  const limitsOn = r.status === 429;
  if (limitsOn) {
    expect(r, 429, 'четвёртая публикация подряд', 'rate');
    assert.ok(Number(r.headers['retry-after']) > 0 && r.json.retryAfter > 0);
    assert.match(r.json.error, /^Слишком часто — (подожди немного|попробуй через \d+ мин\.)$/);
    ok(`ведёрко публикаций: 4-я подряд → 429 «${r.json.error}», Retry-After ${r.headers['retry-after']}`);
  } else {
    expect(r, 201, 'четвёртая публикация');
    console.log('     (пределы выключены: SOCIAL_RATE_LIMITS=off — проверка ведёрок пропущена)');
  }
  assert.equal(h1.uni, 'tsue');

  // ── Лента ──
  r = await call(guest, 'GET', '/api/social/feed', { uni: '' });
  expect(r, 400, 'лента без вуза', 'uni', 'Сначала выбери вуз');
  r = await call(guest, 'GET', '/api/social/feed?limit=50');
  let feed = expect(r, 200, 'лента гостя');
  assert.ok(feed.items.some((p) => p.id === p1.id));
  assert.ok(!feed.items.some((p) => p.id === h1.id), 'пост ТГЭУ не в ленте КФУ');
  assert.ok(feed.items.every((p) => p.author && p.author.uni === null && p.author.uniShort === null), 'гостю author.uni = null');
  assert.ok(feed.items.every((p) => p.uni === UNI && p.uniShort), 'Post.uni заполнен');
  assert.ok(feed.items.every((p, i, a) => i === 0 || a[i - 1].id > p.id), 'новые сверху');
  feed = expect(await call(B.jar, 'GET', '/api/social/feed?limit=50'), 200, 'лента Боба');
  assert.equal(feed.items.find((p) => p.id === p1.id).author.uni, UNI, 'вошедшему author.uni заполнен');
  assert.ok(expect(await call(guest, 'GET', '/api/social/feed?limit=50', { uni: 'tsue' }), 200, 'лента ТГЭУ').items.some((p) => p.id === h1.id));
  const byCat = await feedIds(B.jar, '&category=study');
  assert.ok(byCat.includes(p1.id) && !byCat.includes(h2.id));
  bad(await call(B.jar, 'GET', '/api/social/feed?category=market'), 'лента: чужая тема', 'Выбери тему', 'category');
  r = await call(B.jar, 'GET', '/api/social/feed?limit=1');
  const pg1 = expect(r, 200, 'страница 1');
  assert.equal(pg1.items.length, 1);
  assert.ok(pg1.next);
  const pg2 = expect(await call(B.jar, 'GET', '/api/social/feed?limit=1&cursor=' + pg1.next), 200, 'страница 2');
  assert.ok(pg2.items[0].id < pg1.items[0].id);
  bad(await call(B.jar, 'GET', '/api/social/feed?cursor=abc'), 'кривой курсор');
  bad(await call(B.jar, 'GET', '/api/social/feed?limit=0'), 'limit=0');
  assert.ok(expect(await call(B.jar, 'GET', '/api/social/feed?limit=500'), 200, 'limit=500').items.length <= 50);
  ok('лента: вуз обязателен, только свой вуз, гостю без «моего вуза», тема, курсор, limit ≤ 50');

  // ── Ответы, ветка, лайки ──
  const rb = await reply(B, p1.id, `Я иду · ${RUN}`);
  assert.equal(rb.rootId, p1.id);
  assert.equal(rb.category, null);
  assert.equal(rb.replyTo, null);
  assert.equal(rb.uni, UNI);
  const ra = await reply(A, p1.id, `Отлично · ${RUN}`, { replyTo: rb.id });
  assert.deepEqual(ra.replyTo, { id: rb.id, username: B.me.username });
  const rr = await reply(C, p1.id, `На публикацию · ${RUN}`, { replyTo: p1.id });
  assert.equal(rr.replyTo, null, 'replyTo = id публикации → без адресата');
  const mc = await uploadPhoto(C);
  const rc = await reply(C, p1.id, '', { media: [mc.id] });
  assert.equal(rc.media.length, 1);
  const md1 = await uploadPhoto(D);
  const md2 = await uploadPhoto(D);
  bad(await call(D.jar, 'POST', `/api/social/posts/${p1.id}/replies`, { json: { text: 'два фото', media: [md1.id, md2.id] }, headers: W }),
    'ответ с 2 фото', 'К ответу можно прикрепить одно фото', 'media');
  bad(await call(D.jar, 'POST', `/api/social/posts/${p1.id}/replies`, { json: { text: 'не туда', replyTo: h2.id }, headers: W }),
    'replyTo из другой ветки', 'Неверный запрос', 'replyTo');
  bad(await call(D.jar, 'POST', `/api/social/posts/${rb.id}/replies`, { json: { text: 'ответ на ответ по адресу ответа' }, headers: W }),
    'ответ с :id ответа');
  bad(await call(D.jar, 'POST', `/api/social/posts/${h3.id}/replies`, { json: { text: 'фото', media: [md1.id] }, headers: W }),
    'фото в ответе «Компании»', 'В теме «Компания» — только текст', 'media');
  expect(await call(D.jar, 'POST', '/api/social/posts/999999999/replies', { json: { text: 'x' }, headers: W }), 404, 'ответ несуществующему', 'not_found');
  ok('ответы: плоская ветка, replyTo (имя — при чтении), одно фото, не в «Компании»');

  r = await thread(guest, p1.id);
  let th = expect(r, 200, 'ветка гостю');
  assert.equal(th.post.id, p1.id);
  assert.equal(th.post.replies, 4);
  assert.deepEqual(th.replies.map((x) => x.id), [rb.id, ra.id, rr.id, rc.id]);
  assert.equal(th.focus, null);
  assert.equal(th.next, null);
  assert.ok(th.replies.every((x) => x.author.uni === null), 'гостю author.uni = null в ответах');
  th = expect(await thread(B.jar, ra.id), 200, 'ветка по id ответа');
  assert.equal(th.post.id, p1.id);
  assert.equal(th.focus, ra.id);
  expect(await thread(guest, 999999999), 404, 'несуществующая ветка', 'not_found', 'Публикация удалена или скрыта');
  expect(await call(guest, 'GET', '/api/social/posts/abc'), 404, 'кривой id', 'not_found');
  ok('ветка: старые сверху, счётчик ответов, focus для ответа, 404 для неизвестной');

  const like = (u, id, on) => call(u.jar, on ? 'PUT' : 'DELETE', `/api/social/posts/${id}/like`, { json: {}, headers: W });
  assert.deepEqual(expect(await like(B, p1.id, true), 200, 'лайк'), { liked: true, likes: 1 });
  assert.deepEqual(expect(await like(B, p1.id, true), 200, 'лайк снова'), { liked: true, likes: 1 });
  assert.deepEqual(expect(await like(B, p1.id, false), 200, 'снять лайк'), { liked: false, likes: 0 });
  assert.deepEqual(expect(await like(B, p1.id, false), 200, 'снять снова'), { liked: false, likes: 0 });
  await like(B, p1.id, true);
  await like(C, p1.id, true);
  assert.deepEqual(expect(await like(A, rb.id, true), 200, 'лайк ответа'), { liked: true, likes: 1 });
  th = expect(await thread(B.jar, p1.id), 200, 'ветка Бобу');
  assert.equal(th.post.liked, true);
  assert.equal(th.post.likes, 2);
  expect(await like(B, 999999999, true), 404, 'лайк несуществующему', 'not_found');
  expect(await call(guest, 'PUT', `/api/social/posts/${p1.id}/like`, { json: {}, headers: W }), 401, 'лайк гостя', 'auth');
  ok('лайки идемпотентны, liked и likes в ветке');

  // ── Медиа: 200 запросов за 5 секунд, без ведёрка ──
  const t0 = Date.now();
  const results = [];
  for (let i = 0; i < 10; i++) {
    const batch = await Promise.all(Array.from({ length: 20 }, () => call(null, 'GET', m1.url)));
    results.push(...batch);
  }
  const took = Date.now() - t0;
  assert.ok(results.every((x) => x.status === 200 && x.headers['cache-control'] === 'public, max-age=604800'), 'все 200');
  assert.ok(took < 5000, `200 запросов за ${took} мс`);
  ok(`200 × GET /api/media/<id>.jpg с одного IP за ${took} мс — все 200, public, max-age=604800`);

  // ── Жалобы и автоскрытие ──
  const mcp = await uploadPhoto(C);
  const pc1 = await post(C, `Реклама курсов · ${RUN}`, 'other', [mcp.id]);
  const pd1 = await post(D, `Про драку у общежития · ${RUN}`, 'events');
  const pe1 = await post(E, `Сомнительное предложение · ${RUN}`, 'other');
  const pe2 = await post(E, `Ещё одно · ${RUN}`, 'other');
  const pe3 = await post(E, `Третье · ${RUN}`, 'other');
  expect(await call(B.jar, 'GET', mcp.url), 200, 'фото до скрытия');

  bad(await report(C, 'post', pc1.id, 'spam'), 'жалоба на свой пост', 'Нельзя пожаловаться на себя');
  bad(await report(C, 'user', C.me.id, 'spam'), 'жалоба на себя', 'Нельзя пожаловаться на себя');
  bad(await report(D, 'post', pc1.id, 'nsfw'), 'неизвестная причина', 'Выбери причину жалобы', 'reason');
  bad(await report(D, 'post', pc1.id, 'other'), 'другое без комментария', 'Опиши, что случилось', 'note');
  bad(await report(D, 'post', pc1.id, 'spam', 'к'.repeat(301)), 'длинный комментарий', 'Комментарий к жалобе — не больше 300 символов', 'note');
  bad(await report(D, 'thing', pc1.id, 'spam'), 'неизвестная цель');
  expect(await report(D, 'post', 999999999, 'spam'), 404, 'жалоба на несуществующий', 'not_found');
  expect(await call(guest, 'POST', '/api/social/reports', { json: { target: 'post', id: pc1.id, reason: 'spam' }, headers: W }), 401, 'жалоба гостя', 'auth');

  for (const [u, i, reason] of [[D, 1, 'spam'], [E, 2, 'abuse'], [F, 3, 'scam']]) {
    const res = expect(await report(u, 'post', pc1.id, reason, 'грубо'), 200, 'жалоба ' + i);
    assert.deepEqual(res, { reported: true, hidden: i >= 3 }, `обычные причины: скрыть на 3-й (SOCIAL_REPORTER_MIN_AGE_H=0?)`);
  }
  assert.deepEqual(expect(await report(D, 'post', pc1.id, 'abuse'), 200, 'повторная жалоба'), { reported: true, hidden: true });
  assert.deepEqual(expect(await report(C, 'post', pd1.id, 'violence'), 200, 'тяжёлая 1'), { reported: true, hidden: false });
  assert.deepEqual(expect(await report(E, 'post', pd1.id, 'sexual'), 200, 'тяжёлая 2'), { reported: true, hidden: true });
  assert.deepEqual(expect(await report(C, 'post', pe1.id, 'child', 'Угроза ребёнку'), 200, 'угроза ребёнку'), { reported: true, hidden: true });
  ok('автоскрытие: обычные причины — 3 жалобы, тяжёлые — 2, «угроза ребёнку» — 1; повтор идемпотентен');

  // V2: скрытое видят только автор и модераторы.
  assert.ok(!(await feedIds(B.jar)).includes(pc1.id), 'скрытое не в ленте');
  expect(await thread(B.jar, pc1.id), 404, 'скрытое чужим', 'not_found', 'Публикация удалена или скрыта');
  expect(await thread(guest, pc1.id), 404, 'скрытое гостю');
  th = expect(await thread(C.jar, pc1.id), 200, 'скрытое автору');
  assert.equal(th.post.hidden, true);
  assert.equal(expect(await thread(boss.jar, pc1.id), 200, 'скрытое модератору').post.hidden, true);
  expect(await call(B.jar, 'GET', mcp.url), 404, 'фото скрытого поста чужим');
  expect(await call(C.jar, 'GET', mcp.url), 200, 'фото скрытого поста автору');
  r = await call(C.jar, 'GET', mcp.url);
  assert.equal(r.headers['cache-control'], 'private, no-store');
  expect(await call(boss.jar, 'GET', mcp.url), 200, 'фото скрытого поста модератору');
  expect(await like(B, pc1.id, true), 404, 'лайк скрытого', 'not_found');
  expect(await call(B.jar, 'POST', `/api/social/posts/${pc1.id}/replies`, { json: { text: 'x' }, headers: W }), 404, 'ответ скрытому', 'not_found');
  let prof = expect(await call(B.jar, 'GET', `/api/social/users/${C.me.username}`), 200, 'профиль C Бобу');
  assert.ok(!prof.posts.some((p) => p.id === pc1.id));
  prof = expect(await call(C.jar, 'GET', `/api/social/users/${C.me.username}`), 200, 'свой профиль C');
  assert.equal(prof.posts.find((p) => p.id === pc1.id).hidden, true);
  assert.equal(prof.user.relation, 'self');
  expect(await report(B, 'post', pc1.id, 'spam'), 404, 'жалоба на скрытое', 'not_found', 'Публикация удалена или скрыта');
  ok('V2: скрытое — только автору и модератору (лента, ветка, профиль, фото, лайк, ответ, жалоба)');

  // Модерация: очередь.
  expect(await call(B.jar, 'GET', '/api/social/admin/reports'), 403, 'очередь не модератору', 'forbidden', 'Недостаточно прав');
  for (const p of ['/api/social/admin/stats', '/api/social/admin/audit']) expect(await call(B.jar, 'GET', p), 403, p, 'forbidden');
  expect(await admin(B, { action: 'hide', target: { type: 'post', id: h2.id } }), 403, 'действие не модератора', 'forbidden');
  const bossMe = await meOf(boss.jar);
  assert.ok(bossMe.modQueue >= 3, 'modQueue у модератора');
  assert.equal((await meOf(B.jar)).modQueue, 0);
  let q = await allCases(boss, 'open');
  const caseOf = (list, key) => list.items.find((x) => x.key === key);
  const kc = caseOf(q, 'p:' + pc1.id);
  assert.ok(kc, 'дело по скрытому посту');
  assert.equal(kc.status, 'open');
  assert.deepEqual(kc.target, { type: 'post', id: pc1.id });
  assert.equal(kc.reporters, 3);
  assert.deepEqual(kc.reasons, { spam: 1, abuse: 1, scam: 1 });
  assert.deepEqual(kc.notes, ['грубо', 'грубо', 'грубо']);
  assert.equal(kc.hidden, true);
  assert.equal(kc.severe, false);
  assert.equal(kc.post.rawText, `Реклама курсов · ${RUN}`);
  assert.equal(kc.post.media[0].url, mcp.url);
  assert.equal(kc.post.media[0].thumb, `/api/media/${mcp.id}_t.jpg`);
  assert.equal(kc.snapshot.kind, 'post');
  assert.equal(kc.snapshot.text, `Реклама курсов · ${RUN}`);
  assert.equal(kc.snapshot.username, C.me.username);
  assert.equal(kc.snapshot.mediaCount, 1);
  assert.equal(kc.snapshot.media[0].id, mcp.id);
  assert.equal(kc.user.id, C.me.id);
  assert.equal(kc.user.status, 'active');
  assert.equal(kc.resolvedAt, null);
  const ke = caseOf(q, 'p:' + pe1.id);
  assert.equal(ke.severe, true);
  const iSevere = q.items.findIndex((x) => x.key === 'p:' + pe1.id);
  const iPlain = q.items.findIndex((x) => x.key === 'p:' + pc1.id);
  assert.ok(iSevere < iPlain, 'тяжёлые — выше');
  ok('очередь модератора: дело на цель, причины, комментарии, rawText, снимок, фото (превью и оригинал), тяжёлые выше');

  // «Угроза ребёнку» отклонена → этот жалобщик больше не скрывает в одиночку.
  expect(await admin(boss, { action: 'dismiss', target: { type: 'post', id: pe1.id } }), 200, 'отклонить');
  expect(await thread(B.jar, pe1.id), 200, 'после отклонения снова виден');
  assert.deepEqual(expect(await report(C, 'post', pe2.id, 'child'), 200, 'угроза ребёнку от «сгоревшего»'), { reported: true, hidden: false });
  assert.deepEqual(expect(await report(B, 'post', pe2.id, 'child'), 200, 'угроза ребёнку от другого'), { reported: true, hidden: true });
  assert.deepEqual(expect(await report(boss, 'post', pe3.id, 'spam'), 200, 'жалоба модератора'), { reported: true, hidden: true });
  q = await allCases(boss, 'closed');
  const closed = caseOf(q, 'p:' + pe1.id);
  assert.equal(closed.status, 'dismissed');
  assert.equal(closed.resolvedBy, '@' + bossMe.username);
  assert.ok(closed.resolvedAt);
  ok('отклонённая «угроза ребёнку» больше не скрывает в одиночку; жалоба модератора скрывает сразу; решённые');

  // Действия модератора над постом.
  expect(await admin(boss, { action: 'hide', target: { type: 'post', id: h2.id } }), 200, 'скрыть');
  expect(await thread(B.jar, h2.id), 404, 'скрытый модератором');
  assert.equal(expect(await thread(H.jar, h2.id), 200, 'автору').post.hidden, true);
  expect(await admin(boss, { action: 'unhide', target: { type: 'post', id: h2.id } }), 200, 'вернуть');
  expect(await thread(B.jar, h2.id), 200, 'возвращённый');
  expect(await admin(boss, { action: 'unhide', target: { type: 'post', id: pc1.id } }), 200, 'вернуть скрытый жалобами');
  expect(await thread(B.jar, pc1.id), 200, 'снова виден');
  expect(await admin(boss, { action: 'delete', target: { type: 'post', id: pd1.id } }), 200, 'удалить как модератор');
  expect(await thread(B.jar, pd1.id), 404, 'удалённый модератором');
  expect(await admin(boss, { action: 'delete', target: { type: 'post', id: pd1.id } }), 404, 'удалить второй раз', 'not_found');
  bad(await admin(boss, { action: 'hide', target: { type: 'user', id: C.me.id } }), 'скрыть человека', undefined, 'target');
  bad(await admin(boss, { action: 'warn', target: { type: 'post', id: h2.id } }), 'неизвестное действие', undefined, 'action');
  bad(await admin(boss, { action: 'hide', target: { type: 'post', id: 'x' } }), 'кривой id цели', undefined, 'target');
  q = await allCases(boss, 'closed');
  assert.equal(caseOf(q, 'p:' + pd1.id).status, 'actioned');
  assert.equal(caseOf(q, 'p:' + pd1.id).post, null, 'удалённый совсем — post: null');
  assert.equal(caseOf(q, 'p:' + pd1.id).snapshot.text, `Про драку у общежития · ${RUN}`);
  assert.equal(caseOf(q, 'p:' + pc1.id).status, 'dismissed');
  ok('модератор: скрыть, вернуть, удалить (жалобы → actioned), проверки тела действия');

  // Жалоба на ответ, который автор потом удалил (строки поста больше нет): «Отклонить» закрывает дело.
  const rgone = await reply(C, h2.id, `Ответ, который удалят · ${RUN}`);
  expect(await report(B, 'post', rgone.id, 'spam'), 200, 'жалоба на ответ');
  expect(await call(C.jar, 'DELETE', `/api/social/posts/${rgone.id}`, { json: {}, headers: W }), 200, 'автор удалил ответ');
  expect(await admin(boss, { action: 'hide', target: { type: 'post', id: rgone.id } }), 404, 'скрыть удалённый ответ', 'not_found');
  expect(await admin(boss, { action: 'dismiss', target: { type: 'post', id: rgone.id } }), 200, 'отклонить жалобу на удалённый ответ');
  assert.equal(caseOf(await allCases(boss, 'closed'), 'p:' + rgone.id).status, 'dismissed');
  expect(await admin(boss, { action: 'dismiss', target: { type: 'post', id: 999999999 } }), 404, 'отклонить без поста и жалоб', 'not_found');
  ok('жалоба на удалённый автором ответ: «Отклонить» закрывает дело, «Скрыть» — 404');

  // Бан, V1, снятие.
  bad(await admin(boss, { action: 'ban', target: { type: 'user', id: C.me.id }, days: 1 }), 'бан без причины', 'Укажи причину', 'reason');
  bad(await admin(boss, { action: 'ban', target: { type: 'user', id: C.me.id }, days: 3, reason: 'x' }), 'бан на 3 дня', undefined, 'days');
  expect(await admin(boss, { action: 'ban', target: { type: 'user', id: boss.me.id }, days: null, reason: 'x' }), 403, 'бан модератора', 'forbidden');
  expect(await admin(boss, { action: 'ban', target: { type: 'user', id: C.me.id }, days: 1, reason: 'Спам' }), 200, 'бан на сутки');
  r = await newPost(C, { text: 'я тут', category: 'other', media: [] });
  expect(r, 403, 'пишет ограниченный', 'banned');
  assert.match(r.json.error, /^Публикация ограничена до \d{1,2} [а-я]+\. Причина: Спам\. Читать можно\.$/);
  me = await meOf(C.jar);
  assert.equal(me.banned.reason, 'Спам');
  assert.ok(me.banned.until);
  expect(await like(C, p1.id, true), 403, 'лайк ограниченного', 'banned');
  expect(await call(C.jar, 'PATCH', '/api/social/me', { json: { bio: 'новое' }, headers: W }), 403, 'правка профиля ограниченного', 'banned');
  expect(await call(C.jar, 'PATCH', '/api/social/me', { json: { searchable: false, tg: '' }, headers: W }), 200, 'скрыть себя можно');
  expect(await report(C, 'post', h2.id, 'spam'), 200, 'ограниченный может жаловаться');
  expect(await call(C.jar, 'PUT', `/api/social/blocks/${H.me.id}`, { json: {}, headers: W }), 200, 'ограниченный может блокировать');
  expect(await call(C.jar, 'DELETE', `/api/social/blocks/${H.me.id}`, { json: {}, headers: W }), 200, 'и разблокировать');
  assert.ok(!(await feedIds(B.jar)).includes(pc1.id), 'V1: посты ограниченного не в ленте');
  assert.ok((await feedIds(C.jar)).includes(pc1.id), 'V1: автор видит свои');
  expect(await thread(B.jar, pc1.id), 404, 'V1: ветка ограниченного чужим');
  expect(await thread(C.jar, pc1.id), 200, 'V1: ветка ограниченного автору');
  th = expect(await thread(B.jar, p1.id), 200, 'ветка с ответом ограниченного');
  assert.ok(!th.replies.some((x) => x.author && x.author.id === C.me.id), 'V1: ответы ограниченного скрыты');
  assert.equal(th.post.replies, 4, 'счётчик — все живые ответы');
  assert.ok(expect(await thread(boss.jar, p1.id), 200, 'модератору').replies.some((x) => x.author && x.author.id === C.me.id));
  expect(await call(B.jar, 'GET', mcp.url), 404, 'V1: фото ограниченного');
  expect(await call(B.jar, 'GET', `/api/social/users/${C.me.username}`), 404, 'профиль ограниченного', 'not_found', 'Профиль не найден');
  prof = expect(await call(boss.jar, 'GET', `/api/social/users/${C.me.username}`), 200, 'профиль ограниченного модератору');
  assert.equal(prof.user.banned.reason, 'Спам');
  assert.equal(expect(await call(C.jar, 'GET', `/api/social/users/${C.me.username}`), 200, 'свой профиль при ограничении').user.banned, null);
  assert.equal(expect(await call(A.jar, 'GET', `/api/social/users/${B.me.username}`), 200, 'обычный профиль').user.banned, null);
  q = await allCases(boss, 'closed');
  assert.equal(caseOf(q, 'p:' + pc1.id).user.status, 'banned');
  expect(await admin(boss, { action: 'unban', target: { type: 'user', id: C.me.id } }), 200, 'снять ограничение');
  assert.equal((await meOf(C.jar)).banned, null);
  assert.equal(expect(await call(boss.jar, 'GET', `/api/social/users/${C.me.username}`), 200, 'после снятия').user.banned, null);
  assert.ok((await feedIds(B.jar)).includes(pc1.id), 'после снятия посты снова видны');
  // Бессрочно; причина с точкой на конце — без второй точки (как banText в format.ts).
  expect(await admin(boss, { action: 'ban', target: { type: 'user', id: C.me.id }, days: null, reason: 'Реклама в ответах.' }), 200, 'бан навсегда');
  r = await newPost(C, { text: 'я снова тут', category: 'other', media: [] });
  expect(r, 403, 'пишет ограниченный навсегда', 'banned',
    'Публикация ограничена навсегда. Причина: Реклама в ответах. Читать можно.');
  assert.equal((await meOf(C.jar)).banned.until, null);
  expect(await admin(boss, { action: 'unban', target: { type: 'user', id: C.me.id } }), 200, 'снять бессрочное');
  expect(await admin(boss, { action: 'ban', target: { type: 'post', id: pe3.id }, days: 7, reason: 'Флуд', hidePosts: true }), 200, 'бан через пост');
  assert.equal((await meOf(E.jar)).banned.reason, 'Флуд');
  expect(await admin(boss, { action: 'unban', target: { type: 'post', id: pe3.id } }), 200, 'снять через пост');
  assert.equal((await meOf(E.jar)).banned, null);
  expect(await thread(B.jar, pe1.id), 404, 'hidePosts: посты остались скрытыми');
  ok('бан: 403 banned с текстом, V1 (лента, ветка, ответы, фото, профиль), можно жаловаться/блокировать/скрыть себя, banned — только модератору, снятие');

  // Сброс профиля.
  const avc = expect(await call(C.jar, 'POST', '/api/social/media?kind=avatar', { body: makeJpeg(256, 256, SCENES.avatar(4)), headers: W }), 201, 'аватар C');
  expect(await call(C.jar, 'PATCH', '/api/social/me', { json: { avatar: avc.id, bio: 'Реклама', tg: 'carol_ads' }, headers: W }), 200, 'профиль C');
  bad(await admin(boss, { action: 'reset', target: { type: 'user', id: C.me.id }, fields: [] }), 'сброс без полей', undefined, 'fields');
  bad(await admin(boss, { action: 'reset', target: { type: 'user', id: C.me.id }, fields: ['email'] }), 'сброс почты', undefined, 'fields');
  expect(await admin(boss, { action: 'reset', target: { type: 'user', id: C.me.id }, fields: ['avatar', 'bio', 'links', 'name'] }), 200, 'сброс');
  me = await meOf(C.jar);
  assert.equal(me.name, 'Пользователь');
  assert.equal(me.bio, '');
  assert.deepEqual(me.links, { tg: '', ig: '' });
  assert.equal(me.avatar, null);
  expect(await call(guest, 'GET', `/api/media/${avc.id}.jpg`), 404, 'сброшенный аватар');
  ok('сброс профиля: имя, «О себе», ссылки, аватар (файл удалён)');

  // ── Блокировка (V3) ──
  const pb = await post(B, `Потерял наушники · ${RUN}`, 'lost');
  expect(await call(A.jar, 'POST', `/api/social/friends/${B.me.id}`, { json: {}, headers: W }), 200, 'заявка A→B');
  expect(await call(B.jar, 'POST', `/api/social/friends/${A.me.id}/accept`, { json: {}, headers: W }), 200, 'B принимает');
  bad(await call(B.jar, 'PUT', `/api/social/blocks/${B.me.id}`, { json: {}, headers: W }), 'блок себя', 'Нельзя заблокировать себя');
  expect(await call(B.jar, 'PUT', '/api/social/blocks/999999999', { json: {}, headers: W }), 404, 'блок несуществующего', 'not_found');
  bad(await call(B.jar, 'PUT', '/api/social/blocks/abc', { json: {}, headers: W }), 'блок: кривой id');
  assert.deepEqual(expect(await call(B.jar, 'PUT', `/api/social/blocks/${A.me.id}`, { json: {}, headers: W }), 200, 'блок'), { relation: 'blocked' });
  assert.deepEqual(expect(await call(B.jar, 'PUT', `/api/social/blocks/${A.me.id}`, { json: {}, headers: W }), 200, 'блок снова'), { relation: 'blocked' });
  assert.ok(!(await feedIds(B.jar)).includes(p1.id), 'V3: A не в ленте B');
  assert.ok(!(await feedIds(A.jar)).includes(pb.id), 'V3: B не в ленте A');
  expect(await thread(A.jar, pb.id), 404, 'V3: ветка B для A');
  expect(await thread(B.jar, p1.id), 404, 'V3: ветка A для B');
  th = expect(await thread(C.jar, p1.id), 200, 'третьему видно всё');
  assert.ok(th.replies.some((x) => x.id === rb.id) && th.replies.some((x) => x.id === ra.id));
  r = await call(A.jar, 'POST', `/api/social/posts/${pb.id}/replies`, { json: { text: 'а можно?' }, headers: W });
  expect(r, 403, 'ответ заблокировавшему', 'blocked', 'Нельзя ответить на эту публикацию');
  r = await call(A.jar, 'POST', `/api/social/posts/${h3.id}/replies`, { json: { text: 'ответ B', replyTo: undefined }, headers: W });
  expect(r, 201, 'ответ третьему можно');
  expect(await like(A, pb.id, true), 404, 'лайк заблокировавшему');
  expect(await report(A, 'post', pb.id, 'spam'), 404, 'жалоба на пост заблокировавшего', 'not_found', 'Публикация удалена или скрыта');
  expect(await report(A, 'user', B.me.id, 'spam'), 404, 'жалоба на заблокировавшего', 'not_found', 'Профиль не найден');
  assert.deepEqual(expect(await report(B, 'user', A.me.id, 'spam'), 200, 'жалоба на того, кого сам заблокировал'),
    { reported: true, hidden: false });
  expect(await call(A.jar, 'GET', `/api/social/users/${B.me.username}`), 404, 'профиль заблокировавшего', 'not_found', 'Профиль не найден');
  prof = expect(await call(B.jar, 'GET', `/api/social/users/${A.me.username}`), 200, 'профиль заблокированного');
  assert.equal(prof.user.relation, 'blocked');
  assert.equal(prof.user.bio, '');
  assert.equal(prof.user.links, null);
  assert.equal(prof.user.linksHidden, null);
  assert.equal(prof.user.canFriend, false);
  assert.deepEqual(prof.posts, []);
  assert.equal(prof.next, null);
  assert.deepEqual(expect(await call(B.jar, 'GET', `/api/social/users/${A.me.username}/posts`), 200, 'посты заблокированного'), { items: [], next: null });
  let blocks = expect(await call(B.jar, 'GET', '/api/social/blocks'), 200, 'мои блокировки');
  assert.ok(blocks.items.some((u) => u.id === A.me.id));
  r = await call(A.jar, 'POST', `/api/social/friends/${B.me.id}`, { json: {}, headers: W });
  expect(r, 403, 'заявка при блокировке', 'blocked', 'Нельзя добавить этого пользователя');
  let fr = expect(await call(A.jar, 'GET', '/api/social/friends'), 200, 'друзья A');
  assert.ok(!fr.friends.some((u) => u.id === B.me.id), 'блокировка удалила дружбу');
  let found = expect(await call(A.jar, 'POST', '/api/social/users/search', { json: { q: B.me.username }, headers: W }), 200, 'поиск B');
  assert.ok(!found.items.some((u) => u.id === B.me.id), 'заблокировавший не находится');
  expect(await thread(boss.jar, pb.id), 200, 'модератору блокировки не мешают');
  assert.deepEqual(expect(await call(B.jar, 'DELETE', `/api/social/blocks/${A.me.id}`, { json: {}, headers: W }), 200, 'разблок'), { relation: 'none' });
  assert.ok((await feedIds(A.jar)).includes(pb.id), 'после разблокировки видно');
  ok('V3 блокировка в обе стороны: лента, ветка, ответ (403 blocked), лайк, профиль (404 / blocked), поиск, друзья; модератору видно');

  // ── Друзья ──
  const fpost = (u, id, path = '') => call(u.jar, 'POST', `/api/social/friends/${id}${path}`, { json: {}, headers: W });
  bad(await fpost(A, A.me.id), 'друг сам себе', 'Нельзя добавить в друзья себя');
  expect(await fpost(A, 999999999), 404, 'друг несуществующий', 'not_found', 'Профиль не найден');
  bad(await fpost(A, 'abc'), 'кривой id');
  assert.equal(expect(await call(A.jar, 'GET', `/api/social/users/${F.me.username}`), 200, 'профиль F').user.canFriend, true);
  expect(await call(F.jar, 'PATCH', '/api/social/me', { json: { friendRequests: 'none' }, headers: W }), 200, '«никто» от старой версии');
  assert.equal((await meOf(F.jar)).privacy.friendRequests, 'all', '«никто» не сохраняется');
  assert.deepEqual(expect(await fpost(A, F.me.id), 200, 'заявка 16–17 летнему'), { relation: 'outgoing' });
  expect(await call(A.jar, 'DELETE', `/api/social/friends/${F.me.id}`, { json: {}, headers: W }), 200, 'отмена заявки F');
  const notOnboarded = await login(`sm_${RUN}_n`);
  expect(await fpost(A, notOnboarded.me.id), 403, 'заявка без профиля', 'blocked', 'Нельзя добавить этого пользователя');
  assert.deepEqual(expect(await fpost(A, B.me.id), 200, 'заявка'), { relation: 'outgoing' });
  assert.deepEqual(expect(await fpost(A, B.me.id), 200, 'заявка снова'), { relation: 'outgoing' });
  assert.equal((await meOf(B.jar)).requestsIn, 1);
  fr = expect(await call(B.jar, 'GET', '/api/social/friends'), 200, 'списки B');
  assert.ok(fr.incoming.some((u) => u.id === A.me.id && u.since));
  assert.equal(expect(await call(B.jar, 'GET', `/api/social/users/${A.me.username}`), 200, 'профиль A для B').user.relation, 'incoming');
  assert.equal(expect(await call(A.jar, 'GET', `/api/social/users/${B.me.username}`), 200, 'профиль B для A').user.relation, 'outgoing');
  assert.deepEqual(expect(await fpost(B, A.me.id, '/accept'), 200, 'принять'), { relation: 'friends' });
  assert.deepEqual(expect(await fpost(B, A.me.id, '/accept'), 200, 'принять снова'), { relation: 'friends' });
  prof = expect(await call(B.jar, 'GET', `/api/social/users/${A.me.username}`), 200, 'профиль друга');
  assert.equal(prof.user.relation, 'friends');
  assert.deepEqual(prof.user.links, { tg: 'alice_tg', ig: 'alice.ig' });
  assert.equal(prof.user.counts.friends, 1);
  prof = expect(await call(D.jar, 'GET', `/api/social/users/${A.me.username}`), 200, 'профиль не друга');
  assert.equal(prof.user.links, null);
  assert.equal(prof.user.linksHidden, 'friends');
  assert.equal(prof.user.canFriend, true);
  assert.equal(prof.user.since, A.me.createdAt.slice(0, 7));
  expect(await call(A.jar, 'PATCH', '/api/social/me', { json: { linksVisibility: 'signed' }, headers: W }), 200, 'контакты всем вошедшим');
  assert.deepEqual(expect(await call(D.jar, 'GET', `/api/social/users/${A.me.username}`), 200, 'профиль не друга 2').user.links,
    { tg: 'alice_tg', ig: 'alice.ig' });
  assert.equal((await meOf(A.jar)).counts.friends, 1);
  // Встречные заявки → сразу дружба; отказ; отмена; удаление.
  expect(await fpost(D, A.me.id), 200, 'D → A');
  assert.deepEqual(expect(await fpost(A, D.me.id), 200, 'A → D при встречной'), { relation: 'friends' });
  expect(await fpost(E, A.me.id), 200, 'E → A');
  assert.deepEqual(expect(await fpost(A, E.me.id, '/decline'), 200, 'отказ'), { relation: 'none' });
  assert.deepEqual(expect(await fpost(A, E.me.id, '/decline'), 200, 'отказ снова'), { relation: 'none' });
  expect(await fpost(A, E.me.id, '/accept'), 404, 'принять несуществующую', 'not_found', 'Заявка не найдена');
  expect(await fpost(G, A.me.id), 200, 'G → A');
  assert.deepEqual(expect(await call(G.jar, 'DELETE', `/api/social/friends/${A.me.id}`, { json: {}, headers: W }), 200, 'отмена заявки'), { relation: 'none' });
  assert.deepEqual(expect(await call(A.jar, 'DELETE', `/api/social/friends/${B.me.id}`, { json: {}, headers: W }), 200, 'удалить из друзей'), { relation: 'none' });
  fr = expect(await call(A.jar, 'GET', '/api/social/friends'), 200, 'списки A');
  assert.deepEqual(fr.friends.map((u) => u.id), [D.me.id]);
  assert.deepEqual(fr.incoming, []);
  assert.deepEqual(fr.outgoing, []);
  ok('друзья: заявка, входящие (requestsIn), принять, контакты по настройке, встречные, отказ, отмена, удаление, «никто»');

  // ── Поиск ──
  const search = (u, q) => call(u.jar, 'POST', '/api/social/users/search', { json: { q }, headers: W });
  bad(await search(B, 'a'), 'короткий запрос', 'Введи хотя бы 2 символа', 'q');
  bad(await search(B, ' @ '), 'пустой запрос', 'Введи хотя бы 2 символа', 'q');
  found = expect(await search(B, '@' + A.me.username), 200, 'поиск по @имени');
  assert.equal(found.items[0].username, A.me.username);
  assert.equal(found.items[0].uni, UNI);
  found = expect(await search(B, `АЛИСА ${RUN}`), 200, 'поиск по имени');
  assert.ok(found.items.some((u) => u.id === A.me.id));
  found = expect(await search(B, `семен ${RUN}`), 200, 'поиск: ё = е');
  assert.ok(found.items.some((u) => u.id === D.me.id));
  found = expect(await search(B, `мия ${RUN}`), 200, 'несовершеннолетний не ищется по имени');
  assert.ok(!found.items.some((u) => u.id === F.me.id));
  found = expect(await search(B, F.me.username.slice(0, -1)), 200, 'и по началу @имени');
  assert.ok(!found.items.some((u) => u.id === F.me.id));
  found = expect(await search(B, F.me.username), 200, 'по точному @имени — находится');
  assert.ok(found.items.some((u) => u.id === F.me.id));
  found = expect(await search(B, `sm_${RUN}_`), 200, 'подчёркивание не шаблон');
  assert.ok(found.items.every((u) => u.username.startsWith(`sm_${RUN}_`)));
  assert.ok(!found.items.some((u) => u.id === B.me.id), 'себя не находит');
  found = expect(await search(B, '%%'), 200, 'процент не шаблон');
  assert.ok(found.items.length <= 20);
  ok('поиск: POST, от 2 символов, @имя и имя (регистр, ё), searchable=false — только точное @имя, без себя');

  // ── Профиль (#22) и его публикации по курсору (#23) ──
  const pp = expect(await call(B.jar, 'GET', `/api/social/users/${A.me.username}`), 200, 'профиль A для B');
  assert.deepEqual(Object.keys(pp).sort(), ['next', 'posts', 'user']);
  assert.deepEqual(Object.keys(pp.user).sort(), ['avatar', 'avatarFull', 'badge', 'banned', 'bio', 'canFriend', 'counts', 'id',
    'links', 'linksHidden', 'name', 'relation', 'since', 'team', 'uni', 'uniShort', 'username'].sort());
  assert.ok(pp.posts.length > 0 && pp.posts.length <= 10, 'первые 10 публикаций');
  assert.ok(pp.posts.every((p, i, a) => p.rootId === null && !p.deleted && (i === 0 || a[i - 1].id > p.id)), 'только публикации, новые сверху');
  assert.equal(pp.user.counts.posts >= pp.posts.length, true);
  let ppg = expect(await call(B.jar, 'GET', `/api/social/users/${A.me.username}/posts`), 200, 'публикации A');
  assert.deepEqual(ppg.items.map((p) => p.id), pp.posts.map((p) => p.id).concat(ppg.items.slice(pp.posts.length).map((p) => p.id)));
  ppg = expect(await call(B.jar, 'GET', `/api/social/users/${A.me.username}/posts?cursor=${pp.posts[0].id}`), 200, 'публикации A по курсору');
  assert.ok(ppg.items.every((p) => p.id < pp.posts[0].id), 'курсор: только старше');
  if (pp.posts.length > 1) assert.equal(ppg.items[0].id, pp.posts[1].id, 'курсор: следующая после первой');
  bad(await call(B.jar, 'GET', `/api/social/users/${A.me.username}/posts?cursor=abc`), 'кривой курсор');
  expect(await call(B.jar, 'GET', `/api/social/users/nobody_${RUN}/posts`), 404, 'публикации несуществующего', 'not_found', 'Профиль не найден');
  expect(await call(guest, 'GET', `/api/social/users/${A.me.username}/posts`), 401, 'гостю публикации профиля', 'auth');
  ok('профиль: форма UserProfile, первые 10 публикаций; #23 по курсору, кривой курсор → 400, гостю → 401');

  // ── @имя: раз в 30 дней и удержание ──
  const oldH = H.me.username;
  me = expect(await call(H.jar, 'PATCH', '/api/social/me', { json: { username: `sm_${RUN}_h2` }, headers: W }), 200, 'сменить @имя');
  assert.equal(me.username, `sm_${RUN}_h2`);
  if (me.usernameNextChange) {
    r = await call(H.jar, 'PATCH', '/api/social/me', { json: { username: `sm_${RUN}_h3` }, headers: W });
    bad(r, 'второй раз', 'Имя пользователя можно менять раз в 30 дней', 'username');
    assert.deepEqual(await avail(H.jar, `sm_${RUN}_h3`), { available: false, error: 'Имя пользователя можно менять раз в 30 дней' });
    ok('@имя: второй раз за 30 дней — нельзя (usernameNextChange задан)');
  } else {
    console.log('     (окно нового аккаунта включено: смена @имени свободна — правило 30 дней проверяет прогон с SOCIAL_NEW_ACCOUNT_H=0)');
  }
  assert.deepEqual(await avail(B.jar, oldH), { available: false, error: 'Это имя уже занято' });
  r = await call(G.jar, 'PATCH', '/api/social/me', { json: { username: oldH }, headers: W });
  expect(r, 409, 'удержанное имя', 'conflict', 'Это имя уже занято');
  expect(await call(B.jar, 'GET', `/api/social/users/${oldH}`), 404, 'старое @имя не открывается');
  expect(await call(B.jar, 'GET', `/api/social/users/${me.username.toUpperCase()}`), 200, 'профиль без учёта регистра');
  ok('@имя: старое удерживается 30 дней (занято для других), профиль ищется без учёта регистра');

  // ── Удаление поста: «надгробие» (V5, V6) ──
  expect(await call(B.jar, 'DELETE', `/api/social/posts/${p1.id}`, { json: {}, headers: W }), 403, 'удалить чужое', 'forbidden', 'Недостаточно прав');
  expect(await call(A.jar, 'DELETE', `/api/social/posts/${p3.id}`, { json: {}, headers: W }), 200, 'удалить своё без ответов');
  expect(await thread(A.jar, p3.id), 404, 'без ответов — удалено совсем');
  expect(await call(A.jar, 'DELETE', `/api/social/posts/${p3.id}`, { json: {}, headers: W }), 404, 'удалить второй раз', 'not_found');
  // Ответ B, на который ответила A → «надгробие»; потом ответ A удаляется → надгробие уходит.
  expect(await call(B.jar, 'DELETE', `/api/social/posts/${rb.id}`, { json: {}, headers: W }), 200, 'удалить ответ с ответами');
  th = expect(await thread(C.jar, p1.id), 200, 'ветка после удаления ответа');
  const tomb = th.replies.find((x) => x.id === rb.id);
  assert.deepEqual([tomb.deleted, tomb.text, tomb.author, tomb.media.length, tomb.canDelete], [true, '', null, 0, false], 'V6');
  assert.deepEqual(th.replies.find((x) => x.id === ra.id).replyTo, { id: rb.id, username: null }, 'в ответ на удалённое');
  assert.equal(th.post.replies, 3);
  expect(await call(A.jar, 'DELETE', `/api/social/posts/${ra.id}`, { json: {}, headers: W }), 200, 'удалить ответ без ответов');
  th = expect(await thread(C.jar, p1.id), 200, 'ветка 2');
  assert.ok(!th.replies.some((x) => x.id === rb.id || x.id === ra.id), 'надгробие без ссылок убрано');
  assert.equal(th.post.replies, 2);
  expect(await call(A.jar, 'DELETE', `/api/social/posts/${p1.id}`, { json: {}, headers: W }), 200, 'удалить публикацию с ответами');
  th = expect(await thread(C.jar, p1.id), 200, 'V5: ветка с «надгробием»');
  assert.deepEqual([th.post.deleted, th.post.text, th.post.author, th.post.media, th.post.likes, th.post.hidden], [true, '', null, [], 0, false]);
  assert.ok(th.replies.some((x) => x.id === rr.id), 'ответы остались');
  assert.ok(!(await feedIds(C.jar)).includes(p1.id), '«надгробие» не в ленте');
  expect(await call(guest, 'GET', m1.url), 404, 'фото удалённой публикации');
  expect(await call(guest, 'GET', t1.thumb), 404, 'миниатюра удалённой публикации');
  expect(await call(C.jar, 'POST', `/api/social/posts/${p1.id}/replies`, { json: { text: 'x' }, headers: W }), 404, 'ответ «надгробию»', 'not_found');
  expect(await like(C, p1.id, true), 404, 'лайк «надгробию»');
  ok('удаление: без ответов — совсем, с ответами — «Пост удалён»/«Ответ удалён», фото удаляются, чужое — 403');

  // ── Удаление аккаунта ──
  const gRenamed = expect(await call(G.jar, 'PATCH', '/api/social/me', { json: { username: `sm_${RUN}_g2` }, headers: W }), 200,
    'G сменил @имя (запись profile.username)');
  G.me = gRenamed;
  const mg = await uploadPhoto(G);
  const pg = await post(G, `Мой пост · ${RUN}`, 'other', [mg.id]);
  const rbg = await reply(B, pg.id, `Ответ под постом G · ${RUN}`);
  const rg = await reply(G, h3.id, `Ответ G · ${RUN}`);
  await like(G, pb.id, true);
  const pbLikes = expect(await thread(B.jar, pb.id), 200, 'лайки до').post.likes;
  expect(await report(G, 'post', pb.id, 'spam'), 200, 'жалоба G');
  expect(await report(B, 'user', G.me.id, 'impersonation', 'выдаёт себя за старосту'), 200, 'жалоба на G');
  const gName = G.me.username;
  bad(await call(G.jar, 'DELETE', '/api/social/me', { json: {}, headers: W }), 'удаление без подтверждения', 'Подтверди удаление аккаунта', 'confirm');
  bad(await call(G.jar, 'DELETE', '/api/social/me', { json: { confirm: 'yes' }, headers: W }), 'подтверждение не true', undefined, 'confirm');
  r = await call(G.jar, 'DELETE', '/api/social/me', { json: { confirm: true }, headers: W });
  expect(r, 200, 'удаление аккаунта');
  assert.ok([].concat(r.headers['set-cookie'] || []).some((c) => /para_sid=;/.test(c) && /Max-Age=0/.test(c)), 'кука стёрта');
  assert.equal(await meOf(G.jar), null);
  expect(await call(B.jar, 'GET', mg.url), 404, 'фото удалённого аккаунта');
  expect(await call(B.jar, 'GET', `/api/media/${mg.id}_t.jpg`), 404, 'миниатюра удалённого аккаунта');
  th = expect(await thread(B.jar, pg.id), 200, 'ветка удалённого аккаунта');
  assert.deepEqual([th.post.deleted, th.post.author, th.post.text], [true, null, '']);
  assert.ok(th.replies.some((x) => x.id === rbg.id), 'чужие ответы остались');
  assert.ok(!expect(await thread(B.jar, h3.id), 200, 'ветка H').replies.some((x) => x.id === rg.id), 'ответ удалённого — удалён');
  assert.equal(expect(await thread(B.jar, pb.id), 200, 'лайки после').post.likes, pbLikes - 1, 'лайк удалённого снят');
  assert.deepEqual(await avail(B.jar, gName), { available: false, error: 'Это имя уже занято' });
  expect(await call(B.jar, 'GET', `/api/social/users/${gName}`), 404, 'профиль удалённого');
  r = await call(new Map(), 'POST', '/api/auth/dev', { json: { name: `sm_${RUN}_g`, intent: 'delete' }, headers: W });
  expect(r, 404, 'intent=delete после удаления', 'not_found');
  q = await allCases(boss, 'open');
  const gcase = caseOf(q, 'u:' + G.me.id);
  assert.ok(gcase && gcase.user === null && gcase.snapshot.kind === 'user' && gcase.snapshot.username === gName, 'жалоба на удалённого со снимком');
  assert.equal(caseOf(q, 'p:' + pb.id).reporters, 1, 'жалоба удалённого жалобщика осталась (обезличена)');
  let gAudit = [];
  for (let cur = null, i = 0; i < 20; i++) {
    const a = expect(await call(boss.jar, 'GET', '/api/social/admin/audit' + (cur ? '?cursor=' + cur : '')), 200, 'журнал');
    gAudit = gAudit.concat(a.items.filter((x) => x.actor && x.actor.id === G.me.id));
    cur = a.next;
    if (!cur) break;
  }
  assert.deepEqual(gAudit.map((x) => x.action), ['account.delete'], 'смены @имени удалённого ушли из журнала вместе с аккаунтом');
  ok('удаление аккаунта: подтверждение, кука, фото 404, «надгробие» с чужими ответами, лайки, @имя удерживается, жалобы обезличены, свои записи журнала удалены');

  // Бан переживает удаление и повторный вход.
  const Z = await user('z', `Зафар ${RUN}`);
  expect(await admin(boss, { action: 'ban', target: { type: 'user', id: Z.me.id }, days: 30, reason: 'Спам' }), 200, 'бан Z');
  expect(await call(Z.jar, 'DELETE', '/api/social/me', { json: { confirm: true }, headers: W }), 200, 'ограниченный удаляет аккаунт');
  const Z2 = await login(`sm_${RUN}_z`);
  assert.equal(Z2.me.banned && Z2.me.banned.reason, 'Спам', 'ограничение вернулось после удаления и входа');
  ok('ограничение не снимается удалением аккаунта и повторным входом (ban_marks)');

  // ── Журнал, сводка, выход ──
  let items = [];
  let cur = null;
  for (let i = 0; i < 20; i++) {
    const a = expect(await call(boss.jar, 'GET', '/api/social/admin/audit' + (cur ? '?cursor=' + cur : '')), 200, 'журнал');
    items = items.concat(a.items);
    cur = a.next;
    if (!cur) break;
  }
  const actions = new Set(items.map((x) => x.action));
  for (const a of ['account.delete', 'profile.username', 'post.hide.auto', 'post.hide.admin', 'post.unhide',
    'post.delete', 'report.dismiss', 'user.ban', 'user.unban', 'user.reset']) assert.ok(actions.has(a), 'в журнале нет ' + a);
  assert.ok(!actions.has('auth.login'), 'входы в журнал не пишутся');
  assert.ok(items.every((x) => typeof x.id === 'number' && x.ts && typeof x.info === 'object'));
  const auditText = JSON.stringify(items);
  assert.ok(!auditText.includes('@dev.local') && !auditText.includes('Реклама курсов'), 'в журнале нет почты и текстов');
  const stats = expect(await call(boss.jar, 'GET', '/api/social/admin/stats'), 200, 'сводка');
  for (const k of ['users', 'usersToday', 'postsToday', 'repliesToday', 'openReports', 'hiddenPosts', 'bannedUsers', 'mediaBytes']) {
    assert.equal(typeof stats[k], 'number', 'сводка: ' + k);
  }
  assert.ok(stats.users > 0 && stats.mediaBytes > 0 && stats.bannedUsers >= 1);
  ok('журнал (все действия, без почты и текстов) и сводка модератора');

  // ── Моменты: для всех (по умолчанию) и только друзьям, сутки, реакции, архив, фото не публичное, жалоба, удаление ──
  const I1 = await user('i1', `Момент ${RUN}`);
  const I2 = await user('i2', `Друг ${RUN}`);
  const I3 = await user('i3', `Чужой ${RUN}`);
  expect(await call(I1.jar, 'POST', `/api/social/friends/${I2.me.id}`, { json: {}, headers: W }), 200, 'заявка в друзья');
  expect(await call(I2.jar, 'POST', `/api/social/friends/${I1.me.id}/accept`, { json: {}, headers: W }), 200, 'принять заявку');
  const im = await uploadPhoto(I1, { full: makeJpeg(1080, 1080, SCENES.sunset), thumb: makeJpeg(640, 640, SCENES.sunset) });
  const momentA = expect(await call(I1.jar, 'POST', '/api/social/instants', { json: { media: im.id, audience: 'friends' }, headers: W }),
    201, 'момент друзьям');
  assert.ok(momentA.id && momentA.active && momentA.media && momentA.views === 0 && momentA.audience === 'friends');
  bad(await call(I1.jar, 'POST', '/api/social/instants', { json: { media: im.id }, headers: W }), 'то же фото второй раз',
    'Фото не найдено — сними момент ещё раз', 'media');
  bad(await call(I1.jar, 'POST', '/api/social/posts', { json: { text: 'x', category: 'other', media: [im.id] }, headers: W }),
    'фото момента в пост', undefined, 'media');
  const feed2 = expect(await call(I2.jar, 'GET', '/api/social/instants'), 200, 'моменты друзей');
  const g = feed2.groups.find((x) => x.author.id === I1.me.id);
  assert.ok(g && g.unseen === 1 && g.items[0].id === momentA.id, 'друг видит момент');
  const feed3 = expect(await call(I3.jar, 'GET', '/api/social/instants'), 200, 'моменты чужого');
  assert.ok(!feed3.groups.some((x) => x.author.id === I1.me.id), 'не друг момент не видит');
  expect(await call(I2.jar, 'GET', `/api/media/${im.id}.jpg`, { uni: '' }), 200, 'фото момента другу');
  expect(await call(I3.jar, 'GET', `/api/media/${im.id}.jpg`, { uni: '' }), 404, 'фото момента чужому');
  expect(await call(guest, 'GET', `/api/media/${im.id}.jpg`, { uni: '' }), 404, 'фото момента гостю');
  const imHead = await call(I2.jar, 'GET', `/api/media/${im.id}.jpg`, { uni: '' });
  assert.match(imHead.headers['cache-control'] || '', /private/, 'фото момента не кешируется публично');
  expect(await call(I2.jar, 'POST', `/api/social/instants/${momentA.id}/view`, { json: {}, headers: W }), 200, 'просмотр');
  bad(await call(I2.jar, 'POST', `/api/social/instants/${momentA.id}/react`, { json: { emoji: '💩' }, headers: W }),
    'чужая реакция', 'Такой реакции нет', 'emoji');
  expect(await call(I2.jar, 'POST', `/api/social/instants/${momentA.id}/react`, { json: { emoji: '🔥' }, headers: W }), 200, 'реакция');
  expect(await call(I3.jar, 'POST', `/api/social/instants/${momentA.id}/react`, { json: { emoji: '🔥' }, headers: W }), 404, 'реакция чужого');
  const seenFeed = expect(await call(I2.jar, 'GET', '/api/social/instants'), 200, 'моменты после просмотра');
  const g2 = seenFeed.groups.find((x) => x.author.id === I1.me.id);
  assert.ok(g2.unseen === 0 && g2.items[0].seen && g2.items[0].reaction === '🔥');
  const archive = expect(await call(I1.jar, 'GET', '/api/social/instants/mine'), 200, 'архив');
  const a0 = archive.items.find((x) => x.id === momentA.id);
  assert.ok(a0 && a0.views === 1 && a0.reactions[0].emoji === '🔥' && a0.reactions[0].count === 1, 'в архиве просмотры и реакции');
  const det = expect(await call(I1.jar, 'GET', `/api/social/instants/${momentA.id}`), 200, 'момент автору');
  assert.ok(det.viewers.length === 1 && det.viewers[0].user.id === I2.me.id && det.viewers[0].reaction === '🔥');
  const detFriend = expect(await call(I2.jar, 'GET', `/api/social/instants/${momentA.id}`), 200, 'момент другу');
  assert.ok(!('viewers' in detFriend), 'друг не видит, кто ещё смотрел');
  ok('моменты друзьям: только друзья, фото не публичное, просмотры, реакции, архив автора');

  // По умолчанию момент — для всех: его видят вошедшие в ленте моментов того же вуза (друзья — всегда первыми).
  const imAll = await uploadPhoto(I1, { full: makeJpeg(1080, 1080, SCENES.sea), thumb: makeJpeg(640, 640, SCENES.sea) });
  const imAll2 = await uploadPhoto(I1, { full: makeJpeg(1080, 1080, SCENES.sea), thumb: makeJpeg(640, 640, SCENES.sea) });
  bad(await call(I1.jar, 'POST', '/api/social/instants', { json: { media: imAll.id, audience: 'nobody' }, headers: W }),
    'кривая аудитория', 'Выбери, кто увидит момент', 'audience');
  const momentAll = expect(await call(I1.jar, 'POST', '/api/social/instants', { json: { media: imAll.id }, headers: W }), 201, 'момент всем');
  assert.equal(momentAll.audience, 'all', 'по умолчанию — для всех');
  let fAll = expect(await call(I3.jar, 'GET', '/api/social/instants'), 200, 'моменты вуза');
  let gAll = fAll.groups.find((x) => x.author.id === I1.me.id);
  assert.ok(gAll && gAll.friend === false && gAll.items.map((x) => x.id).join() === String(momentAll.id),
    'не друг видит момент для всех, но не момент для друзей');
  assert.ok(expect(await call(I2.jar, 'GET', '/api/social/instants'), 200, 'моменты друга').groups
    .find((x) => x.author.id === I1.me.id).items.length === 2, 'друг видит оба');
  assert.ok(!expect(await call(I3.jar, 'GET', '/api/social/instants', { uni: 'tsue' }), 200, 'моменты другого вуза').groups
    .some((x) => x.author.id === I1.me.id), 'в другом вузе момент для всех не виден');
  expect(await call(I3.jar, 'GET', `/api/media/${imAll.id}.jpg`, { uni: '' }), 200, 'фото момента для всех вошедшему');
  expect(await call(guest, 'GET', `/api/media/${imAll.id}.jpg`, { uni: '' }), 404, 'фото момента для всех гостю');
  expect(await call(I3.jar, 'POST', `/api/social/instants/${momentAll.id}/react`, { json: { emoji: '❤️' }, headers: W }), 200, 'реакция не друга');
  expect(await call(I3.jar, 'PUT', `/api/social/blocks/${I1.me.id}`, { json: {}, headers: W }), 200, 'блок автора');
  fAll = expect(await call(I3.jar, 'GET', '/api/social/instants'), 200, 'моменты после блока');
  assert.ok(!fAll.groups.some((x) => x.author.id === I1.me.id), 'заблокированный автор не виден');
  expect(await call(I3.jar, 'GET', `/api/media/${imAll.id}.jpg`, { uni: '' }), 404, 'фото после блока');
  expect(await call(I3.jar, 'DELETE', `/api/social/blocks/${I1.me.id}`, { json: {}, headers: W }), 200, 'разблок автора');
  expect(await call(I1.jar, 'POST', '/api/social/instants', { json: { media: imAll2.id, audience: 'all' }, headers: W }), 201, 'момент всем 2');
  const mineAll = expect(await call(I1.jar, 'GET', '/api/social/instants/mine'), 200, 'архив');
  assert.equal(mineAll.items.find((x) => x.id === momentAll.id).audience, 'all');
  ok('моменты для всех: по умолчанию, лента вуза (не другого), фото вошедшим, не гостям, блокировка');

  // Жалоба друга «сексуальное» ×1 не скрывает, модератор видит дело с фото и удаляет момент.
  const rep1 = expect(await report(I2, 'instant', momentA.id, 'sexual'), 200, 'жалоба на момент');
  assert.equal(rep1.reported, true);
  expect(await report(I3, 'instant', momentA.id, 'spam'), 404, 'жалоба чужого на момент');
  const iq = expect(await call(boss.jar, 'GET', '/api/social/admin/reports?status=open'), 200, 'очередь');
  const c = iq.items.find((x) => x.key === 'i:' + momentA.id);
  assert.ok(c && c.target.type === 'instant' && c.snapshot.kind === 'instant' && c.snapshot.media.length === 1, 'дело по моменту с фото');
  expect(await call(boss.jar, 'GET', `/api/media/${im.id}.jpg`, { uni: '' }), 200, 'фото момента модератору');
  expect(await call(boss.jar, 'POST', '/api/social/admin/action', { json: { action: 'delete', target: { type: 'instant', id: momentA.id } }, headers: W }),
    200, 'удаление момента модератором');
  expect(await call(I2.jar, 'GET', `/api/media/${im.id}.jpg`, { uni: '' }), 404, 'фото удалённого момента');
  const after = expect(await call(I1.jar, 'GET', '/api/social/instants/mine'), 200, 'архив после удаления');
  assert.ok(!after.items.some((x) => x.id === momentA.id));
  // Свой момент автор удаляет сам.
  const im2 = await uploadPhoto(I1, { full: makeJpeg(1080, 1080, SCENES.sunset), thumb: makeJpeg(640, 640, SCENES.sunset) });
  const momentB = expect(await call(I1.jar, 'POST', '/api/social/instants', { json: { media: im2.id }, headers: W }), 201, 'момент 2');
  expect(await call(I2.jar, 'DELETE', `/api/social/instants/${momentB.id}`, { json: {}, headers: W }), 404, 'чужой момент не удалить');
  expect(await call(I1.jar, 'DELETE', `/api/social/instants/${momentB.id}`, { json: {}, headers: W }), 200, 'удалить свой момент');
  ok('моменты: жалоба, дело в очереди с фото, удаление модератором и автором');

  // Пользователи в админке: только модератору; почта, возраст, данные входа — да, Google ID — никогда.
  expect(await call(guest, 'GET', '/api/social/admin/users'), 401, 'пользователи гостю', 'auth');
  expect(await call(B.jar, 'GET', '/api/social/admin/users'), 403, 'пользователи не модератору', 'forbidden');
  const users = expect(await call(boss.jar, 'GET', '/api/social/admin/users'), 200, 'пользователи');
  assert.ok(users.items.length > 0 && users.stats && users.stats.total >= users.items.length);
  for (const k of ['total', 'today', 'week', 'active', 'noProfile', 'banned']) assert.equal(typeof users.stats[k], 'number', 'сводка: ' + k);
  const usersText = JSON.stringify(users);
  assert.ok(!usersText.includes('dev:') && !usersText.includes('google_sub') && !usersText.includes('token'),
    'в админке нет Google ID и ключей входа');
  const u0 = users.items[0];
  assert.deepEqual(Object.keys(u0.counts).sort(), ['friends', 'likes', 'posts', 'replies']);
  assert.ok(users.items.every((x, i, a) => i === 0 || a[i - 1].id > x.id), 'новые сверху');
  const aNow = await meOf(A.jar);
  const foundU = expect(await call(boss.jar, 'GET', `/api/social/admin/users?q=${encodeURIComponent('@' + aNow.username)}`), 200, 'поиск');
  const aRow = foundU.items.find((x) => x.id === aNow.id);
  assert.ok(aRow && foundU.stats === null, 'поиск по @имени, без сводки');
  assert.match(aRow.email, /@dev\.local$/, 'почта видна модератору');
  assert.ok(['adult', 'minor'].includes(aRow.age) && aRow.loginCount >= 1 && aRow.signup.host === HUB, 'возраст, входы, адрес');
  assert.ok(Array.isArray(aRow.devices) && typeof aRow.sessions === 'number' && 'google' in aRow);
  const byMail = expect(await call(boss.jar, 'GET', `/api/social/admin/users?q=${encodeURIComponent(aRow.email)}`), 200, 'поиск по почте');
  assert.ok(byMail.items.some((x) => x.id === aNow.id), 'поиск по почте');
  expect(await call(boss.jar, 'GET', '/api/social/admin/users?cursor=abc'), 400, 'кривой курсор', 'invalid');
  ok('админка «Пользователи»: только модератору; почта, возраст и входы видны, Google ID — нет; поиск и страницы');

  // Значки у имени: выдаёт только модератор (и себе тоже), видно всем в карточке и профиле, null — убрать.
  const badgeAct = (who, target, badge) => call(who.jar, 'POST', '/api/social/admin/action',
    { json: { action: 'badge', target, badge }, headers: W });
  expect(await badgeAct(B, { type: 'user', id: A.me.id }, 'crown'), 403, 'значок не модератором', 'forbidden');
  bad(await badgeAct(boss, { type: 'user', id: A.me.id }, 'unicorn'), 'неизвестный значок', undefined, 'badge');
  bad(await badgeAct(boss, { type: 'user', id: A.me.id }, undefined), 'значок без значения', undefined, 'badge');
  expect(await badgeAct(boss, { type: 'user', id: 999999999 }, 'star'), 404, 'значок несуществующему');
  expect(await badgeAct(boss, { type: 'user', id: A.me.id }, 'crown'), 200, 'значок «корона»');
  assert.equal(expect(await call(B.jar, 'GET', `/api/social/users/${A.me.username}`), 200, 'профиль со значком').user.badge, 'crown');
  assert.equal((await meOf(A.jar)).badge, 'crown', 'свой значок в Me');
  const aBadge = expect(await call(boss.jar, 'GET', `/api/social/admin/users?q=${encodeURIComponent('@' + aNow.username)}`), 200, 'админка');
  assert.equal(aBadge.items.find((x) => x.id === aNow.id).badge, 'crown');
  expect(await badgeAct(boss, { type: 'user', id: boss.me.id }, 'blue'), 200, 'значок себе');
  assert.equal((await meOf(boss.jar)).badge, 'blue');
  expect(await badgeAct(boss, { type: 'user', id: A.me.id }, null), 200, 'убрать значок');
  assert.equal(expect(await call(B.jar, 'GET', `/api/social/users/${A.me.username}`), 200, 'профиль без значка').user.badge, null);
  const badgeAudit = expect(await call(boss.jar, 'GET', '/api/social/admin/audit'), 200, 'журнал');
  assert.ok(badgeAudit.items.some((x) => x.action === 'user.badge'), 'значок в журнале');
  ok('значки: только модератор (и себе), видны в профиле, Me и админке, «убрать», журнал');

  const B2 = await login(`sm_${RUN}_b`);
  expect(await call(A.jar, 'POST', '/api/auth/logout', { json: {}, headers: W }), 200, 'выход');
  assert.equal(await meOf(A.jar), null);
  expect(await call(B.jar, 'POST', '/api/auth/logout', { json: { all: true }, headers: W }), 200, 'выход со всех устройств');
  assert.equal(await meOf(B2.jar), null, 'второе устройство тоже вышло');
  r = await call(new Map([[SID, 'x'.repeat(43)]]), 'GET', '/api/auth/me');
  assert.equal(r.json.data.user, null);
  assert.ok([].concat(r.headers['set-cookie'] || []).some((c) => /para_sid=;/.test(c)), 'неверная кука стёрта');
  ok('выход, выход со всех устройств, неверная кука стирается');

  // Страницы Para (если POLICY их уже положил) и robots.txt.
  r = await call(guest, 'GET', '/robots.txt', { uni: '' });
  expect(r, 200, 'robots.txt');
  assert.equal(r.buf.toString(), 'User-agent: *\nDisallow: /api/\n');
  const pages = [];
  for (const p of ['/policy', '/rules', '/delete-account']) pages.push(`${p} ${(await call(guest, 'GET', p, { uni: '' })).status}`);
  ok('robots.txt; страницы Para: ' + pages.join(', '));

  await runGame(st, boss, guest, limitsOn);
  await runLive(boss, guest);
  await runPush(guest);
  await runChat(boss, guest);
  if (!limitsOn) console.log('     внимание: прогон A должен идти с включёнными пределами (без SOCIAL_RATE_LIMITS=off)');
}

// ═══════════════ Уведомления, когда Para закрыта (CONTRACT.md §K) ═══════════════
// Поддельная служба push на 127.0.0.1 (вне production сервер шлёт и туда): принимает запросы, отвечает 201,
// на /gone/… — 410. Устройство — своя пара ключей P-256 и секрет; содержимое расшифровываем по RFC 8291.

async function pushService() {
  const got = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(req.url.startsWith('/gone/') ? 410 : 201).end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const count = (path) => got.filter((g) => g.path === path).length;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    count,
    /** Дождаться n-го (с 1) запроса на path. */
    async wait(path, n, ms = 5000) {
      const t = Date.now();
      while (count(path) < n) {
        if (Date.now() - t > ms) throw new Error(`push: не дождались ${n}-го уведомления на ${path} (есть ${count(path)})`);
        await sleep(40);
      }
      return got.filter((g) => g.path === path)[n - 1];
    },
    close: () => srv.close(),
  };
}

function pushDevice(svc, path) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const pub = ecdh.getPublicKey();
  const auth = randomBytes(16);
  return { ecdh, pub, auth, path, sub: { endpoint: svc.url(path), p256dh: pub.toString('base64url'), auth: auth.toString('base64url') } };
}

/** Расшифровать тело aes128gcm (RFC 8188 + RFC 8291) ключами устройства dev. */
function openPush(body, dev) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const rec = body.subarray(21 + idlen);
  const secret = dev.ecdh.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync('sha256', secret, dev.auth, Buffer.concat([Buffer.from('WebPush: info\0'), dev.pub, asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(rec.subarray(rec.length - 16));
  const plain = Buffer.concat([d.update(rec.subarray(0, rec.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  assert.equal(plain[end], 2, 'push: разделитель последней записи');
  return JSON.parse(plain.subarray(0, end).toString('utf8'));
}

const ALL_KINDS = ['sched', 'game', 'friends', 'replies'];
const pushSub = (jar, dev, extra = {}) =>
  call(jar, 'POST', '/api/social/push', { json: { ...dev.sub, group: null, kinds: ALL_KINDS, ...extra }, headers: W });

async function runPush(guest) {
  const svc = await pushService();
  let r;
  try {
    // 1. Ключ VAPID — гостю тоже: точка P-256 без сжатия (65 байт, 0x04).
    const key = expect(await call(guest, 'GET', '/api/social/push/key'), 200, 'push: ключ').key;
    const kb = Buffer.from(key, 'base64url');
    assert.ok(kb.length === 65 && kb[0] === 4, 'push: ключ VAPID — 65 байт с 0x04');
    ok('уведомления: GET /push/key — открытый ключ VAPID (гостю тоже)');

    // 2. Проверки подписки: CSRF, только службы push, ключи устройства ровно нужной длины.
    const g = pushDevice(svc, '/guest');
    r = await call(guest, 'POST', '/api/social/push', { json: g.sub });
    expect(r, 403, 'push без X-Para', 'csrf');
    bad(await pushSub(guest, { sub: { ...g.sub, endpoint: 'https://evil.example/push' } }), 'push: чужой адрес', undefined, 'endpoint');
    bad(await pushSub(guest, { sub: { ...g.sub, endpoint: 'http://10.0.0.1:8080/push' } }), 'push: внутренний адрес', undefined, 'endpoint');
    bad(await pushSub(guest, { sub: { ...g.sub, endpoint: 'https://fcm.googleapis.com:8443/x' } }), 'push: порт', undefined, 'endpoint');
    bad(await pushSub(guest, { sub: { ...g.sub, p256dh: g.sub.p256dh.slice(4) } }), 'push: короткий p256dh', undefined, 'p256dh');
    bad(await pushSub(guest, { sub: { ...g.sub, auth: randomBytes(12).toString('base64url') } }), 'push: auth не 16 байт', undefined, 'auth');
    expect(await pushSub(guest, g, { group: 'любая группа', kinds: ['sched', 'nonsense'] }), 200, 'push: гость подписался на пары');
    expect(await call(guest, 'POST', '/api/social/push/remove', { json: { endpoint: g.sub.endpoint }, headers: W }), 200, 'push: отписка');
    ok('уведомления: подписка — CSRF, только службы push (не чужой и не внутренний адрес, без порта), ключи 65/16 байт; гостю — пары; отписка');

    // 3. Заявка в друзья — второму на все его устройства; второй раз за 10 минут — нет; принятие — «Новый друг».
    const A = await user('pa', `Азиза ${RUN}`);
    const B = await user('pb', `Бобур ${RUN}`);
    const C = await user('pc', `Камола ${RUN}`);
    const D = await user('pd', `Дамир ${RUN}`);
    const dA = pushDevice(svc, '/a');
    const dB = pushDevice(svc, '/b');
    const dB2 = pushDevice(svc, '/gone/b2');
    expect(await pushSub(A.jar, dA), 200, 'push: устройство A');
    expect(await pushSub(B.jar, dB), 200, 'push: устройство B');
    expect(await pushSub(B.jar, dB2), 200, 'push: второе устройство B (служба ответит 410)');
    const fr = (u, id, path = '', method = 'POST') => call(u.jar, method, `/api/social/friends/${id}${path}`, { json: {}, headers: W });
    expect(await fr(B, A.me.id), 200, 'заявка B→A');
    let m = await svc.wait('/a', 1);
    assert.equal(m.headers['content-encoding'], 'aes128gcm');
    assert.equal(m.headers.ttl, '86400');
    assert.equal(m.headers.topic, 'f' + B.me.id);
    assert.match(m.headers.authorization || '', new RegExp('^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=' + key + '$'));
    let n = openPush(m.body, dA);
    assert.deepEqual(n, { t: 'Заявка в друзья', b: `Бобур ${RUN} хочет добавить тебя в друзья`,
      u: `/?uni=${UNI}&user=${B.me.username}`, g: 'friend-' + B.me.id }, 'push: заявка');
    expect(await fr(B, A.me.id, '', 'DELETE'), 200, 'B отменил заявку');
    expect(await fr(B, A.me.id), 200, 'заявка B→A снова');
    await sleep(500);
    assert.equal(svc.count('/a'), 1, 'push: повторная заявка за 10 минут — без уведомления');
    expect(await fr(A, B.me.id, '/accept'), 200, 'A принимает');
    m = await svc.wait('/b', 1);
    n = openPush(m.body, dB);
    assert.equal(n.t, 'Новый друг');
    assert.equal(n.b, `Азиза ${RUN} теперь в друзьях`);
    await svc.wait('/gone/b2', 1);
    ok('уведомления: заявка → «Заявка в друзья» (aes128gcm, TTL сутки, Topic, VAPID с ключом сервера, ссылка с uni на профиль); повтор за 10 мин — нет; принятие → «Новый друг»');

    // 4. Ответы: приложение открыто (живой поток) — не шлём; закрыто — «Новый ответ» с текстом и ссылкой на ветку.
    const p1 = await post(A, `Пост для уведомлений ${RUN}`);
    const [sA] = await lives(A);
    await reply(B, p1.id, 'Ответ, пока приложение открыто');
    await sleep(500);
    assert.equal(svc.count('/a'), 1, 'push: пока приложение открыто — без уведомления');
    sA.close();
    await sleep(300);
    await reply(C, p1.id, 'Ответ, когда приложение закрыто');
    m = await svc.wait('/a', 2);
    n = openPush(m.body, dA);
    assert.deepEqual(n, { t: 'Новый ответ', b: `Камола ${RUN}: Ответ, когда приложение закрыто`,
      u: `/?uni=${UNI}&post=${p1.id}`, g: 'reply-' + p1.id }, 'push: ответ');
    // Ответ на ответ A в чужой ветке — A (автору ответа) и B (автору публикации).
    const bp = await post(B, `Ветка B ${RUN}`);
    const nb = svc.count('/b');
    const ra = await reply(A, bp.id, 'Ответ A в ветке B');
    m = await svc.wait('/b', nb + 1);
    assert.equal(openPush(m.body, dB).u, `/?uni=${UNI}&post=${bp.id}`);
    await reply(D, bp.id, 'Ответ на ответ A', { replyTo: ra.id });
    m = await svc.wait('/a', 3);
    assert.equal(openPush(m.body, dA).b, `Дамир ${RUN}: Ответ на ответ A`);
    await sleep(300);
    assert.equal(svc.count('/b'), nb + 1, 'push: второй ответ в той же ветке за 30 с — без уведомления');
    ok('уведомления: ответ — пока приложение открыто, нет; закрыто — «Новый ответ» (имя: текст, ссылка на ветку); ответ на ответ — автору ответа; автору публикации — не чаще раза в 30 с на ветку');

    // 5. Приглашение в покер — срочное, живёт 10 минут. Служба ответила 410 — подписку забыли (больше туда не шлём).
    expect(await call(A.jar, 'POST', '/api/social/games/invite', { json: { to: B.me.id }, headers: W }), 200, 'A зовёт B в покер');
    m = await svc.wait('/b', svc.count('/b') + 1);
    assert.equal(m.headers.urgency, 'high');
    assert.equal(m.headers.ttl, '600');
    assert.deepEqual(openPush(m.body, dB), { t: 'Покер', b: `Азиза ${RUN} зовёт тебя за стол`, u: `/?uni=${UNI}&game=1`, g: 'game' });
    await sleep(300);
    assert.equal(svc.count('/gone/b2'), 1, 'push: после 410 подписка забыта');
    ok('уведомления: приглашение в покер — Urgency high, TTL 10 мин, ссылка на стол; после 410 устройство больше не получает');

    // 6. Переключатели: без «Ответов» — не шлём; включил снова — шлём. Выход — личное больше не приходит.
    const p2 = await post(A, `Второй пост ${RUN}`);
    const p3 = await post(A, `Третий пост ${RUN}`);
    expect(await pushSub(A.jar, dA, { kinds: ['sched', 'game', 'friends'] }), 200, 'push: A выключил ответы');
    const na = svc.count('/a');
    await reply(D, p2.id, 'Ответ при выключенных ответах');
    await sleep(500);
    assert.equal(svc.count('/a'), na, 'push: выключенное не приходит');
    expect(await pushSub(A.jar, dA), 200, 'push: A включил всё');
    await reply(C, p2.id, 'Ответ при включённых ответах');
    await svc.wait('/a', na + 1);
    expect(await call(A.jar, 'POST', '/api/auth/logout', { json: {}, headers: W }), 200, 'A вышел');
    await reply(D, p3.id, 'Ответ после выхода');
    await sleep(500);
    assert.equal(svc.count('/a'), na + 1, 'push: после выхода личное не приходит');
    ok('уведомления: переключатели на сервере (выключил «Ответы» — не приходит, включил — приходит); после выхода с устройства — не приходит');
  } finally {
    svc.close();
  }
}

// ═══════════════ Чат стола и стикеры, фишки от модератора (CONTRACT.md §I.11, §I.12) ═══════════════

async function runChat(boss, guest) {
  const X = await gamer('ca', `Чат А ${RUN}`);
  const Y = await gamer('cb', `Чат Б ${RUN}`);
  const say = (u, json) => gcall(u, 'POST', '/chat', { json });

  // 1. Не за столом — 409; гость — 401; поля.
  expect(await say(X, { text: 'Привет' }), 409, 'чат не за столом', 'conflict', 'Писать в чат могут те, кто за столом');
  expect(await say(null, { text: 'Привет' }), 401, 'чат гостю', 'auth');
  expect(await paced(() => gcall(X, 'POST', '/sit')), 200, 'X садится');
  const stopX = keep(X);
  X.auto = passive;
  try {
    bad(await say(X, { sticker: 'nope' }), 'чат: неизвестный стикер', undefined, 'sticker');
    bad(await say(X, { text: '   ' }), 'чат: пусто', 'Напиши сообщение', 'text');
    bad(await say(X, { text: 'смотри https://example.com' }), 'чат: ссылка', 'Ссылки в чате стола нельзя', 'text');
    bad(await say(X, { text: 'я'.repeat(121) }), 'чат: длинно', 'Не длиннее 120 символов', 'text');
    ok('чат стола: не за столом — 409, гостю — 401; стикер из списка, текст без ссылок, до 120 символов');

    // 2. Сообщение и стикер: ответ — строка автору; гостю в поток — chat с тем же id; история — всем.
    const g = await stream(null);
    await g.wait('hello');
    const m1 = expect(await say(X, { text: `  Привет,   стол ${RUN}  ` }), 200, 'чат: текст').item;
    assert.equal(m1.text, `Привет, стол ${RUN}`);
    assert.equal(m1.sticker, null);
    assert.equal(m1.bot, false);
    assert.equal(m1.user.id, X.me.id);
    assert.ok(Number.isInteger(m1.seat) && Number.isInteger(m1.id) && Number.isInteger(m1.at));
    const e1 = await g.wait('chat', (d) => d.item && d.item.id === m1.id);
    assert.equal(e1.item.text, m1.text);
    assert.equal(e1.item.user.uni, null, 'гостю — карточка без «мой вуз»');
    const m2 = expect(await say(X, { sticker: 'fire' }), 200, 'чат: стикер').item;
    assert.equal(m2.sticker, 'fire');
    assert.equal(m2.text, null);
    await g.wait('chat', (d) => d.item && d.item.id === m2.id);
    g.close();
    const hist = expect(await call(guest, 'GET', G + '/chat', { headers: { 'X-Para': '1' } }), 200, 'история чата гостю').items;
    assert.ok(hist.some((x) => x.id === m1.id) && hist.some((x) => x.id === m2.id), 'в истории оба');
    ok('чат стола: текст (очищен) и стикер — ответ автору, событие chat всем потокам (гостю — без «мой вуз»), история');

    // 3. Блокировка: тот, кто заблокировал автора, его сообщений не видит (ни в истории, ни в потоке).
    expect(await call(Y.jar, 'PUT', `/api/social/blocks/${X.me.id}`, { json: {}, headers: W }), 200, 'Y блокирует X');
    const yHist = expect(await gcall(Y, 'GET', '/chat'), 200, 'история Y').items;
    assert.ok(!yHist.some((x) => x.user && x.user.id === X.me.id), 'Y не видит X');
    const sy = await stream(Y);
    await sy.wait('hello');
    const m3 = expect(await say(X, { text: 'Это Y не увидит' }), 200, 'чат: ещё').item;
    await none(sy, 'chat', (d) => d.item && d.item.id === m3.id, 400, 'заблокированному');
    sy.close();
    expect(await call(Y.jar, 'DELETE', `/api/social/blocks/${X.me.id}`, { json: {}, headers: W }), 200, 'Y разблокирует X');
    ok('чат стола: заблокировавший автора не видит его сообщений — ни в истории, ни в потоке');

    // 4. Предел: 8 подряд, дальше — 429 с retryAfter.
    let limited = null;
    for (let i = 0; i < 10 && !limited; i++) {
      const r = await say(X, { sticker: 'gg' });
      if (r.status === 429) limited = r;
      else expect(r, 200, 'чат: подряд');
    }
    assert.ok(limited, 'чат: предел частоты');
    assert.ok(Number(limited.json.retryAfter) >= 1, 'retryAfter');
    ok('чат стола: предел частоты — 429 с retryAfter');

    // 5. Фишки от модератора: только модератору; сумма — целое ≠ 0 до 1 000 000; человеку — chips в поток живых
    //    обновлений; меньше нуля не бывает; в списке пользователей — фишки.
    const chipsOf = (u, amount) => call(u.jar, 'POST', '/api/social/admin/action',
      { json: { action: 'chips', target: { type: 'user', id: Y.me.id }, amount }, headers: W });
    expect(await chipsOf(X, 500), 403, 'фишки не модератором', 'forbidden');
    bad(await chipsOf(boss, 0), 'фишки: 0', undefined, 'amount');
    bad(await chipsOf(boss, 1.5), 'фишки: дробь', undefined, 'amount');
    bad(await chipsOf(boss, 1_000_001), 'фишки: много', undefined, 'amount');
    const [ly] = await lives(Y);
    const c1 = expect(await chipsOf(boss, 1500), 200, 'фишки +1500').chips;
    assert.equal(c1, 2500, 'стола не открывал: 1000 + 1500');
    const ev = await ly.wait('chips');
    assert.deepEqual(ev, { amount: 1500, chips: 2500 });
    const c2 = expect(await chipsOf(boss, -1_000_000), 200, 'фишки −1 000 000').chips;
    assert.equal(c2, 0, 'меньше нуля не бывает');
    ly.close();
    const row = expect(await call(boss.jar, 'GET', `/api/social/admin/users?q=${encodeURIComponent('@' + Y.me.username)}`), 200, 'админка').items[0];
    assert.equal(row.chips, 0, 'в списке пользователей — фишки');
    // За столом (X сидит): стек меняется — сразу или после раздачи.
    const before = (await tableOf(X)).me.chips;
    const cx = expect(await call(boss.jar, 'POST', '/api/social/admin/action',
      { json: { action: 'chips', target: { type: 'user', id: X.me.id }, amount: 700 }, headers: W }), 200, 'фишки сидящему').chips;
    assert.ok(cx >= 700, 'банкролл вырос: ' + cx);
    await until(X, (v) => v.me && v.me.chips >= before + 700 - 200, { what: 'стек сидящего вырос' });
    ok('фишки от модератора: 403 не модератору, сумма 1…1 000 000 (±), живое событие chips, пол — 0, в админке, сидящему — в стек');
  } finally {
    stopX();
    await paced(() => gcall(X, 'POST', '/stand'));
  }
}

// ═══════════════ «Покер»: один стол Para (CONTRACT.md §I) ═══════════════

const G = '/api/social/games';
const CARD_RE = /^[AKQJT98765432][shdc]$/;
/** Игрок покера: вход и профиль. Все игроки — с одного IP (127.0.0.1), как класс за одним Wi-Fi. */
async function gamer(suffix, name, extra = {}) {
  return user(suffix, name, extra);
}
/** Запрос к /api/social/games…: u — игрок (null — гость); GET — только X-Para, изменяющим — ещё Origin. */
function gcall(u, method, path, { json, headers = {}, uni } = {}) {
  const h = { ...(method === 'GET' ? { 'X-Para': '1' } : W), ...headers };
  return call(u ? u.jar : new Map(), method, G + path, { json: method === 'GET' ? undefined : json ?? {}, headers: h, uni });
}
/** Повторить при 429 (ведёрки хода и чтения). */
async function paced(fn) {
  for (let i = 0; i < 15; i++) {
    const r = await fn();
    if (r.status !== 429) return r;
    await sleep(Number(r.headers['retry-after'] || 1) * 1000 + 50);
  }
  throw new Error('429 не отпускает');
}
const tableOf = async (u) => expect(await paced(() => gcall(u, 'GET', '')), 200, 'стол');
const seatOfUser = (v, id) => v.seats.find((s) => s && s.user && s.user.id === id) || null;
const botOf = (v) => v.seats.find((s) => s && s.bot) || null;
const act = (u, hand, action, amount) =>
  paced(() => gcall(u, 'POST', '/act', { json: { hand, action, ...(amount !== undefined ? { amount } : {}) } }));
/** Пассивный авто-ход: check, если можно, иначе fold — чтобы раздачи шли, пока проверяем другое. */
const passive = (v) => ({ action: v.me.actions.check ? 'check' : 'fold' });
/** Ва-банк против человека (есть что уравнять — call, иначе allin); с ботом — сразу fold. */
const shove = (v) => (botOf(v) ? { action: 'fold' } : v.me.actions.call > 0 ? { action: 'call' } : { action: 'allin' });

/**
 * me.bonus (§I.10): поля, как ждём, и resetAt — ближайшая полночь по Ташкенту (19:00 UTC) в пределах суток от now.
 */
function checkBonus(b, want, now, what) {
  const { resetAt, ...rest } = b || {};
  assert.deepEqual(rest, want, what + ': ' + JSON.stringify(b));
  assert.ok(Number.isInteger(resetAt) && resetAt > now && resetAt <= now + 86_400_000, what + ': resetAt ' + resetAt);
  assert.equal((resetAt - 19 * 3_600_000) % 86_400_000, 0, what + ': resetAt — полночь по Ташкенту');
}

/**
 * Ждать состояния стола (опрос раз в 100 мс, как опрос приложения): pred(view) → true. Возвращает view.
 */
async function until(u, pred, { ms = 10_000, what = 'состояние стола' } = {}) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    const v = await tableOf(u);
    last = v;
    if (pred(v)) return v;
    await sleep(100);
  }
  throw new Error(`${what}: не дождался за ${ms} мс; стол: ${JSON.stringify(last).slice(0, 700)}`);
}

/**
 * Присутствие игрока без потока: опрос стола раз в 300 мс (в тесте таймеры быстрые: away через 1,5 с).
 * u.auto(view) → { action, amount? } | null — авто-ход в свою очередь; me.kicked запоминается в u.kickedSeen.
 * Возвращает функцию остановки.
 */
function keep(u) {
  let stop = false;
  u.kickedSeen = u.kickedSeen || null;
  (async () => {
    while (!stop) {
      try {
        const r = await gcall(u, 'GET', '');
        const v = r.json && r.json.data;
        if (v && v.me) {
          if (v.me.kicked) u.kickedSeen = v.me.kicked;
          if (u.auto && v.hand && v.me.actions) {
            const d = u.auto(v);
            if (d) await gcall(u, 'POST', '/act', { json: { hand: v.hand.id, action: d.action, ...(d.amount !== undefined ? { amount: d.amount } : {}) } });
          }
        }
      } catch { /* сеть */ }
      await sleep(300);
    }
  })();
  return () => { stop = true; };
}

/**
 * Поток событий игры (SSE) на http.request: { status, headers, raw, events, json }, wait(event, pred, ms),
 * until(fn, ms, what), close(). json — тело отказа (не 200). u — игрок или null (гость).
 * path — другой поток того же вида (живые обновления: /api/social/live).
 */
function stream(u, { uni = UNI, c = '', headers = {}, path = `${G}/stream` } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: HUB, Accept: 'text/event-stream', ...headers };
    if (u && u.jar.size) h.Cookie = [...u.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const s = { status: 0, headers: {}, raw: '', events: [], ended: false, json: null, subs: new Set() };
    const poke = () => { for (const f of [...s.subs]) f(); };
    s.until = (fn, ms, what) => new Promise((res, rej) => {
      let t = null;
      const check = () => {
        const v = fn();
        if (!v) return false;
        clearTimeout(t);
        s.subs.delete(check);
        res(v);
        return true;
      };
      if (check()) return;
      t = setTimeout(() => { s.subs.delete(check); rej(new Error(`${what}: не дождался за ${ms} мс; в потоке: ${JSON.stringify(s.raw.slice(-300))}`)); }, ms);
      s.subs.add(check);
    });
    s.wait = (name, pred, ms = 3000) => s.until(() => {
      const e = s.events.find((x) => x.event === name && (!pred || pred(x.data)));
      return e ? e.data : null;
    }, ms, 'событие ' + name);
    s.close = () => { try { rq.destroy(); } catch { /* уже */ } };
    const q = [uni ? 'uni=' + uni : '', c ? 'c=' + c : ''].filter(Boolean).join('&');
    const rq = http.request({ hostname: BASE.hostname, port: BASE.port, method: 'GET', path: `${path}${q ? '?' + q : ''}`, headers: h }, (res) => {
      s.status = res.statusCode;
      s.headers = res.headers;
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk) => {
        s.raw += chunk;
        buf += chunk;
        for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let event = null;
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (event) { let d = null; try { d = JSON.parse(data); } catch { d = data; } s.events.push({ event, data: d }); }
        }
        poke();
      });
      const end = () => {
        if (s.ended) return;
        s.ended = true;
        if (s.status !== 200) { try { s.json = JSON.parse(s.raw); } catch { /* не JSON */ } }
        poke();
      };
      res.on('end', end);
      res.on('close', end);
      resolve(s);
    });
    rq.on('error', (e) => { s.ended = true; poke(); if (!s.status) reject(e); });
    rq.end();
  });
}

async function runGame(st, boss, guest, limitsOn) {
  let r;
  const stops = [];
  try {
    // 1. Настройки, гость и пустой стол (остатки прошлого прогона встают сами: away → kick).
    assert.equal(st.config.game, 'on', 'config.game (сервер с SOCIAL_GAME=on)');
    let gv = await until(null, (v) => v.seats.every((s) => !s) && !v.hand, { ms: 20_000, what: 'пустой стол' });
    assert.deepEqual([gv.me, gv.seats.length, gv.hand, gv.countdown, gv.blinds, gv.startStack], [null, 4, null, null, { small: 10, big: 20 }, 1000]);
    assert.ok(Number.isInteger(gv.seq) && Number.isInteger(gv.now) && Number.isInteger(gv.watchers), 'seq, now, watchers');
    const ga = await gamer('ga', `Гоша ${RUN}`);
    assert.deepEqual((await meOf(ga.jar)).game, { players: 0, invite: null, bonus: false },
      'me.game — сколько людей за столом, приглашения нет, бонус не ждёт (стол не находил)');
    const gaView = await tableOf(ga);
    const { bonus: gaBonus, ...gaMe } = gaView.me;
    assert.deepEqual(gaMe, { seat: null, state: 'none', chips: 1000, cards: null, actions: null, stats: { hands: 0, wins: 0, bestPot: 0 }, kicked: null, broke: false });
    checkBonus(gaBonus, { available: true, amount: 500, streak: 0, tomorrow: 600 }, gaView.now, 'me.bonus нового');
    assert.equal((await meOf(ga.jar)).game.bonus, true, 'нашёл стол — me.game.bonus');
    r = await call(ga.jar, 'POST', G + '/sit', { json: {} });
    expect(r, 403, 'sit без X-Para', 'csrf');
    ok('«Покер»: config.game on; гостю стол — 200 с me null и 4 пустыми местами; вошедшему me с банкроллом 1000 и бонусом 500 (серия 0); sit без X-Para → 403');

    // 2. Сесть: бот напротив, отсчёт, раздача сама; свои карты — настоящие, чужие — «?».
    ga.auto = null;
    stops.push(keep(ga));
    let tv = expect(await gcall(ga, 'POST', '/sit'), 200, 'сесть').table;
    const mySeat = tv.me.seat;
    assert.ok(Number.isInteger(mySeat) && mySeat >= 0 && mySeat < 4, 'место');
    assert.deepEqual([tv.me.state, tv.me.chips, tv.seats[mySeat].user.id, tv.seats[mySeat].user.username], ['seated', 1000, ga.me.id, ga.me.username]);
    let bot = botOf(tv);
    assert.ok(bot && bot.seat === (mySeat + 2) % 4 && bot.user === null && bot.masked === false, 'бот сел напротив');
    assert.ok(Number.isInteger(tv.countdown) && tv.countdown > tv.now, 'отсчёт до раздачи');
    assert.deepEqual((await meOf(ga.jar)).game, { players: 1, invite: null, bonus: true });
    assert.equal(expect(await gcall(ga, 'POST', '/sit'), 200, 'сесть ещё раз').table.me.seat, mySeat, 'повтор — то же место');
    tv = await until(ga, (v) => v.hand && v.hand.phase === 'preflop', { what: 'раздача' });
    assert.ok(tv.me.cards.length === 2 && tv.me.cards.every((c) => CARD_RE.test(c)), 'свои карты: ' + JSON.stringify(tv.me.cards));
    assert.deepEqual(tv.seats[mySeat].cards, tv.me.cards, 'своё место — те же карты');
    assert.deepEqual(botOf(tv).cards, ['?', '?'], 'карты бота закрыты');
    assert.ok(['sb', 'bb'].includes(tv.seats[mySeat].last.a) && ['sb', 'bb'].includes(botOf(tv).last.a), 'блайнды поставлены');
    assert.ok(tv.hand.turn && Number.isInteger(tv.hand.turn.deadline) && tv.hand.currentBet === 20 && tv.hand.minRaise === 20, 'ход и ставка');
    gv = await tableOf(null);
    assert.ok(gv.hand && gv.me === null, 'гость видит раздачу');
    assert.deepEqual(gv.seats[mySeat].cards, ['?', '?'], 'гостю карты ga закрыты');
    assert.deepEqual(botOf(gv).cards, ['?', '?']);
    assert.equal(gv.seats[mySeat].user.uni, null, 'гостю — без «моего вуза»');
    assert.equal(JSON.stringify(gv).includes(tv.me.cards[0]) && JSON.stringify(gv).includes(tv.me.cards[1]), false, 'карт ga в view гостя нет');
    ok(`«Покер»: сел на место ${mySeat}, бот напротив, отсчёт, раздача началась сама; свои карты видны, чужие и гостю — «?»`);

    // 3. Ход: чужая раздача → 409; check при ставке → 409; кривая сумма → 400; fold → банк боту, стек минус блайнд.
    tv = await until(ga, (v) => v.hand && !v.hand.result && v.me.actions, { what: 'свой ход' });
    const stackBefore = tv.seats[mySeat].chips + tv.seats[mySeat].bet;
    const blind = tv.seats[mySeat].bet;
    r = await act(ga, tv.hand.id + 1, 'call');
    expect(r, 409, 'чужая раздача', 'conflict', 'Сейчас не твой ход');
    assert.equal(r.json.field, 'status');
    if (!tv.me.actions.check) expect(await act(ga, tv.hand.id, 'check'), 409, 'check при ставке', 'conflict', 'Нужно уравнять или сбросить');
    bad(await act(ga, tv.hand.id, 'raise', 3.5), 'дробная сумма', 'Неверная сумма', 'amount');
    bad(await act(ga, tv.hand.id, 'raise'), 'рейз без суммы', 'Неверная сумма', 'amount');
    bad(await act(ga, tv.hand.id, 'raise', tv.me.actions.raise.max + 10), 'сумма больше стека', 'Неверная сумма', 'amount');
    bad(await act(ga, tv.hand.id, 'dance'), 'неизвестный ход', undefined, 'action');
    const folded = expect(await act(ga, tv.hand.id, 'fold'), 200, 'fold').table;
    bot = botOf(folded);
    assert.deepEqual([folded.hand.phase, folded.hand.result.showdown, folded.hand.result.winners.length, folded.hand.result.winners[0].seat, folded.hand.result.reveal],
      ['done', false, 1, bot.seat, []]);
    assert.equal(folded.hand.result.winners[0].amount, folded.seats[bot.seat].last.amount, 'банк — у бота (last win)');
    assert.equal(folded.seats[bot.seat].last.a, 'win');
    assert.equal(folded.seats[mySeat].chips, stackBefore - blind, 'ga потерял ровно блайнд');
    assert.deepEqual([folded.seats[mySeat].folded, folded.hand.pot, folded.hand.pots, folded.hand.turn, folded.me.actions], [true, 0, [], null, null]);
    const doneId = folded.hand.id;
    tv = await until(ga, (v) => v.hand && v.hand.id !== doneId && v.hand.phase === 'preflop', { what: 'следующая раздача' });
    assert.ok(tv.me.stats.hands >= 1, 'счёт раздач растёт: ' + tv.me.stats.hands);
    ok(`«Покер»: чужая раздача → 409 «Сейчас не твой ход»; check при ставке → 409; сумма 3.5 / без суммы / больше стека → 400 amount; fold → банк боту без вскрытия, стек −${blind}; следующая раздача сама`);

    // 4. Второй человек садится во время раздачи → «ждёт раздачи», со следующей — в игре, бот встаёт.
    const gb = await gamer('gb', `Боря ${RUN}`);
    // С ботом доигрывает сам — сбросом (один ход на раздачу: ведёрко хода [8, 2 с] нужно шагу 5, иначе 429 и paced
    // проспит двухсекундный ход), с человеком — ходим вручную.
    ga.auto = (v) => (botOf(v) ? { action: 'fold' } : null);
    gb.auto = null;
    stops.push(keep(gb));
    tv = await until(ga, (v) => v.hand && !v.hand.result, { what: 'идущая раздача' });
    const sitB = expect(await gcall(gb, 'POST', '/sit'), 200, 'gb сел во время раздачи').table;
    const seatB = sitB.me.seat;
    assert.deepEqual([sitB.me.state, sitB.seats[seatB].reserved, sitB.seats[seatB].inHand, sitB.seats[seatB].cards, sitB.me.cards, sitB.me.actions],
      ['reserved', true, false, null, null, null]);
    assert.deepEqual((await meOf(gb.jar)).game, { players: 2, invite: null, bonus: true });
    tv = await until(gb, (v) => v.hand && v.hand.phase === 'preflop' && !v.hand.result && seatOfUser(v, gb.me.id) && seatOfUser(v, gb.me.id).inHand,
      { what: 'раздача с gb' });
    assert.equal(botOf(tv), null, 'бот встал, когда людей двое');
    assert.deepEqual([tv.me.state, tv.seats[seatB].reserved, tv.me.cards.length], ['seated', false, 2]);
    ok('«Покер»: сел во время раздачи → reserved («ждёт раздачи»), со следующей раздачи в игре; бот встал');

    // 5. Двое людей: не свой ход → 409; SB не может check; рейз: min 40, кривая сумма → 400; рейз до 60; fold → банк.
    const first = tv.hand.turn.seat === mySeat ? ga : gb;
    const second = first === ga ? gb : ga;
    const seatOf = (u) => (u === ga ? mySeat : seatB);
    const stack = (u) => tv.seats[seatOf(u)].chips + tv.seats[seatOf(u)].bet;   // стеки до раздачи (ga уже играл с ботом)
    const hand = tv.hand.id;
    r = await act(second, hand, 'call');
    expect(r, 409, 'ход не в свою очередь', 'conflict', 'Сейчас не твой ход');
    expect(await act(first, hand, 'check'), 409, 'check малого блайнда', 'conflict', 'Нужно уравнять или сбросить');
    const afterCall = expect(await act(first, hand, 'call'), 200, 'call').table;
    assert.deepEqual([afterCall.seats[seatOf(first)].last, afterCall.hand.turn.seat, afterCall.hand.currentBet], [{ a: 'call', amount: 10 }, seatOf(second), 20]);
    const sv = await tableOf(second);
    assert.deepEqual([sv.me.actions.check, sv.me.actions.call, sv.me.actions.raise, sv.me.actions.allin],
      [true, 0, { min: 40, max: stack(second) }, stack(second)]);
    bad(await act(second, hand, 'raise', 39), 'рейз меньше минимума', 'Неверная сумма', 'amount');
    const raised = expect(await act(second, hand, 'raise', 60), 200, 'рейз до 60').table;
    assert.deepEqual([raised.hand.currentBet, raised.hand.minRaise, raised.seats[seatOf(second)].bet, raised.seats[seatOf(second)].last, raised.hand.turn.seat],
      [60, 40, 60, { a: 'raise', amount: 60 }, seatOf(first)]);
    const fv = await tableOf(first);
    assert.deepEqual([fv.me.actions.check, fv.me.actions.call, fv.me.actions.raise.min, fv.me.actions.raise.max], [false, 40, 100, stack(first)]);
    assert.deepEqual(fv.seats[seatOf(second)].cards, ['?', '?'], 'карты соперника закрыты');
    const won = expect(await act(first, hand, 'fold'), 200, 'fold').table;
    assert.deepEqual([won.hand.phase, won.hand.result.showdown, won.hand.result.winners[0].seat, won.hand.result.winners[0].amount], ['done', false, seatOf(second), 80]);
    assert.equal(won.seats[seatOf(second)].chips, stack(second) - 60 + 80, 'победитель: стек − 60 + 80');
    assert.equal(won.seats[seatOf(first)].chips, stack(first) - 20, 'сбросивший: стек − 20');
    tv = await until(second, (v) => !v.hand || v.hand.id !== hand, { what: 'конец раздачи' });
    assert.ok(tv.me.stats.wins >= 1 && tv.me.stats.bestPot >= 80, 'счёт побед и лучший банк: ' + JSON.stringify(tv.me.stats));
    ga.auto = passive;
    gb.auto = passive;
    ok('«Покер»: двое — не свой ход → 409; check у SB → 409; рейз 39 → 400, рейз до 60 (min 40, max — стек); fold → 80 победителю; счёт побед');

    // 6. gb встал → бот вернулся к ga.
    const stood = expect(await gcall(gb, 'POST', '/stand'), 200, 'gb встал').table;
    assert.ok(['leaving', 'none'].includes(stood.me.state), 'встал: ' + stood.me.state);
    tv = await until(ga, (v) => botOf(v) && !seatOfUser(v, gb.me.id), { what: 'бот вернулся' });
    assert.equal(expect(await gcall(gb, 'POST', '/stand'), 200, 'встать, не сидя').table.me.state, 'none');
    assert.deepEqual((await meOf(ga.jar)).game, { players: 1, invite: null, bonus: true });
    ok('«Покер»: gb встал — место освободилось, бот вернулся; «встать» не сидя — 200');

    // 7. Блокировки: заблокировавший ga не сядет; блокировка за столом — другой показан «Игроком» (masked).
    const gc = await gamer('gc', `Вика ${RUN}`);
    expect(await call(gc.jar, 'PUT', `/api/social/blocks/${ga.me.id}`, { json: {}, headers: W }), 200, 'gc блокирует ga');
    r = await gcall(gc, 'POST', '/sit');
    expect(r, 409, 'сесть при блокировке', 'conflict', 'За этот стол сейчас не сесть — попробуй позже');
    assert.equal(r.json.field, 'status');
    expect(await call(gc.jar, 'DELETE', `/api/social/blocks/${ga.me.id}`, { json: {}, headers: W }), 200, 'gc разблокировал');
    tv = expect(await gcall(gb, 'POST', '/sit'), 200, 'gb снова сел').table;
    const seatB2 = tv.me.seat;
    expect(await call(gb.jar, 'PUT', `/api/social/blocks/${ga.me.id}`, { json: {}, headers: W }), 200, 'gb блокирует ga за столом');
    const bv = await tableOf(gb);
    assert.deepEqual([bv.seats[mySeat].masked, bv.seats[mySeat].user, bv.seats[mySeat].bot, bv.seats[seatB2].masked], [true, null, false, false]);
    const av = await tableOf(ga);
    assert.deepEqual([av.seats[seatB2].masked, av.seats[seatB2].user, av.seats[mySeat].masked], [true, null, false]);
    gv = await tableOf(null);
    assert.ok(!gv.seats[mySeat].masked && gv.seats[mySeat].user && !gv.seats[seatB2].masked && gv.seats[seatB2].user, 'гостю видны оба');
    expect(await call(gb.jar, 'DELETE', `/api/social/blocks/${ga.me.id}`, { json: {}, headers: W }), 200, 'gb разблокировал');
    assert.equal((await tableOf(gb)).seats[mySeat].masked, false, 'маска снята');
    ok('«Покер»: заблокировавший сидящего → 409 «За этот стол сейчас не сесть…»; блокировка за столом — masked у обоих, гостю видны');

    // 8. Реакции: в потоки остальных (и гостю), себе — нет; чужая → 400 r; не за столом → 409; 6-я за 3 с → 429.
    const sa = await stream(ga);
    const sb = await stream(gb);
    const sg = await stream(null, { headers: { 'X-Real-IP': '10.77.1.1' } });
    for (const s of [sa, sb, sg]) await s.wait('hello');
    expect(await gcall(ga, 'POST', '/react', { json: { r: 'fire' } }), 200, 'реакция');
    await sb.wait('react', (d) => d.seat === mySeat && d.r === 'fire', 2000);
    await sg.wait('react', (d) => d.seat === mySeat && d.r === 'fire', 2000);
    await sleep(150);
    assert.ok(!sa.events.some((e) => e.event === 'react'), 'себе реакция не приходит');
    bad(await gcall(ga, 'POST', '/react', { json: { r: 'kiss' } }), 'чужая реакция', undefined, 'r');
    expect(await gcall(gc, 'POST', '/react', { json: { r: 'wave' } }), 409, 'реакция не за столом', 'conflict', 'Ты не за столом');
    if (limitsOn) {
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await gcall(ga, 'POST', '/react', { json: { r: 'wave' } })).status);
      assert.deepEqual(codes, [200, 200, 200, 200, 429], '5 подряд, 6-я за 3 с — 429: ' + codes);
    }
    // Поток: hello, сразу table со своим view, ping; seq в table растёт.
    assert.equal(sa.status, 200, 'поток: ' + sa.raw.slice(0, 200));
    assert.match(sa.headers['content-type'] || '', /^text\/event-stream/);
    assert.match(sa.headers['cache-control'] || '', /no-store/);
    assert.equal(sa.headers['x-accel-buffering'], 'no');
    assert.equal(sa.headers['x-robots-tag'], 'noindex');
    assert.ok(sa.raw.startsWith('retry: 3000\n\nevent: hello\ndata: {"now":'), 'retry: 3000, затем hello');
    const firstTable = await sa.wait('table', (d) => d.view && d.view.me && d.view.me.seat === mySeat, 2000);
    assert.ok(Number.isInteger(firstTable.view.seq) && firstTable.view.seats.length === 4, 'table со своим view');
    const gTable = await sg.wait('table', null, 2000);
    assert.equal(gTable.view.me, null, 'гостю table с me null');
    await sa.wait('ping', null, 2500);
    await sa.wait('table', (d) => d.view.seq > firstTable.view.seq, 5000);
    const seqs = sa.events.filter((e) => e.event === 'table').map((e) => e.data.view.seq);
    assert.ok(seqs.every((s, i) => i === 0 || s >= seqs[i - 1]), 'seq не убывает: ' + seqs.join(','));
    assert.ok(!sa.events.filter((e) => e.event === 'table').some((e) => e.data.view.seats.some((s) => s && s.user && s.user.id !== ga.me.id && s.cards && s.cards.some((c) => c !== '?') && !e.data.view.hand.result && !(e.data.view.hand.phase !== 'preflop' && e.data.view.seats.filter((x) => x && x.inHand && !x.folded && !x.allIn).length <= 1))),
      'чужие карты в потоке закрыты до вскрытия');
    sa.close(); sb.close(); sg.close();
    expect(await gcall(gb, 'POST', '/stand'), 200, 'gb встал');
    ok('«Покер»: реакция — в потоки других и гостя, не себе; чужая → 400 r; не за столом → 409; 6-я за 3 с → 429; поток: retry, hello, table (своё view), ping, seq растёт');

    // 9. Потоки: гостю — по IP (4-й с того же IP вытесняет первый); у человека 4-й → replaced, 5 с → max_age, выход → session.
    const ip = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
    const gs4 = [];
    for (let i = 0; i < 4; i++) { gs4.push(await stream(null, { headers: { 'X-Real-IP': ip } })); await gs4[i].wait('hello'); }
    assert.equal((await gs4[0].wait('bye', null, 2000)).reason, 'replaced', 'гость: 4-й поток с того же IP вытесняет первый');
    assert.ok(!gs4[1].events.some((e) => e.event === 'bye'), 'остальные гостевые живы');
    for (const x of gs4) x.close();
    const gsu = await gamer('gs', `Соня ${RUN}`);
    const ss = [];
    for (let i = 0; i < 4; i++) { ss.push(await stream(gsu)); await ss[i].wait('hello'); }
    assert.equal((await ss[0].wait('bye', null, 2000)).reason, 'replaced');
    await ss[0].until(() => ss[0].ended, 2000, 'вытесненный поток закрыт');
    assert.ok(!ss[1].events.some((e) => e.event === 'bye'), 'остальные живы');
    const t9 = Date.now();
    assert.equal((await ss[1].wait('bye', null, 7000)).reason, 'max_age');
    const age = Date.now() - t9;
    const tab = 'smoke' + RUN + 'tabA';
    const s5 = await stream(gsu, { c: tab });
    await s5.wait('hello');
    const s6 = await stream(gsu, { c: tab });
    await s6.wait('hello');
    await s5.until(() => s5.ended, 2000, 'старое соединение вкладки закрыто');
    assert.ok(!s5.events.some((e) => e.event === 'bye'), 'та же вкладка (c=) — тихо, без bye');
    expect(await call(gsu.jar, 'POST', '/api/auth/logout', { json: {}, headers: W }), 200, 'выход');
    assert.equal((await s6.wait('bye', null, 2000)).reason, 'session');
    for (const x of ss) x.close();
    s5.close(); s6.close();
    ok(`«Покер»: гостю поток по IP (4-й → bye replaced); человеку 4-й → replaced, через ${Math.round(age / 100) / 10} с — max_age, c= тихо заменяет, выход → session`);

    // 10. Таймаут хода: не ходит — авто check/fold; два подряд — после раздачи из-за стола, me.kicked = 'idle' один раз.
    const gt = await gamer('gt', `Тима ${RUN}`);
    gt.auto = null;
    stops.push(keep(gt));
    tv = expect(await gcall(gt, 'POST', '/sit'), 200, 'gt сел').table;
    const seatT = tv.me.seat;
    tv = await until(gt, (v) => v.hand && v.hand.turn && v.hand.turn.seat === seatT && !v.hand.result, { ms: 15_000, what: 'ход gt' });
    const deadline = tv.hand.turn.deadline;
    tv = await until(gt, (v) => !v.hand || v.hand.id !== tv.hand.id || !v.hand.turn || v.hand.turn.seat !== seatT || v.hand.result, { ms: 6000, what: 'таймаут хода' });
    const lastT = seatOfUser(tv, gt.me.id) && seatOfUser(tv, gt.me.id).last;
    assert.ok(Date.now() >= deadline - 100, 'ход перешёл не раньше срока');
    assert.ok(!lastT || ['check', 'fold', 'win', 'sb', 'bb'].includes(lastT.a), 'после таймаута — check или fold: ' + JSON.stringify(lastT));
    // Отметка kicked приходит один раз — в первом же ответе после снятия (сюда или в опрос keep).
    const kicked = await until(gt, (v) => !seatOfUser(v, gt.me.id), { ms: 25_000, what: 'gt выгнан за два пропуска' });
    await sleep(700);
    assert.ok(kicked.me.kicked === 'idle' || gt.kickedSeen === 'idle', 'me.kicked = idle пришёл: ' + JSON.stringify([kicked.me.kicked, gt.kickedSeen]));
    assert.equal((await tableOf(gt)).me.kicked, null, 'второй раз kicked не приходит');
    ok('«Покер»: таймаут хода → авто check/fold; два пропуска подряд → после раздачи из-за стола, me.kicked = idle (один раз)');

    // 11. Бан сидящего: встал (в раздаче — по её окончании), поток — bye ban; забаненному сесть → 403 banned, стол — 200.
    const gx = await gamer('gx', `Хасан ${RUN}`);
    gx.auto = passive;
    stops.push(keep(gx));
    expect(await gcall(gx, 'POST', '/sit'), 200, 'gx сел');
    const sx = await stream(gx);
    await sx.wait('hello');
    expect(await admin(boss, { action: 'ban', target: { type: 'user', id: gx.me.id }, days: 1, reason: 'Проверка стола' }), 200, 'бан gx');
    assert.equal((await sx.wait('bye', null, 2000)).reason, 'ban');
    await until(ga, (v) => !seatOfUser(v, gx.me.id), { what: 'gx встал после бана' });
    expect(await gcall(gx, 'POST', '/sit'), 403, 'сесть при бане', 'banned');
    expect(await gcall(gx, 'POST', '/react', { json: { r: 'wave' } }), 403, 'реакция при бане', 'banned');
    expect(await gcall(gx, 'GET', ''), 200, 'стол при бане');
    expect(await gcall(gx, 'POST', '/stand'), 200, 'встать при бане');
    const sx2 = await stream(gx);
    await sx2.until(() => sx2.ended, 2000, 'отказ потока');
    assert.deepEqual([sx2.status, sx2.json && sx2.json.code], [403, 'banned']);
    ok('«Покер»: бан — встал, поток bye { reason: ban }; забаненному стол 200, сесть и реакция — 403 banned, поток — 403');

    // 12. Удаление аккаунта сидящего: место освобождается.
    const gz = await gamer('gz', `Зоя ${RUN}`);
    gz.auto = passive;
    stops.push(keep(gz));
    expect(await gcall(gz, 'POST', '/sit'), 200, 'gz сел');
    assert.equal((await meOf(ga.jar)).game.players, 2);
    expect(await call(gz.jar, 'DELETE', '/api/social/me', { json: { confirm: true }, headers: W }), 200, 'удаление gz');
    await until(ga, (v) => !seatOfUser(v, gz.me.id) && v.seats.every((s) => !s || s.bot || s.user), { what: 'место gz освободилось' });
    assert.equal((await meOf(ga.jar)).game.players, 1);
    ok('«Покер»: удаление аккаунта сидящего — место освободилось, me.game.players уменьшился');

    // 13. Стек и счёт — в базе: встал и сел снова — тот же стек. Встаём между раздачами (идёт отсчёт, до раздачи
    //     ещё > 150 мс): раздача, в которую ga уже сдан, при уходе доигрывается сбросом и честно засчитывается (hands + 1).
    const before = (await until(ga, (v) => !v.hand && (v.countdown === null || v.countdown - v.now > 150),
      { what: 'стол между раздачами' })).me;
    expect(await gcall(ga, 'POST', '/stand'), 200, 'ga встал');
    tv = await until(ga, (v) => !seatOfUser(v, ga.me.id), { what: 'ga вне стола' });
    assert.deepEqual([tv.me.state, tv.me.chips, tv.me.stats], ['none', before.chips, before.stats], 'банкролл и счёт сохранились');
    assert.deepEqual((await meOf(ga.jar)).game, { players: 0, invite: null, bonus: true });
    await until(null, (v) => v.seats.every((s) => !s), { what: 'стол пуст' });
    ok('«Покер»: встал — стек и счёт остались в базе (me.chips, me.stats), стол пуст');

    await runEconomy(stops);
    await runTop();
  } finally {
    for (const stop of stops) stop();
  }
}

/**
 * «Покер»: экономика фишек (CONTRACT.md §I.10). Стол пуст на входе и на выходе. Бесплатной подпитки нет:
 *  1) бонус «ждёт раздачи» (место есть, но в раздачу не сдан) — сразу в стек и в базу; второй раз — 409; me.game.bonus;
 *  2) бонус в раздаче — в стек только после неё (по потоку: стек после конца раздачи = стек на её итоге + 500);
 *  3) двое ва-банк друг против друга, пока у кого-то не останется меньше большого блайнда: в начале следующей раздачи
 *     он встаёт сам (me.kicked = 'broke' один раз), me.broke, сесть — 409; бонус — и снова можно сесть.
 */
async function runEconomy(stops) {
  let r;
  let tv;
  // 1. gp с ботом; ждём ход gp (сам он не ходит: на ход 2 с) — раздача точно идёт. gr садится в неё и забирает бонус.
  const gp = await gamer('gp', `Паша ${RUN}`);
  const gr = await gamer('gr', `Рома ${RUN}`);
  gp.auto = null;
  stops.push(keep(gp));
  expect(await gcall(gp, 'POST', '/sit'), 200, 'gp сел');
  const myTurn = (u) => (v) => {
    const s = seatOfUser(v, u.me.id);
    return !!(s && v.hand && !v.hand.result && v.hand.turn && v.hand.turn.seat === s.seat);
  };
  tv = await until(gp, myTurn(gp), { ms: 15_000, what: 'ход gp' });
  const seatP = seatOfUser(tv, gp.me.id).seat;
  const handP = tv.hand.id;
  assert.equal((await meOf(gr.jar)).game.bonus, false, 'стол не находил — бонус не ждёт');
  const sitR = expect(await gcall(gr, 'POST', '/sit'), 200, 'gr сел во время раздачи').table;
  const seatR = sitR.me.seat;
  assert.deepEqual([sitR.me.state, sitR.me.chips, sitR.me.broke], ['reserved', 1000, false]);
  checkBonus(sitR.me.bonus, { available: true, amount: 500, streak: 0, tomorrow: 600 }, sitR.now, 'бонус gr до');
  const br = expect(await gcall(gr, 'POST', '/bonus'), 200, 'бонус «ждёт раздачи»');
  assert.equal(br.got, 500);
  assert.deepEqual([br.table.me.state, br.table.me.chips, br.table.seats[seatR].chips, br.table.me.broke], ['reserved', 1500, 1500, false],
    'не в раздаче — сразу в стек');
  checkBonus(br.table.me.bonus, { available: false, amount: 500, streak: 1, tomorrow: 600 }, br.table.now, 'бонус gr после');
  r = await gcall(gr, 'POST', '/bonus');
  expect(r, 409, 'бонус второй раз', 'conflict', 'Бонус на сегодня уже получен');
  assert.equal(r.json.field, 'status');
  assert.equal((await meOf(gr.jar)).game.bonus, false, 'me.game.bonus после бонуса');
  tv = expect(await gcall(gr, 'POST', '/stand'), 200, 'gr встал').table;
  assert.deepEqual([tv.me.state, tv.me.chips], ['none', 1500], 'встал — бонус в банкролле (база)');
  ok('«Покер»: бонус новому — 500 (серия 0); «ждёт раздачи» забрал — +500 сразу в стек и в базу, серия 1, завтра 600; второй раз — 409 «Бонус на сегодня уже получен»; me.game.bonus false');

  // 2. Бонус gp в его раздаче (всё ещё его ход): стек не меняется, пока раздача не кончится; потом — +500.
  const sp = await stream(gp);
  await sp.wait('hello');
  const bp = expect(await gcall(gp, 'POST', '/bonus'), 200, 'бонус в раздаче');
  const mine = bp.table.seats[seatP];
  assert.ok(bp.table.hand && bp.table.hand.id === handP && mine.inHand, 'бонус забран в раздаче: ' + JSON.stringify(bp.table.hand && bp.table.hand.phase));
  assert.equal(bp.got, 500);
  assert.equal(bp.table.me.chips, mine.chips);
  assert.ok(mine.chips + mine.bet <= 1100, 'в раздаче стек ещё без бонуса: ' + (mine.chips + mine.bet));
  checkBonus(bp.table.me.bonus, { available: false, amount: 500, streak: 1, tomorrow: 600 }, bp.table.now, 'бонус gp после');
  gp.auto = passive;
  const claimSeq = bp.table.seq;
  const ends = await sp.until(() => {
    const ev = sp.events.filter((e) => e.event === 'table' && e.data.view.seq >= claimSeq).map((e) => e.data.view);
    const i = ev.findIndex((v) => !v.hand || v.hand.id !== handP);
    return i > 0 ? { last: ev[i - 1], after: ev[i] } : null;
  }, 4500, 'конец раздачи с бонусом');
  sp.close();
  assert.ok(ends.last.hand && ends.last.hand.result, 'перед концом раздачи — её итог');
  assert.equal(ends.after.seats[seatP].chips, ends.last.seats[seatP].chips + 500, 'бонус — в стек по окончании раздачи');
  expect(await gcall(gp, 'POST', '/stand'), 200, 'gp встал');
  await until(null, (v) => v.seats.every((s) => !s), { ms: 15_000, what: 'стол пуст после gp' });
  ok(`«Покер»: бонус в раздаче — стек не меняется до её конца, потом +500 (${ends.last.seats[seatP].chips} → ${ends.after.seats[seatP].chips})`);

  // 3. Ва-банк: gu и gv, пока кто-то не проиграется (меньше 20 в начале раздачи — встаёт сам).
  const gu = await gamer('gu', `Уля ${RUN}`);
  const gv = await gamer('gv', `Вова ${RUN}`);
  for (const u of [gu, gv]) {
    u.auto = shove;
    u.kickedSeen = null;
    stops.push(keep(u));
  }
  expect(await gcall(gu, 'POST', '/sit'), 200, 'gu сел');
  expect(await gcall(gv, 'POST', '/sit'), 200, 'gv сел');
  let L = null;
  let lv = null;
  const t0 = Date.now();
  while (!L) {
    if (Date.now() - t0 > 60_000) throw new Error('ва-банк: за 60 с никто не проигрался');
    for (const u of [gu, gv]) {
      const v = await tableOf(u);
      if (v.me.kicked) u.kickedSeen = v.me.kicked;
      if (v.me.state === 'none') { L = u; lv = v; break; }
    }
    if (!L) await sleep(150);
  }
  const W = L === gu ? gv : gu;
  L.auto = null;
  W.auto = passive;
  await sleep(700);   // me.kicked мог уйти в опрос keep — ждём его ответа
  assert.ok(lv.me.kicked === 'broke' || L.kickedSeen === 'broke', 'me.kicked = broke пришёл: ' + JSON.stringify([lv.me.kicked, L.kickedSeen]));
  tv = await tableOf(L);
  assert.equal(tv.me.kicked, null, 'второй раз kicked не приходит');
  assert.ok(tv.me.state === 'none' && tv.me.broke === true && tv.me.chips < 20, 'фишки кончились: ' + JSON.stringify(tv.me));
  checkBonus(tv.me.bonus, { available: true, amount: 500, streak: 0, tomorrow: 600 }, tv.now, 'бонус проигравшегося');
  r = await gcall(L, 'POST', '/sit');
  expect(r, 409, 'сесть без фишек', 'conflict', 'Фишки кончились — новые завтра');
  assert.equal(r.json.field, 'status');
  assert.equal((await meOf(L.jar)).game.bonus, true, 'бонус ждёт');
  const lb = expect(await gcall(L, 'POST', '/bonus'), 200, 'бонус проигравшегося');
  assert.deepEqual([lb.got, lb.table.me.state, lb.table.me.chips, lb.table.me.broke], [500, 'none', tv.me.chips + 500, false], 'бонус — в банкролл');
  const back = expect(await gcall(L, 'POST', '/sit'), 200, 'с бонусом — снова за стол').table;
  assert.ok(['seated', 'reserved'].includes(back.me.state), 'сел: ' + back.me.state);
  expect(await gcall(L, 'POST', '/stand'), 200, 'проигравшийся встал');
  expect(await gcall(W, 'POST', '/stand'), 200, 'победитель встал');
  await until(null, (v) => v.seats.every((s) => !s), { ms: 15_000, what: 'стол пуст' });
  ok(`«Покер»: ва-банк до конца фишек — в начале раздачи встал сам, me.kicked = broke (один раз), me.broke, сесть → 409 «Фишки кончились — новые завтра»; бонус +500 — снова за стол (${Math.round((Date.now() - t0) / 1000)} с)`);
}

/**
 * «Покер»: рейтинг по фишкам (GET /api/social/games/top, §I.10). «Друзья» — друзья и я; «Все» — взрослые, которых можно
 * найти в поиске, друзья и я; 16–17 чужим не видны (даже с поиском), другу — видны; скрылся из поиска или блокировка —
 * не виден. База общая с прошлыми прогонами, поэтому «Все» проверяется по total: разница между зрителями — ровно наши люди.
 */
async function runTop() {
  const top = async (u, scope) => expect(await paced(() => gcall(u, 'GET', '/top?scope=' + scope)), 200, 'рейтинг ' + scope);
  const total = async (u) => (await top(u, 'all')).total;
  const S = await gamer('ts', `Стас ${RUN}`);
  const F = await gamer('tf', `Фарид ${RUN}`);
  const M = await gamer('tm', `Мадина ${RUN}`, { age: 'minor' });
  const H = await gamer('th', `Хилола ${RUN}`);
  expect(await gcall(null, 'GET', '/top?scope=all'), 401, 'рейтинг гостю', 'auth');
  bad(await gcall(S, 'GET', '/top?scope=world'), 'кривой scope', 'Неверный запрос', 'scope');
  bad(await gcall(S, 'GET', '/top'), 'без scope', 'Неверный запрос', 'scope');
  let t = await top(S, 'friends');
  assert.deepEqual([t.scope, t.items, t.me, t.total], ['friends', [], null, 0], 'стол не находил — своей строки нет');
  for (const u of [S, F, M, H]) await tableOf(u);   // нашли стол — строки poker_players (по 1000)
  // M (16–17) открывает себя поиску — во «Всех» её всё равно не видно чужим; бонус — 1500, выше F. F и M — друзья.
  expect(await call(M.jar, 'PATCH', '/api/social/me', { json: { searchable: true }, headers: W }), 200, 'M в поиске');
  expect(await gcall(M, 'POST', '/bonus'), 200, 'бонус M');
  expect(await call(F.jar, 'POST', `/api/social/friends/${M.me.id}`, { json: {}, headers: W }), 200, 'F → M');
  expect(await call(M.jar, 'POST', `/api/social/friends/${F.me.id}/accept`, { json: {}, headers: W }), 200, 'M принимает F');

  // «Друзья»: у S — только он сам; у F и M — оба, M выше (1500 > 1000).
  t = await top(S, 'friends');
  assert.equal(t.scope, 'friends');
  assert.deepEqual([t.total, t.me, t.items.length, t.items[0].place, t.items[0].user.id, t.items[0].chips, t.items[0].me],
    [1, { place: 1, chips: 1000 }, 1, 1, S.me.id, 1000, true], 'друзья S: только своя строка');
  assert.deepEqual(Object.keys(t.items[0].user).sort(), ['avatar', 'badge', 'id', 'name', 'team', 'uni', 'uniShort', 'username']);
  t = await top(F, 'friends');
  assert.deepEqual(t.items.map((x) => [x.place, x.user.id, x.chips, x.me]), [[1, M.me.id, 1500, false], [2, F.me.id, 1000, true]]);
  assert.deepEqual([t.total, t.me], [2, { place: 2, chips: 1000 }]);
  t = await top(M, 'friends');
  assert.deepEqual([t.items.map((x) => [x.user.id, x.me]), t.me], [[[M.me.id, true], [F.me.id, false]], { place: 1, chips: 1500 }]);
  ok('«Покер»: рейтинг — гостю 401, кривой или пустой scope → 400 scope; стол не находил — me null; «Друзья» — друзья и я, места по фишкам');

  // «Все»: F видит M (друг), S — нет; M видит себя; места идут подряд, фишки не растут, своя строка — на своём месте.
  const tS = await total(S);
  const tF = await total(F);
  assert.equal(tF, tS + 1, `F видит M-друга, S — нет (${tF} / ${tS})`);
  assert.equal(await total(M), tS + 1, 'M (16–17) видит себя');
  t = await top(S, 'all');
  assert.equal(t.scope, 'all');
  assert.ok(!t.items.some((x) => x.user.id === M.me.id), '16–17 чужим во «Всех» не видна');
  assert.ok(t.items.every((x, i) => x.place === i + 1 && (i === 0 || t.items[i - 1].chips >= x.chips)), 'места подряд, по фишкам');
  assert.ok(t.items.length <= 20 && t.items.filter((x) => x.me).every((x) => x.user.id === S.me.id), 'me — только своя строка');
  const own = t.items.find((x) => x.me);
  assert.ok(t.me && t.me.chips === 1000 && t.me.place >= 1 && t.me.place <= t.total && (!own || own.place === t.me.place),
    'своё место совпадает со строкой в списке: ' + JSON.stringify(t.me));
  // H скрылась из поиска — чужим не видна, себе — да; S блокирует F — не видят друг друга.
  expect(await call(H.jar, 'PATCH', '/api/social/me', { json: { searchable: false }, headers: W }), 200, 'H скрылась из поиска');
  const tS1 = await total(S);
  assert.equal(tS1, tS - 1, 'скрылась из поиска — не во «Всех» у чужих');
  assert.equal(await total(H), tS1 + 1, 'своя строка — всегда');
  const tF1 = await total(F);
  expect(await call(S.jar, 'PUT', `/api/social/blocks/${F.me.id}`, { json: {}, headers: W }), 200, 'S блокирует F');
  assert.deepEqual([await total(S), await total(F)], [tS1 - 1, tF1 - 1], 'блокировка — не видят друг друга');
  expect(await call(S.jar, 'DELETE', `/api/social/blocks/${F.me.id}`, { json: {}, headers: W }), 200, 'S разблокировал F');
  assert.equal(await total(S), tS1);
  ok(`«Покер»: рейтинг «Все» (${tS} чел.) — 16–17 чужим не видна, другу — да; скрытые из поиска и заблокированные — нет; своя строка всегда, места подряд`);
}

// ═══════════════ Живые обновления (CONTRACT.md §J) ═══════════════

const LIVE = '/api/social/live';
/** Поток живых обновлений (SSE) человека: как stream(), но /api/social/live. */
const live = (u, o = {}) => stream(u, { ...o, path: LIVE });
/** Открыть потоки людей и дождаться hello в каждом. Сервер теста держит поток 5 с — открываем на каждый шаг заново. */
async function lives(...us) {
  const out = [];
  for (const u of us) {
    const s = await live(u);
    assert.equal(s.status, 200, 'поток живых обновлений: ' + s.raw.slice(0, 200));
    await s.wait('hello');
    out.push(s);
  }
  return out;
}
/** За ms в поток s не пришло событие name (с pred). */
async function none(s, name, pred, ms = 350, what = name) {
  if (ms) await sleep(ms);
  const extra = s.events.filter((e) => e.event === name && (!pred || pred(e.data)));
  assert.equal(extra.length, 0, `${what}: пришло лишнее ${JSON.stringify(extra.map((e) => e.data)).slice(0, 300)}`);
}
const closeAll = (...ss) => { for (const s of ss.flat()) if (s) s.close(); };

async function runLive(boss, guest) {
  const seen = {};   // первое настоящее событие каждого вида — для SMOKE_LIVE_SHOW=1
  const keepOne = (name, d) => { if (!(name in seen)) seen[name] = d; return d; };
  const W8 = 3000;
  let r;

  // 1. Гостю — 401 JSON; вошедшему — SSE: заголовки, retry: 3000, hello, ping (GAME_PING_MS=1000).
  expect(await call(guest, 'GET', LIVE), 401, 'живые обновления гостю', 'auth', 'Войди через Google, чтобы продолжить');
  const A = await user('la', `Лейла ${RUN}`);
  const B = await user('lb', `Бахром ${RUN}`);
  const C = await user('lc', `Сардор ${RUN}`);
  const D = await user('ld', `Дильноза ${RUN}`);
  const E = await user('le', `Эльёр ${RUN}`);
  const [sE0] = await lives(E);               // проживёт до конца раздела: в конце — bye max_age
  assert.match(sE0.headers['content-type'] || '', /^text\/event-stream; charset=utf-8/);
  assert.match(sE0.headers['cache-control'] || '', /no-store/);
  assert.equal(sE0.headers['x-accel-buffering'], 'no');
  assert.equal(sE0.headers['x-robots-tag'], 'noindex');
  assert.ok(sE0.raw.startsWith('retry: 3000\n\nevent: hello\ndata: {"now":'), 'retry: 3000, затем hello: ' + JSON.stringify(sE0.raw.slice(0, 80)));
  assert.ok(Number.isInteger(sE0.events[0].data.now), 'hello.now');
  const t0 = Date.now();
  const ping = await sE0.wait('ping', null, 2500);
  assert.ok(Number.isInteger(ping.now) && Date.now() - t0 <= 2500, 'ping за ~1,5 с');
  ok('живые обновления: гостю 401 auth; вошедшему — text/event-stream, no-store, noindex, retry: 3000, hello, ping');

  // 2. Пост: B получает post с mine:false (тот же объект, что в его ленте), другое устройство автора (своя сессия) —
  //    mine:true, а сессия, которая его создала, — ничего (знает из ответа: эхо пришло бы раньше ответа).
  //    C, которого A заблокировала, — ничего. Ответ B — A получает reply, C — нет. Лайк A — B получает likes, C — нет.
  expect(await call(A.jar, 'PUT', `/api/social/blocks/${C.me.id}`, { json: {}, headers: W }), 200, 'A блокирует C');
  const A2 = await login(`sm_${RUN}_la`);          // второе устройство A (своя сессия)
  let [sA, sA2, sB, sC] = await lives(A, A2, B, C);
  const p = await post(A, `Живой пост · ${RUN}`, 'other');
  const gotPost = keepOne('post', await sB.wait('post', (d) => d.post && d.post.id === p.id, W8));
  assert.deepEqual([gotPost.post.mine, gotPost.post.canDelete, gotPost.post.liked, gotPost.post.author.id, gotPost.post.author.uni],
    [false, false, false, A.me.id, UNI]);
  const inFeed = expect(await call(B.jar, 'GET', '/api/social/feed?limit=50'), 200, 'лента B').items.find((x) => x.id === p.id);
  assert.deepEqual(gotPost.post, inFeed, 'post в потоке — тот же Post, что в ленте B');
  assert.equal((await sA2.wait('post', (d) => d.post.id === p.id, W8)).post.mine, true, 'другому устройству автора — mine:true');
  const rp = await reply(B, p.id, `Живой ответ · ${RUN}`);
  const gotReply = keepOne('reply', await sA.wait('reply', (d) => d.reply && d.reply.id === rp.id, W8));
  const inThread = expect(await thread(A.jar, p.id), 200, 'ветка A').replies.find((x) => x.id === rp.id);
  assert.deepEqual(gotReply.reply, inThread, 'reply в потоке — тот же Post, что в ветке A');
  assert.deepEqual([gotReply.reply.rootId, gotReply.reply.mine, gotReply.reply.author.id], [p.id, false, B.me.id]);
  const like = (u, id, on) => call(u.jar, on ? 'PUT' : 'DELETE', `/api/social/posts/${id}/like`, { json: {}, headers: W });
  expect(await like(A, rp.id, true), 200, 'A лайкает ответ B');
  assert.deepEqual(keepOne('likes', await sB.wait('likes', (d) => d.id === rp.id, W8)), { id: rp.id, likes: 1 });
  await none(sA, 'post', (d) => d.post.id === p.id, 300, 'сессии, создавшей пост, — без эха');
  await none(sB, 'reply', (d) => d.reply.id === rp.id, 0, 'сессии, создавшей ответ, — без эха');
  await none(sC, 'post', (d) => d.post.id === p.id, 0, 'C (заблокирован A): post');
  await none(sC, 'reply', (d) => d.reply.id === rp.id, 0, 'C: reply в ветке A');
  await none(sC, 'likes', (d) => d.id === rp.id, 0, 'C: likes в ветке A');
  closeAll(sA, sA2, sB, sC);
  ok('живые обновления: пост → post другим (mine:false, как в ленте), другому устройству автора mine:true, своей сессии — без эха; ответ → reply; лайк → likes; заблокированному — ничего');

  // 3. Склейка likes (не чаще раза в 700 мс на пост, последнее число) и gone: удалил ответ — A, удалил пост — B;
  //    удалившей сессии — без эха.
  [sA, sB] = await lives(A, B);
  for (const on of [false, true, false]) expect(await like(A, rp.id, on), 200, 'лайк ' + on);
  await sleep(900);
  // Окно прошлого лайка могло ещё не закрыться — тогда всё уйдёт одним событием в его конце.
  const burst = sB.events.filter((e) => e.event === 'likes' && e.data.id === rp.id).map((e) => e.data.likes);
  assert.ok(burst.length >= 1 && burst.length <= 2 && burst[burst.length - 1] === 0,
    '3 изменения подряд → не больше 2 событий, последнее — итоговое число: ' + JSON.stringify(burst));
  expect(await call(B.jar, 'DELETE', `/api/social/posts/${rp.id}`, { json: {}, headers: W }), 200, 'B удаляет ответ');
  assert.deepEqual(await sA.wait('gone', (d) => d.id === rp.id, W8), { id: rp.id, rootId: p.id });
  expect(await call(A.jar, 'DELETE', `/api/social/posts/${p.id}`, { json: {}, headers: W }), 200, 'A удаляет пост');
  assert.deepEqual(keepOne('gone', await sB.wait('gone', (d) => d.id === p.id, W8)), { id: p.id, rootId: null });
  await none(sB, 'gone', (d) => d.id === rp.id, 200, 'удалившей ответ сессии — без эха');
  await none(sA, 'gone', (d) => d.id === p.id, 0, 'удалившей пост сессии — без эха');
  closeAll(sA, sB);
  ok(`живые обновления: likes склеиваются (3 изменения → ${burst.length} соб., последнее — итоговое число); удаление ответа и поста → gone {id, rootId}`);

  // 4. Друзья: заявка → incoming + me; принять → friends + me; встречная → friends; отказ → none без me;
  //    отмена своей заявки → none + me; удалить из друзей → none + me; блокировка → второму ничего.
  const fr = (u, id, path = '', method = 'POST') => call(u.jar, method, `/api/social/friends/${id}${path}`, { json: {}, headers: W });
  let sD;
  [sA, sB, sD] = await lives(A, B, D);
  expect(await fr(A, B.me.id), 200, 'A → B');
  const relIn = keepOne('relation', await sB.wait('relation', (d) => d.user && d.user.id === A.me.id, W8));
  assert.deepEqual([relIn.relation, relIn.user.username, relIn.user.name], ['incoming', A.me.username, A.me.name]);
  keepOne('me', await sB.wait('me', null, W8));
  expect(await fr(B, A.me.id, '/accept'), 200, 'B принимает');
  assert.equal((await sA.wait('relation', (d) => d.user.id === B.me.id, W8)).relation, 'friends');
  await sA.wait('me', null, W8);
  expect(await fr(D, A.me.id), 200, 'D → A');
  assert.equal((await sA.wait('relation', (d) => d.user.id === D.me.id, W8)).relation, 'incoming');
  expect(await fr(A, D.me.id, '/decline'), 200, 'A отклоняет D');
  assert.equal((await sD.wait('relation', (d) => d.user.id === A.me.id, W8)).relation, 'none');
  await none(sD, 'me', null, 300, 'отказ: me не нужен');
  const aRel = () => sA.events.filter((e) => e.event === 'relation' && e.data.user.id === D.me.id).map((e) => e.data.relation);
  expect(await fr(D, A.me.id), 200, 'D → A снова');
  await sA.until(() => aRel().length === 2, W8, 'вторая заявка D');
  expect(await fr(D, A.me.id, '', 'DELETE'), 200, 'D отменяет заявку');
  await sA.until(() => aRel().length === 3, W8, 'отмена заявки D');
  assert.deepEqual(aRel(), ['incoming', 'incoming', 'none'], 'A видит заявки D и отмену: ' + JSON.stringify(aRel()));
  await sA.until(() => {
    const i = sA.events.findIndex((e) => e.event === 'relation' && e.data.user.id === D.me.id && e.data.relation === 'none');
    return i >= 0 && sA.events.slice(i + 1).some((e) => e.event === 'me');
  }, W8, 'me после отмены заявки');
  expect(await fr(D, A.me.id), 200, 'D → A в третий раз');
  expect(await fr(A, D.me.id), 200, 'A → D при встречной — сразу дружба');
  assert.equal((await sD.wait('relation', (d) => d.user.id === A.me.id && d.relation === 'friends', W8)).relation, 'friends');
  expect(await fr(D, B.me.id), 200, 'D → B');
  expect(await fr(B, D.me.id, '/accept'), 200, 'B принимает D');
  closeAll(sA, sB, sD);
  ok('живые обновления: заявка → incoming + me; принять и встречная → friends; отказ → none без me; отмена → none + me');

  // 5. Моменты: A (друг B) — момент друзьям → B получает instants, C (заблокирован) и сама A — нет; удалила — снова B.
  [sA, sB, sC] = await lives(A, B, C);
  const im = await uploadPhoto(A, { full: makeJpeg(1080, 1080, SCENES.sea), thumb: makeJpeg(640, 640, SCENES.sea) });
  const mo = expect(await call(A.jar, 'POST', '/api/social/instants', { json: { media: im.id, audience: 'friends' }, headers: W }), 201, 'момент друзьям');
  assert.deepEqual(keepOne('instants', await sB.wait('instants', null, W8)), {});
  await none(sC, 'instants', null, 300, 'C: момент A');
  await none(sA, 'instants', null, 0, 'автору про свой момент');
  expect(await call(A.jar, 'DELETE', `/api/social/instants/${mo.id}`, { json: {}, headers: W }), 200, 'A удаляет момент');
  await sB.until(() => sB.events.filter((e) => e.event === 'instants').length === 2, W8, 'instants после удаления');
  await none(sC, 'instants', null, 200, 'C: удаление момента A');
  closeAll(sA, sB, sC);
  ok('живые обновления: момент другу → instants (и при удалении); заблокированному и автору — нет');

  // 6. Приглашения в покер: не другу, себе, несуществующему → 403; to не число → 400; другу → invite и me.game.invite;
  //    повтор за минуту → 429; «не сейчас» → null, снова позвать до конца минуты → 429; сел за стол → приглашение снято.
  const inv = (u, to) => call(u.jar, 'POST', `${G}/invite`, { json: { to }, headers: W });
  bad(await inv(A, 'x'), 'to не число', 'Неверный запрос', 'to');
  bad(await inv(A, 1.5), 'to дробное', 'Неверный запрос', 'to');
  for (const [to, what] of [[C.me.id, 'не другу (и блокировка)'], [E.me.id, 'не другу'], [A.me.id, 'себе'], [999999999, 'несуществующему']]) {
    expect(await inv(A, to), 403, 'позвать ' + what, 'blocked', 'Нельзя позвать этого человека');
  }
  expect(await call(guest, 'POST', `${G}/invite`, { json: { to: B.me.id }, headers: W }), 401, 'позвать гостем', 'auth');
  expect(await call(A.jar, 'POST', `${G}/invite`, { json: { to: B.me.id } }), 403, 'позвать без X-Para', 'csrf');
  [sA, sB] = await lives(A, B);
  assert.deepEqual(expect(await inv(A, B.me.id), 200, 'A зовёт B'), {});
  const gotInv = keepOne('invite', await sB.wait('invite', null, W8));
  assert.equal(gotInv.from.id, A.me.id);
  assert.deepEqual(Object.keys(gotInv).sort(), ['at', 'from']);
  assert.ok(Number.isInteger(gotInv.at) && Math.abs(gotInv.at - Date.now()) < 10_000, 'at — мс сервера');
  let bg = (await meOf(B.jar)).game;
  assert.deepEqual([bg.invite.from.id, bg.invite.from.username, bg.invite.at], [A.me.id, A.me.username, gotInv.at]);
  assert.deepEqual(bg.invite.from, gotInv.from, 'from в me — та же карточка');
  r = await inv(A, B.me.id);
  expect(r, 429, 'позвать снова за минуту', 'rate', 'Уже позвали — подожди минуту');
  assert.ok(r.json.retryAfter >= 1 && r.json.retryAfter <= 60 && Number(r.headers['retry-after']) === r.json.retryAfter, 'retryAfter до конца минуты: ' + r.json.retryAfter);
  expect(await call(B.jar, 'POST', `${G}/invite/dismiss`, { json: {}, headers: W }), 200, '«не сейчас»');
  assert.equal((await meOf(B.jar)).game.invite, null, 'после «не сейчас» — null');
  expect(await inv(A, B.me.id), 429, 'снова до конца минуты', 'rate', 'Уже позвали — подожди минуту');
  assert.equal((await meOf(A.jar)).game.invite, null, 'у зовущего приглашения нет');
  // Сел за стол — входящее приглашение снимается; players — живым, когда кто-то сел и встал.
  const n0 = (await meOf(A.jar)).game.players;
  expect(await inv(D, B.me.id), 200, 'D зовёт B');
  assert.equal((await meOf(B.jar)).game.invite.from.id, D.me.id, 'новое приглашение заменило прежнее');
  expect(await gcall(B, 'POST', '/sit'), 200, 'B сел за стол');
  bg = (await meOf(B.jar)).game;
  assert.deepEqual([bg.invite, bg.players], [null, n0 + 1], 'сел — приглашение снято');
  assert.deepEqual(keepOne('players', await sA.wait('players', (d) => d.n === n0 + 1, W8)), { n: n0 + 1 });
  expect(await gcall(B, 'POST', '/stand'), 200, 'B встал');
  await sA.wait('players', (d) => d.n === n0, 4500);
  closeAll(sA, sB);
  ok(`живые обновления: позвать в покер — не другу/себе/несуществующему 403 «Нельзя позвать…», to 400; другу → invite + me.game.invite; повтор → 429 (retryAfter ${r.json.retryAfter} с); «не сейчас» → null; сел → снято; players ${n0 + 1} → ${n0}`);

  // 7. Модерация: жалоба → модератору me; скрытие модератором → gone всем, кроме модератора и автора (им пост виден);
  //    бан и снятие → человеку me, поток ограниченного не закрывается (он читает).
  let sBoss;
  [sA, sB, sBoss] = await lives(A, B, boss);
  const p2 = await post(A, `Пост для модератора · ${RUN}`, 'other');
  assert.equal((await sBoss.wait('post', (d) => d.post.id === p2.id, W8)).post.canDelete, true, 'модератору canDelete');
  expect(await report(B, 'post', p2.id, 'spam'), 200, 'B жалуется');
  await sBoss.wait('me', null, W8);
  expect(await admin(boss, { action: 'hide', target: { type: 'post', id: p2.id } }), 200, 'модератор скрыл');
  assert.deepEqual(await sB.wait('gone', (d) => d.id === p2.id, W8), { id: p2.id, rootId: null });
  await none(sBoss, 'gone', (d) => d.id === p2.id, 300, 'модератору gone при скрытии');
  await none(sA, 'gone', (d) => d.id === p2.id, 0, 'автору gone при скрытии');
  closeAll(sA, sB, sBoss);
  [sC] = await lives(C);
  expect(await admin(boss, { action: 'ban', target: { type: 'user', id: C.me.id }, days: 1, reason: 'Проверка живых обновлений' }), 200, 'бан C');
  await sC.wait('me', null, W8);
  const sC2 = (await lives(C))[0];
  expect(await admin(boss, { action: 'unban', target: { type: 'user', id: C.me.id } }), 200, 'снять бан C');
  await sC2.until(() => sC2.events.filter((e) => e.event === 'me').length >= 1, W8, 'me после снятия бана');
  assert.ok(!sC.events.some((e) => e.event === 'bye'), 'поток ограниченного не закрыт');
  closeAll(sC, sC2);
  ok('живые обновления: жалоба → модератору me; скрытие → gone всем, кроме модератора и автора; бан и снятие → me, поток не закрыт');

  // 8. Потоки: живёт GAME_STREAM_MAX_MS (5 с) → bye max_age; 4-й у человека → bye replaced, c= — тихо;
  //    выход → bye session только потокам своей сессии.
  assert.equal((await sE0.wait('bye', null, 7000)).reason, 'max_age', 'первый поток раздела дожил до max_age');
  await sE0.until(() => sE0.ended, 2000, 'поток закрыт после max_age');
  const s4 = [];
  for (let i = 0; i < 4; i++) s4.push((await lives(E))[0]);
  assert.equal((await s4[0].wait('bye', null, 2000)).reason, 'replaced', '4-й поток вытесняет самый старый');
  await s4[0].until(() => s4[0].ended, 2000, 'вытесненный закрыт');
  assert.ok(!s4.slice(1).some((s) => s.events.some((e) => e.event === 'bye')), 'остальные живы');
  closeAll(s4);
  const tab = 'live' + RUN + 'tab';
  const sT1 = await live(E, { c: tab });
  await sT1.wait('hello');
  const sT2 = await live(E, { c: tab });
  await sT2.wait('hello');
  await sT1.until(() => sT1.ended, 2000, 'та же вкладка (c=) — старое соединение закрыто');
  assert.ok(!sT1.events.some((e) => e.event === 'bye'), 'c= — без bye');
  closeAll(sT1, sT2);
  const [sA1, sA2b] = await lives(A, A2);
  expect(await call(A2.jar, 'POST', '/api/auth/logout', { json: {}, headers: W }), 200, 'выход A2');
  assert.equal(keepOne('bye', await sA2b.wait('bye', null, 2000)).reason, 'session', 'выход → bye session');
  await none(sA1, 'bye', null, 250, 'поток другой сессии');
  closeAll(sA1, sA2b);
  ok('живые обновления: через 5 с — bye max_age; 4-й поток → bye replaced, c= заменяет тихо; выход → bye session (другая сессия жива)');

  if (process.env.SMOKE_LIVE_SHOW === '1') {
    for (const [k, v] of Object.entries(seen)) console.log(`     событие ${k}: ${JSON.stringify(v)}`);
  }
}


// ═══════════════ Прогон D: вход через поддельный Google ═══════════════

/** Поддельный Google (обмен кода на id_token) на 127.0.0.1:SMOKE_GOOGLE_PORT и вход через него. */
async function fakeGoogleServer(ORIGIN) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  let clientId = '';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = new URLSearchParams(body);
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      let spec;
      try { spec = JSON.parse(Buffer.from(p.get('code') || '', 'base64url').toString('utf8')); } catch { return send(400, { error: 'invalid_grant' }); }
      const pkce = createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === spec.challenge;
      if (spec.fail || !pkce || p.get('grant_type') !== 'authorization_code' || p.get('client_id') !== clientId
        || !p.get('client_secret') || p.get('redirect_uri') !== ORIGIN + '/api/auth/google/callback') {
        return send(400, { error: 'invalid_grant' });
      }
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: 'https://accounts.google.com', aud: clientId, azp: clientId, sub: spec.sub, email: spec.email,
        email_verified: spec.verified !== false, nonce: spec.nonce, given_name: spec.given, name: spec.given + ' Тестов', iat: now, exp: now + 3600 };
      return send(200, { access_token: 'ya29.x', token_type: 'Bearer', expires_in: 3599, id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.sig` });
    });
  });
  await new Promise((r) => server.listen(GOOGLE_PORT, '127.0.0.1', r));
  /**
   * start → «Google» → callback; возвращает адрес, куда callback отправил браузер.
   * host — где начали вход (адрес вуза: callback всё равно на Para); cbJar — куки браузера на адресе Para.
   */
  const signIn = async (jar, { intent = 'signin', age = 'adult', sub, email, verified, nonce, fail, back = '/?tab=profile',
    host = HUB, cbJar = jar }) => {
    let q = `/api/auth/google/start?return=${encodeURIComponent(back)}&intent=${intent}`;
    if (intent === 'signin') q += `&age=${age}&accept=1`;
    const s = await call(jar, 'GET', q, { host });
    if (/#auth=limited$/.test(s.headers.location)) throw new Error(LIMITED);
    const u = new URL(s.headers.location);
    assert.equal(u.origin, 'https://accounts.google.com', 'start должен вести на Google: ' + s.headers.location);
    clientId = u.searchParams.get('client_id');
    const code = Buffer.from(JSON.stringify({ sub, email, verified, fail, given: 'Гугл', challenge: u.searchParams.get('code_challenge'),
      nonce: nonce || u.searchParams.get('nonce') })).toString('base64url');
    assert.equal(u.searchParams.get('redirect_uri'), ORIGIN + '/api/auth/google/callback', 'Google возвращает только на Para');
    const r = await call(cbJar, 'GET', `/api/auth/google/callback?state=${u.searchParams.get('state')}&code=${code}`);
    assert.equal(r.status, 302);
    return r.headers.location;
  };
  return { signIn, close: () => server.close() };
}

async function fakeGoogle(ORIGIN) {
  const { signIn, close } = await fakeGoogleServer(ORIGIN);
  try {
    const sub = 'g' + RUN;
    const jar = new Map();
    let loc = await signIn(jar, { intent: 'delete', sub, email: `${sub}@example.com` });
    assert.equal(loc, ORIGIN + '/?tab=profile#auth=none');
    assert.equal(await meOf(jar), null);
    loc = await signIn(jar, { intent: 'delete', sub, email: `${sub}@example.com` });
    assert.equal(loc, ORIGIN + '/?tab=profile#auth=none', 'аккаунт не должен был появиться');
    ok('Google intent=delete без аккаунта → #auth=none, аккаунт не создаётся');
    loc = await signIn(jar, { age: 'minor', sub, email: `${sub.toUpperCase()}@Example.com` });
    assert.equal(loc, ORIGIN + '/?tab=profile#auth=ok');
    const me = await meOf(jar);
    assert.deepEqual([me.age, me.privacy.searchable, me.privacy.friendRequests, me.rulesAccepted, me.name, me.needsProfile, me.uni],
      ['minor', false, 'all', true, 'Гугл', true, UNI]);
    assert.match(me.email, /^g•••@example\.com$/);
    ok('Google: новый аккаунт (minor: не ищется, заявки открыты), имя из given_name, согласие записано, вуз из start');
    loc = await signIn(jar, { intent: 'delete', sub, email: `${sub}@example.com` });
    assert.equal(loc, ORIGIN + '/?tab=profile#auth=ok');
    assert.equal((await meOf(jar)).id, me.id);
    ok('Google intent=delete для существующего аккаунта → #auth=ok');
    assert.match(await signIn(new Map(), { sub: 'u' + RUN, email: 'u@example.com', verified: false }), /#auth=unverified$/);
    assert.match(await signIn(new Map(), { sub: 'n' + RUN, email: 'n@example.com', nonce: 'wrong' }), /#auth=failed$/);
    assert.match(await signIn(new Map(), { sub: 'f' + RUN, email: 'f@example.com', fail: true }), /#auth=failed$/);
    ok('Google: неподтверждённая почта → unverified, чужой nonce и ошибка обмена → failed');

    // Вход с адреса вуза: Google возвращает на Para, Para передаёт итог адресу вуза билетом, а сессию создаёт
    // адрес вуза, только если у браузера есть его кука входа. Вне production адреса — http (PARA_ORIGIN http://…).
    const UO = 'http://' + UNI_HOST;
    const ksub = 'k' + RUN;
    const kj = new Map();
    const viaUni = async () => {
      const loc = new URL(await signIn(kj, { sub: ksub, email: `${ksub}@example.com`, host: UNI_HOST, cbJar: new Map(), back: '/?tab=chat' }));
      assert.equal(loc.origin + loc.pathname, UO + '/api/auth/google/finish', 'Para передаёт вход адресу вуза: ' + loc);
      return loc.pathname + loc.search;
    };
    let fin = await viaUni();
    let r = await call(new Map(), 'GET', fin, { host: UNI_HOST, uni: '' });
    assert.equal(r.headers.location, UO + '/?tab=chat#auth=browser', 'билет без куки входа этого браузера');
    r = await call(kj, 'GET', fin, { host: UNI_HOST, uni: '' });
    assert.equal(r.headers.location, UO + '/#auth=expired', 'билет одноразовый');
    fin = await viaUni();
    r = await call(kj, 'GET', fin, { host: 'tsue.skycoax.uz', uni: '' });
    assert.equal(r.headers.location, 'http://tsue.skycoax.uz/#auth=expired', 'билет другого адреса');
    ok('адрес вуза: билет входа одноразовый, только для своего адреса и только с кукой входа этого браузера');
    fin = await viaUni();
    r = await call(kj, 'GET', fin, { host: UNI_HOST, uni: '' });
    assert.equal(r.headers.location, UO + '/?tab=chat#auth=ok');
    const km = expect(await call(kj, 'GET', '/api/auth/me', { host: UNI_HOST, uni: '' }), 200, 'me на адресе вуза').user;
    assert.ok(km, 'после входа на адресе вуза есть сессия');
    assert.equal(km.uni, 'kfu', 'вуз аккаунта — из адреса');
    ok('адрес вуза: вход через Google завершается на нём самом, вуз аккаунта — из адреса');
  } finally {
    close();
  }
}

// ═══════════════ Прогон B: новый аккаунт ═══════════════

async function runNewAccount() {
  const guest = new Map();
  await commonChecks(guest);
  const N = await user('n', `Новичок ${RUN}`);
  const post1 = (text) => call(N.jar, 'POST', '/api/social/posts', { json: { text, category: 'other', media: [] }, headers: W });
  let r = await post1('Смотрите https://example.com');
  bad(r, 'ссылка у нового аккаунта', 'Ссылки можно добавлять через сутки после регистрации', 'text');
  r = await post1('Смотрите www.example.com');
  bad(r, 'www у нового аккаунта', 'Ссылки можно добавлять через сутки после регистрации', 'text');
  ok('новый аккаунт: ссылки нельзя');
  let me = expect(await call(N.jar, 'PATCH', '/api/social/me', { json: { username: `sm_${RUN}_n2` }, headers: W }), 200, 'смена @имени 1');
  me = expect(await call(N.jar, 'PATCH', '/api/social/me', { json: { username: `sm_${RUN}_n3` }, headers: W }), 200, 'смена @имени 2');
  assert.equal(me.usernameNextChange, null);
  ok('новый аккаунт: @имя в первые сутки меняется свободно');
  const root = expect(await post1(`Первая · ${RUN}`), 201, 'публикация 1');
  r = await call(N.jar, 'POST', `/api/social/posts/${root.id}/replies`, { json: { text: 't.me/somebody' }, headers: W });
  bad(r, 'ссылка в ответе нового аккаунта', 'Ссылки можно добавлять через сутки после регистрации', 'text');
  // Дневной предел для нового аккаунта — 5 публикаций. Ведёрко (3 подряд, потом 1 в 2 минуты) — ждём его.
  let made = 1;
  const t0 = Date.now();
  for (;;) {
    r = await post1(`Публикация ${made + 1} · ${RUN}`);
    if (r.status === 201) { made++; continue; }
    expect(r, 429, 'предел', 'rate');
    if (r.json.error === 'Лимит публикаций на сегодня исчерпан — попробуй позже') break;
    const wait = Number(r.headers['retry-after']);
    assert.ok(wait > 0 && wait <= 130, 'Retry-After ведёрка: ' + wait);
    console.log(`     ведёрко: жду ${wait} с (опубликовано ${made})…`);
    await sleep(wait * 1000 + 300);
  }
  assert.equal(made, 5, 'дневной предел нового аккаунта — 5 публикаций');
  assert.ok(Number(r.headers['retry-after']) > 3600, 'Retry-After до конца суток');
  ok(`новый аккаунт: 6-я публикация за сутки → 429 «${r.json.error}» (${Math.round((Date.now() - t0) / 1000)} с)`);
}

// ═══════════════ Прогон C: readonly и off ═══════════════

async function runReadonly() {
  const guest = new Map();
  await commonChecks(guest);
  const alice = await login('alice');
  const bob = await login('bob');
  const mia = await login('mia');
  if (alice.me.needsProfile || bob.me.needsProfile) throw new Error('нужны люди из social-seed.mjs (запусти его до перезапуска в readonly)');
  const feed = expect(await call(alice.jar, 'GET', '/api/social/feed?limit=50'), 200, 'лента');
  assert.ok(feed.items.length > 0, 'лента пустая — сначала social-seed.mjs');
  const bobPost = feed.items.find((p) => p.author && p.author.id === bob.me.id);
  expect(await thread(guest, feed.items[0].id), 200, 'ветка');
  expect(await call(alice.jar, 'GET', `/api/social/users/${bob.me.username}`), 200, 'профиль');
  expect(await call(alice.jar, 'GET', '/api/social/friends'), 200, 'друзья');
  ok('readonly: чтение работает (лента, ветка, профиль, друзья), вход работает');

  const ro = async (r, what) => expect(r, 403, what, 'readonly', 'Обсуждения временно доступны только для чтения');
  await ro(await call(alice.jar, 'POST', '/api/social/posts', { json: { text: 'x', category: 'other', media: [] }, headers: W }), 'публикация');
  await ro(await call(alice.jar, 'POST', `/api/social/posts/${feed.items[0].id}/replies`, { json: { text: 'x' }, headers: W }), 'ответ');
  await ro(await call(alice.jar, 'PUT', `/api/social/posts/${feed.items[0].id}/like`, { json: {}, headers: W }), 'лайк');
  await ro(await call(alice.jar, 'DELETE', `/api/social/posts/${feed.items[0].id}/like`, { json: {}, headers: W }), 'снять лайк');
  await ro(await call(alice.jar, 'POST', '/api/social/media?kind=post', { body: PHOTO, headers: W }), 'фото');
  await ro(await call(alice.jar, 'POST', '/api/social/media?kind=avatar', { body: makeJpeg(128, 128), headers: W }), 'аватар');
  await ro(await call(alice.jar, 'PUT', `/api/social/media/${'A'.repeat(22)}/thumb`, { body: PHOTO_T, headers: W }), 'миниатюра');
  await ro(await call(alice.jar, 'POST', `/api/social/friends/${mia.me.id}`, { json: {}, headers: W }), 'заявка');
  await ro(await call(alice.jar, 'POST', `/api/social/friends/${bob.me.id}/accept`, { json: {}, headers: W }), 'принять заявку');
  await ro(await call(alice.jar, 'PATCH', '/api/social/me', { json: { bio: 'новое' }, headers: W }), 'правка профиля');
  await ro(await call(alice.jar, 'PATCH', '/api/social/me', { json: { searchable: true }, headers: W }), 'открыть себя поиску');
  ok('readonly: все маршруты с M → 403 readonly');

  if (bobPost) expect(await report(alice, 'post', bobPost.id, 'spam'), 200, 'жалоба');
  expect(await call(alice.jar, 'PUT', `/api/social/blocks/${mia.me.id}`, { json: {}, headers: W }), 200, 'блок');
  expect(await call(alice.jar, 'DELETE', `/api/social/blocks/${mia.me.id}`, { json: {}, headers: W }), 200, 'разблок');
  expect(await call(alice.jar, 'POST', `/api/social/friends/${mia.me.id}/decline`, { json: {}, headers: W }), 200, 'отказ');
  expect(await call(alice.jar, 'DELETE', `/api/social/friends/${mia.me.id}`, { json: {}, headers: W }), 200, 'отмена/удаление');
  expect(await call(alice.jar, 'DELETE', `/api/social/media/${'A'.repeat(22)}`, { json: {}, headers: W }), 404, 'удаление фото (не 403)', 'not_found');
  expect(await call(alice.jar, 'POST', '/api/social/me/rules', { json: { version: 1 }, headers: W }), 200, 'принять правила');
  expect(await call(mia.jar, 'PATCH', '/api/social/me', { json: { searchable: false, linksVisibility: 'friends' }, headers: W }), 200, 'скрыть себя');
  const own = expect(await call(alice.jar, 'GET', `/api/social/users/${alice.me.username}`), 200, 'свой профиль').posts
    .find((p) => p.replies === 0);
  if (own) expect(await call(alice.jar, 'DELETE', `/api/social/posts/${own.id}`, { json: {}, headers: W }), 200, 'удалить свой пост');
  const tmp = await login(`sm_${RUN}_ro`);
  expect(await call(tmp.jar, 'DELETE', '/api/social/me', { json: { confirm: true }, headers: W }), 200, 'удаление аккаунта');
  expect(await call(bob.jar, 'POST', '/api/auth/logout', { json: {}, headers: W }), 200, 'выход');
  ok('readonly: жалоба, блок, отказ/отмена, удаление фото и своего поста, правила, скрыть себя, удаление аккаунта, выход — работают');

  // ── «Покер» в readonly: смотреть и поток — можно (и гостю); сесть, ход, реакция → 403 readonly; встать — можно ──
  const aliceGame = (await meOf(alice.jar)).game;
  assert.ok(aliceGame && typeof aliceGame.players === 'number' && typeof aliceGame.bonus === 'boolean', 'me.game в readonly: ' + JSON.stringify(aliceGame));
  const tv = expect(await gcall(alice, 'GET', ''), 200, 'стол в readonly');
  assert.ok(tv.me && tv.me.state === 'none' && tv.seats.length === 4, 'стол читается');
  assert.ok(tv.me.bonus && typeof tv.me.bonus.available === 'boolean' && typeof tv.me.broke === 'boolean', 'me.bonus и me.broke в readonly');
  assert.equal(expect(await gcall(null, 'GET', ''), 200, 'стол гостю в readonly').me, null);
  await ro(await gcall(alice, 'POST', '/sit'), 'сесть');
  await ro(await gcall(alice, 'POST', '/act', { json: { hand: 1, action: 'fold' } }), 'ход');
  await ro(await gcall(alice, 'POST', '/react', { json: { r: 'wave' } }), 'реакция');
  await ro(await gcall(alice, 'POST', '/bonus'), 'бонус');
  assert.equal(expect(await gcall(alice, 'POST', '/stand'), 200, 'встать в readonly').table.me.state, 'none');
  const tt = expect(await gcall(alice, 'GET', '/top?scope=all'), 200, 'рейтинг в readonly');
  assert.ok(tt.scope === 'all' && Array.isArray(tt.items) && tt.me && tt.me.chips === tv.me.chips, 'рейтинг в readonly: ' + JSON.stringify(tt.me));
  const s = await stream(alice);
  assert.equal(s.status, 200, 'поток в readonly: ' + s.raw.slice(0, 200));
  await s.wait('hello');
  await s.wait('table', (d) => d.view && d.view.me && d.view.me.state === 'none', 2000);
  s.close();
  ok('readonly: «Покер» — стол читается (и гостю), поток открывается (hello, table), рейтинг — 200; сесть, ход, реакция, бонус → 403 readonly; встать — 200');

  // ── Живые обновления в readonly: поток открывается (гостю — 401); позвать в покер → 403 readonly; «не сейчас» — 200 ──
  expect(await call(guest, 'GET', LIVE), 401, 'живые обновления гостю в readonly', 'auth');
  const ls = await live(alice);
  assert.equal(ls.status, 200, 'живые обновления в readonly: ' + ls.raw.slice(0, 200));
  assert.ok(ls.raw.startsWith('retry: 3000\n\nevent: hello\ndata: {"now":'), 'retry, hello');
  await ls.wait('ping', null, 2500);
  ls.close();
  await ro(await call(alice.jar, 'POST', `${G}/invite`, { json: { to: bob.me.id }, headers: W }), 'позвать в покер');
  expect(await call(alice.jar, 'POST', `${G}/invite/dismiss`, { json: {}, headers: W }), 200, '«не сейчас» в readonly');
  assert.equal((await meOf(alice.jar)).game.invite, null, 'me.game.invite в readonly');
  ok('readonly: живые обновления — поток открывается (retry, hello, ping); позвать в покер → 403 readonly; «не сейчас» — 200');
}

async function runOff() {
  const guest = new Map();
  const st = await commonChecks(guest);
  const X = await login(`sm_${RUN}_off`);
  const signed = expect(await call(X.jar, 'GET', '/api/auth/me'), 200, 'me');
  assert.equal(signed.mode, 'off');
  assert.equal(signed.user.id, X.me.id);
  ok('off: /api/auth/me отвечает mode:"off", вход разработчика работает');
  // «Покер» в off: маршрутов нет (общий 404), пасхалка в приложении молчит.
  assert.equal(signed.config.game, 'off', 'config.game в off');
  assert.equal(signed.user.game, null, 'me.game в off');
  expect(await call(X.jar, 'GET', G), 404, 'стол в off', 'not_found', 'Нет такого адреса API');
  expect(await call(guest, 'GET', G), 404, 'стол гостю в off', 'not_found');
  expect(await call(X.jar, 'GET', G + '/stream'), 404, 'поток игры в off', 'not_found');
  expect(await call(X.jar, 'POST', G + '/sit', { json: {}, headers: W }), 404, 'сесть в off', 'not_found');
  expect(await call(X.jar, 'POST', G + '/invite', { json: { to: 1 }, headers: W }), 404, 'позвать в off', 'not_found');
  expect(await call(X.jar, 'POST', G + '/invite/dismiss', { json: {}, headers: W }), 404, '«не сейчас» в off', 'not_found');
  expect(await call(X.jar, 'POST', G + '/bonus', { json: {}, headers: W }), 404, 'бонус в off', 'not_found');
  expect(await call(X.jar, 'GET', G + '/top?scope=all'), 404, 'рейтинг в off', 'not_found');
  ok('off: «Покер» — config.game off, me.game null, /api/social/games, поток, приглашения, бонус и рейтинг → 404 not_found');
  expect(await call(X.jar, 'GET', LIVE), 404, 'живые обновления в off', 'not_found', 'Нет такого адреса API');
  expect(await call(guest, 'GET', LIVE), 404, 'живые обновления гостю в off', 'not_found');
  ok('off: живые обновления — /api/social/live → 404 not_found');
  // Фото, друзей и жалоб в off нет: Me не ведёт на недоступный аватар и не зажигает значки (у alice из seed есть и то, и другое).
  const alice = await login('alice');
  const boss = await login('boss');
  assert.equal(alice.me.avatar, null, 'off: аватар в Me');
  assert.equal(alice.me.avatarFull, null, 'off: полный аватар в Me');
  assert.equal(alice.me.requestsIn, 0, 'off: заявки в друзья в Me');
  assert.equal(boss.me.modQueue, 0, 'off: очередь жалоб в Me');
  ok('off: в Me нет аватара, заявок в друзья и очереди жалоб');
  const gone = (r, what) => expect(r, 404, what, 'not_found', 'Нет такого адреса API');
  gone(await call(guest, 'GET', '/api/social/feed'), 'лента');
  gone(await call(guest, 'GET', '/api/social/posts/1'), 'ветка');
  gone(await call(X.jar, 'POST', '/api/social/posts', { json: { text: 'x', category: 'other', media: [] }, headers: W }), 'публикация');
  gone(await call(X.jar, 'PATCH', '/api/social/me', { json: { bio: '' }, headers: W }), 'правка профиля');
  gone(await call(X.jar, 'POST', '/api/social/users/search', { json: { q: 'alice' }, headers: W }), 'поиск');
  gone(await call(X.jar, 'GET', '/api/social/admin/reports'), 'модерация');
  gone(await call(X.jar, 'POST', '/api/social/reports', { json: { target: 'post', id: 1, reason: 'spam' }, headers: W }), 'жалоба');
  gone(await call(guest, 'GET', `/api/media/${'A'.repeat(22)}.jpg`), 'фото');
  gone(await call(X.jar, 'POST', '/api/social/media?kind=post', { body: PHOTO, headers: W }), 'загрузка фото');
  ok('off: лента, посты, профили, поиск, жалобы, модерация и фото → 404 JSON');
  let r = await call(guest, 'GET', '/api/auth/google/start?return=/&intent=signin&age=adult&accept=1');
  assert.match(r.headers.location, /\/#auth=unavailable$/);
  r = await call(guest, 'GET', '/api/auth/google/start?return=/delete-account&intent=delete');
  if (st.google) assert.ok(r.headers.location.startsWith('https://accounts.google.com/'), 'intent=delete в off: ' + r.headers.location);
  else assert.match(r.headers.location, /\/delete-account#auth=unavailable$/);
  ok('off: вход через Google для intent=signin → #auth=unavailable; для удаления — ' + (st.google ? 'ведёт на Google' : 'нет ключей'));
  if (GOOGLE_PORT && st.google) {
    const ORIGIN = new URL(r.headers.location).searchParams.get('redirect_uri').replace(/\/api\/auth\/google\/callback$/, '');
    const { signIn, close } = await fakeGoogleServer(ORIGIN);
    try {
      const loc = await signIn(new Map(), { intent: 'delete', sub: 'off' + RUN, email: `off${RUN}@example.com`, back: '/delete-account' });
      assert.equal(loc, ORIGIN + '/delete-account#auth=none');
      ok('off: вход ради удаления через Google проходит до конца (нет аккаунта → #auth=none, ничего не создано)');
    } finally {
      close();
    }
  }
  expect(await call(X.jar, 'POST', '/api/auth/logout', { json: {}, headers: W }), 200, 'выход');
  const Y = await login(`sm_${RUN}_off`);
  expect(await call(Y.jar, 'DELETE', '/api/social/me', { json: { confirm: true }, headers: W }), 200, 'удаление аккаунта');
  assert.equal(await meOf(Y.jar), null);
  r = await call(guest, 'GET', '/api/schedule?group=', { uni: UNI });
  assert.equal(r.status, 200, 'расписание: ' + show(r));
  assert.equal(r.json.ready, true, 'расписание готово');
  assert.ok(Array.isArray(r.json.groups) && r.json.groups.length > 0, 'в расписании есть группы');
  ok('off: выход и удаление аккаунта работают; расписание работает');
}

async function main() {
  const t0 = Date.now();
  console.log(`Дымовой тест обсуждений: ${BASE.origin} · вуз ${UNI} · режим ${MODE}${NEW_ACCOUNT ? ' · новый аккаунт' : ''} · метка ${RUN}\n`);
  if (MODE === 'readonly') await runReadonly();
  else if (MODE === 'off') await runOff();
  else if (NEW_ACCOUNT) await runNewAccount();
  else await runMain();
  const n10 = step % 10;
  const n100 = step % 100;
  const word = n10 === 1 && n100 !== 11 ? 'проверка' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'проверки' : 'проверок';
  console.log(`\nВсё прошло: ${step} ${word}.`);
  console.log(`Время: ${Math.round((Date.now() - t0) / 1000)} с.`);
}

main().catch((e) => { console.error('\nПРОВАЛ после шага', step, '\n', e); process.exit(1); });
