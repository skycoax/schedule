// «Шахматы» (CONTRACT.md §I): партии с друзьями — маршруты /api/social/chess. Игра с ботом целиком в приложении
// (web/src/game/bot.ts), сервер о ней не знает. Спрятаны в «Сегодня» (5 касаний по часам), как раньше покер.
// Партия живёт в базе (chess_games, V13): ходы в UCI через пробел, позиция (FEN), чей ход, итог. Правила — chess.js:
// ход проверяется на сервере, позиция восстанавливается из всех ходов (иначе троекратное повторение не увидеть).
// Часов нет: ходят в своём темпе. Ставок, фишек и выигрышей нет — это не азартная игра (возрастной рейтинг).
// Приглашение — как было у покера (§J.5): в памяти на 10 минут, событие invite в поток живых обновлений (live.js),
// me.game.invite и push. Принял — партия создаётся, цвет случайный. Каждый ход — событие chess обоим (своё view
// и сколько партий ждут твоего хода) и push сопернику, если у него Para закрыта.
import { Chess } from 'chess.js';
import { tx, nowIso } from './db.js';
import { ok, invalid, blocked, notFound, guard, bodyOf, intField, TEXT, SocialError } from './http.js';
import { limit, rateError } from './limits.js';
import { usersByIds, userCardOf, blockedEither } from './users.js';
import { areFriends } from './instant-access.js';
import { liveTo } from './live.js';
import { pushInvite, pushChess } from './push.js';

const INVITE_MS = 10 * 60_000;   // приглашение живёт 10 минут
const INVITE_AGAIN = 60_000;     // одному и тому же другу — не чаще раза в минуту
const MAX_ACTIVE = 20;           // идущих партий у человека
const MAX_PLY = 1000;            // защита базы: столько полуходов не бывает (50 ходов без взятий — уже ничья)
const RECENT = 10;               // законченных партий в списке
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const conflict = (message) => new SocialError(409, 'conflict', message, { field: 'status' });

export const CHESS_TEXT = {
  noInvite: 'Нельзя позвать этого человека',
  again: 'Уже позвали — подожди минуту',
  expired: 'Приглашение уже не действует',
  tooMany: `Уже идут ${MAX_ACTIVE} партий — доиграй какую-нибудь`,
  gone: 'Партия не найдена',
  over: 'Партия уже закончена',
  notYourTurn: 'Сейчас ход соперника',
  stale: 'Позиция изменилась — обнови партию',
  illegal: 'Так ходить нельзя',
  noOffer: 'Ничью не предлагали',
  offered: 'Ничья уже предложена',
};

// ─── Приглашения (в памяти) ───

const invites = new Map();   // toId → { fromId, at }
const sent = new Map();      // 'от:кому' → мс последнего приглашения

/** Входящее приглашение человека (не истекшее) или null. */
export function inviteOf(toId) {
  const inv = invites.get(toId);
  if (!inv) return null;
  if (Date.now() - inv.at > INVITE_MS) { invites.delete(toId); return null; }
  return inv;
}

/** Убрать входящее приглашение человека («не сейчас», принял, удалил аккаунт). */
export function dropInvite(toId) {
  invites.delete(toId);
}

// ─── Партии ───

const uci = (s) => ({ from: s.slice(0, 2), to: s.slice(2, 4), promotion: s[4] || undefined });
const RU = { K: 'Кр', Q: 'Ф', R: 'Л', B: 'С', N: 'К' };
/** Ход по-русски для уведомления: Кf3, Фxd8+, 0-0, e8=Ф (как в приложении). */
const ruSan = (san) => san.replace(/^O-O-O/, '0-0-0').replace(/^O-O/, '0-0').replace(/[KQRBN]/g, (x) => RU[x]);
const movesOf = (row) => (row.moves ? row.moves.split(' ') : []);
const colorOf = (row, uid) => (row.white_id === uid ? 'w' : row.black_id === uid ? 'b' : null);
const opponentOf = (row, uid) => (row.white_id === uid ? row.black_id : row.white_id);

/** Позиция после всех ходов партии (chess.js хранит историю — для повторений). */
function replay(moves) {
  const c = new Chess();
  for (const m of moves) c.move(uci(m));
  return c;
}

/** Итог после хода: null — партия идёт, иначе { result, reason }. */
function endOf(c) {
  if (c.isCheckmate()) return { result: c.turn() === 'w' ? '0-1' : '1-0', reason: 'mate' };
  if (c.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (c.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'material' };
  if (c.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'repetition' };
  if (c.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'fifty' };
  return null;
}

/**
 * Партии, где удаляют аккаунт uid: идущие заканчиваются победой соперника (reason left), а партии, где соперника
 * уже нет, удаляются (они больше ничьи). Вызывается внутри транзакции удаления аккаунта, до DELETE users (потом
 * ON DELETE SET NULL обнулит white_id/black_id в остальных).
 */
export function chessAccountGone(db, uid) {
  const now = nowIso();
  db.prepare(`DELETE FROM chess_games WHERE (white_id = ? AND black_id IS NULL) OR (black_id = ? AND white_id IS NULL)`)
    .run(uid, uid);
  db.prepare(`UPDATE chess_games SET status = 'over', reason = 'left', draw_offer = NULL, updated_at = ?,
    result = CASE WHEN white_id = ? THEN '0-1' ELSE '1-0' END
    WHERE status = 'active' AND (white_id = ? OR black_id = ?)`).run(now, uid, uid, uid);
  dropInvite(uid);
}

/** Сколько партий ждут хода человека (точка на герое, me.game.turn). */
export function chessTurns(db, uid) {
  return Number(db.prepare(`SELECT COUNT(*) n FROM chess_games WHERE status = 'active'
    AND ((white_id = ? AND turn = 'w') OR (black_id = ? AND turn = 'b'))`).get(uid, uid).n) || 0;
}

/**
 * /api/social/chess (CONTRACT.md §I): список (#1), партия (#2), позвать (#3), «не сейчас» (#4), принять (#5),
 * ход (#6), сдаться (#7), ничья (#8). Регистрируется, только если SOCIAL_MODE ≠ off и SOCIAL_GAME ≠ off.
 * Порядок в обработчике: проверки доступа → поля → пределы частоты → база (§B.2).
 */
export function chessRoutes(inst, ctx) {
  const db = ctx.db;
  const st = {
    get: db.prepare('SELECT * FROM chess_games WHERE id = ?'),
    active: db.prepare(`SELECT * FROM chess_games WHERE status = 'active' AND (white_id = ? OR black_id = ?)
      ORDER BY updated_at DESC, id DESC`),
    recent: db.prepare(`SELECT * FROM chess_games WHERE status = 'over' AND (white_id = ? OR black_id = ?)
      ORDER BY updated_at DESC, id DESC LIMIT ${RECENT}`),
    activeCount: db.prepare(`SELECT COUNT(*) n FROM chess_games WHERE status = 'active' AND (white_id = ? OR black_id = ?)`),
    stats: db.prepare(`SELECT
        SUM(CASE WHEN (white_id = $u AND result = '1-0') OR (black_id = $u AND result = '0-1') THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN (white_id = $u AND result = '0-1') OR (black_id = $u AND result = '1-0') THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws
      FROM chess_games WHERE status = 'over' AND (white_id = $u OR black_id = $u)`),
    create: db.prepare(`INSERT INTO chess_games (white_id, black_id, fen, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) RETURNING *`),
    move: db.prepare(`UPDATE chess_games SET moves = $moves, fen = $fen, turn = $turn, ply = $ply, draw_offer = NULL,
      status = $status, result = $result, reason = $reason, updated_at = $now WHERE id = $id AND ply = $was RETURNING *`),
    end: db.prepare(`UPDATE chess_games SET status = 'over', result = ?, reason = ?, draw_offer = NULL, updated_at = ?
      WHERE id = ? AND status = 'active' RETURNING *`),
    offer: db.prepare(`UPDATE chess_games SET draw_offer = ?, updated_at = ? WHERE id = ? AND status = 'active' RETURNING *`),
  };

  /** Карточки участников: удалённый аккаунт — null. */
  const cardsFor = (rows) => {
    const ids = [];
    for (const r of rows) { if (r.white_id) ids.push(r.white_id); if (r.black_id) ids.push(r.black_id); }
    const m = usersByIds(db, ids);
    const out = new Map();
    for (const [id, u] of m) out.set(id, userCardOf(ctx, u, false));
    return out;
  };

  /** ChessGame (social/types.ts) для участника uid. */
  const view = (row, uid, cards = cardsFor([row])) => ({
    id: row.id,
    white: (row.white_id && cards.get(row.white_id)) || null,
    black: (row.black_id && cards.get(row.black_id)) || null,
    me: colorOf(row, uid),
    moves: movesOf(row),
    fen: row.fen,
    turn: row.turn,
    status: row.status,
    result: row.result || null,
    reason: row.reason || null,
    drawOffer: row.draw_offer || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  /**
   * После изменения: обоим — их view и счёт «ждут твоего хода»; сопернику — push, если Para у него закрыта.
   * Между ними блокировка — push не шлём (партия остаётся: доиграть или сдаться, блокировка не раскрывается).
   */
  const announce = (row, actorId, pushBody) => {
    const cards = cardsFor([row]);
    const ids = [row.white_id, row.black_id].filter(Boolean);
    liveTo(ids, 'chess', (uid) => ({ game: view(row, uid, cards), turn: chessTurns(db, uid) }));
    const other = opponentOf(row, actorId);
    if (other && pushBody && !blockedEither(db, actorId, other)) {
      const actor = usersByIds(db, [actorId]).get(actorId);
      if (actor) pushChess(other, row.id, pushBody(actor));
    }
  };

  /** Партия, в которой участвует me, иначе 404. */
  const mine = (raw, me) => {
    const s = String(raw ?? '');
    if (!/^\d{1,12}$/.test(s)) throw notFound(CHESS_TEXT.gone);
    const row = st.get.get(Number(s));
    if (!row || !colorOf(row, me.id)) throw notFound(CHESS_TEXT.gone);
    return row;
  };
  const activeOf = (raw, me) => {
    const row = mine(raw, me);
    if (row.status !== 'active') throw conflict(CHESS_TEXT.over);
    return row;
  };

  // #1 — мои партии: идущие (все) и последние законченные; счёт побед.
  inst.get('/api/social/chess', async (req) => {
    const me = guard(req, 'S');
    limit('read', 'u:' + me.id);
    const rows = [...st.active.all(me.id, me.id), ...st.recent.all(me.id, me.id)];
    const cards = cardsFor(rows);
    const s = st.stats.get({ $u: me.id }) || {};
    return ok({
      games: rows.map((r) => view(r, me.id, cards)),
      stats: { wins: Number(s.wins) || 0, losses: Number(s.losses) || 0, draws: Number(s.draws) || 0 },
      turn: chessTurns(db, me.id),
    });
  });

  // #2 — одна партия (только участнику).
  inst.get('/api/social/chess/:id', async (req) => {
    const me = guard(req, 'S');
    limit('read', 'u:' + me.id);
    return ok({ game: view(mine(req.params.id, me), me.id) });
  });

  // #3 — позвать друга: { to } → {}. Только друга с активным аккаунтом и без блокировки в любую сторону, иначе
  // (и себя) — 403 blocked без причины. Одному и тому же — раз в минуту. Ему — invite { from, at } в поток и push.
  inst.post('/api/social/chess/invite', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    const to = intField(b.to, 'to');
    const t = to === me.id ? null : usersByIds(db, [to]).get(to);
    if (!t || !t.username || t.status !== 'active' || blockedEither(db, me.id, to) || !areFriends(db, me.id, to)) {
      throw blocked(CHESS_TEXT.noInvite);
    }
    if (Number(st.activeCount.get(me.id, me.id).n) >= MAX_ACTIVE) throw conflict(CHESS_TEXT.tooMany);
    const now = Date.now();
    const pair = me.id + ':' + to;
    const last = sent.get(pair);
    if (last && now - last < INVITE_AGAIN) throw rateError(Math.max(1, Math.ceil((last + INVITE_AGAIN - now) / 1000)), CHESS_TEXT.again);
    limit('gameInvite', 'u:' + me.id);
    if (sent.size >= 10_000) for (const [k, at] of sent) if (now - at >= INVITE_AGAIN) sent.delete(k);
    sent.set(pair, now);
    invites.set(to, { fromId: me.id, at: now });
    const from = usersByIds(db, [me.id]).get(me.id);
    if (from) {
      liveTo([to], 'invite', { from: userCardOf(ctx, from, false), at: now });
      pushInvite(to, from);   // приложение закрыто — push
    }
    return ok({});
  });

  // #4 — «не сейчас»: убрать своё входящее приглашение. Без P, N и M.
  inst.post('/api/social/chess/invite/dismiss', async (req) => {
    const me = guard(req, 'S');
    bodyOf(req);
    dropInvite(me.id);
    return ok({});
  });

  // #5 — принять: { from } → { game }. Приглашение от from должно действовать, дружба и отсутствие блокировок — тоже.
  inst.post('/api/social/chess/accept', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    const fromId = intField(b.from, 'from');
    const inv = inviteOf(me.id);
    if (!inv || inv.fromId !== fromId) throw conflict(CHESS_TEXT.expired);
    const f = usersByIds(db, [fromId]).get(fromId);
    if (!f || !f.username || f.status !== 'active' || blockedEither(db, me.id, fromId) || !areFriends(db, me.id, fromId)) {
      dropInvite(me.id);
      throw conflict(CHESS_TEXT.expired);
    }
    limit('gameSit', 'u:' + me.id);
    if (Number(st.activeCount.get(me.id, me.id).n) >= MAX_ACTIVE
      || Number(st.activeCount.get(fromId, fromId).n) >= MAX_ACTIVE) throw conflict(CHESS_TEXT.tooMany);
    dropInvite(me.id);
    const now = nowIso();
    const meWhite = Math.random() < 0.5;
    const row = tx(db, () => st.create.get(meWhite ? me.id : fromId, meWhite ? fromId : me.id, new Chess().fen(), now, now));
    announce(row, me.id, (actor) => `${actor.name || 'Друг'}: партия началась`);
    return ok({ game: view(row, me.id) });
  });

  // #6 — ход: { move: 'e2e4' | 'e7e8q', ply } → { game }. ply — сколько полуходов было до хода (защита от гонки
  // с двух устройств): не совпало — 409 stale. Не мой ход — 409; неверный ход — 400 move.
  inst.post('/api/social/chess/:id/move', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    if (typeof b.move !== 'string' || !UCI_RE.test(b.move)) throw invalid(CHESS_TEXT.illegal, 'move');
    if (!Number.isInteger(b.ply) || b.ply < 0) throw invalid(TEXT.invalid, 'ply');
    limit('gameAct', 'u:' + me.id);
    const row = activeOf(req.params.id, me);
    if (row.turn !== colorOf(row, me.id)) throw conflict(CHESS_TEXT.notYourTurn);
    if (row.ply !== b.ply) throw conflict(CHESS_TEXT.stale);
    const moves = movesOf(row);
    const c = replay(moves);
    let m;
    try { m = c.move(uci(b.move)); } catch { throw invalid(CHESS_TEXT.illegal, 'move'); }
    moves.push(m.lan);
    const end = endOf(c) || (moves.length >= MAX_PLY ? { result: '1/2-1/2', reason: 'fifty' } : null);
    const next = tx(db, () => st.move.get({
      $id: row.id, $was: row.ply, $moves: moves.join(' '), $fen: c.fen(), $turn: c.turn(), $ply: moves.length,
      $status: end ? 'over' : 'active', $result: end ? end.result : null, $reason: end ? end.reason : null, $now: nowIso(),
    }));
    if (!next) throw conflict(CHESS_TEXT.stale);
    const san = ruSan(m.san);
    announce(next, me.id, (actor) => {
      const name = actor.name || 'Соперник';
      if (!end) return `${name}: ${san} — твой ход`;
      if (end.reason === 'mate') return `${name}: ${san} — мат`;
      return `${name}: ${san} — ничья`;
    });
    return ok({ game: view(next, me.id) });
  });

  // #7 — сдаться: {} → { game }. Работает и в readonly, и при ограничении (только S).
  inst.post('/api/social/chess/:id/resign', async (req) => {
    const me = guard(req, 'S');
    bodyOf(req);
    limit('gameSit', 'u:' + me.id);
    const row = activeOf(req.params.id, me);
    const next = tx(db, () => st.end.get(colorOf(row, me.id) === 'w' ? '0-1' : '1-0', 'resign', nowIso(), row.id));
    if (!next) throw conflict(CHESS_TEXT.over);
    announce(next, me.id, (actor) => `${actor.name || 'Соперник'} сдаётся — победа твоя`);
    return ok({ game: view(next, me.id) });
  });

  // #8 — ничья: { action: offer | accept | decline } → { game }. offer — предложить (SPNM); соперник уже предложил —
  // это согласие. accept — согласиться на предложение соперника; decline — отказаться (только S).
  inst.post('/api/social/chess/:id/draw', async (req) => {
    const me = guard(req, 'S');
    const b = bodyOf(req);
    const action = b.action;
    if (!['offer', 'accept', 'decline'].includes(action)) throw invalid(TEXT.invalid, 'action');
    if (action === 'offer') guard(req, 'PNM');
    limit('gameSit', 'u:' + me.id);
    const row = activeOf(req.params.id, me);
    const mineC = colorOf(row, me.id);
    const theirs = row.draw_offer && row.draw_offer !== mineC;
    let next;
    if (action === 'accept' || (action === 'offer' && theirs)) {
      if (!theirs) throw conflict(CHESS_TEXT.noOffer);
      next = tx(db, () => st.end.get('1/2-1/2', 'agreement', nowIso(), row.id));
      if (next) announce(next, me.id, (actor) => `${actor.name || 'Соперник'}: ничья по согласию`);
    } else if (action === 'offer') {
      if (row.draw_offer === mineC) throw conflict(CHESS_TEXT.offered);
      next = tx(db, () => st.offer.get(mineC, nowIso(), row.id));
      if (next) announce(next, me.id, (actor) => `${actor.name || 'Соперник'} предлагает ничью`);
    } else {
      if (!theirs) throw conflict(CHESS_TEXT.noOffer);
      next = tx(db, () => st.offer.get(null, nowIso(), row.id));
      if (next) announce(next, me.id, null);
    }
    if (!next) throw conflict(CHESS_TEXT.over);
    return ok({ game: view(next, me.id) });
  });
}
