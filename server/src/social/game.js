// «Покер» (CONTRACT.md §I): маршруты /api/social/games — один общий стол Para, техасский холдем на игровые
// фишки, спрятан в «Сегодня» (5 касаний по часам). Стол и правила — poker-table.js (состояние, таймеры, view),
// poker-logic.js (карты), poker-bot.js (бот); поток событий — game-stream.js. Здесь только HTTP: проверки,
// поля, пределы частоты — и карточки/блокировки людей для стола (users.js), чтобы стол не тянул маршруты.
// Стол один на все вузы, поэтому проверки U нет нигде; смотреть могут и гости.
// Приглашения друзей (§J.5): позвать — событие invite другу в поток живых обновлений (live.js) и me.game.invite
// на 10 минут; хранятся только в памяти (poker-table.js).
import { ok, invalid, blocked, guard, bodyOf, intField, TEXT, marks } from './http.js';
import { limit, keyOf, rateError } from './limits.js';
import { usersByIds, userCardOf, blockedEither } from './users.js';
import { areFriends } from './instant-access.js';
import { streamHandler } from './game-stream.js';
import { liveTo } from './live.js';
import * as pokerTable from './poker-table.js';

const { REACTIONS, ACTIONS } = pokerTable;

const INVITE_TEXT = {
  no: 'Нельзя позвать этого человека',
  again: 'Уже позвали — подожди минуту',
};
const INVITE_AGAIN = 60_000;   // одному и тому же другу — не чаще раза в минуту

/**
 * /api/social/games (#1–#5), поток (#6) и приглашения (#7, #8). Регистрируется, только если SOCIAL_MODE ≠ off и SOCIAL_GAME ≠ off
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

  // #7 — позвать друга: { to } → {}. Только друга (принятая дружба) с активным аккаунтом и без блокировки в любую
  // сторону, иначе (и себя) — 403 blocked, причина не раскрывается. Одному и тому же — раз в минуту (429 до конца
  // минуты, жетон ведёрка не тратится). Приглашение для него заменяет прежнее и живёт 10 минут (poker-table.js);
  // ему в поток — invite { from, at } (at — мс сервера), если потока нет — увидит в me.game.invite.
  const sent = new Map();   // 'от:кому' → мс последнего приглашения
  inst.post('/api/social/games/invite', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    const to = intField(b.to, 'to');
    const t = to === me.id ? null : usersByIds(db, [to]).get(to);
    if (!t || !t.username || t.status !== 'active' || blockedEither(db, me.id, to) || !areFriends(db, me.id, to)) {
      throw blocked(INVITE_TEXT.no);
    }
    const now = Date.now();
    const pair = me.id + ':' + to;
    const last = sent.get(pair);
    if (last && now - last < INVITE_AGAIN) throw rateError(Math.max(1, Math.ceil((last + INVITE_AGAIN - now) / 1000)), INVITE_TEXT.again);
    limit('gameInvite', 'u:' + me.id);
    if (sent.size >= 10_000) for (const [k, at] of sent) if (now - at >= INVITE_AGAIN) sent.delete(k);
    sent.set(pair, now);
    pokerTable.putInvite(to, me.id, now);
    const from = usersByIds(db, [me.id]).get(me.id);
    if (from) liveTo([to], 'invite', { from: userCardOf(ctx, from, false), at: now });
    return ok({});
  });

  // #8 — «не сейчас»: убрать своё входящее приглашение. Без P, N и M (работает и в readonly).
  inst.post('/api/social/games/invite/dismiss', async (req) => {
    const me = guard(req, 'S');
    bodyOf(req);
    pokerTable.dropInvite(me.id);
    return ok({});
  });

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
