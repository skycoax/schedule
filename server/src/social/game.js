// «Покер» (CONTRACT.md §I): маршруты /api/social/games — один общий стол Para, техасский холдем на игровые
// фишки, спрятан в «Сегодня» (5 касаний по часам). Стол и правила — poker-table.js (состояние, таймеры, view),
// poker-logic.js (карты), poker-bot.js (бот); поток событий — game-stream.js. Здесь только HTTP: проверки,
// поля, пределы частоты — и карточки/блокировки людей для стола (users.js), чтобы стол не тянул маршруты.
// Стол один на все вузы, поэтому проверки U нет нигде; смотреть могут и гости.
import { ok, invalid, guard, bodyOf, TEXT, marks } from './http.js';
import { limit, keyOf } from './limits.js';
import { usersByIds, userCardOf } from './users.js';
import { streamHandler } from './game-stream.js';
import * as pokerTable from './poker-table.js';

const { REACTIONS, ACTIONS } = pokerTable;

/**
 * /api/social/games (#1–#5) и поток (#6). Регистрируется, только если SOCIAL_MODE ≠ off и SOCIAL_GAME ≠ off
 * (иначе — общий 404). Порядок в обработчике: проверки доступа → поля → пределы частоты → стол (§B.2).
 * @param {import('fastify').FastifyInstance} inst
 */
export function gameRoutes(inst, ctx) {
  const db = ctx.db;

  // #1 — стол: всем, даже гостям. Вошедшему — строка счёта (found_at) и отметка присутствия (опрос вместо потока).
  inst.get('/api/social/games', async (req) => {
    limit('read', keyOf(req));
    if (req.user) pokerTable.touchPlayer(req.user.id);
    return ok(pokerTable.viewFor(req.user ? req.user.id : null));
  });

  // #2 — сесть. 409 «Стол заполнен» / «За этот стол сейчас не сесть — попробуй позже» (блокировка, причина не раскрывается).
  inst.post('/api/social/games/sit', async (req) => {
    const me = guard(req, 'SPNM');
    bodyOf(req);
    limit('gameSit', 'u:' + me.id);
    return ok({ table: pokerTable.sit(me) });
  });

  // #3 — встать: без M и N (работает в readonly и при ограничении). Не сижу — 200.
  inst.post('/api/social/games/stand', async (req) => {
    const me = guard(req, 'S');
    bodyOf(req);
    limit('gameSit', 'u:' + me.id);
    return ok({ table: pokerTable.stand(me.id) });
  });

  // #4 — ход: { hand, action, amount? }. Не мой ход или чужая раздача → 409 «Сейчас не твой ход».
  inst.post('/api/social/games/act', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    if (!Number.isInteger(b.hand) || b.hand < 1) throw invalid(TEXT.invalid, 'hand');
    if (!ACTIONS.includes(b.action)) throw invalid(TEXT.invalid, 'action');
    if (b.action === 'raise' && !Number.isInteger(b.amount)) throw invalid(pokerTable.POKER_TEXT.amount, 'amount');
    limit('gameAct', 'u:' + me.id);
    return ok({ table: pokerTable.act(me.id, b.hand, b.action, b.amount) });
  });

  // #5 — реакция сидящего: всем остальным в поток; нигде не хранится. Неизвестная → 400 r; не за столом → 409.
  inst.post('/api/social/games/react', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    if (!REACTIONS.includes(b.r)) throw invalid(TEXT.invalid, 'r');
    limit('gameReact', 'u:' + me.id);
    pokerTable.react(me.id, b.r);
    return ok({});
  });

  // #6 — поток событий (SSE), game-stream.js: гостю тоже.
  inst.get('/api/social/games/stream', streamHandler(ctx));

  // Стол: карточки сидящих и блокировки — из базы, по разу на рассылку.
  const blocksAmong = (ids) => {
    const out = new Set();
    if (!ids.length) return out;
    const rows = db.prepare(`SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id IN (${marks(ids)}) OR blocked_id IN (${marks(ids)})`)
      .all(...ids, ...ids);
    for (const r of rows) out.add(r.blocker_id + ':' + r.blocked_id);
    return out;
  };
  const blockedWith = (id, ids) => !!ids.length && !!db.prepare(`SELECT 1 FROM blocks
    WHERE (blocker_id = ? AND blocked_id IN (${marks(ids)})) OR (blocked_id = ? AND blocker_id IN (${marks(ids)})) LIMIT 1`)
    .get(id, ...ids, id, ...ids);
  // Гостю — карточка без «моего вуза» (как везде, V7).
  const cardsOf = (ids) => {
    const out = new Map();
    for (const [id, row] of usersByIds(db, ids)) out.set(id, { full: userCardOf(ctx, row, false), guest: userCardOf(ctx, row, true) });
    return out;
  };
  pokerTable.startTable(ctx, { cardsOf, blocksAmong, blockedWith });
}
