// Источник КФУ (server/src/source.js): основная таблица напрямую, при сбое — Apps Script; дополнительные таблицы —
// при сбое из прошлой сверки (в памяти, после перезапуска — из последнего снимка). Google подменён: сеть не нужна.
// node --test server/test/source-fallback.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fetchSchedule } from '../src/source.js';

const MAIN = 'MainSheetId_aaaaaaaaaaaaaaaa';
const EXTRA = 'ExtraSheetId_bbbbbbbbbbbbbbb';
const AS = 'https://script.google.com/macros/s/TEST/exec';
const EXTRA2 = 'ExtraSheetTwo_ccccccccccccc';

const csv = (rows) => rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
const grid = (name, pair) => csv([
  [name, '', ''],
  ['', '1-я пара 08:30 - 09:50', '2-я пара 10:00 - 11:20'],
  ['Пн', pair, ''],
]);
const htmlview = (tabs) => '<script>' + tabs.map(([n, gid]) =>
  `items.push({name: "${n}", pageUrl: "https:\\/\\/docs.google.com\\/x?gid\\x3d${gid}", gid: "${gid}",initialSheet: false});`).join('') + '</script>';

const state = { mainDown: false, extraDown: false, asCalls: 0 };
globalThis.fetch = async (url) => {
  const u = String(url);
  const res = (status, body) => ({ ok: status < 300, status, text: async () => body, json: async () => JSON.parse(body) });
  if (u.startsWith(AS)) {
    state.asCalls++;
    return res(200, JSON.stringify({ ok: true, data: { header: '', fetchedAt: '2026-10-05T00:00:00Z', groups: [{
      key: '1 курс очное :: 1 курс Геология 05.03.01', sheet: '1 курс очное', course: '1', name: '1 курс Геология 05.03.01', link: '',
      times: ['08:30 – 09:50', '10:00 – 11:20'], days: [{ day: 'Пн', pairs: ['Из Apps Script', ''] }] }] } }));
  }
  if (u.includes(MAIN + '/htmlview')) return res(200, htmlview([['1 курс очное', '11']]));
  if (u.includes(MAIN + '/gviz')) return state.mainDown ? res(500, 'down') : res(200, grid('1 курс Геология 05.03.01', 'Напрямую'));
  if (u.includes(EXTRA2 + '/htmlview')) return res(200, htmlview([['Лист1', '0'], ['ИС \x26 Экономика', '7'], ['Удалённый', '0']]));
  if (u.includes(EXTRA2 + '/gviz')) return res(200, u.endsWith('gid=7') ? grid('1 курс Лингвистика 45.04.02 магистратура', 'НИР')
    : grid('1 курс Экономика 38.04.01 магистратура', 'Микроэкономика'));
  if (u.includes(EXTRA + '/htmlview')) return res(200, htmlview([['Лист1', '0']]));
  if (u.includes(EXTRA + '/gviz')) return state.extraDown ? res(500, 'down') : res(200, grid('1 курс Экономика 38.04.01 магистратура', 'Микроэкономика'));
  throw new Error('неожиданный адрес ' + u);
};

function tenant(id) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, fetched_at TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL)');
  return { id, db, cache: {}, source: { type: 'sheets', url: AS, id: MAIN, extra: [{ id: EXTRA, section: 'Магистратура' }] } };
}
const warns = [];
const log = { warn: (o, m) => warns.push(m) };

test('основная таблица — напрямую; Apps Script не нужен; дополнительная — после неё, раздел из настройки', async () => {
  Object.assign(state, { mainDown: false, extraDown: false, asCalls: 0 });
  const s = await fetchSchedule(tenant('t1'), log);
  assert.equal(state.asCalls, 0);
  assert.deepEqual(s.groups.map((g) => g.key), ['1 курс очное :: 1 курс Геология 05.03.01', 'Магистратура :: 1 курс Экономика 38.04.01 магистратура']);
  assert.equal(s.groups[0].days[0].pairs[0], 'Напрямую');
});

test('основная напрямую не прочиталась — Apps Script', async () => {
  Object.assign(state, { mainDown: true, extraDown: false, asCalls: 0 });
  const s = await fetchSchedule(tenant('t2'), log);
  assert.equal(state.asCalls, 1);
  assert.equal(s.groups[0].days[0].pairs[0], 'Из Apps Script');
  assert.equal(s.groups.length, 2);
});

test('дополнительная не ответила: сначала — из памяти, после «перезапуска» — из последнего снимка, совсем нечем — без неё', async () => {
  Object.assign(state, { mainDown: false, extraDown: false });
  const t = tenant('t3');
  await fetchSchedule(t, log);                       // удачная сверка — группы в памяти
  state.extraDown = true;
  const s1 = await fetchSchedule(t, log);
  assert.equal(s1.groups.length, 2, 'из памяти');
  assert.equal(s1.groups[1].days[0].pairs[0], 'Микроэкономика');

  const t2 = tenant('t4');                           // «после перезапуска»: памяти нет, есть снимок
  t2.db.prepare('INSERT INTO snapshots (fetched_at, hash, data) VALUES (?,?,?)').run('2026-10-04T00:00:00Z', 'h', JSON.stringify({ header: '', groups: [
    { key: '1 курс очное :: старое', sheet: '1 курс очное', name: 'старое', times: [], days: [] },
    { key: 'Магистратура :: 1 курс Экономика 38.04.01 магистратура', sheet: 'Магистратура', name: '1 курс Экономика 38.04.01 магистратура',
      times: ['08:30 – 09:50'], days: [{ day: 'Пн', pairs: ['Из снимка'] }] },
  ] }));
  const s2 = await fetchSchedule(t2, log);
  assert.deepEqual(s2.groups.map((g) => g.sheet), ['1 курс очное', 'Магистратура'], 'из снимка — только раздел этой таблицы');
  assert.equal(s2.groups[1].days[0].pairs[0], 'Из снимка');

  const s3 = await fetchSchedule(tenant('t5'), log);  // ни памяти, ни снимка
  assert.equal(s3.groups.length, 1, 'основная — есть, дополнительной — нет');
  assert.ok(warns.includes('дополнительная таблица не прочиталась'));
});

test('второй лист в дополнительной таблице: ключи прежние («раздел :: группа»), имя листа — подраздел; ' +
  'лист, которого нет (gviz отдаёт первый), — не дублируется; имя листа с «\x26» читается', async () => {
  const { fetchGsheet } = await import('../src/source-gsheet.js');
  const s = await fetchGsheet({ id: EXTRA2, section: 'Магистратура' });
  assert.deepEqual(s.groups.map((g) => [g.key, g.sub]), [
    ['Магистратура :: 1 курс Экономика 38.04.01 магистратура', 'Лист1'],
    ['Магистратура :: 1 курс Лингвистика 45.04.02 магистратура', 'ИС & Экономика'],
  ]);
});
