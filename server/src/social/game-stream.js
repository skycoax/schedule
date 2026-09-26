// Мини-игра «Код»: поток событий GET /api/social/games/stream (SSE, CONTRACT.md §I). Только дополнение:
// всё состояние в базе, поток лишь подсказывает приложению, что пора перечитать. Без id: и без повтора
// пропущенного — после переподключения приложение получает hello и перечитывает экран.
// Реестр соединений — в памяти (перезапуск его теряет, это безвредно). Импортирует только http.js и limits.js
// (и настройки): хуки блокировки, бана и удаления в users.js, moderation.js и posts.js шлют события без циклов импорта,
// а сборщик DuelView регистрирует game.js (setDuelViewBuilder).
import { social } from '../config.js';
import { SocialError, guard } from './http.js';
import { limit } from './limits.js';

const MAX_TOTAL = 300;          // всех соединений на сервер
const MAX_PER_USER = 3;         // 4-е вытесняет самое старое (bye replaced)
const MAX_BUFFER = 65_536;      // не читает — отключаем
const PRESENCE_OFF_MS = 5000;   // «вышел из игры» — через 5 с тишины (переподключение не мигает)

const conns = new Map();        // userId → Set<Conn>; Conn = { res, userId, sid, cid, openedAt, closed, maxTimer }
const CID_RE = /^[A-Za-z0-9_-]{8,24}$/;   // ?c= — случайный id потока вкладки (одна вкладка — один живой поток)
let total = 0;
let pingTimer = null;
let dbCtx = null;               // ctx первого streamHandler: для «в игре» (presence)
let viewOf = null;              // (ctx, row, viewerId) → DuelView
let waitingOf = null;           // (ctx, userId) → number
const offTimers = new Map();    // userId → таймер «вышел» (1→0)

/** game.js регистрирует сборщик DuelView и подсчёт waiting (Me.game). Без них publish* ничего не делает. */
export function setDuelViewBuilder(fn, waitingFn = null) {
  viewOf = fn;
  if (waitingFn) waitingOf = waitingFn;
}

/** Есть ли у человека хоть одно открытое соединение. */
export const isLive = (userId) => !!userId && conns.has(userId);

function send(conn, event, data) {
  if (conn.closed) return;
  try {
    conn.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (conn.res.writableLength > MAX_BUFFER) conn.res.destroy();
  } catch {
    drop(conn);
  }
}

/** Написать bye и закрыть: EventSource в приложении закрывает себя сам, иначе переподключился бы. */
function bye(conn, reason) {
  if (conn.closed) return;
  send(conn, 'bye', { reason });
  try { conn.res.end(); } catch { /* уже закрыто */ }
  drop(conn);
}

function drop(conn) {
  if (conn.closed) return;
  conn.closed = true;
  clearTimeout(conn.maxTimer);
  total = Math.max(0, total - 1);
  const set = conns.get(conn.userId);
  if (!set) return;
  set.delete(conn);
  if (set.size) return;
  conns.delete(conn.userId);
  // 1 → 0: соперникам «вышел» — если за 5 с не вернулся.
  const t = setTimeout(() => {
    offTimers.delete(conn.userId);
    if (!isLive(conn.userId)) presence(conn.userId, false);
  }, PRESENCE_OFF_MS);
  t.unref();
  offTimers.set(conn.userId, t);
}

/** «в игре» соперникам в каждой идущей дуэли человека. Только текущему сопернику — списка «кто онлайн» нет. */
function presence(userId, live) {
  if (!dbCtx) return;
  let rows = [];
  try {
    rows = dbCtx.db.prepare("SELECT id, a_id, b_id FROM game_duels WHERE status = 'active' AND (a_id = ? OR b_id = ?)")
      .all(userId, userId);
  } catch { return; }
  for (const r of rows) {
    const opp = r.a_id === userId ? r.b_id : r.a_id;
    for (const c of conns.get(opp) || []) send(c, 'presence', { duel: r.id, live });
  }
}

function ensurePing() {
  if (pingTimer) return;
  // Настоящее событие, а не комментарий: его видит JS (сторож 45 с в приложении и сдвиг часов).
  pingTimer = setInterval(() => {
    const now = Date.now();
    for (const set of conns.values()) for (const c of [...set]) send(c, 'ping', { now });
  }, social.gamePingMs);
  pingTimer.unref();
}

/**
 * #16 GET /api/social/games/stream. До hijack — обычные ответы JSON (401/403/429/503), после — только события.
 * Кука продления сессии (sessionLoader) переносится в заголовки вручную: после hijack onSend не работает.
 */
export function streamHandler(ctx) {
  dbCtx = ctx;
  return async function gameStream(req, reply) {
    const me = guard(req, 'SN');
    limit('gameStream', 'u:' + me.id);
    if (total >= MAX_TOTAL) throw new SocialError(503, 'server', 'Игра перегружена — попробуй чуть позже');

    const cookie = reply.getHeader('set-cookie');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'x-robots-tag': 'noindex',
      connection: 'keep-alive',
      ...(cookie ? { 'set-cookie': cookie } : {}),
    });
    const sock = req.raw.socket;
    if (sock) { sock.setKeepAlive(true, 20_000); sock.setNoDelay(true); sock.setTimeout(0); }

    const c = String((req.query || {}).c ?? '');
    const cid = CID_RE.test(c) ? c : null;
    const conn = { res, userId: me.id, sid: req.sid, cid, openedAt: Date.now(), closed: false, maxTimer: null };
    let set = conns.get(me.id);
    const first = !set;
    if (!set) { set = new Set(); conns.set(me.id, set); }
    set.add(conn);
    total++;
    // Соединение закрыто: клиентом, сетью или нами (bye). 'close' ответа приходит во всех этих случаях
    // во всех версиях Node (у запроса в старых версиях — уже после чтения тела).
    res.on('close', () => drop(conn));
    // Та же вкладка переподключилась (сторож 45 с, смена Wi-Fi ↔ LTE): старое соединение умерло молча и висело бы
    // до 15 минут — ложное «в игре» и чужое место в трёх. Закрываем его тихо, без bye: новое уже в наборе,
    // поэтому «вышел» соперникам не уходит.
    if (cid) {
      for (const old of [...set]) {
        if (old === conn || old.cid !== cid) continue;
        drop(old);
        try { old.res.destroy(); } catch { /* уже закрыто */ }
      }
    }
    while (set.size > MAX_PER_USER) bye(set.values().next().value, 'replaced');

    res.write('retry: 3000\n\n');
    send(conn, 'hello', { now: Date.now() });
    conn.maxTimer = setTimeout(() => bye(conn, 'max_age'), social.gameStreamMaxMs);
    conn.maxTimer.unref();
    ensurePing();

    // 0 → 1: «в игре» сразу, и когда человек вернулся раньше, чем ушло «вышел»: за эти 5 с соперник мог собрать
    // игру с live: false (принял вызов, перечитал экран). Повторное live: true приложению не мешает.
    if (first) {
      const t = offTimers.get(me.id);
      if (t) { clearTimeout(t); offTimers.delete(me.id); }
      presence(me.id, true);
    }
  };
}

/**
 * Разослать участникам дуэлей их DuelView (событие duel) и новый waiting (lobby). Вызывать после COMMIT;
 * никогда не бросает. Открытый вызов другу видит и адресат; открытый реванш не-другу — только создатель.
 * У реванша (rematch_of) заодно уходит и итог исходной игры: в нём поле rematch и кнопка «Реванш» — принят ли,
 * отклонён, отменён, истёк (один уровень, без повторов).
 */
export function publishDuels(ctx, ids) {
  try {
    if (!viewOf || !total || !ids || !ids.length) return;
    const get = ctx.db.prepare('SELECT * FROM game_duels WHERE id = ?');
    const lobby = new Set();
    const queue = [...new Set(ids)];
    const asked = queue.length;
    const done = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      const row = get.get(queue[i]);
      if (!row) continue;
      if (i < asked && row.rematch_of && !done.has(row.rematch_of)) {
        done.add(row.rematch_of);
        queue.push(row.rematch_of);
      }
      const viewers = [row.a_id, row.b_id];
      if (row.kind === 'friend' && row.to_id) {
        if (row.status === 'open') viewers.push(row.to_id);
        else if (conns.has(row.to_id)) lobby.add(row.to_id);
      }
      for (const uid of new Set(viewers)) {
        if (!uid || !conns.has(uid)) continue;
        const duel = viewOf(ctx, row, uid);
        for (const c of [...conns.get(uid) || []]) send(c, 'duel', { duel });
        lobby.add(uid);
      }
    }
    publishLobby(ctx, [...lobby]);
  } catch (err) {
    if (ctx && ctx.log) ctx.log.warn({ msg: err && err.message }, 'игра: событие не отправлено');
  }
}

/** Событие lobby { waiting } тем, у кого открыт поток. Никогда не бросает. */
export function publishLobby(ctx, userIds) {
  try {
    if (!waitingOf || !total) return;
    for (const uid of new Set(userIds)) {
      if (!uid || !conns.has(uid)) continue;
      const waiting = waitingOf(ctx, uid);
      for (const c of [...conns.get(uid) || []]) send(c, 'lobby', { waiting });
    }
  } catch (err) {
    if (ctx && ctx.log) ctx.log.warn({ msg: err && err.message }, 'игра: событие не отправлено');
  }
}

/** Реакция — только в открытые потоки соперника; нигде не хранится. */
export function sendReact(userId, duelId, r) {
  for (const c of [...conns.get(userId) || []]) send(c, 'react', { duel: duelId, r });
}

/** Закрыть все потоки человека (выход со всех устройств, удаление аккаунта — 'session'; бан — 'ban'). */
export function closeStreams(userId, reason) {
  for (const c of [...conns.get(userId) || []]) bye(c, reason);
}

/** Закрыть потоки одной сессии (обычный выход). */
export function closeStreamsBySid(sid) {
  if (!sid) return;
  for (const set of [...conns.values()]) for (const c of [...set]) if (c.sid === sid) bye(c, 'session');
}
