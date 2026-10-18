// Дымовой тест «Раннего доступа» (CONTRACT.md §L): запись с согласием, выход, выгрузка модератору, Me, бренд страницы.
// Сервер — как для social-smoke.mjs (DEV_LOGIN=1, SOCIAL_ADMIN_EMAILS=boss@dev.local) и с HUB_DIR, где в hub.json
// "earlyAccess": true и "playTest": "https://play.google.com/apps/testing/uz.skycoax.para":
//   node server/test/early-smoke.mjs http://127.0.0.1:8792
import http from 'node:http';
import assert from 'node:assert/strict';

const BASE = new URL(process.argv[2] || 'http://127.0.0.1:8792');
const HUB = 'para.skycoax.uz';
const W = { 'X-Para': '1', Origin: 'https://' + HUB };
const RUN = Date.now().toString(36).slice(-5);

let step = 0;
const ok = (name) => console.log(String(++step).padStart(3, '0'), 'ok ', name);

function call(jar, method, path, { json, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: HUB, ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const payload = json === undefined ? null : Buffer.from(JSON.stringify(json));
    if (payload) h['Content-Type'] = 'application/json';
    h['Content-Length'] = payload ? payload.length : 0;
    const rq = http.request({ hostname: BASE.hostname, port: BASE.port, method, path, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        for (const sc of [].concat(res.headers['set-cookie'] || [])) {
          const [nv, ...attrs] = sc.split(';');
          const i = nv.indexOf('=');
          const k = nv.slice(0, i).trim();
          const v = nv.slice(i + 1).trim();
          if (!v || /max-age=0/i.test(attrs.join(';'))) jar.delete(k); else jar.set(k, v);
        }
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch { /* страница */ }
        resolve({ status: res.statusCode, json: data, text });
      });
    });
    rq.on('error', reject);
    if (payload) rq.write(payload);
    rq.end();
  });
}

const show = (r) => `${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 300) : r.text.slice(0, 80)}`;
function expect(r, status, what, code) {
  assert.equal(r.status, status, `${what}: ${show(r)}`);
  if (code) assert.equal(r.json && r.json.code, code, `${what}: код ${show(r)}`);
  return r.json ? r.json.data : null;
}
async function login(name) {
  const jar = new Map();
  expect(await call(jar, 'POST', '/api/auth/dev', { json: { name }, headers: W }), 200, 'вход ' + name);
  return jar;
}
const meOf = async (jar) => expect(await call(jar, 'GET', '/api/auth/me'), 200, 'me').user;

// Бренд страницы Para: карточка включена, ссылка тестирования передана
const page = await call(new Map(), 'GET', '/');
assert.match(page.text, /"earlyAccess":true/, 'бренд: earlyAccess');
assert.match(page.text, /"playTest":"https:\/\/play\.google\.com\//, 'бренд: playTest');
ok('страница Para: earlyAccess и playTest в бренде');

// Гость и CSRF
const guest = new Map();
expect(await call(guest, 'POST', '/api/social/early', { json: { consent: true }, headers: W }), 401, 'гость', 'auth');
const a = await login(`ea_${RUN}_a`);
expect(await call(a, 'POST', '/api/social/early', { json: { consent: true }, headers: { Origin: 'https://' + HUB } }), 403, 'без X-Para', 'csrf');
ok('гостю — 401, без X-Para — 403');

// Без согласия — 400; с согласием — записан, повтор — то же
let r = await call(a, 'POST', '/api/social/early', { json: {}, headers: W });
expect(r, 400, 'без согласия', 'invalid');
assert.equal(r.json.field, 'consent');
expect(await call(a, 'POST', '/api/social/early', { json: { consent: 'yes' }, headers: W }), 400, 'согласие не true', 'invalid');
assert.equal((await meOf(a)).earlyAccess, false, 'Me до записи');
assert.deepEqual(expect(await call(a, 'POST', '/api/social/early', { json: { consent: true }, headers: W }), 200, 'запись'),
  { earlyAccess: true });
expect(await call(a, 'POST', '/api/social/early', { json: { consent: true }, headers: W }), 200, 'повтор');
assert.equal((await meOf(a)).earlyAccess, true, 'Me после записи');
ok('без согласия — 400 consent; запись и повтор; Me.earlyAccess');

// Выгрузка — только модератору; почты через запятую в порядке записи
const b = await login(`ea_${RUN}_b`);
expect(await call(b, 'POST', '/api/social/early', { json: { consent: true }, headers: W }), 200, 'запись b');
expect(await call(b, 'GET', '/api/social/admin/early'), 403, 'не модератор', 'forbidden');
const boss = await login('boss');
let ex = expect(await call(boss, 'GET', '/api/social/admin/early'), 200, 'выгрузка');
const mine = ex.emails.split(', ').filter((e) => e.includes(`ea_${RUN}_`));
assert.equal(mine.length, 2, 'в выгрузке обе почты: ' + ex.emails);
assert.ok(mine[0].includes(`ea_${RUN}_a`) && mine[1].includes(`ea_${RUN}_b`), 'порядок записи');
assert.equal(ex.count, ex.emails.split(', ').length, 'count');
ok('выгрузка: только модератору, почты через запятую по порядку');

// Выйти из списка — пропадает из выгрузки
assert.deepEqual(expect(await call(a, 'POST', '/api/social/early/remove', { json: {}, headers: W }), 200, 'выход'),
  { earlyAccess: false });
assert.equal((await meOf(a)).earlyAccess, false, 'Me после выхода');
ex = expect(await call(boss, 'GET', '/api/social/admin/early'), 200, 'выгрузка после выхода');
assert.ok(!ex.emails.includes(`ea_${RUN}_a`), 'a нет в выгрузке');
ok('«Выйти из списка» — нет в выгрузке');

// Удаление аккаунта — запись уходит вместе с ним (каскад)
expect(await call(b, 'DELETE', '/api/social/me', { json: { confirm: true }, headers: W }), 200, 'удаление b');
ex = expect(await call(boss, 'GET', '/api/social/admin/early'), 200, 'выгрузка после удаления');
assert.ok(!ex.emails.includes(`ea_${RUN}_b`), 'b нет в выгрузке');
ok('удаление аккаунта убирает из выгрузки');

console.log(`Всё прошло: ${step} проверок.`);
