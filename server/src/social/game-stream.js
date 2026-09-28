// «Покер»: поток событий GET /api/social/games/stream (SSE, CONTRACT.md §I.6). Стол живёт в памяти
// (poker-table.js), поток после каждого изменения шлёт каждому соединению его view (гостям — общее).
// Без id: и без повтора пропущенного — после переподключения приложение получает hello и свежий стол.
// Реестр соединений — в памяти (перезапуск его теряет, это безвредно). Импортирует только http.js и limits.js
// (и настройки): хуки бана, выхода и удаления в moderation.js, auth.js и posts.js шлют bye без циклов импорта,
// а сборщик view и хук присутствия регистрирует стол (setStreamHooks).
import { social } from '../config.js';
import { SocialError, guard } from './http.js';
import { limit, ipKey } from './limits.js';

const MAX_TOTAL = 300;          // всех соединений на сервер
const MAX_PER_KEY = 3;          // у человека — 3 (4-е вытесняет самое старое: bye replaced); у гостей — 3 на IP
const MAX_BUFFER = 65_536;      // не читает — отключаем
const CID_RE = /^[A-Za-z0-9_-]{8,24}$/;   // ?c= — случайный id потока вкладки (одна вкладка — один живой поток)

// Conn = { res, userId: number|null, key: 'u:<id>'|'ip:<хеш>', sid, cid, openedAt, closed, maxTimer }
const conns = new Set();
const byUser = new Map();       // userId → Set<Conn>
let pingTimer = null;
let log = null;
let viewOf = null;              // (userId|null) → PokerView — для первого события table
let presenceOf = null;          // (userId, online) → void — 0→1 и 1→0 соединений человека

/** Стол регистрирует сборщик view (первое событие table) и хук присутствия. */
export function setStreamHooks({ view, presence, log: l } = {}) {
  if (view) viewOf = view;
  if (presence) presenceOf = presence;
  if (l) log = l;
}

/** Есть ли у человека хоть одно открытое соединение. */
export const isLive = (userId) => !!userId && byUser.has(userId);
/** Сколько потоков открыто всего (PokerView.watchers). */
export const streamCount = () => conns.size;

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
  conns.delete(conn);
  if (!conn.userId) return;
  const set = byUser.get(conn.userId);
  if (!set) return;
  set.delete(conn);
  if (set.size) return;
  byUser.delete(conn.userId);
  // 1 → 0: стол сам выждет AWAY_MS, прежде чем считать человека отошедшим.
  if (presenceOf) {
    try { presenceOf(conn.userId, false); } catch (err) { if (log) log.warn({ msg: err && err.message }, 'покер: хук присутствия'); }
  }
}

function ensurePing() {
  if (pingTimer) return;
  // Настоящее событие, а не комментарий: его видит JS (сторож 45 с в приложении и сдвиг часов).
  pingTimer = setInterval(() => {
    const now = Date.now();
    for (const c of [...conns]) send(c, 'ping', { now });
  }, social.gamePingMs);
  pingTimer.unref();
}

/**
 * GET /api/social/games/stream. Гостю можно (стол публичный); вошедший — как раньше: бан → 403.
 * До hijack — обычные ответы JSON (403/429/503), после — только события. Кука продления сессии
 * (sessionLoader) переносится в заголовки вручную: после hijack onSend не работает.
 */
export function streamHandler(ctx) {
  log = ctx.log;
  return async function gameStream(req, reply) {
    const me = req.user ? guard(req, 'SN') : null;
    const key = me ? 'u:' + me.id : ipKey(req);
    limit('gameStream', key);
    if (conns.size >= MAX_TOTAL) throw new SocialError(503, 'server', 'Стол перегружен — попробуй чуть позже');

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
    const conn = { res, userId: me ? me.id : null, key, sid: req.sid, cid, openedAt: Date.now(), closed: false, maxTimer: null };
    conns.add(conn);
    let first = false;
    if (conn.userId) {
      let set = byUser.get(conn.userId);
      first = !set;
      if (!set) { set = new Set(); byUser.set(conn.userId, set); }
      set.add(conn);
    }
    // Соединение закрыто: клиентом, сетью или нами (bye). 'close' ответа приходит во всех этих случаях
    // во всех версиях Node (у запроса в старых версиях — уже после чтения тела).
    res.on('close', () => drop(conn));
    // Та же вкладка переподключилась (сторож 45 с, смена Wi-Fi ↔ LTE): старое соединение умерло молча и висело бы
    // до 15 минут — ложное присутствие и чужое место в трёх. Закрываем его тихо, без bye.
    const same = [...conns].filter((x) => x !== conn && x.key === key).sort((a, b) => a.openedAt - b.openedAt);
    if (cid) {
      for (const old of same) {
        if (old.cid !== cid) continue;
        drop(old);
        try { old.res.destroy(); } catch { /* уже закрыто */ }
      }
    }
    const alive = same.filter((x) => !x.closed);
    while (alive.length + 1 > MAX_PER_KEY) bye(alive.shift(), 'replaced');

    res.write('retry: 3000\n\n');
    send(conn, 'hello', { now: Date.now() });
    conn.maxTimer = setTimeout(() => bye(conn, 'max_age'), social.gameStreamMaxMs);
    conn.maxTimer.unref();
    ensurePing();

    // 0 → 1: человек вернулся к столу (снимает away, если был). Потом — свежий стол этому соединению.
    if (first && presenceOf) {
      try { presenceOf(conn.userId, true); } catch (err) { log.warn({ msg: err && err.message }, 'покер: хук присутствия'); }
    }
    if (viewOf) {
      try { send(conn, 'table', { view: viewOf(conn.userId) }); } catch (err) { log.warn({ msg: err && err.message }, 'покер: первое table'); }
    }
  };
}

/**
 * Разослать всем соединениям их view (событие table): build(userId|null) → PokerView; у каждого человека
 * view своё (свои карты, маскировка блокировок), у гостей — общее; строится по разу. Вызывать после COMMIT;
 * никогда не бросает.
 */
export function broadcast(build) {
  try {
    if (!conns.size) return;
    const cache = new Map();
    for (const c of [...conns]) {
      if (c.closed) continue;
      const k = c.userId || 0;
      let view = cache.get(k);
      if (!view) { view = build(c.userId); cache.set(k, view); }
      send(c, 'table', { view });
    }
  } catch (err) {
    if (log) log.warn({ msg: err && err.message }, 'покер: событие не отправлено');
  }
}

/** Реакция { seat, r } — во все открытые потоки, кроме потоков самого отправителя; нигде не хранится. */
export function sendReact(fromUserId, payload) {
  for (const c of [...conns]) if (!fromUserId || c.userId !== fromUserId) send(c, 'react', payload);
}

/**
 * Сообщение чата стола (§I.11): build(userId|null) → строка чата этому зрителю или null (не показывать: блокировка);
 * строится по разу на человека. Всем открытым потокам, и самому автору (приложение уберёт дубль по id). Не бросает.
 */
export function sendChat(build) {
  try {
    const cache = new Map();
    for (const c of [...conns]) {
      if (c.closed) continue;
      const k = c.userId || 0;
      if (!cache.has(k)) cache.set(k, build(c.userId || null));
      const item = cache.get(k);
      if (item) send(c, 'chat', { item });
    }
  } catch (err) {
    if (log) log.warn({ msg: err && err.message }, 'покер: сообщение чата не отправлено');
  }
}

/** Закрыть все потоки человека (выход со всех устройств, удаление аккаунта — 'session'; бан — 'ban'). */
export function closeStreams(userId, reason) {
  for (const c of [...byUser.get(userId) || []]) bye(c, reason);
}

/** Закрыть потоки одной сессии (обычный выход). */
export function closeStreamsBySid(sid) {
  if (!sid) return;
  for (const c of [...conns]) if (c.sid === sid) bye(c, 'session');
}
