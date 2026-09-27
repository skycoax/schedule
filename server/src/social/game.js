// «Покер» (CONTRACT.md §I): маршруты /api/social/games — один общий стол Para, техасский холдем на игровые
// фишки, спрятан в «Сегодня» (5 касаний по часам). Стол и правила — poker-table.js (состояние, таймеры, view),
// poker-logic.js (карты), poker-bot.js (бот); поток событий — game-stream.js. Здесь только HTTP: проверки,
// поля, пределы частоты — и карточки/блокировки людей для стола (users.js), чтобы стол не тянул маршруты.
// Стол один на все вузы, поэтому проверки U нет нигде; смотреть могут и гости.
// Приглашения друзей (§J.5): позвать — событие invite другу в поток живых обновлений (live.js) и me.game.invite
// на 10 минут; хранятся только в памяти (poker-table.js).
// Экономика фишек (§I.10): ежедневный бонус (#9, poker-table.js claimBonus) и рейтинг по фишкам (#10, здесь — запрос
// к базе: видимость как у поиска и друзей).
import { ok, invalid, blocked, guard, bodyOf, intField, TEXT, marks } from './http.js';
import { limit, keyOf, rateError } from './limits.js';
import { usersByIds, userCardOf, blockedEither, CARD_COLS } from './users.js';
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

// ─── Рейтинг по фишкам (#10) ───
const TOP_N = 20;
const TOP_SCOPES = ['friends', 'all'];
// Кого видит $me: себя — всегда; остальных — активных с профилем и без блокировки в любую сторону; в «Друзьях» —
// принятых друзей, во «Всех» — ещё и взрослых, которых можно найти в поиске (searchable), — как у поиска людей.
const FRIEND_OF_ME = `EXISTS (SELECT 1 FROM friends f WHERE f.status = 'accepted'
  AND f.user_lo = MIN($me, u.id) AND f.user_hi = MAX($me, u.id))`;
const NO_BLOCK = `NOT EXISTS (SELECT 1 FROM blocks b
  WHERE (b.blocker_id = $me AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $me))`;
const TOP_VISIBLE = {
  friends: `(u.id = $me OR (u.status = 'active' AND u.username IS NOT NULL AND ${FRIEND_OF_ME} AND ${NO_BLOCK}))`,
  all: `(u.id = $me OR (u.status = 'active' AND u.username IS NOT NULL
    AND ((u.age_group = 'adult' AND u.searchable = 1) OR ${FRIEND_OF_ME}) AND ${NO_BLOCK}))`,
};
// Порядок мест: больше фишек — выше, при равенстве — кто раньше нашёл стол (found_at), затем id.
const TOP_ORDER = 'p.chips DESC, p.found_at, p.user_id';

/**
 * /api/social/games (#1–#5), поток (#6), приглашения (#7, #8), бонус (#9) и рейтинг (#10). Регистрируется, только
 * если SOCIAL_MODE ≠ off и SOCIAL_GAME ≠ off (иначе — общий 404). Порядок в обработчике: проверки доступа → поля →
 * пределы частоты → стол (§B.2).
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

  // #9 — ежедневный бонус: {} → { got, table }. Раз в сутки по Ташкенту, растёт с серией дней подряд; уже забран
  // сегодня → 409 status «Бонус на сегодня уже получен». За столом вне раздачи — сразу в стек, в раздаче — после неё.
  inst.post('/api/social/games/bonus', async (req) => {
    const me = guard(req, 'SPNM');
    bodyOf(req);
    limit('gameSit', 'u:' + me.id);
    return ok(pokerTable.claimBonus(me.id));
  });

  // #10 — рейтинг по фишкам: ?scope=friends|all → { scope, items (первые 20: place, user, chips, me), me, total }.
  // Кривой scope → 400 scope. Работает и в readonly, и ограниченным (они читают). Строки poker_players — у тех, кто
  // находил стол; фишки — из базы (у сидящих — на конец последней раздачи). me.place — 1 + сколько видимых стоит
  // выше меня в том же порядке, что и items; me — null, если я стол ещё не находил.
  const topQ = {};
  for (const scope of TOP_SCOPES) {
    const vis = TOP_VISIBLE[scope];
    const from = `FROM poker_players p JOIN users u ON u.id = p.user_id`;
    topQ[scope] = {
      items: db.prepare(`SELECT ${CARD_COLS}, p.chips AS p_chips ${from} LEFT JOIN media m ON m.id = u.avatar_id
        WHERE ${vis} ORDER BY ${TOP_ORDER} LIMIT ${TOP_N}`),
      total: db.prepare(`SELECT COUNT(*) n ${from} WHERE ${vis}`),
      above: db.prepare(`SELECT COUNT(*) n ${from} WHERE ${vis}
        AND (p.chips > $chips OR (p.chips = $chips AND (p.found_at < $found OR (p.found_at = $found AND p.user_id < $me))))`),
    };
  }
  const myRow = db.prepare('SELECT chips, found_at FROM poker_players WHERE user_id = ?');
  inst.get('/api/social/games/top', async (req) => {
    const me = guard(req, 'S');
    const scope = (req.query || {}).scope;
    if (!TOP_SCOPES.includes(scope)) throw invalid(TEXT.invalid, 'scope');
    limit('read', keyOf(req));
    const q = topQ[scope];
    const items = q.items.all({ $me: me.id }).map((r, i) => ({
      place: i + 1, user: userCardOf(ctx, r, false), chips: Number(r.p_chips), me: r.id === me.id,
    }));
    const mine = myRow.get(me.id);
    const place = mine ? Number(q.above.get({ $me: me.id, $chips: mine.chips, $found: mine.found_at }).n) + 1 : 0;
    return ok({
      scope,
      items,
      me: mine ? { place, chips: Number(mine.chips) } : null,
      total: Number(q.total.get({ $me: me.id }).n),
    });
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
