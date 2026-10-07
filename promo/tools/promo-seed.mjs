// Демо-люди и посты для съёмки «Обсуждений» в ролике — без реальных людей.
// Сервер: локальный, с DEV_LOGIN=1 DEV_HUB=1 (см. AGENTS.md), данные во временной папке.
// Фото — папка с <id>.jpg и <id>_t.jpg (Pexels, лицензия Pexels: можно без указания автора).
// Запуск: node promo/tools/promo-seed.mjs http://127.0.0.1:8792 kfu <папка с фото>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const BASE = new URL(process.argv[2] || 'http://127.0.0.1:8792');
const UNI = process.argv[3] || 'kfu';
const PX = process.argv[4];

function call(jar, method, p, { json, body } = {}) {
  return new Promise((done, fail) => {
    const h = { Host: 'localhost:' + BASE.port };
    if (method !== 'GET') h['X-Para'] = '1';
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload = null;
    if (json !== undefined) { payload = Buffer.from(JSON.stringify(json)); h['Content-Type'] = 'application/json'; }
    else if (body) { payload = body; h['Content-Type'] = 'image/jpeg'; }
    h['Content-Length'] = payload ? payload.length : 0;
    const full = p + (p.includes('?') ? '&' : '?') + 'uni=' + UNI;
    const rq = http.request({ hostname: BASE.hostname, port: BASE.port, method, path: full, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        for (const sc of [].concat(res.headers['set-cookie'] || [])) {
          const nv = sc.split(';')[0]; const i = nv.indexOf('=');
          const k = nv.slice(0, i).trim(); const v = nv.slice(i + 1).trim();
          if (v) jar.set(k, v); else jar.delete(k);
        }
        let data = null;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* не JSON */ }
        done({ status: res.statusCode, json: data });
      });
    });
    rq.on('error', fail);
    if (payload) rq.write(payload);
    rq.end();
  });
}
async function must(jar, method, p, opts, what) {
  const r = await call(jar, method, p, opts);
  if (r.status >= 200 && r.status < 300) return r.json ? r.json.data : null;
  throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`);
}

const img = (id, t = false) => fs.readFileSync(path.join(PX, `${id}${t ? '_t' : ''}.jpg`));

// [логин, имя, о себе, аватар (id фото Pexels, квадрат) или null — буква]
const PEOPLE = [
  ['madina', 'Мадина', '1 курс, ИСиТ. Кофе, код и хорошие конспекты', 'av_books'],
  ['sardor', 'Сардор', 'Собираю команду на хакатон', null],
  ['kamola', 'Камола', 'Фотографирую всё подряд', 'av_lib'],
  ['timur', 'Тимур', 'Линейная алгебра и олимпиадные задачи', null],
  ['dilnoza', 'Дилноза', 'Бегаю по утрам', 'av_desk'],
  ['aziz', 'Азиз', 'Мини-футбол и C++', null],
  ['malika', 'Малика', 'Учу корейский', null],
  ['jasur', 'Жасур', null, null],
  ['nilufar', 'Нилуфар', null, null],
];

// [автор, текст, фото[]]
const POSTS = [
  ['aziz', 'В субботу мини-футбол между факультетами — нужны ещё двое в команду ИСиТ ⚽️', []],
  ['malika', 'Поздравляем выпускников! Следующие — мы 🎓', ['267885']],
  ['madina', 'Конспект по основам программирования на C++ за сегодня — кому нужно, забирайте 👇', ['5905710']],
  ['dilnoza', 'Кто идёт на лекцию приглашённого профессора в четверг? Займём места вместе', ['207691']],
  ['timur', 'Разобрал задачи к контрольной по линейной алгебре. Объясню в читальном зале после пятой пары', []],
  ['kamola', 'Новая читалка на втором этаже — тихо, светло и розетка у каждого стола', ['590493']],
  ['sardor', 'Собираем команду на хакатон в ноябре: нужен дизайнер и ещё один разработчик 🚀', []],
];

const REPLIES = [
  ['madina', 'Я в деле! Давно хотела попробовать'],
  ['timur', 'Могу взять бэкенд'],
  ['nilufar', 'А дизайнеру с какого курса можно?'],
];

const MOMENTS = [['kamola', '2041540'], ['dilnoza', '374074'], ['timur', '1029141'], ['aziz', '261909']];

async function main() {
  const who = {};
  for (const [u, name, bio, av] of PEOPLE) {
    const jar = new Map();
    let me = await must(jar, 'POST', '/api/auth/dev', { json: { name: u } }, 'вход ' + u);
    if (me.needsProfile) {
      const patch = { username: u, name };
      if (bio) patch.bio = bio;
      me = await must(jar, 'PATCH', '/api/social/me', { json: patch }, 'профиль ' + u);
    }
    if (!me.rulesAccepted) me = await must(jar, 'POST', '/api/social/me/rules', { json: { version: 1 } }, 'правила ' + u);
    if (av && !me.avatar) {
      const up = await must(jar, 'POST', '/api/social/media?kind=avatar', { body: img(av) }, 'аватар ' + u);
      await must(jar, 'PUT', `/api/social/media/${up.id}/thumb`, { body: img(av, true) }, 'миниатюра аватара ' + u);
      me = await must(jar, 'PATCH', '/api/social/me', { json: { avatar: up.id } }, 'аватар ' + u);
    }
    who[u] = { jar, me };
  }
  const posts = [];
  for (const [u, text, photos] of POSTS) {
    const { jar } = who[u];
    const media = [];
    for (const id of photos) {
      const up = await must(jar, 'POST', '/api/social/media?kind=post', { body: img(id) }, 'фото ' + id);
      await must(jar, 'PUT', `/api/social/media/${up.id}/thumb`, { body: img(id, true) }, 'миниатюра ' + id);
      media.push(up.id);
    }
    posts.push(await must(jar, 'POST', '/api/social/posts', { json: { text, category: 'other', media } }, 'пост ' + u));
  }
  const top = posts[posts.length - 1];
  for (const [u, text] of REPLIES) {
    await must(who[u].jar, 'POST', `/api/social/posts/${top.id}/replies`, { json: { text, media: [] } }, 'ответ ' + u);
  }
  // лайки: у каждого поста — разное число
  const names = Object.keys(who);
  posts.forEach((p, i) => {
    const k = [3, 7, 5, 6, 4, 8, 6][i % 7];
    for (const u of names.slice(0, k)) void call(who[u].jar, 'PUT', `/api/social/posts/${p.id}/like`);
  });
  await new Promise((r) => setTimeout(r, 800));
  // друзья Мадины — все
  const me = who.madina;
  for (const u of names.filter((x) => x !== 'madina')) {
    await call(me.jar, 'POST', `/api/social/friends/${who[u].me.id}`);
    await call(who[u].jar, 'POST', `/api/social/friends/${me.me.id}/accept`);
  }
  for (const [u, id] of MOMENTS) {
    const { jar } = who[u];
    const up = await must(jar, 'POST', '/api/social/media?kind=post', { body: img(id) }, 'фото момента ' + id);
    await must(jar, 'PUT', `/api/social/media/${up.id}/thumb`, { body: img(id, true) }, 'миниатюра момента ' + id);
    await must(jar, 'POST', '/api/social/instants', { json: { media: up.id, audience: 'all' } }, 'момент ' + u);
  }
  console.log('готово:', posts.length, 'постов,', MOMENTS.length, 'момента; вход — dev:madina');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
