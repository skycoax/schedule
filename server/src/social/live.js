// Живые обновления приложения (CONTRACT.md §J): GET /api/social/live — один поток SSE на вошедшего, пока приложение
// открыто. Сервер шлёт ЧУЖИЕ события: посты и ответы, число «нравится», удаления и скрытия, заявки в друзья, моменты,
// приглашения в покер, число людей за столом; приложение превращает их в свои локальные события (web/src/social/live.ts).
// Без id и без повтора пропущенного: после переподключения приходит hello, и приложение перечитывает экраны.
// Код потока — копия проверенного game-stream.js (hijack, перенос куки продления сессии, ?c=, ping, max_age, bye,
// переполнение буфера); сам game-stream.js не меняется. Реестр соединений — в памяти (перезапуск его теряет, это безвредно).
// Импортирует только http.js и limits.js (и настройки), поэтому хуки в posts.js, users.js, moderation.js, instants.js,
// instant-access.js, auth.js, game.js и poker-table.js зовут liveTo/liveAll без циклов импорта. Кому что видно, решают
// сами хуки (им виднее: postOut, canSeeInstant, блокировки), здесь — только доставка. Вызывать после COMMIT;
// ни одна функция отсюда не бросает.
import { social } from '../config.js';
import { SocialError, guard } from './http.js';
import { limit } from './limits.js';

const MAX_TOTAL = 500;          // всех соединений на сервер
const MAX_PER_USER = 3;         // у человека — 3 (4-е вытесняет самое старое: bye replaced)
const MAX_BUFFER = 65_536;      // не читает — отключаем
const CID_RE = /^[A-Za-z0-9_-]{8,24}$/;   // ?c= — случайный id потока вкладки (одна вкладка — один живой поток)

// Conn = { res, userId, sid, cid, openedAt, closed, maxTimer }
const conns = new Set();
const byUser = new Map();       // userId → Set<Conn>
let pingTimer = null;
let log = null;

const warn = (err, what) => { if (log) log.warn({ msg: err && err.message }, 'живые обновления: ' + what); };
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function write(conn, text) {
  if (conn.closed) return;
  try {
    conn.res.write(text);
    if (conn.res.writableLength > MAX_BUFFER) conn.res.destroy();
  } catch {
    drop(conn);
  }
}
const send = (conn, event, data) => write(conn, frame(event, data));

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
  const set = byUser.get(conn.userId);
  if (!set) return;
  set.delete(conn);
  if (!set.size) byUser.delete(conn.userId);
}

function ensurePing() {
  if (pingTimer) return;
  // Настоящее событие, а не комментарий: его видит JS (сторож 45 с в приложении и сдвиг часов).
  pingTimer = setInterval(() => {
    const text = frame('ping', { now: Date.now() });
    for (const c of [...conns]) write(c, text);
  }, social.gamePingMs);
  pingTimer.unref();
}

/**
 * GET /api/social/live. Только вошедшим (ограниченным — можно: они читают); гость → 401 JSON. До hijack — обычные
 * ответы JSON (401/429/503), после — только события: retry, hello, дальше ping и чужие события. Кука продления сессии
 * (sessionLoader) переносится в заголовки вручную: после hijack onSend не работает.
 * Регистрируется в index.js вместе с остальными маршрутами, если SOCIAL_MODE ≠ off (в off — общий 404).
 * @param {import('fastify').FastifyInstance} inst
 */
export function liveRoutes(inst, ctx) {
  log = ctx.log;
  inst.get('/api/social/live', async (req, reply) => {
    const me = guard(req, 'S');
    limit('live', 'u:' + me.id);
    if (conns.size >= MAX_TOTAL) throw new SocialError(503, 'server', 'Сервер занят — попробуй чуть позже');

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
    conns.add(conn);
    let set = byUser.get(me.id);
    if (!set) { set = new Set(); byUser.set(me.id, set); }
    set.add(conn);
    // Соединение закрыто: клиентом, сетью или нами (bye). 'close' ответа приходит во всех этих случаях.
    res.on('close', () => drop(conn));
    // Та же вкладка переподключилась (сторож 45 с, смена Wi-Fi ↔ LTE): старое соединение умерло молча и висело бы
    // до 15 минут, занимая место в трёх. Закрываем его тихо, без bye.
    const same = [...set].filter((x) => x !== conn).sort((a, b) => a.openedAt - b.openedAt);
    if (cid) {
      for (const old of same) {
        if (old.cid !== cid) continue;
        drop(old);
        try { old.res.destroy(); } catch { /* уже закрыто */ }
      }
    }
    const alive = same.filter((x) => !x.closed);
    while (alive.length + 1 > MAX_PER_USER) bye(alive.shift(), 'replaced');

    res.write('retry: 3000\n\n');
    send(conn, 'hello', { now: Date.now() });
    conn.maxTimer = setTimeout(() => bye(conn, 'max_age'), social.gameStreamMaxMs);
    conn.maxTimer.unref();
    ensurePing();
  });
}

/**
 * Событие людям userIds (число или массив). data — объект (один на всех) или (userId) → объект | null
 * (null — этому не слать): строится по разу на человека и уходит во все его потоки. Тем, у кого потока нет, —
 * ничего и без затрат. exceptSid — не слать в потоки этой сессии: устройство, которое сделало запрос, уже знает
 * о своём посте или удалении из ответа, а эхо из потока могло бы прийти раньше ответа и посчитаться второй раз.
 * Никогда не бросает: ошибка сборки данных — в журнал (warn).
 */
export function liveTo(userIds, event, data, { exceptSid = null } = {}) {
  try {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    const shared = typeof data === 'function' ? null : frame(event, data ?? {});
    const done = new Set();
    for (const uid of ids) {
      if (done.has(uid)) continue;
      done.add(uid);
      const set = byUser.get(uid);
      const targets = set ? [...set].filter((c) => !exceptSid || c.sid !== exceptSid) : [];
      if (!targets.length) continue;
      let text = shared;
      if (text === null) {
        let d;
        try { d = data(uid); } catch (err) { warn(err, event); continue; }
        if (d === null || d === undefined) continue;
        text = frame(event, d);
      }
      for (const c of targets) write(c, text);
    }
  } catch (err) {
    warn(err, event);
  }
}

/** Событие всем живым; data и o — как у liveTo. */
export const liveAll = (event, data, o) => liveTo(liveUsers(), event, data, o);

/** Id людей, у которых сейчас открыт хоть один поток (для фильтров в хуках). */
export const liveUsers = () => [...byUser.keys()];

/** Есть ли у человека хоть один открытый поток. */
export const isLiveUser = (userId) => !!userId && byUser.has(userId);

/** Закрыть все потоки человека: bye { reason } (выход со всех устройств, удаление аккаунта — 'session'). */
export function liveClose(userId, reason = 'session') {
  for (const c of [...(byUser.get(userId) || [])]) bye(c, reason);
}

/** Закрыть потоки одной сессии (обычный выход): bye { reason: 'session' }. */
export function liveCloseSid(sid) {
  if (!sid) return;
  for (const c of [...conns]) if (c.sid === sid) bye(c, 'session');
}

// ─── Склейка частых событий ───
// likes — по посту (700 мс), players — одно на сервер (1 с): первое уходит сразу, все следующие за окно — одним
// событием в конце окна, с последними данными (fn сам читает свежее состояние и шлёт). Окно живёт, пока есть что склеивать.
const windows = new Map();      // key → { timer, next: fn | null }

/** Не чаще раза в ms на ключ key: нет окна — fn сейчас; есть — последний fn в конце окна. Никогда не бросает. */
export function liveThrottle(key, ms, fn) {
  const w = windows.get(key);
  if (w) { w.next = fn; return; }
  openWindow(key, ms, fn);
}

function openWindow(key, ms, fn) {
  const w = { timer: null, next: null };
  windows.set(key, w);
  w.timer = setTimeout(() => {
    windows.delete(key);
    if (w.next) openWindow(key, ms, w.next);
  }, ms);
  w.timer.unref();
  try { fn(); } catch (err) { warn(err, key); }
}
