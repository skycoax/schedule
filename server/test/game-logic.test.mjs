// Мини-игра «Код»: правила без сервера (game-logic.js), исход ровно один раз (game-db.js на временной базе)
// и сила бота из приложения (web/src/game/bot.ts). Запуск из корня проекта:
//   node --test server/test/game-logic.test.mjs
// Бот проверяется, только если есть web/src/game/bot.ts и Node умеет --experimental-strip-types; иначе — пропуск.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  ATTEMPTS, FAIL_SCORE, TTL_MS, REACTIONS, evaluate, validCode, randomCode, newToken, tashkentDay, prevDay, settle, score,
} from '../src/social/game-logic.js';

const here = dirname(fileURLToPath(import.meta.url));

test('константы', () => {
  assert.equal(ATTEMPTS, 12);
  assert.equal(FAIL_SCORE, 13);
  assert.equal(TTL_MS, 24 * 3600_000);
  assert.deepEqual(REACTIONS, ['wave', 'like', 'wow', 'lol', 'fire', 'deal']);
});

test('evaluate: ● на месте, ○ не на месте', () => {
  assert.deepEqual(evaluate('4071', '1074'), { on: 2, near: 2 });
  assert.deepEqual(evaluate('1234', '1234'), { on: 4, near: 0 });
  assert.deepEqual(evaluate('1234', '5678'), { on: 0, near: 0 });
  assert.deepEqual(evaluate('0123', '3210'), { on: 0, near: 4 });
  assert.deepEqual(evaluate('9352', '1234'), { on: 0, near: 2 });
});

test('validCode: четыре разные цифры', () => {
  assert.equal(validCode('0123'), true);
  assert.equal(validCode('9876'), true);
  for (const bad of ['1123', '123', '12a4', '01234', '', ' 123', 1234, null, undefined, ['1', '2', '3', '4']]) {
    assert.equal(validCode(bad), false, String(bad));
  }
});

test('randomCode: 2000 кодов — все правильные, ведущий ноль встречается', () => {
  let zero = false;
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = randomCode();
    assert.ok(validCode(c), c);
    if (c[0] === '0') zero = true;
    seen.add(c);
  }
  assert.ok(zero, 'ведущий 0 должен встречаться');
  assert.ok(seen.size > 1000, 'коды разные');
});

test('newToken: 6 знаков без похожих', () => {
  for (let i = 0; i < 500; i++) assert.match(newToken(), /^[A-HJKMNP-Z2-9]{6}$/);
});

test('tashkentDay: сутки начинаются в 00:00 по Ташкенту (UTC+5)', () => {
  assert.equal(tashkentDay(Date.parse('2026-09-25T19:00:00Z')), '2026-09-26');
  assert.equal(tashkentDay(Date.parse('2026-09-25T18:59:59Z')), '2026-09-25');
  assert.equal(prevDay('2026-03-01'), '2026-02-28');
  assert.equal(prevDay('2026-01-01'), '2025-12-31');
});

test('score', () => {
  assert.equal(score({ n: 5, res: 'cracked' }), 5);
  assert.equal(score({ n: 12, res: 'failed' }), 13);
  assert.equal(score({ n: 3, res: 'timeout' }), 13);
  assert.equal(score({ n: 3, res: 'left' }), null);
  assert.equal(score({ n: 3, res: null }), null);
});

// ─── settle: таблица случаев ───
const NOW = Date.parse('2026-09-26T12:00:00Z');
const FUTURE = '2026-09-27T12:00:00.000Z';
const PAST = '2026-09-26T11:59:59.000Z';
const act = (a, b, deadlineAt = FUTURE) => ({ status: 'active', deadlineAt, a, b });
const side = (n, res = null) => ({ n, res });

const CASES = [
  ['open до срока', { status: 'open', deadlineAt: FUTURE, a: side(0), b: side(0) }, null],
  ['open после срока', { status: 'open', deadlineAt: PAST, a: side(0), b: side(0) }, { status: 'expired', reason: 'expired', winner: 'none' }],
  ['open ровно в срок', { status: 'open', deadlineAt: new Date(NOW).toISOString(), a: side(0), b: side(0) }, { status: 'expired', reason: 'expired', winner: 'none' }],
  ['A взломал за 5, B сделал 4 — игра идёт', act(side(5, 'cracked'), side(4)), null],
  ['A взломал за 5, B промахнулся 5-й — A досрочно', act(side(5, 'cracked'), side(5)), { winner: 'a', reason: 'early', aRes: 'cracked', bRes: null }],
  ['B взломал на 5-й — ничья', act(side(5, 'cracked'), side(5, 'cracked')), { winner: 'draw', reason: 'score' }],
  ['B взломал на 4-й — победа B', act(side(5, 'cracked'), side(4, 'cracked')), { winner: 'b', reason: 'score' }],
  ['B взломал за 3, A сделал 3 — B досрочно', act(side(3), side(3, 'cracked')), { winner: 'b', reason: 'early', aRes: null, bRes: 'cracked' }],
  ['B взломал за 6, A сделал 5 — игра идёт', act(side(5), side(6, 'cracked')), null],
  ['A взломал с первой, B ещё не ходил — игра идёт', act(side(1, 'cracked'), side(0)), null],
  ['A взломал с первой, B промахнулся — A досрочно', act(side(1, 'cracked'), side(1)), { winner: 'a', reason: 'early' }],
  ['A не взломал (13), B сделал 11 — игра идёт', act(side(12, 'failed'), side(11)), null],
  ['A не взломал, B взломал на 12-й — победа B', act(side(12, 'failed'), side(12, 'cracked')), { winner: 'b', reason: 'score' }],
  ['оба не взломали — ничья 13:13', act(side(12, 'failed'), side(12, 'failed')), { winner: 'draw', reason: 'score' }],
  ['13 досрочно не срабатывает никогда', act(side(12, 'failed'), side(12)), null],
  ['срок вышел, оба играют — ничья по времени', act(side(4), side(2), PAST), { winner: 'draw', reason: 'timeout', aRes: 'timeout', bRes: 'timeout' }],
  ['срок вышел, A взломал за 7, B сделал 3 — A по времени', act(side(7, 'cracked'), side(3), PAST), { winner: 'a', reason: 'timeout', aRes: 'cracked', bRes: 'timeout' }],
  ['срок вышел, A не взломал, B играет — 13:13', act(side(12, 'failed'), side(10), PAST), { winner: 'draw', reason: 'timeout' }],
  ['срок вышел, оба закончили — по счёту, но reason timeout', act(side(12, 'cracked'), side(12, 'failed'), PAST), { winner: 'a', reason: 'timeout' }],
  ['B сдался, A ещё играет', act(side(2), side(3, 'left')), { winner: 'a', reason: 'left', bRes: 'left' }],
  ['A сдался, B ещё играет', act(side(1, 'left'), side(4)), { winner: 'b', reason: 'left', aRes: 'left' }],
  ['B сдался после того, как A взломал', act(side(7, 'cracked'), side(3, 'left')), { winner: 'a', reason: 'left' }],
  ['A сдался после того, как B взломал', act(side(2, 'left'), side(4, 'cracked')), { winner: 'b', reason: 'left' }],
  ['сдался после срока — всё равно «сдался»', act(side(2, 'left'), side(4), PAST), { winner: 'b', reason: 'left' }],
  ['done — ничего', { status: 'done', deadlineAt: PAST, a: side(5, 'cracked'), b: side(5) }, null],
  ['cancelled — ничего', { status: 'cancelled', deadlineAt: PAST, a: side(0), b: side(0) }, null],
  ['expired — ничего', { status: 'expired', deadlineAt: PAST, a: side(0), b: side(0) }, null],
];

for (const [name, input, want] of CASES) {
  test('settle: ' + name, () => {
    const got = settle(input, NOW);
    if (want === null) return assert.equal(got, null);
    assert.ok(got, 'ожидался исход');
    if (want.status !== 'expired') assert.equal(got.status, 'done');
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, k);
  });
}

test('settle: принимает и ISO-время', () => {
  assert.equal(settle({ status: 'open', deadlineAt: FUTURE, a: side(0), b: side(0) }, new Date(NOW).toISOString()), null);
});

// ─── Исход ровно один раз (временная база) ───
test('finishDuel: счёт меняется ровно один раз; блокировка — без счёта', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'para-game-'));
  const { openSocialDb, tx } = await import('../src/social/db.js');
  const { finishDuel, cancelDuelsBetween, forfeitAll, gameMeOf, ensurePlayer } = await import('../src/social/game-db.js');
  const db = openSocialDb(dir);
  try {
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), 7, 'схема V7');
    const now = new Date().toISOString();
    const mk = (name) => Number(db.prepare(`INSERT INTO users (google_sub, email, username, name, created_at)
      VALUES (?,?,?,?,?)`).run('dev:' + name, name + '@dev.local', name, name, now).lastInsertRowid);
    const a = mk('ga');
    const b = mk('gb');
    const c = mk('gc');
    const moves = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => [String(1230 + i).slice(-4), 0, 0, now]));
    const deadline = new Date(Date.now() + 3600_000).toISOString();
    const insert = db.prepare(`INSERT INTO game_duels (kind, status, a_id, b_id, to_id, a_code, b_code, a_moves, b_moves, a_res, b_res,
      created_at, joined_at, deadline_at) VALUES ('quick', 'active', ?, ?, NULL, '4071', '9352', ?, ?, ?, NULL, ?, ?, ?)`);
    const id = Number(insert.run(a, b, moves(5), moves(5), 'cracked', now, now, deadline).lastInsertRowid);
    const stale = db.prepare('SELECT * FROM game_duels WHERE id = ?').get(id);
    const r1 = tx(db, () => finishDuel(db, stale));
    assert.equal(r1.changed, true);
    assert.equal(r1.row.status, 'done');
    assert.equal(r1.row.winner, 'a');
    assert.equal(r1.row.reason, 'early');
    assert.equal(r1.row.a_seen, 0, 'итог по попытке — не видели оба');
    assert.equal(r1.row.b_seen, 0);
    const r2 = tx(db, () => finishDuel(db, stale));   // та же старая строка (v уже другой)
    assert.equal(r2.changed, false);
    const r3 = tx(db, () => finishDuel(db, r1.row));  // свежая, но уже done
    assert.equal(r3.changed, false);
    const stat = (u) => db.prepare('SELECT wins, losses, draws FROM game_players WHERE user_id = ?').get(u);
    assert.deepEqual({ ...stat(a) }, { wins: 1, losses: 0, draws: 0 });
    assert.deepEqual({ ...stat(b) }, { wins: 0, losses: 1, draws: 0 });

    // Блокировка посреди игры: прервана, без счёта, отметка «не видели» у обоих.
    const id2 = Number(insert.run(a, c, moves(2), moves(1), null, now, now, deadline).lastInsertRowid);
    const ids = tx(db, () => cancelDuelsBetween(db, c, a));
    assert.deepEqual(ids, [id2]);
    const d2 = db.prepare('SELECT * FROM game_duels WHERE id = ?').get(id2);
    assert.deepEqual([d2.status, d2.reason, d2.winner, d2.a_seen, d2.b_seen], ['cancelled', 'blocked', 'none', 0, 0]);
    assert.equal(stat(c), undefined, 'у прерванной игры счёта нет');

    // Бан: идущая — «сдался» (соперник побеждает, счёт идёт), свои открытые — отменены.
    const id3 = Number(insert.run(b, c, moves(1), moves(2), null, now, now, deadline).lastInsertRowid);
    const open = Number(db.prepare(`INSERT INTO game_duels (kind, status, token, a_id, a_code, created_at, deadline_at)
      VALUES ('link', 'open', 'ABCDEF', ?, '0123', ?, ?)`).run(c, now, deadline).lastInsertRowid);
    const f = tx(db, () => forfeitAll(db, c, 'banned'));
    assert.deepEqual(f.sort((x, y) => x - y), [id3, open].sort((x, y) => x - y));
    const d3 = db.prepare('SELECT * FROM game_duels WHERE id = ?').get(id3);
    assert.deepEqual([d3.status, d3.winner, d3.reason, d3.b_res, d3.a_seen, d3.b_seen], ['done', 'a', 'left', 'left', 0, 1]);
    const o = db.prepare('SELECT * FROM game_duels WHERE id = ?').get(open);
    assert.deepEqual([o.status, o.reason, o.token], ['cancelled', 'cancelled', null]);
    assert.deepEqual({ ...stat(b) }, { wins: 1, losses: 1, draws: 0 });
    assert.deepEqual({ ...stat(c) }, { wins: 0, losses: 1, draws: 0 });

    // Код ссылки живёт, пока игра идёт (повтор принятия — та же игра), и стирается, когда она кончилась.
    const linked = Number(db.prepare(`INSERT INTO game_duels (kind, status, token, a_id, b_id, a_code, b_code, a_moves, a_res,
      created_at, joined_at, deadline_at) VALUES ('link', 'active', 'KMNPQR', ?, ?, '4071', '9352', ?, 'cracked', ?, ?, ?)`)
      .run(a, b, moves(1), now, now, deadline).lastInsertRowid);
    db.prepare("UPDATE game_duels SET b_moves = ? WHERE id = ?").run(moves(1), linked);
    const lf = tx(db, () => finishDuel(db, db.prepare('SELECT * FROM game_duels WHERE id = ?').get(linked)));
    assert.deepEqual([lf.row.status, lf.row.token], ['done', null], 'кончилась — кода ссылки нет');
    db.prepare('UPDATE game_duels SET a_seen = 1, b_seen = 1 WHERE id = ?').run(linked);

    // Схема: у «Кода дня» нет вуза (таблица вуза — по профилю); удаление аккаунта ищет адресатов по индексу.
    assert.ok(!db.prepare('PRAGMA table_info(game_daily)').all().some((c) => c.name === 'uni'), 'game_daily без uni');
    const plan = db.prepare('EXPLAIN QUERY PLAN DELETE FROM users WHERE id = ?').all(a).map((r) => r.detail).join('\n');
    assert.ok(!/SCAN game_duels/.test(plan) && /idx_gd_to/.test(plan), 'ON DELETE SET NULL по to_id — по индексу: ' + plan);

    // Me.game: null, пока строки игрока нет; итог, который не видел, — ждёт.
    const d = mk('gd');
    assert.equal(gameMeOf(db, d), null);
    ensurePlayer(db, d);
    assert.deepEqual(gameMeOf(db, d), { waiting: 0 });
    assert.deepEqual(gameMeOf(db, b), { waiting: 2 }, 'b не видел итоги двух игр (с a и с c)');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Бот приложения: средняя сила ───
const BOT = join(here, '..', '..', 'web', 'src', 'game', 'bot.ts');
test('бот (web/src/game/bot.ts): 2000 игр с зерном — в среднем 6,5–8,5 попытки', (t) => {
  if (!existsSync(BOT)) return t.skip('web/src/game/bot.ts ещё нет — пропускаю');
  const script = `
    const bot = await import(${JSON.stringify(pathToFileURL(BOT).href)});
    const { evaluate } = await import(${JSON.stringify(pathToFileURL(join(here, '..', 'src', 'social', 'game-logic.js')).href)});
    const res = await (${botAverage.toString()})(bot, evaluate);
    process.stdout.write(JSON.stringify(res));`;
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0 && /bad option|unknown option|strip-types/i.test(r.stderr || '')) {
    return t.skip('Node без --experimental-strip-types — пропускаю');
  }
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  if (out.skip) return t.skip(out.skip);
  t.diagnostic(`в среднем ${out.avg.toFixed(2)} попытки (${out.games} игр, не взломал: ${out.failed})`);
  assert.ok(out.avg >= 6.5 && out.avg <= 8.5, `средняя ${out.avg.toFixed(2)} вне [6.5, 8.5]`);
});

/**
 * Прогон бота: 2000 игр с детерминированным генератором (mulberry32). Выполняется в дочернем процессе
 * (передаётся текстом), поэтому всё нужное — внутри. Не взломал за 12 — считается как 13.
 */
async function botAverage(bot, evaluate) {
  const mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const codeFrom = (rnd) => {
    const d = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (let i = 9; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d.slice(0, 4).join('');
  };
  // botGuess(moves, rand) — следующая попытка по своим прошлым попыткам и ответам (web/src/game/bot.ts).
  if (typeof bot.botGuess !== 'function') return { skip: 'в bot.ts нет botGuess(moves, rand) — пропускаю' };
  let sum = 0;
  let failed = 0;
  const games = 2000;
  for (let g = 0; g < games; g++) {
    const rnd = mulberry32(1000 + g);
    const secret = codeFrom(rnd);
    const moves = [];
    let cracked = false;
    while (moves.length < 12) {
      const guess = bot.botGuess(moves, rnd);
      const { on, near } = evaluate(secret, guess);
      moves.push({ g: guess, on, near });
      if (on === 4) { cracked = true; break; }
    }
    if (!cracked) failed++;
    sum += cracked ? moves.length : 13;
  }
  return { avg: sum / games, games, failed };
}
