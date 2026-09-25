// Наполнение «Обсуждений» для разработки: постоянные люди, ~25 публикаций вуза с фото, ветка с ответами,
// лайки, друзья и одна открытая жалоба. Можно запускать повторно: люди те же (вход разработчика dev:<имя>),
// профиль заполняется только при первом входе; у текстов публикаций — метка прогона.
// Нужен сервер с DEV_LOGIN=1 (см. CONTRACT.md §G.0), лучше с SOCIAL_RATE_LIMITS=off.
// Запуск: node server/test/social-seed.mjs [http://127.0.0.1:8792] [kfu]
// Адрес Para подставляется заголовком Host, поэтому DEV_HUB не обязателен.
import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── JPEG без зависимостей ───
// Простой базовый JPEG (JFIF, 3 компоненты, 4:4:4): у каждого блока 8×8 только средний цвет (DC),
// поэтому картинка — плавный «мозаичный» рисунок. Этого хватает, чтобы проверить сетку фото, миниатюры
// и геометрию (соотношение сторон). Размер кадра — любой до 2048.

const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];   // стандартная таблица DC (яркость)
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];   // минимальная таблица AC: EOB и ещё один символ
const AC_VALS = [0x00, 0x01];

function huffCodes(bits, vals) {
  const out = new Map();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) out.set(vals[k++], [code++, len]);
    code <<= 1;
  }
  return out;
}
const DC_CODES = huffCodes(DC_BITS, DC_VALS);
const AC_EOB = huffCodes(AC_BITS, AC_VALS).get(0x00);

const u16 = (n) => [(n >> 8) & 0xFF, n & 0xFF];
const clamp8 = (x) => Math.max(0, Math.min(255, Math.round(x)));

/**
 * Сделать JPEG w×h. paint(u, v, w, h) → [r, g, b] для центра каждого блока 8×8 (u, v — от 0 до 1).
 * @returns {Buffer}
 */
export function makeJpeg(w, h, paint = () => [200, 200, 200]) {
  const head = [
    0xFF, 0xD8,
    0xFF, 0xE0, ...u16(16), 0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xFF, 0xDB, ...u16(67), 0x00, 8, ...new Array(63).fill(1),
    0xFF, 0xC0, ...u16(17), 8, ...u16(h), ...u16(w), 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
    0xFF, 0xC4, ...u16(2 + 17 + DC_VALS.length + 17 + AC_VALS.length),
    0x00, ...DC_BITS, ...DC_VALS, 0x10, ...AC_BITS, ...AC_VALS,
    0xFF, 0xDA, ...u16(12), 3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0,
  ];
  const data = [];
  let acc = 0;
  let n = 0;
  const put = (code, len) => {
    for (let i = len - 1; i >= 0; i--) {
      acc = (acc << 1) | ((code >> i) & 1);
      if (++n === 8) {
        data.push(acc);
        if (acc === 0xFF) data.push(0x00);
        acc = 0;
        n = 0;
      }
    }
  };
  const pred = [0, 0, 0];
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 8);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const [r, g, b] = paint((bx * 8 + 4) / w, (by * 8 + 4) / h, w, h);
      const ycc = [
        0.299 * r + 0.587 * g + 0.114 * b,
        -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
        0.5 * r - 0.418688 * g - 0.081312 * b + 128,
      ];
      for (let c = 0; c < 3; c++) {
        const dc = clamp8(ycc[c]) - 128;                 // DC / 8 = средний уровень (таблица квантования: 8)
        const diff = dc - pred[c];
        pred[c] = dc;
        const size = diff === 0 ? 0 : 32 - Math.clz32(Math.abs(diff));
        const [code, len] = DC_CODES.get(size);
        put(code, len);
        if (size) put(diff > 0 ? diff : diff + (1 << size) - 1, size);
        put(AC_EOB[0], AC_EOB[1]);
      }
    }
  }
  if (n) put((1 << (8 - n)) - 1, 8 - n);
  return Buffer.from([...head, ...data, 0xFF, 0xD9]);
}

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
/** Мягкий край круга радиуса r: 1 внутри, 0 снаружи. У мозаики 8×8 резкий край — «лесенка», мягкий — нет. */
const disc = (d, r, w = 0.05) => {
  const t = Math.max(0, Math.min(1, (d - r + w) / (2 * w)));
  return 1 - t * t * (3 - 2 * t);
};
/** Сюжеты для фото: небо с солнцем, море, поле, ночь, тетрадь в линейку, предмет на столе. */
export const SCENES = {
  sunset: (u, v) => {
    const sky = mix([255, 170, 90], [120, 60, 150], v * 1.3);
    const d = Math.hypot(u - 0.68, (v - 0.42) * 1.2);
    return mix(mix(sky, [255, 215, 140], 0.35 - d), [255, 236, 170], disc(d, 0.11, 0.04));
  },
  sea: (u, v) => (v < 0.55
    ? mix([150, 200, 245], [215, 235, 250], v / 0.55)
    : mix([40, 110, 170], [20, 60, 110], (v - 0.55) / 0.45)),
  field: (u, v) => (v < 0.5
    ? mix([120, 180, 235], [200, 225, 245], v / 0.5)
    : mix([110, 170, 70], [60, 120, 40], (v - 0.5) / 0.5 + 0.2 * Math.sin(u * 12))),
  night: (u, v) => {
    const d = Math.hypot(u - 0.3, v - 0.3);
    return mix(mix([20, 30, 70], [5, 10, 30], v), [235, 235, 215], disc(d, 0.08, 0.05));
  },
  // 12 линеек на любой высоте: линейка — последний ряд блоков каждой доли, поэтому шаг ровный и в фото, и в миниатюре.
  paper: (u, v, _w = 1600, h = 1200) => {
    if (u > 0.08 && u < 0.095) return [230, 120, 120];
    const rows = Math.ceil(h / 8);
    const r = Math.floor((v * h) / 8);
    const line = r < rows - 1 && Math.floor(((r + 1) * 12) / rows) > Math.floor((r * 12) / rows);
    return line ? [150, 180, 220] : [250, 248, 238];
  },
  object: (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.55);
    return mix(mix([205, 180, 150], [170, 140, 110], v), mix([60, 60, 70], [120, 120, 140], d / 0.22), disc(d, 0.22, 0.06));
  },
  // Аватар — плавный диагональный переход двух цветов: у мозаики 8×8 нет резких краёв, поэтому и в 40 px не «лесенка».
  avatar: (hue) => (u, v) => {
    const [a, b] = [
      [[94, 92, 230], [175, 82, 222]], [[255, 159, 10], [255, 94, 58]], [[52, 199, 89], [48, 176, 199]],
      [[255, 55, 95], [255, 149, 0]], [[10, 132, 255], [90, 200, 250]], [[191, 90, 242], [255, 55, 95]],
      [[100, 210, 255], [52, 199, 89]],
    ][hue % 7];
    return mix(a, b, (u + v) / 2);
  },
};

/** Полное фото и подходящая миниатюра (длинная сторона 640, то же соотношение сторон). */
export function photoPair(w, h, paint) {
  const k = Math.min(1, 640 / Math.max(w, h));
  return { full: makeJpeg(w, h, paint), thumb: makeJpeg(Math.round(w * k), Math.round(h * k), paint), w, h };
}

// ─── HTTP ───

const BASE = new URL(process.argv[2] || 'http://127.0.0.1:8792');
const UNI = process.argv[3] || 'kfu';
const HUB = 'para.skycoax.uz';
const RUN = Date.now().toString(36).slice(-4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запрос с «банкой» кук (Map). Возвращает { status, headers, json }. */
function call(jar, method, path, { json, body, uni = UNI } = {}) {
  return new Promise((done, fail) => {
    const h = { Host: HUB };
    if (method !== 'GET') h['X-Para'] = '1';
    if (jar && jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload = null;
    if (json !== undefined) { payload = Buffer.from(JSON.stringify(json)); h['Content-Type'] = 'application/json'; }
    else if (body) { payload = body; h['Content-Type'] = 'image/jpeg'; }
    h['Content-Length'] = payload ? payload.length : 0;
    const full = uni ? path + (path.includes('?') ? '&' : '?') + 'uni=' + uni : path;
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
        let data = null;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* не JSON */ }
        done({ status: res.statusCode, headers: res.headers, json: data });
      });
    });
    rq.on('error', fail);
    if (payload) rq.write(payload);
    rq.end();
  });
}

/** Вызов, который ждёт при 429 (Retry-After до 150 с, до 4 раз) и падает с понятным текстом при ошибке. */
async function must(jar, method, path, opts, what) {
  for (let i = 0; ; i++) {
    const r = await call(jar, method, path, opts);
    if (r.status >= 200 && r.status < 300) return r.json ? r.json.data : null;
    const wait = Number(r.headers['retry-after']) || 0;
    if (r.status === 429 && i < 4 && wait && wait <= 150) {
      console.log(`  предел частоты (${what}) — жду ${wait} с… (быстрее: SOCIAL_RATE_LIMITS=off)`);
      await sleep(wait * 1000 + 200);
      continue;
    }
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`);
  }
}

// ─── Люди ───

const PEOPLE = [
  { u: 'alice', name: 'Алиса', bio: '2 курс, ИС. Люблю задачи по матанализу и хорошие конспекты', tg: 'alice_kfu', ig: 'alice.kfu', links: 'signed', av: 0 },
  { u: 'bob', name: 'Боб', bio: 'Программирование, футбол и кофе из автомата на 2 этаже', tg: 'bob_codes', av: 1 },
  { u: 'mia', name: 'Мия', age: 'minor', bio: '1 курс, химия' },
  { u: 'boss', name: 'Шерзод', bio: 'Слежу за порядком в обсуждениях', av: 2 },
  { u: 'dilnoza', name: 'Дилноза', bio: 'Бегаю по утрам, ищу компанию', ig: 'dilnoza.run', av: 3 },
  { u: 'timur', name: 'Тимур', bio: 'Физика и олимпиадные задачи', av: 4 },
  { u: 'kamola', name: 'Камола', bio: 'Фотографирую всё подряд', av: 5 },
  { u: 'sardor', name: 'Сардор', bio: 'Собираю команду на хакатон', av: 6 },
  { u: 'nigora', name: 'Нигора' },
  { u: 'jasur', name: 'Жасур' },
  { u: 'malika', name: 'Малика', bio: 'Учу корейский, ищу компанию' },
  { u: 'rustam', name: 'Рустам', bio: 'Мини-футбол, ИС' },
];

/** Войти как dev:<имя>, при первом входе заполнить профиль. Возвращает { jar, me }. */
async function person(p) {
  const jar = new Map();
  let me = await must(jar, 'POST', '/api/auth/dev', { json: { name: p.u, ...(p.age ? { age: p.age } : {}) } }, 'вход ' + p.u);
  if (me.needsProfile) {
    const patch = { username: p.u, name: p.name };
    if (p.bio) patch.bio = p.bio;
    if (p.tg) patch.tg = p.tg;
    if (p.ig) patch.ig = p.ig;
    if (p.links) patch.linksVisibility = p.links;
    const r = await call(jar, 'PATCH', '/api/social/me', { json: patch });
    if (r.status === 409) {
      console.log(`  имя @${p.u} занято другим аккаунтом — беру предложенное @${me.suggestedUsername}`);
      patch.username = me.suggestedUsername;
      me = await must(jar, 'PATCH', '/api/social/me', { json: patch }, 'профиль ' + p.u);
    } else if (r.status !== 200) {
      throw new Error(`профиль ${p.u}: ${r.status} ${JSON.stringify(r.json)}`);
    } else {
      me = r.json.data;
    }
  }
  if (!me.rulesAccepted) me = await must(jar, 'POST', '/api/social/me/rules', { json: { version: 1 } }, 'правила ' + p.u);
  if (p.age === 'minor' && me.age !== 'minor') {
    console.log(`  внимание: @${me.username} уже был создан взрослым — для проверок несовершеннолетнего нужна новая база`);
  }
  if (p.av !== undefined && !me.avatar) {
    const full = makeJpeg(512, 512, SCENES.avatar(p.av));
    const thumb = makeJpeg(128, 128, SCENES.avatar(p.av));
    const up = await must(jar, 'POST', '/api/social/media?kind=avatar', { body: full }, 'аватар ' + p.u);
    await must(jar, 'PUT', `/api/social/media/${up.id}/thumb`, { body: thumb }, 'миниатюра аватара ' + p.u);
    me = await must(jar, 'PATCH', '/api/social/me', { json: { avatar: up.id } }, 'аватар ' + p.u);
  }
  return { jar, me };
}

/** Загрузить фото (полное + миниатюра), вернуть id. */
async function upload(jar, [w, h, scene], who) {
  const pair = photoPair(w, h, scene);
  const up = await must(jar, 'POST', '/api/social/media?kind=post', { body: pair.full }, 'фото ' + who);
  await must(jar, 'PUT', `/api/social/media/${up.id}/thumb`, { body: pair.thumb }, 'миниатюра ' + who);
  return up.id;
}

const L = [1600, 1200];     // горизонтальное 4:3
const P = [1080, 1440];     // вертикальное 3:4
const S = [1200, 1200];     // квадрат
const W = [1600, 900];      // широкое 16:9

// [автор, тема, текст, фото[], вуз?]
const POSTS = [
  ['alice', 'study', 'Кто понял последнюю тему по матанализу — ряды Тейлора? Могу поделиться конспектом, но хочу сверить с чьим-нибудь.', [[...L, SCENES.paper]]],
  ['dilnoza', 'study', 'Ищу задачник Демидовича на пару дней. Верну в целости и с шоколадкой 🙂'],
  ['timur', 'study', 'Разобрал задачи к контрольной по физике. Если кому-то нужно — пишите, объясню пятую и седьмую.'],
  ['sardor', 'study', 'Как вы готовитесь к экзамену по английскому? Поделитесь сайтами, которые помогают с грамматикой.'],
  ['kamola', 'study', 'Конспект лекции по экономике за вторник — две страницы, сфотографировала.', [[...P, SCENES.paper], [...P, SCENES.paper]]],
  ['bob', 'schedule', 'Пару по программированию в четверг перенесли в 305 аудиторию — сам видел объявление у деканата.'],
  ['nigora', 'schedule', 'У 2 курса ИС завтра первой пары нет? В расписании пусто, а староста молчит.'],
  ['jasur', 'schedule', 'Физкультура в пятницу будет в спортзале, а не на стадионе — обещают дождь.'],
  ['malika', 'schedule', 'Замена: вместо истории в среду будет консультация к экзамену, ауд. 1/214.'],
  ['rustam', 'events', 'В субботу турнир по мини-футболу между факультетами. Нужны ещё двое в команду ИС!', [[...W, SCENES.field]]],
  ['alice', 'events', 'Вечер поэзии в библиотеке в пятницу в 17:00. Приходите, можно читать своё.', [[...L, SCENES.night]]],
  ['kamola', 'events', 'Фото с дня открытых дверей — было здорово, спасибо всем, кто помогал!', [[...L, SCENES.sunset], [...P, SCENES.sea], [...S, SCENES.field], [...W, SCENES.sunset]]],
  ['timur', 'events', 'Кто идёт на лекцию приглашённого профессора в актовом зале? Давайте займём места вместе.'],
  ['dilnoza', 'company', 'Ищу, с кем бегать по утрам в парке у общежития. Три-четыре раза в неделю, темп спокойный.'],
  ['sardor', 'company', 'Собираем команду на хакатон в ноябре: нужен дизайнер и ещё один разработчик.'],
  ['malika', 'company', 'Кто хочет вместе учить корейский? Думаю собрать небольшую группу, по вечерам.'],
  ['jasur', 'company', 'Ищу напарника для настольного тенниса, уровень — любитель.'],
  ['nigora', 'lost', 'Нашла студенческий на 3 этаже главного корпуса. Отдала на вахту — спрашивайте там.', [[...S, SCENES.object]]],
  ['bob', 'lost', 'Потерял чёрные наушники в столовой в понедельник. Если кто нашёл — буду очень благодарен.'],
  ['rustam', 'lost', 'Найден зонт в аудитории 2/108 после второй пары. Лежит у лаборанта.', [[...P, SCENES.object]]],
  ['mia', 'lost', 'Кто-то оставил синюю тетрадь по химии в читальном зале. Забирайте у библиотекаря.'],
  ['mia', 'other', 'Где в городе можно недорого распечатать цветной плакат А2?'],
  ['rustam', 'other', 'Посоветуйте, где рядом с вузом вкусно и недорого пообедать?'],
  ['timur', 'other', 'В столовой снова продают самсу по утрам. Кто ещё не пробовал — очень рекомендую.'],
  ['malika', 'other', 'Wi‑Fi в читальном зале сегодня еле работает — у всех так?'],
  ['bob', 'events', 'Кто из ТГЭУ идёт на ярмарку вакансий в эту субботу?', [], 'tsue'],
  ['kamola', 'study', 'Ищу конспекты по микроэкономике за первый курс, можно фото.', [], 'tsue'],
];

// Ветка к первой публикации: [автор, текст, ответ на (номер ответа в этом списке), фото?]
const THREAD = [
  ['bob', 'Я тоже путаюсь в остаточном члене. Давай сверим!'],
  ['dilnoza', 'У меня есть решённые примеры из прошлого года, могу скинуть.'],
  ['alice', 'Отлично, давай после пары в читальном зале.', 0],
  ['timur', 'Главное — запомнить разложения для e^x, sin x и ln(1+x), остальное выводится.'],
  ['sardor', 'А для (1+x)^a тоже нужно наизусть?', 3],
  ['timur', 'Желательно: на контрольной его точно дадут.', 4],
  ['kamola', 'Вот моя шпаргалка с формулами.', null, [...P, SCENES.paper]],
  ['nigora', 'Спасибо, очень выручила!', 6],
  ['jasur', 'Преподаватель сказал, что в билетах будут две задачи на ряды.'],
  ['malika', 'Это на экзамене или на контрольной?', 8],
  ['jasur', 'На контрольной, в следующую среду.', 9],
  ['rustam', 'Можно я тоже приду в читальный зал?'],
  ['alice', 'Конечно, приходи!', 11],
];

async function main() {
  const t0 = Date.now();
  console.log(`Наполняю ${BASE.origin} · вуз ${UNI} · метка прогона ${RUN}`);
  const who = {};
  for (const p of PEOPLE) who[p.u] = await person(p);
  console.log('Люди: ' + PEOPLE.map((p) => '@' + who[p.u].me.username + (p.age === 'minor' ? ' (до 18)' : '')
    + (p.u === 'boss' ? (who.boss.me.isAdmin ? ' (модератор)' : ' (НЕ модератор: SOCIAL_ADMIN_EMAILS=boss@dev.local?)') : '')).join(', '));

  const posts = [];
  for (const [author, category, text, photos = [], uni = UNI] of POSTS) {
    const { jar } = who[author];
    const media = [];
    for (const ph of photos) media.push(await upload(jar, ph, author));
    const post = await must(jar, 'POST', '/api/social/posts', { json: { text: `${text} · ${RUN}`, category, media }, uni },
      'публикация ' + author);
    posts.push(post);
  }
  console.log(`Публикаций: ${posts.length} (из них с фото: ${posts.filter((p) => p.media.length).length})`);

  const root = posts[0];
  const replies = [];
  for (const [author, text, to, photo] of THREAD) {
    const { jar } = who[author];
    const media = photo ? [await upload(jar, photo, author)] : [];
    const body = { text: `${text} · ${RUN}`, media };
    if (to !== undefined && to !== null) body.replyTo = replies[to].id;
    replies.push(await must(jar, 'POST', `/api/social/posts/${root.id}/replies`, { json: body }, 'ответ ' + author));
  }
  console.log(`Ветка #${root.id}: ${replies.length} ответов`);

  // Лайки: каждый отмечает несколько публикаций и ответов (детерминированно).
  let likes = 0;
  const names = Object.keys(who);
  for (let i = 0; i < names.length; i++) {
    const { jar } = who[names[i]];
    const targets = [...posts, ...replies].filter((_, k) => (k * 7 + i * 3) % 5 === 0).slice(0, 8);
    for (const t of targets) {
      if (t.author && t.author.username === who[names[i]].me.username) continue;
      await must(jar, 'PUT', `/api/social/posts/${t.id}/like`, { json: {} }, 'лайк');
      likes++;
    }
  }
  console.log(`Лайков: ${likes}`);

  // Друзья: dilnoza ↔ alice и timur ↔ sardor — дружба; bob → alice — заявка ждёт ответа.
  const rel = async (a, b, action) => {
    const id = who[b].me.id;
    if (action === 'request') return (await must(who[a].jar, 'POST', `/api/social/friends/${id}`, { json: {} }, 'заявка')).relation;
    return (await must(who[a].jar, 'POST', `/api/social/friends/${id}/accept`, { json: {} }, 'принять')).relation;
  };
  if ((await rel('dilnoza', 'alice', 'request')) === 'outgoing') await rel('alice', 'dilnoza', 'accept');
  if ((await rel('timur', 'sardor', 'request')) === 'outgoing') await rel('sardor', 'timur', 'accept');
  const pending = await rel('bob', 'alice', 'request');
  console.log(`Друзья: @alice ↔ @dilnoza, @timur ↔ @sardor; @bob → @alice: ${pending === 'outgoing' ? 'заявка ждёт ответа' : pending}`);

  // Одна открытая жалоба: mia на публикацию timur про самсу.
  const reported = posts[23];
  await must(who.mia.jar, 'POST', '/api/social/reports', { json: { target: 'post', id: reported.id, reason: 'spam', note: 'Похоже на рекламу' } }, 'жалоба');
  console.log(`Жалоба: @mia → публикация #${reported.id} (спам)`);

  console.log(`\nГотово за ${Math.round((Date.now() - t0) / 1000)} с.`);
  console.log(`Вход: alice, bob, mia (до 18), boss (модератор) — «Войти для разработки» или POST /api/auth/dev {"name":"alice"}`);
  console.log(`Ветка: /?uni=${UNI}&post=${root.id} · жалоба на #${reported.id}`);
}

const direct = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (direct) {
  main().catch((e) => { console.error('\nНаполнение не удалось:', e.message); process.exit(1); });
}
