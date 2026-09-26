// Мини-игра «Код» (CONTRACT.md §I): быки и коровы на цифрах флип-часов, спрятана в «Сегодня» (5 касаний по часам).
// Маршруты /api/social/games (#1–#16), сборка DuelView / DuelRow / GameLobby / DailyView, таблицы «Кода дня»,
// исход по срокам (лениво при чтении и раз в 10 минут), продление сроков после простоя сервера.
// Правила — game-logic.js (settle решает исход), запись исхода и хуки — game-db.js, поток событий — game-stream.js.
// Всё асинхронно: два человека одновременно онлайн не нужны никогда; «в игре» и реакции — только бонус.
// Переписки нет: люди обмениваются только цифрами кода (видны после игры), отметками ●○ и шестью готовыми эмодзи.
import { gameMode } from '../config.js';
import { tx, nowIso, DAY, HOUR } from './db.js';
import { SocialError, ok, invalid, notFound, blocked, guard, needUni, bodyOf, intField, TEXT } from './http.js';
import { limit, limitPeek, limited, keyOf, ipKey, dailyCap, dayAgo, rateError } from './limits.js';
import { CARD_COLS, usersByIds, userCardOf, blockedEither } from './users.js';
import { areFriends } from './instant-access.js';
import {
  ATTEMPTS, TTL_MS, REACTIONS, TOKEN_RE, validCode, evaluate, randomCode, newToken, tashkentDay, prevDay, score,
} from './game-logic.js';
import { ensurePlayer, finishDuel, cancelDuel, gameMeOf, movesOf } from './game-db.js';
import { streamHandler, publishDuels, publishLobby, sendReact, isLive, setDuelViewBuilder } from './game-stream.js';

const MIN = 60_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOBBY_ROWS = 30;
const BOARD_ROWS = 50;
const MAX_OPEN_INVITES = 5;     // своих открытых вызовов (ссылка, другу, реванш)
const MAX_ACTIVE = 20;          // идущих дуэлей
const MAX_REACTS = 20;          // реакций за дуэль от одного игрока
const REMATCH_COOLDOWN = 7 * DAY;

export const GAME_TEXT = {
  code: 'Нужны четыре разные цифры',
  repeat: 'Эта комбинация уже была',
  stale: 'Состояние игры изменилось',
  over: 'Игра уже закончилась',
  gone: 'Игра не найдена',
  invite: 'Вызов истёк или уже принят',
  own: 'Это твой вызов — отправь ссылку другу',
  friend: 'Нельзя вызвать этого пользователя',
  rematch: 'Реванш с этим игроком пока недоступен',
  newDay: 'Новый день — код обновился',
  quickOff: 'Случайный соперник сейчас выключен',
  boardsOff: 'Общие таблицы сейчас выключены',
  invites: 'Слишком много вызовов ждут ответа — отмени какой-нибудь',
  active: 'Слишком много начатых игр — сначала доиграй',
};

// ─── Мелочи ───

const conflict = (field, message) => new SocialError(409, 'conflict', message, { field });
const over = () => conflict('status', GAME_TEXT.over);
const tooMany = (message) => new SocialError(429, 'rate', message, { retryAfter: 3600 });

/** :id дуэли (^\d{1,12}$); иначе — как чужая: 404 «Игра не найдена». */
function duelIdParam(raw) {
  const s = String(raw ?? '');
  if (!/^\d{1,12}$/.test(s) || Number(s) < 1) throw notFound(GAME_TEXT.gone);
  return Number(s);
}
/** Код или попытка: четыре разные цифры. */
function codeField(v, field) {
  if (!validCode(v)) throw invalid(GAME_TEXT.code, field);
  return v;
}
/** Номер попытки 1…12. */
function nField(v) {
  if (!Number.isInteger(v) || v < 1 || v > ATTEMPTS) throw invalid(TEXT.invalid, 'n');
  return v;
}

/** Сторона человека в дуэли: 'a' (создатель), 'b' (принявший) или null. */
const sideOf = (row, uid) => (!row || !uid ? null : row.a_id === uid ? 'a' : row.b_id === uid ? 'b' : null);
/** Соперник: для создателя — принявший или адресат вызова; для остальных — создатель. */
const oppIdOf = (row, uid) => (row.a_id === uid ? row.b_id ?? row.to_id ?? null : row.a_id ?? null);
/** Может ли человек открыть дуэль: участник, или адресат, пока вызов открыт. */
const canSee = (row, uid) => !!row && (row.a_id === uid || row.b_id === uid || (row.to_id === uid && row.status === 'open'));
/** Соперник удалил аккаунт: место соперника было занято, а id стал NULL (ON DELETE SET NULL). */
function goneOf(row, role, oppId) {
  if (oppId) return false;
  if (role !== 'creator') return true;
  return !!row.joined_at || row.kind === 'friend' || row.kind === 'rematch';
}
const moveOut = ([g, on, near]) => ({ g, on, near });
const markOut = ([, on, near]) => ({ on, near });
const TERMINAL = new Set(['done', 'expired', 'cancelled']);
/** Причина наружу: прерванная блокировкой игра — просто «прервана» (блокировка себя не выдаёт; в базе — 'blocked'). */
const reasonOut = (reason) => (reason === 'blocked' ? 'cancelled' : reason);

// ─── Сборка ответов (types.ts §I) ───

/** Реванш не-другу недоступен: его предложение этой паре за 7 дней истекло или было отклонено. */
function rematchCooldown(db, a, b) {
  return !!db.prepare(`SELECT 1 FROM game_duels WHERE kind = 'rematch' AND status IN ('expired','cancelled')
    AND reason IN ('expired','declined') AND created_at > ?
    AND ((a_id = ? AND to_id = ?) OR (a_id = ? AND to_id = ?)) LIMIT 1`).get(nowIso(Date.now() - REMATCH_COOLDOWN), a, b, b, a);
}
const lastRematchOf = (db, id) =>
  db.prepare('SELECT id, a_id, status FROM game_duels WHERE rematch_of = ? ORDER BY id DESC LIMIT 1').get(id) || null;

/**
 * DuelView для участника uid. Никогда не отдаёт: код соперника, пока игра не 'done', и его попытки цифрами
 * (только отметки ●○ по моему коду) — так цифры не становятся каналом для переписки.
 * Блокировка в любую сторону: карточки соперника нет (user null, но не «Удалённый аккаунт»), реванша и «в игре» — тоже,
 * как в профиле и ленте: заблокированный не видит свежих имени, фото и значка того, кто его заблокировал.
 */
export function duelView(ctx, row, uid) {
  const db = ctx.db;
  const role = row.a_id === uid ? 'creator' : row.b_id === uid ? 'joiner' : 'invited';
  const my = role === 'creator' ? 'a' : role === 'joiner' ? 'b' : null;
  const op = my === 'a' ? 'b' : 'a';
  const oppId = oppIdOf(row, uid);
  const cut = !!oppId && blockedEither(db, uid, oppId);
  const card = oppId && !cut ? usersByIds(db, [oppId]).get(oppId) || null : null;
  const myMoves = my ? movesOf(row[my + '_moves']) : [];
  const oppMoves = movesOf(row[op + '_moves']);
  const myRes = my ? row[my + '_res'] ?? null : null;
  const oppRes = row[op + '_res'] ?? null;
  const friends = !!oppId && areFriends(db, uid, oppId);
  const view = {
    id: row.id,
    v: row.v,
    kind: row.kind,
    status: row.status,
    role,
    token: role === 'creator' && row.kind === 'link' && row.status === 'open' ? row.token : null,
    createdAt: row.created_at,
    deadlineAt: row.deadline_at,
    friends,
    me: {
      code: my ? row[my + '_code'] ?? null : null,
      moves: myMoves.map(moveOut),
      left: ATTEMPTS - myMoves.length,
      res: myRes,
      score: score({ n: myMoves.length, res: myRes }),
    },
    opp: {
      user: card ? userCardOf(ctx, card, false) : null,
      gone: goneOf(row, role, oppId),
      n: oppMoves.length,
      marks: my ? oppMoves.map(markOut) : [],
      res: oppRes,
      score: score({ n: oppMoves.length, res: oppRes }),
      live: row.status === 'active' && !cut && isLive(oppId),
    },
    outcome: null,
    rematch: null,
    canRematch: false,
  };
  if (TERMINAL.has(row.status)) {
    const w = row.winner || 'none';
    view.outcome = {
      winner: w === 'draw' || w === 'none' ? w : my && w === my ? 'me' : my ? 'opp' : 'none',
      reason: reasonOut(row.reason || row.status),
      oppCode: row.status === 'done' && my ? row[op + '_code'] ?? null : null,
    };
  }
  if (row.status === 'done' && my && !cut) {
    const last = lastRematchOf(db, row.id);
    view.rematch = last ? { id: last.id, mine: last.a_id === uid, status: last.status } : null;
    const pending = last && (last.status === 'active' || (last.status === 'open' && last.a_id === uid));
    view.canRematch = !!card && card.status === 'active' && !pending && (friends || !rematchCooldown(db, uid, oppId));
  }
  return view;
}

/** Строка лобби (DuelRow). cards — Map(id → строка users) соперников. */
function duelRowOut(ctx, row, uid, cards) {
  const role = row.a_id === uid ? 'creator' : row.b_id === uid ? 'joiner' : 'invited';
  const my = role === 'creator' ? 'a' : role === 'joiner' ? 'b' : null;
  const op = my === 'a' ? 'b' : 'a';
  const oppId = oppIdOf(row, uid);
  const card = oppId ? cards.get(oppId) || null : null;
  const myN = my ? movesOf(row[my + '_moves']).length : 0;
  const oppN = movesOf(row[op + '_moves']).length;
  const myRes = my ? row[my + '_res'] ?? null : null;
  let state;
  if (row.status === 'open') state = role === 'invited' ? 'invited' : 'wait_join';
  else if (row.status === 'active') state = myRes ? 'wait_opp' : 'turn';
  else if (row.status === 'done') state = row.winner === 'draw' ? 'draw' : row.winner === my ? 'won' : 'lost';
  else state = row.status;   // 'expired' | 'cancelled'
  return {
    id: row.id,
    v: row.v,
    kind: row.kind,
    status: row.status,
    state,
    opp: card ? userCardOf(ctx, card, false) : null,
    gone: goneOf(row, role, oppId),
    myN,
    oppN,
    myScore: score({ n: myN, res: myRes }),
    oppScore: score({ n: oppN, res: row[op + '_res'] ?? null }),
    unseen: !!my && TERMINAL.has(row.status) && Number(row[my + '_seen']) === 0,
    deadlineAt: row.deadline_at,
    reason: reasonOut(row.reason ?? null),
  };
}

// ─── «Код дня»: таблицы ───

// Кто виден в таблице: «Друзья» — друзья в любом возрасте; «Все» и «Мой вуз» — они же плюс взрослые, которых можно
// найти в поиске. Друзья есть во всех таблицах: иначе друг, которого видно в «Друзьях», но нет во «Всех», выдавал бы
// свой возраст (16–17). «Мой вуз» — по вузу из профиля («мой вуз»; скрыт в профиле — ни в одной таблице вуза).
// Себя человек видит всегда (в «Моём вузе» — если в профиле этот вуз); блокировка в любую сторону прячет обоих.
const FRIEND_OF_ME = `EXISTS (SELECT 1 FROM friends f WHERE f.status = 'accepted'
  AND f.user_lo = MIN($me, u.id) AND f.user_hi = MAX($me, u.id))`;
const boardWhere = (scope) => `d.day = $day AND d.solved = 1
  AND (u.id = $me OR (u.status = 'active' AND (${FRIEND_OF_ME}${scope === 'friends' ? '' : " OR (u.searchable = 1 AND u.age_group = 'adult')"})))
  ${scope === 'uni' ? 'AND u.uni = $uni' : ''}
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $me AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $me))`;

const boardCache = new WeakMap();   // db → Map(scope → { items, total, better })
function boardStmts(db, scope) {
  let byDb = boardCache.get(db);
  if (!byDb) { byDb = new Map(); boardCache.set(db, byDb); }
  let s = byDb.get(scope);
  if (!s) {
    const from = 'FROM game_daily d JOIN users u ON u.id = d.user_id';
    s = {
      items: db.prepare(`SELECT d.n AS g_n, d.ms AS g_ms, d.finished_at AS g_fin, ${CARD_COLS} ${from}
        LEFT JOIN media m ON m.id = u.avatar_id WHERE ${boardWhere(scope)} ORDER BY d.n, d.ms, d.finished_at LIMIT ${BOARD_ROWS}`),
      total: db.prepare(`SELECT COUNT(*) n ${from} WHERE ${boardWhere(scope)}`),
      better: db.prepare(`SELECT COUNT(*) n ${from} WHERE ${boardWhere(scope)}
        AND (d.n < $n OR (d.n = $n AND (d.ms < $ms OR (d.ms = $ms AND d.finished_at < $fin))))`),
    };
    byDb.set(scope, s);
  }
  return s;
}

/**
 * Место своей строки (1 + видимые строго лучше) и сколько всего видно. mine — своя строка game_daily или null;
 * myUni — «мой вуз» из профиля (для таблицы вуза).
 */
function boardPlace(db, scope, params, mine, myUni = null) {
  const s = boardStmts(db, scope);
  const total = Number(s.total.get(params).n) || 0;
  if (!mine || Number(mine.solved) !== 1 || (scope === 'uni' && myUni !== params.$uni)) return { total, me: null };
  const better = Number(s.better.get({ ...params, $n: mine.n, $ms: mine.ms, $fin: mine.finished_at }).n) || 0;
  return { total, me: { place: better + 1, n: mine.n, ms: mine.ms } };
}

const playerOf = (db, uid) => db.prepare('SELECT * FROM game_players WHERE user_id = ?').get(uid) || null;
const dailyRow = (db, uid, day) => db.prepare('SELECT * FROM game_daily WHERE user_id = ? AND day = ?').get(uid, day) || null;
/** Серия на экране: 0, если последний взломанный день раньше вчерашнего. */
const shownStreak = (p, day) => (p && p.streak_day && (p.streak_day === day || p.streak_day === prevDay(day)) ? p.streak : 0);
const dailyStatus = (row) => (!row ? 'new' : Number(row.solved) === 1 ? 'cracked' : Number(row.solved) === 2 ? 'failed' : 'playing');

/** Прошлые дни, не доигранные до конца, — «не взломан» (при чтении, и раз в сутки в jobs.js). */
function closeOldDaily(db, uid, day) {
  db.prepare('UPDATE game_daily SET solved = 2, finished_at = ? WHERE user_id = ? AND solved = 0 AND day < ?').run(nowIso(), uid, day);
}

/** DailyView. Место — в таблице «Все» (в режиме friends общих таблиц нет: place null, total 0). */
function dailyView(ctx, uid, day, row) {
  const db = ctx.db;
  const p = playerOf(db, uid);
  const moves = row ? movesOf(row.moves) : [];
  const solved = row ? Number(row.solved) : 0;
  let place = null;
  let total = 0;
  if (gameMode() === 'on') {
    const b = boardPlace(db, 'all', { $day: day, $me: uid }, row);
    total = b.total;
    place = b.me ? b.me.place : null;
  }
  return {
    day,
    status: dailyStatus(row),
    moves: moves.map(moveOut),
    n: moves.length,
    left: ATTEMPTS - moves.length,
    ms: solved === 1 ? row.ms : null,
    code: row && solved !== 0 ? row.code : null,
    place,
    total,
    streak: shownStreak(p, day),
    bestStreak: p ? p.best_streak : 0,
  };
}

// ─── Исход по срокам ───

const duelById = (db, id) => db.prepare('SELECT * FROM game_duels WHERE id = ?').get(id) || null;

/** Дуэль с уже применённым сроком (своя tx, событие после COMMIT). null — нет такой. */
function loadSettled(ctx, id) {
  const db = ctx.db;
  const row = duelById(db, id);
  if (!row || (row.status !== 'open' && row.status !== 'active') || row.deadline_at > nowIso()) return row;
  const r = tx(db, () => finishDuel(db, duelById(db, id), Date.now()));
  if (r.changed) publishDuels(ctx, [id]);
  return r.row;
}

/** Свои открытые и идущие дуэли с истёкшим сроком (при открытии лобби). */
function settleMine(ctx, uid) {
  const db = ctx.db;
  const now = Date.now();
  const rows = db.prepare(`SELECT id FROM game_duels WHERE status IN ('open','active') AND deadline_at <= ?
    AND (a_id = ? OR b_id = ? OR to_id = ?)`).all(nowIso(now), uid, uid, uid);
  if (!rows.length) return;
  const ids = tx(db, () => rows.filter((r) => finishDuel(db, duelById(db, r.id), now).changed).map((r) => r.id));
  publishDuels(ctx, ids);
}

/**
 * Раз в 10 минут (jobs.js): все дуэли с истёкшим сроком, до 500 за раз, каждая в своей tx. Так итог приходит
 * тем, кто держит игру открытой, даже если никто не заходил.
 */
export function settleExpired(ctx) {
  const db = ctx.db;
  const now = Date.now();
  const rows = db.prepare(`SELECT id FROM game_duels WHERE status IN ('open','active') AND deadline_at <= ? LIMIT 500`)
    .all(nowIso(now));
  const ids = [];
  for (const { id } of rows) {
    if (tx(db, () => finishDuel(db, duelById(db, id), now)).changed) ids.push(id);
  }
  publishDuels(ctx, ids);
}

// Реакции: не больше 20 за дуэль от игрока (в памяти; перезапуск счёт обнуляет — не страшно).
const reactCounts = new Map();   // `${duelId}:${userId}` → { n, at }
/** Убрать старые счётчики реакций (раз в 10 минут): дуэль живёт не дольше суток (+ продление после простоя). */
export function sweepReactCounters() {
  const old = Date.now() - 31 * HOUR;
  for (const [k, v] of reactCounts) if (v.at < old) reactCounts.delete(k);
}

/**
 * Запуск (все режимы, после startJobs): сборщик DuelView для потока, продление сроков после простоя и «пульс».
 * Сервер лежал дольше 10 минут — все открытые и идущие дуэли получают столько же времени (не больше 6 ч):
 * простой не должен решать игры. Обычная выкладка (секунды) ничего не продлевает.
 */
export function startGame(ctx) {
  const db = ctx.db;
  setDuelViewBuilder(duelView, (c, uid) => (gameMeOf(c.db, uid) || { waiting: 0 }).waiting);
  try {
    const beat = db.prepare("SELECT v FROM game_meta WHERE k = 'beat'").get();
    const gap = beat ? Date.now() - Date.parse(beat.v) : 0;
    if (gap > 10 * MIN) {
      const add = Math.min(gap, 6 * HOUR);
      const n = tx(db, () => {
        const rows = db.prepare("SELECT id, deadline_at FROM game_duels WHERE status IN ('open','active')").all();
        const upd = db.prepare('UPDATE game_duels SET deadline_at = ?, v = v + 1 WHERE id = ?');
        for (const r of rows) upd.run(nowIso(Date.parse(r.deadline_at) + add), r.id);
        return rows.length;
      });
      ctx.log.info({ downMin: Math.round(gap / MIN), addMin: Math.round(add / MIN), duels: n }, 'игра: сроки продлены после простоя');
    }
  } catch (err) {
    ctx.log.error({ msg: err && err.message }, 'игра: продление сроков не выполнилось');
  }
  const pulse = () => {
    try { db.prepare("INSERT OR REPLACE INTO game_meta (k, v) VALUES ('beat', ?)").run(nowIso()); } catch { /* в следующий раз */ }
  };
  pulse();
  setInterval(pulse, MIN).unref();
}

// ─── Маршруты ───

/**
 * /api/social/games (#1–#16). Регистрируется, только если SOCIAL_MODE ≠ off и SOCIAL_GAME ≠ off (иначе — общий 404).
 * Проверка U — только у таблицы «Мой вуз»: у игры нет вуза. Порядок в обработчике: проверки доступа → поля →
 * пределы частоты → транзакция (§B.2).
 * @param {import('fastify').FastifyInstance} inst
 */
export function gameRoutes(inst, ctx) {
  const db = ctx.db;

  const capStat = db.prepare(`SELECT COUNT(*) n, MIN(t) first FROM (
    SELECT created_at t FROM game_duels WHERE a_id = $me AND created_at > $dayAgo
    UNION ALL SELECT joined_at FROM game_duels WHERE b_id = $me AND joined_at > $dayAgo)`);
  const activeCount = db.prepare("SELECT COUNT(*) n FROM game_duels WHERE status = 'active' AND (a_id = ? OR b_id = ?)");
  const openInvites = db.prepare(`SELECT COUNT(*) n FROM game_duels WHERE status = 'open' AND a_id = ?
    AND kind IN ('link','friend','rematch')`);
  // Код вызова остаётся до конца игры (повтор принятия тем же человеком — та же игра); смотреть и принять его
  // другим уже нельзя (status ≠ open). Срок — последняя страховка: истёкший вызов принять нельзя, даже не подведённый.
  const joinStmt = db.prepare(`UPDATE game_duels SET status = 'active', b_id = ?, b_code = ?, joined_at = ?,
    deadline_at = ?, v = v + 1 WHERE id = ? AND status = 'open' AND deadline_at > ?`);
  const insertDuel = db.prepare(`INSERT INTO game_duels (kind, status, token, a_id, to_id, rematch_of, a_code, created_at, deadline_at)
    VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?)`);
  const tokenTaken = db.prepare('SELECT 1 FROM game_duels WHERE token = ?');
  // Случайный соперник: самая старая чужая открытая заявка — хозяин активен, блокировки нет ни в какую сторону.
  // «Держится сутки» — по сроку заявки (он продлевается после простоя сервера), порядок — по времени создания.
  const pairCandidate = db.prepare(`SELECT d.id FROM game_duels d JOIN users u ON u.id = d.a_id
    WHERE d.status = 'open' AND d.kind = 'quick' AND d.a_id <> $me AND d.deadline_at > $now AND u.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $me AND b.blocked_id = d.a_id)
                                                OR (b.blocker_id = d.a_id AND b.blocked_id = $me))
    ORDER BY d.created_at LIMIT 1`);
  const searchingCount = db.prepare(`SELECT COUNT(*) n FROM game_duels d JOIN users u ON u.id = d.a_id
    WHERE d.status = 'open' AND d.kind = 'quick' AND d.a_id <> $me AND d.deadline_at > $now AND u.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $me AND b.blocked_id = d.a_id)
                                                OR (b.blocker_id = d.a_id AND b.blocked_id = $me))`);
  const userRow = db.prepare('SELECT id, status, username FROM users WHERE id = ?');

  /** Не больше 20 идущих дуэлей — и у того, кто создаёт вызов (перебор — только если примут все открытые, до +6). */
  const activeLimit = (me) => {
    if (activeCount.get(me.id, me.id).n >= MAX_ACTIVE) throw tooMany(GAME_TEXT.active);
  };
  /** Дневной предел игр и предел идущих дуэлей — перед тем, как человек начнёт новую (внутри tx). */
  const beforeJoin = (me) => {
    dailyCap('game', me, capStat.get({ $me: me.id, $dayAgo: dayAgo() }));
    activeLimit(me);
  };
  /** Принять открытый вызов (внутри tx): меня — стороной b, срок — сутки с этого момента. */
  const joinDuel = (id, me, code, now) =>
    joinStmt.run(me.id, code, nowIso(now), nowIso(now + TTL_MS), id, nowIso(now)).changes === 1;
  // Встречный вызов другу: он уже вызвал меня (или ждёт реванша) — мой вызов его просто принимает.
  const counterInvite = db.prepare(`SELECT id FROM game_duels WHERE status = 'open' AND a_id = ? AND to_id = ?
    AND kind IN ('friend','rematch') AND deadline_at > ? ORDER BY id LIMIT 1`);
  // Повтор «Случайного соперника» после потерянного ответа: пару уже нашли (я принял чужую заявку или приняли мою)
  // тем же кодом меньше минуты назад — та же игра, а не вторая с кем-то ещё.
  const recentQuick = db.prepare(`SELECT id FROM game_duels WHERE kind = 'quick' AND status = 'active' AND joined_at > $since
    AND ((b_id = $me AND b_code = $code) OR (a_id = $me AND a_code = $code)) ORDER BY id DESC LIMIT 1`);
  /** Новый открытый вызов (внутри tx). Код вызова — только у ссылки. */
  const createDuel = (kind, me, code, { to = null, rematchOf = null } = {}, now) => {
    let token = null;
    if (kind === 'link') {
      for (let i = 0; i < 10 && (!token || tokenTaken.get(token)); i++) token = newToken();
      if (tokenTaken.get(token)) throw new SocialError(500, 'server', TEXT.server);
    }
    const r = insertDuel.run(kind, token, me.id, to, rematchOf, code, nowIso(now), nowIso(now + TTL_MS));
    return Number(r.lastInsertRowid);
  };
  const view = (id, uid) => duelView(ctx, duelById(db, id), uid);

  // #1 — лобби. Первый вызов заводит строку счёта (с этого момента человек «нашёл» игру).
  const lobbyRows = db.prepare(`SELECT d.* FROM game_duels d
    WHERE (d.a_id = $me OR d.b_id = $me OR (d.to_id = $me AND d.status = 'open' AND d.kind = 'friend'))
      AND (d.status IN ('open','active') OR COALESCE(d.finished_at, d.created_at) > $weekAgo)
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
           (b.blocker_id = $me AND b.blocked_id = CASE WHEN d.a_id = $me THEN COALESCE(d.b_id, d.to_id) ELSE d.a_id END)
        OR (b.blocked_id = $me AND b.blocker_id = CASE WHEN d.a_id = $me THEN COALESCE(d.b_id, d.to_id) ELSE d.a_id END))
    ORDER BY (d.status IN ('open','active')) DESC, COALESCE(d.finished_at, d.joined_at, d.created_at) DESC
    LIMIT 100`);
  /** Свои законченные непросмотренные игры, кроме shown (id строк лобби), — просмотрены. true — что-то изменилось. */
  const markOverflowSeen = (uid, shown) => {
    const keep = shown.length ? shown : [0];
    const not = `status IN ('done','expired','cancelled') AND id NOT IN (${keep.map(() => '?').join(',')})`;
    return tx(db, () => db.prepare(`UPDATE game_duels SET a_seen = 1 WHERE a_id = ? AND a_seen = 0 AND ${not}`).run(uid, ...keep).changes
      + db.prepare(`UPDATE game_duels SET b_seen = 1 WHERE b_id = ? AND b_seen = 0 AND ${not}`).run(uid, ...keep).changes) > 0;
  };
  inst.get('/api/social/games', async (req) => {
    const me = guard(req, 'S');
    limit('read', keyOf(req));
    const now = Date.now();
    ensurePlayer(db, me.id, nowIso(now));
    settleMine(ctx, me.id);
    const rows = lobbyRows.all({ $me: me.id, $weekAgo: nowIso(now - 7 * DAY) });
    const cards = usersByIds(db, rows.map((r) => oppIdOf(r, me.id)).filter(Boolean));
    const at = (r) => r.finished_at || r.joined_at || r.created_at;
    const rank = (x) => (x.state === 'invited' ? 0 : x.state === 'turn' ? 1 : 2);
    const duels = rows
      .map((r) => ({ r, out: duelRowOut(ctx, r, me.id, cards) }))
      .sort((x, y) => rank(x.out) - rank(y.out) || (at(x.r) < at(y.r) ? 1 : at(x.r) > at(y.r) ? -1 : y.r.id - x.r.id))
      .slice(0, LOBBY_ROWS)
      .map((x) => x.out);
    // Итоги, которые в лобби не поместились (за неделю больше 30 строк), открыть уже нельзя — считаем их
    // просмотренными, иначе «Тебя ждёт игра» на герое горело бы до недели.
    if (rows.length > LOBBY_ROWS && markOverflowSeen(me.id, duels.map((x) => x.id))) publishLobby(ctx, [me.id]);
    const p = playerOf(db, me.id);
    const day = tashkentDay(now);
    const d = dailyRow(db, me.id, day);
    const dn = d ? movesOf(d.moves).length : 0;
    const mode = gameMode();
    return ok({
      me: { wins: p.wins, losses: p.losses, draws: p.draws, streak: shownStreak(p, day), bestStreak: p.best_streak },
      daily: { status: dailyStatus(d), n: dn, left: ATTEMPTS - dn },
      duels,
      searching: mode === 'on' ? Number(searchingCount.get({ $me: me.id, $now: nowIso(now) }).n) || 0 : 0,
      cfg: { attempts: ATTEMPTS, ttlH: TTL_MS / HOUR, reactions: REACTIONS, game: mode },
    });
  });

  // #2 — «Код дня»: ничего не создаёт; недоигранные прошлые дни закрываются как «не взломан».
  inst.get('/api/social/games/daily', async (req) => {
    const me = guard(req, 'S');
    limit('read', keyOf(req));
    const day = tashkentDay();
    closeOldDaily(db, me.id, day);
    return ok({ daily: dailyView(ctx, me.id, day, dailyRow(db, me.id, day)) });
  });

  // #3 — попытка «Кода дня». Код у каждого свой (crypto.randomInt), появляется с первой попыткой.
  inst.post('/api/social/games/daily/guess', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    if (typeof b.day !== 'string' || !DAY_RE.test(b.day)) throw invalid(TEXT.invalid, 'day');
    const guess = codeField(b.guess, 'guess');
    const n = nField(b.n);
    const now = Date.now();
    const day = tashkentDay(now);
    if (b.day !== day) throw conflict('day', GAME_TEXT.newDay);
    limit('gameGuess', 'u:' + me.id);
    const iso = nowIso(now);
    const row = tx(db, () => {
      closeOldDaily(db, me.id, day);
      let d = dailyRow(db, me.id, day);
      const moves = d ? movesOf(d.moves) : [];
      if (n === moves.length && moves[n - 1][0] === guess) return d;   // повтор той же попытки (сеть) — как есть
      if (d && Number(d.solved) !== 0) throw over();
      if (n !== moves.length + 1) throw conflict('n', GAME_TEXT.stale);
      if (moves.some((m) => m[0] === guess)) throw invalid(GAME_TEXT.repeat, 'guess');
      if (!d) {
        ensurePlayer(db, me.id, iso);
        db.prepare('INSERT INTO game_daily (user_id, day, code, started_at) VALUES (?,?,?,?)').run(me.id, day, randomCode(), iso);
        d = dailyRow(db, me.id, day);
      }
      const { on, near } = evaluate(d.code, guess);
      moves.push([guess, on, near, iso]);
      const solved = on === 4 ? 1 : moves.length >= ATTEMPTS ? 2 : 0;
      db.prepare('UPDATE game_daily SET moves = ?, n = ?, solved = ?, finished_at = ?, ms = ? WHERE user_id = ? AND day = ?')
        .run(JSON.stringify(moves), moves.length, solved, solved ? iso : null,
          solved === 1 ? Math.max(0, now - Date.parse(d.started_at)) : null, me.id, day);
      if (solved === 1) {
        // Серия: вчера взломан — +1, сегодня уже был — как есть, иначе — 1.
        const p = playerOf(db, me.id);
        const streak = p.streak_day === day ? p.streak : p.streak_day === prevDay(day) ? p.streak + 1 : 1;
        db.prepare('UPDATE game_players SET streak = ?, best_streak = MAX(best_streak, ?), streak_day = ? WHERE user_id = ?')
          .run(streak, streak, day, me.id);
      }
      return dailyRow(db, me.id, day);
    });
    return ok({ daily: dailyView(ctx, me.id, day, row) });
  });

  // #4 — таблица «Кода дня» за сегодня: «Все», «Мой вуз» (нужен вуз), «Друзья». Места — среди того, что видно зрителю.
  inst.get('/api/social/games/daily/board', async (req) => {
    const me = guard(req, 'S');
    const q = req.query || {};
    const scope = q.scope === undefined || q.scope === '' ? 'all' : String(q.scope);
    if (!['all', 'uni', 'friends'].includes(scope)) throw invalid(TEXT.invalid, 'scope');
    if (scope === 'uni') needUni(req);
    if (scope !== 'friends' && gameMode() !== 'on') throw new SocialError(403, 'forbidden', GAME_TEXT.boardsOff);
    limit('read', keyOf(req));
    const day = tashkentDay();
    const params = { $day: day, $me: me.id, ...(scope === 'uni' ? { $uni: req.tenant.id } : {}) };
    const items = boardStmts(db, scope).items.all(params).map((r, i) => ({
      place: i + 1,
      user: userCardOf(ctx, r, false),
      n: r.g_n,
      ms: r.g_ms,
      me: r.id === me.id,
    }));
    const b = boardPlace(db, scope, params, dailyRow(db, me.id, day), me.uni || null);
    return ok({ day, scope, items, me: b.me, total: b.total });
  });

  // #5 — новый вызов: ссылкой, другу или «случайный соперник».
  inst.post('/api/social/games/duels', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    const mode = b.mode;
    if (mode !== 'link' && mode !== 'friend' && mode !== 'quick') throw invalid(TEXT.invalid, 'mode');
    if (mode === 'quick' && gameMode() !== 'on') throw new SocialError(403, 'forbidden', GAME_TEXT.quickOff);
    const code = codeField(b.code, 'code');
    let to = null;
    if (mode === 'friend') {
      to = intField(b.to, 'to');
      const t = to === me.id ? null : userRow.get(to);
      if (!t || t.status !== 'active' || !t.username || !areFriends(db, me.id, to) || blockedEither(db, me.id, to)) {
        throw blocked(GAME_TEXT.friend);
      }
    }
    limit('gameNew', 'u:' + me.id);
    settleMine(ctx, me.id);   // свои вызовы с вышедшим сроком — сначала итог: не вернуть истёкший и не считать его в пределах
    const now = Date.now();
    const iso = nowIso(now);
    const out = tx(db, () => {
      ensurePlayer(db, me.id, iso);
      if (mode === 'friend') {
        // Один открытый вызов другу на пару: повтор возвращает тот же.
        const same = db.prepare(`SELECT id FROM game_duels WHERE status = 'open' AND kind = 'friend' AND a_id = ? AND to_id = ?
          AND deadline_at > ? ORDER BY id DESC LIMIT 1`).get(me.id, to, iso);
        if (same) return { id: same.id, matched: false };
        // Друг уже вызвал меня — принимаем его вызов (две параллельные игры одной пары не нужны).
        const counter = counterInvite.get(to, me.id, iso);
        if (counter) {
          beforeJoin(me);
          if (joinDuel(counter.id, me, code, now)) return { id: counter.id, matched: true };
        }
      }
      if (mode === 'quick') {
        const mine = db.prepare(`SELECT id FROM game_duels WHERE status = 'open' AND kind = 'quick' AND a_id = ?
          AND deadline_at > ?`).get(me.id, iso);
        if (mine) return { id: mine.id, matched: false };
        const again = recentQuick.get({ $me: me.id, $code: code, $since: nowIso(now - MIN) });
        if (again) return { id: again.id, matched: true };
        beforeJoin(me);
        // Самая старая чужая заявка; уведена из-под носа (changes ≠ 1) — ещё одна попытка, потом своя заявка.
        for (let i = 0; i < 2; i++) {
          const c = pairCandidate.get({ $me: me.id, $now: nowIso(now) });
          if (!c) break;
          if (joinDuel(c.id, me, code, now)) return { id: c.id, matched: true };
        }
        return { id: createDuel('quick', me, code, {}, now), matched: false };
      }
      if (openInvites.get(me.id).n >= MAX_OPEN_INVITES) throw tooMany(GAME_TEXT.invites);
      activeLimit(me);
      dailyCap('game', me, capStat.get({ $me: me.id, $dayAgo: dayAgo() }));
      return { id: createDuel(mode, me, code, { to }, now), matched: false };
    });
    publishDuels(ctx, [out.id]);
    return ok({ duel: view(out.id, me.id), matched: out.matched });
  });

  // #6 — просмотр вызова по коду: и гостю (без «моего вуза» хозяина). Истёкший, принятый, чужой из-за
  // блокировки — один и тот же 404, чтобы блокировка не выдавала себя.
  // Только из приложения (X-Para: 1): чужая страница (<img src=…/invite?t=…>) не потратит ведёрко людей за общим IP.
  // Вошедший тратит своё ведёрко (u:<id>): кампусный Wi-Fi и CGNAT — один IP на многих. Гость — ведёрко IP, но жетон
  // уходит только на промах (нет такого живого вызова): подбирать коды нельзя, а открыть ссылку из чата группы — можно всем.
  inst.get('/api/social/games/invite', async (req) => {
    if (req.headers['x-para'] !== '1') throw new SocialError(403, 'csrf', TEXT.csrf);
    const t = String((req.query || {}).t ?? '').trim().toUpperCase();
    if (!TOKEN_RE.test(t)) throw notFound(GAME_TEXT.invite);
    const guestKey = req.user ? null : ipKey(req);
    if (req.user) limit('gameJoin', 'u:' + req.user.id);
    else limitPeek('gameJoin', guestKey);
    const miss = () => {
      if (guestKey) limited('gameJoin', guestKey);
      return notFound(GAME_TEXT.invite);
    };
    const found = db.prepare("SELECT id FROM game_duels WHERE token = ? AND kind = 'link'").get(t);
    const row = found ? loadSettled(ctx, found.id) : null;
    if (!row || row.status !== 'open' || row.token !== t) throw miss();
    const host = usersByIds(db, [row.a_id]).get(row.a_id);
    if (!host || host.status !== 'active' || !host.username) throw miss();
    const mine = !!req.user && req.user.id === row.a_id;
    if (req.user && !mine && blockedEither(db, req.user.id, row.a_id)) throw notFound(GAME_TEXT.invite);
    return ok({ invite: { id: row.id, from: userCardOf(ctx, host, !req.user), expiresAt: row.deadline_at, mine } });
  });

  // #7 — принять вызов по коду (ссылка из Telegram или «Ввести код»). Первый принявший играет.
  inst.post('/api/social/games/join', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    const code = codeField(b.code, 'code');
    const t = typeof b.t === 'string' ? b.t.trim().toUpperCase() : '';
    if (!TOKEN_RE.test(t)) throw notFound(GAME_TEXT.invite);
    limit('gameJoin', 'u:' + me.id);
    const found = db.prepare("SELECT id FROM game_duels WHERE token = ? AND kind = 'link'").get(t);
    const row0 = found ? loadSettled(ctx, found.id) : null;
    // Уже принял я (ответ потерялся, повтор) — та же игра, а не «Вызов истёк или уже принят».
    if (row0 && row0.b_id === me.id) return ok({ duel: duelView(ctx, row0, me.id) });
    const now = Date.now();
    const id = tx(db, () => {
      const row = found ? duelById(db, found.id) : null;
      if (!row || row.status !== 'open' || row.token !== t) throw notFound(GAME_TEXT.invite);
      if (row.a_id === me.id) throw invalid(GAME_TEXT.own);
      const host = row.a_id ? userRow.get(row.a_id) : null;
      if (!host || host.status !== 'active' || blockedEither(db, me.id, row.a_id)) throw notFound(GAME_TEXT.invite);
      beforeJoin(me);
      ensurePlayer(db, me.id, nowIso(now));
      if (!joinDuel(row.id, me, code, now)) throw notFound(GAME_TEXT.invite);
      return row.id;
    });
    publishDuels(ctx, [id]);
    return ok({ duel: view(id, me.id) });
  });

  // #8 — принять вызов из лобби (другу; реванш — тоже, но обычно через #14).
  inst.post('/api/social/games/duels/:id/accept', async (req) => {
    const me = guard(req, 'SPNM');
    const id = duelIdParam(req.params.id);
    const code = codeField(bodyOf(req).code, 'code');
    limit('gameJoin', 'u:' + me.id);
    const row0 = loadSettled(ctx, id);
    if (!row0 || (row0.to_id !== me.id && row0.b_id !== me.id)) throw notFound(GAME_TEXT.gone);
    if (row0.b_id === me.id) return ok({ duel: duelView(ctx, row0, me.id) });   // уже принят (повтор)
    const now = Date.now();
    tx(db, () => {
      const row = duelById(db, id);
      if (!row || row.status !== 'open' || row.to_id !== me.id) throw notFound(GAME_TEXT.invite);
      const host = row.a_id ? userRow.get(row.a_id) : null;
      if (!host || host.status !== 'active' || blockedEither(db, me.id, row.a_id)) throw notFound(GAME_TEXT.invite);
      beforeJoin(me);
      ensurePlayer(db, me.id, nowIso(now));
      if (!joinDuel(id, me, code, now)) throw notFound(GAME_TEXT.invite);
    });
    publishDuels(ctx, [id]);
    return ok({ duel: view(id, me.id) });
  });

  // #9 — отказаться от вызова (без M и N: работает в readonly и при ограничении).
  inst.post('/api/social/games/duels/:id/decline', async (req) => {
    const me = guard(req, 'S');
    const id = duelIdParam(req.params.id);
    bodyOf(req);
    limit('gameNew', 'u:' + me.id);
    const row = loadSettled(ctx, id);
    if (!row || row.to_id !== me.id) throw notFound(GAME_TEXT.gone);
    if (row.status === 'cancelled' && row.reason === 'declined') return ok({});
    if (row.status !== 'open') throw over();
    tx(db, () => {
      if (!cancelDuel(db, id, 'declined', 0, 1)) throw over();
    });
    publishDuels(ctx, [id]);
    publishLobby(ctx, [me.id]);
    return ok({});
  });

  // #10 — дуэль: участникам (и адресату, пока вызов открыт); остальным — 404, как несуществующая.
  inst.get('/api/social/games/duels/:id', async (req) => {
    const me = guard(req, 'S');
    const id = duelIdParam(req.params.id);
    limit('read', keyOf(req));
    const row = loadSettled(ctx, id);
    if (!canSee(row, me.id)) throw notFound(GAME_TEXT.gone);
    return ok({ duel: duelView(ctx, row, me.id) });
  });

  // #11 — попытка в дуэли. n — номер попытки (защита от двойной отправки); тот же n с той же попыткой — повтор, 200.
  inst.post('/api/social/games/duels/:id/guess', async (req) => {
    const me = guard(req, 'SPNM');
    const id = duelIdParam(req.params.id);
    const b = bodyOf(req);
    const guess = codeField(b.guess, 'guess');
    const n = nField(b.n);
    limit('gameGuess', 'u:' + me.id);
    loadSettled(ctx, id);   // срок вышел — сначала итог (тогда ниже 409)
    const now = Date.now();
    const out = tx(db, () => {
      const row = duelById(db, id);
      const my = sideOf(row, me.id);
      if (!my) throw notFound(GAME_TEXT.gone);
      const moves = movesOf(row[my + '_moves']);
      if (n === moves.length && moves[n - 1][0] === guess) return { row, changed: false };
      if (row.status !== 'active' || row[my + '_res']) throw over();
      if (n !== moves.length + 1) throw conflict('n', GAME_TEXT.stale);
      if (moves.some((m) => m[0] === guess)) throw invalid(GAME_TEXT.repeat, 'guess');
      const op = my === 'a' ? 'b' : 'a';
      const { on, near } = evaluate(row[op + '_code'], guess);
      moves.push([guess, on, near, nowIso(now)]);
      const res = on === 4 ? 'cracked' : moves.length >= ATTEMPTS ? 'failed' : null;
      const c = db.prepare(`UPDATE game_duels SET ${my}_moves = ?, ${my}_res = ?, v = v + 1
        WHERE id = ? AND status = 'active' AND v = ?`).run(JSON.stringify(moves), res, id, row.v).changes;
      if (c !== 1) throw conflict('n', GAME_TEXT.stale);
      return { row: finishDuel(db, duelById(db, id), now).row, changed: true };
    });
    if (out.changed) publishDuels(ctx, [id]);
    return ok({ duel: duelView(ctx, out.row, me.id) });
  });

  // #12 — реакция сопернику: только в идущей дуэли, только в его открытые потоки, нигде не хранится.
  inst.post('/api/social/games/duels/:id/react', async (req) => {
    const me = guard(req, 'SPNM');
    const id = duelIdParam(req.params.id);
    const b = bodyOf(req);
    if (!REACTIONS.includes(b.r)) throw invalid(TEXT.invalid, 'r');
    limit('gameReact', 'u:' + me.id);
    const row = loadSettled(ctx, id);
    const my = sideOf(row, me.id);
    if (!my) throw notFound(GAME_TEXT.gone);
    if (row.status !== 'active') throw over();
    const key = id + ':' + me.id;
    const cnt = reactCounts.get(key) || { n: 0, at: Date.now() };
    if (cnt.n >= MAX_REACTS) throw rateError(60);
    cnt.n++;
    reactCounts.set(key, cnt);
    const opp = my === 'a' ? row.b_id : row.a_id;
    if (opp) sendReact(opp, id, b.r);
    return ok({});
  });

  // #13 — «Сдаться» (идёт — поражение) или отменить свой непринятый вызов (без последствий).
  // Без M и N: работает в readonly и при ограничении.
  // expect — что человек видел, нажимая: 'open' («Отменить вызов», «Отменить поиск») или 'active' («Сдаться»).
  // Вызов успели принять, пока он подтверждал отмену, — 409, а не поражение; без expect — как раньше.
  inst.post('/api/social/games/duels/:id/leave', async (req) => {
    const me = guard(req, 'S');
    const id = duelIdParam(req.params.id);
    const b = bodyOf(req);
    if (b.expect !== undefined && b.expect !== 'open' && b.expect !== 'active') throw invalid(TEXT.invalid, 'expect');
    limit('gameNew', 'u:' + me.id);
    loadSettled(ctx, id);
    const now = Date.now();
    const row = tx(db, () => {
      const r = duelById(db, id);
      if (!canSee(r, me.id)) throw notFound(GAME_TEXT.gone);
      if (b.expect && (r.status === 'open' || r.status === 'active') && r.status !== b.expect) {
        throw conflict('status', GAME_TEXT.stale);
      }
      if (r.status === 'open') {
        // Свой вызов — отменить; вызов мне — то же, что отказаться.
        const own = r.a_id === me.id;
        if (!cancelDuel(db, id, own ? 'cancelled' : 'declined', own ? 1 : 0, 1, nowIso(now))) throw over();
        return duelById(db, id);
      }
      const my = sideOf(r, me.id);
      if (r.status !== 'active' || !my || r[my + '_res']) throw over();
      db.prepare(`UPDATE game_duels SET ${my}_res = 'left', v = v + 1 WHERE id = ? AND status = 'active' AND v = ?`).run(id, r.v);
      return finishDuel(db, duelById(db, id), now).row;
    });
    publishDuels(ctx, [id]);
    return ok({ duel: duelView(ctx, row, me.id) });
  });

  // #14 — реванш после законченной игры. Встречное предложение соперника — принять; своё — вернуть;
  // иначе новое: друзьям — вызов в лобби (kind 'friend'), не-друзьям — взаимный реванш (kind 'rematch'),
  // который виден только на экране итога этой игры. Истёкший или отклонённый реванш не-другу — пауза 7 дней.
  inst.post('/api/social/games/duels/:id/rematch', async (req) => {
    const me = guard(req, 'SPNM');
    const id = duelIdParam(req.params.id);
    const code = codeField(bodyOf(req).code, 'code');
    limit('gameNew', 'u:' + me.id);
    const src = loadSettled(ctx, id);
    const my = sideOf(src, me.id);
    if (!my) throw notFound(GAME_TEXT.gone);
    if (src.status !== 'done') throw conflict('status', GAME_TEXT.stale);
    const oppId = my === 'a' ? src.b_id : src.a_id;
    const opp = oppId ? userRow.get(oppId) : null;
    if (!opp || opp.status !== 'active' || !opp.username || blockedEither(db, me.id, oppId)) throw blocked(GAME_TEXT.rematch);
    // Истёкшее предложение (своё или встречное: to_id = я) — сначала итог: его нельзя ни принять, ни вернуть,
    // а истёкший реванш не-другу включает паузу 7 дней.
    settleMine(ctx, me.id);
    const now = Date.now();
    const newId = tx(db, () => {
      ensurePlayer(db, me.id, nowIso(now));
      const started = db.prepare("SELECT id FROM game_duels WHERE rematch_of = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
        .get(id);
      if (started) return started.id;   // реванш уже начался (оба нажали почти одновременно)
      const counter = db.prepare(`SELECT id FROM game_duels WHERE rematch_of = ? AND status = 'open' AND to_id = ? AND a_id = ?
        ORDER BY id DESC LIMIT 1`).get(id, me.id, oppId);
      if (counter) {
        beforeJoin(me);
        if (!joinDuel(counter.id, me, code, now)) throw notFound(GAME_TEXT.invite);
        return counter.id;
      }
      const mine = db.prepare(`SELECT id FROM game_duels WHERE rematch_of = ? AND status = 'open' AND a_id = ?
        ORDER BY id DESC LIMIT 1`).get(id, me.id);
      if (mine) return mine.id;
      const friends = areFriends(db, me.id, oppId);
      if (!friends && rematchCooldown(db, me.id, oppId)) throw blocked(GAME_TEXT.rematch);
      if (openInvites.get(me.id).n >= MAX_OPEN_INVITES) throw tooMany(GAME_TEXT.invites);
      activeLimit(me);
      dailyCap('game', me, capStat.get({ $me: me.id, $dayAgo: dayAgo() }));
      return createDuel(friends ? 'friend' : 'rematch', me, code, { to: oppId, rematchOf: id }, now);
    });
    publishDuels(ctx, [newId, id]);   // новая дуэль и итог старой (в нём поле rematch)
    return ok({ duel: view(newId, me.id) });
  });

  // #15 — итоги просмотрены: снять отметку «не видел» (до 30 дуэлей за раз).
  inst.post('/api/social/games/seen', async (req) => {
    const me = guard(req, 'S');
    const b = bodyOf(req);
    if (!Array.isArray(b.ids) || b.ids.length > LOBBY_ROWS) throw invalid(TEXT.invalid, 'ids');
    const ids = [...new Set(b.ids.map((x) => intField(x, 'ids')))];
    limit('read', keyOf(req));
    if (ids.length) {
      const marks = ids.map(() => '?').join(',');
      tx(db, () => {
        db.prepare(`UPDATE game_duels SET a_seen = 1 WHERE a_id = ? AND a_seen = 0 AND id IN (${marks})`).run(me.id, ...ids);
        db.prepare(`UPDATE game_duels SET b_seen = 1 WHERE b_id = ? AND b_seen = 0 AND id IN (${marks})`).run(me.id, ...ids);
      });
    }
    publishLobby(ctx, [me.id]);
    return ok({});
  });

  // #16 — поток событий (SSE), game-stream.js.
  inst.get('/api/social/games/stream', streamHandler(ctx));
}
