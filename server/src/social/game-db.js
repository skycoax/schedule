// Мини-игра «Код»: действия с базой, которые нужны и маршрутам игры (game.js), и чужим хукам — блокировке
// (users.js), бану (moderation.js), удалению аккаунта (posts.js), выдаче Me. Только db.js и game-logic.js:
// так хуки не тянут маршруты игры и не создают циклов импорта. Всё вызывается внутри tx() (кроме gameMeOf).
import { nowIso, DAY } from './db.js';
import { settle } from './game-logic.js';

/** Попытки из JSON-столбца: [["1074",2,2,"2026-09-26T10:00:00.000Z"], …]; испорченное — []. */
export function movesOf(json) {
  try {
    const m = JSON.parse(json || '[]');
    return Array.isArray(m) ? m : [];
  } catch {
    return [];
  }
}

const duelRow = (db, id) => db.prepare('SELECT * FROM game_duels WHERE id = ?').get(id) || null;

/** Строка счёта игрока (появляется при первом GET /api/social/games или первой игре). */
export function ensurePlayer(db, userId, now = nowIso()) {
  if (!userId) return;
  db.prepare('INSERT OR IGNORE INTO game_players (user_id, found_at) VALUES (?, ?)').run(userId, now);
}

/**
 * Применить settle() к строке дуэли и записать исход (внутри tx). Счёт побед меняется только при переходе
 * active → done этой же строки (WHERE status='active' AND v=?, changes === 1) — ровно один раз.
 * Отметка «просмотрено» (x_seen): итог не видели оба, кроме сдавшегося (его действие и закончило игру);
 * истечение вызова и «время вышло» — оба не видели.
 * @returns {{ row: object|null, changed: boolean }} свежая строка и изменилась ли она
 */
export function finishDuel(db, row, now = Date.now()) {
  if (!row || (row.status !== 'open' && row.status !== 'active')) return { row, changed: false };
  const r = settle({
    status: row.status,
    deadlineAt: row.deadline_at,
    a: { n: movesOf(row.a_moves).length, res: row.a_res },
    b: { n: movesOf(row.b_moves).length, res: row.b_res },
  }, now);
  if (!r) return { row, changed: false };
  const iso = nowIso(typeof now === 'number' ? now : Date.parse(now));
  if (r.status === 'expired') {
    const c = db.prepare(`UPDATE game_duels SET status = 'expired', reason = 'expired', winner = 'none', token = NULL,
      finished_at = ?, a_seen = 0, b_seen = 0, v = v + 1 WHERE id = ? AND status = 'open' AND v = ?`).run(iso, row.id, row.v).changes;
    return { row: duelRow(db, row.id), changed: c === 1 };
  }
  const c = db.prepare(`UPDATE game_duels SET status = 'done', winner = ?, reason = ?, a_res = ?, b_res = ?, finished_at = ?,
    token = NULL, a_seen = ?, b_seen = ?, v = v + 1 WHERE id = ? AND status = 'active' AND v = ?`)
    .run(r.winner, r.reason, r.aRes, r.bRes, iso, r.aRes === 'left' ? 1 : 0, r.bRes === 'left' ? 1 : 0, row.id, row.v).changes;
  if (c === 1) {
    const add = db.prepare(`UPDATE game_players SET wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE user_id = ?`);
    for (const [side, id] of [['a', row.a_id], ['b', row.b_id]]) {
      if (!id) continue;
      ensurePlayer(db, id, iso);
      if (r.winner === 'draw') add.run(0, 0, 1, id);
      else if (r.winner === side) add.run(1, 0, 0, id);
      else add.run(0, 1, 0, id);
    }
  }
  return { row: duelRow(db, row.id), changed: c === 1 };
}

/**
 * Прервать открытую или идущую дуэль без счёта (внутри tx): status 'cancelled', winner 'none'.
 * seenA/seenB — отметки «просмотрено» после этого (1 — у того, кто прервал сам).
 */
export function cancelDuel(db, id, reason, seenA, seenB, now = nowIso()) {
  return db.prepare(`UPDATE game_duels SET status = 'cancelled', reason = ?, winner = 'none', token = NULL, finished_at = ?,
    a_seen = ?, b_seen = ?, v = v + 1 WHERE id = ? AND status IN ('open','active')`).run(reason, now, seenA, seenB, id).changes === 1;
}

/**
 * Блокировка (внутри tx блокировки, users.js): все открытые и идущие дуэли пары — в любую сторону, и вызовы
 * (a_id, to_id) — прерываются без счёта (reason 'blocked'), итог не видели оба. Возвращает id — для publishDuels.
 * Наружу 'blocked' не уходит никогда: game.js отдаёт его как 'cancelled' («Игра прервана»).
 */
export function cancelDuelsBetween(db, a, b) {
  if (!a || !b) return [];
  const rows = db.prepare(`SELECT id FROM game_duels WHERE status IN ('open','active')
    AND ((a_id = $a AND (b_id = $b OR to_id = $b)) OR (a_id = $b AND (b_id = $a OR to_id = $a)))`).all({ $a: a, $b: b });
  const now = nowIso();
  return rows.filter((r) => cancelDuel(db, r.id, 'blocked', 0, 0, now)).map((r) => r.id);
}

/**
 * Бан или удаление аккаунта (внутри их tx): свои открытые вызовы и поиск — отменены; вызовы ему — «отклонены»;
 * идущие дуэли — «сдался» (соперник получает победу с reason 'left', приложение бан не называет; счёт идёт).
 * reason ('banned' | 'deleted') — для читающего код: сами строки об этом не говорят. Возвращает id.
 * @param {'banned'|'deleted'} _reason
 */
export function forfeitAll(db, id, _reason) {
  const ids = [];
  const now = Date.now();
  const iso = nowIso(now);
  for (const r of db.prepare("SELECT id FROM game_duels WHERE a_id = ? AND status = 'open'").all(id)) {
    if (cancelDuel(db, r.id, 'cancelled', 1, 1, iso)) ids.push(r.id);
  }
  for (const r of db.prepare("SELECT id FROM game_duels WHERE to_id = ? AND status = 'open'").all(id)) {
    if (cancelDuel(db, r.id, 'declined', 0, 1, iso)) ids.push(r.id);
  }
  for (const r of db.prepare("SELECT * FROM game_duels WHERE status = 'active' AND (a_id = ? OR b_id = ?)").all(id, id)) {
    const side = r.a_id === id ? 'a' : 'b';
    db.prepare(`UPDATE game_duels SET ${side}_res = 'left', v = v + 1 WHERE id = ? AND status = 'active'`).run(r.id);
    finishDuel(db, duelRow(db, r.id), now);
    ids.push(r.id);
  }
  return ids;
}

// Сколько игр ждут человека: его ход в идущей дуэли, итог, который он ещё не видел (за 7 дней, соперник
// не заблокирован — как в лобби), и вызовы от друзей. Реванш не-друга (kind 'rematch') в открытом виде
// не считается никогда: он виден только на экране итога той игры.
const WAITING_SQL = `
  SELECT (SELECT COUNT(*) FROM game_duels WHERE status = 'active'
            AND ((a_id = $me AND a_res IS NULL) OR (b_id = $me AND b_res IS NULL)))
       + (SELECT COUNT(*) FROM game_duels d WHERE d.status IN ('done','expired','cancelled')
            AND ((d.a_id = $me AND d.a_seen = 0) OR (d.b_id = $me AND d.b_seen = 0))
            AND COALESCE(d.finished_at, d.created_at) > $weekAgo
            AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                 (b.blocker_id = $me AND b.blocked_id = CASE WHEN d.a_id = $me THEN COALESCE(d.b_id, d.to_id) ELSE d.a_id END)
              OR (b.blocked_id = $me AND b.blocker_id = CASE WHEN d.a_id = $me THEN COALESCE(d.b_id, d.to_id) ELSE d.a_id END)))
       + (SELECT COUNT(*) FROM game_duels WHERE status = 'open' AND to_id = $me AND kind = 'friend') AS waiting`;

/**
 * Me.game: { waiting } | null. null — человек игру не находил (строки game_players нет): один дешёвый запрос,
 * ничего не выдаёт тем, кто о ней не знает.
 */
export function gameMeOf(db, id) {
  if (!id || !db.prepare('SELECT 1 FROM game_players WHERE user_id = ?').get(id)) return null;
  const r = db.prepare(WAITING_SQL).get({ $me: id, $weekAgo: nowIso(Date.now() - 7 * DAY) });
  return { waiting: Number(r && r.waiting) || 0 };
}
