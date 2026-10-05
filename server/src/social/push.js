// Уведомления, когда Para закрыта (Web Push: RFC 8030, шифрование RFC 8291, VAPID RFC 8292 — библиотека web-push;
// запрос уходит обычным fetch). Контракт — CONTRACT.md §K.
// Подписка — одно устройство (браузер или приложение с экрана «Домой»): endpoint и ключи шифрования, где подписались
// (Para или адрес вуза — для ссылки в уведомлении), вуз и группа (изменения пар), сессия этого устройства (заявки
// в друзья, ответы, приглашения в покер — только пока на нём выполнен вход) и что присылать (kinds — переключатели
// «Уведомлений» в приложении). Содержимое шифруется ключом устройства: служба push видит только адрес, время и размер.
// Кому своё событие видно на открытом экране (живой поток, live.js), тому push о нём не шлём.
// Ключи VAPID создаются при первом запуске: <DATA_DIR>/push-vapid.json (секрет: не выводить, не коммитить).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { config, social } from '../config.js';
import { nowIso } from './db.js';
import { SocialError, bodyOf, invalid, ok } from './http.js';
import { keyOf, limit } from './limits.js';
import { isLiveUser } from './live.js';
import { maskProfanity } from './text.js';

export const KINDS = Object.freeze(['sched', 'game', 'friends', 'replies']);
const MIN = 60_000;
const DAY_S = 86_400;
const MAX_SUBS = 200_000;          // всего подписок: защита базы от мусора
const MAX_FAILS = 10;              // неудачных отправок подряд (сеть, 429, 5xx, 400/403) — и подписку забываем
const WORKERS = 16;                // одновременных отправок
const MAX_QUEUE = 50_000;

// Службы push браузеров: сервер шлёт только туда (иначе подписка — способ заставить его стучаться куда угодно).
// Вне production — ещё http://127.0.0.1:<порт> (поддельная служба дымового теста).
const PUSH_HOST = /(^|\.)(googleapis\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com|yandex\.net|yandex\.ru)$/;
const DEV_ENDPOINT = /^http:\/\/127\.0\.0\.1:\d{2,5}\//;

const TEXT = {
  off: 'Уведомления сейчас недоступны',
  endpoint: 'Этот браузер не поддерживается',
};

let ctxRef = null;
let vapid = null;                  // { subject, publicKey, privateKey } — null: отправка выключена
let st = null;                     // подготовленные запросы

/** Готовы ли уведомления (ключи есть и SOCIAL_PUSH не off). */
export const pushReady = () => !!vapid;

function loadKeys() {
  mkdirSync(config.dataDir, { recursive: true });
  const file = join(config.dataDir, 'push-vapid.json');
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(webpush.generateVAPIDKeys()) + '\n', { mode: 0o600, flag: 'wx' });
    ctxRef.log.info('уведомления: созданы ключи VAPID');
  }
  const k = JSON.parse(readFileSync(file, 'utf8'));
  if (!k || typeof k.publicKey !== 'string' || typeof k.privateKey !== 'string') throw new Error('push-vapid.json без ключей');
  return k;
}

/** Подготовка при старте (registerSocial). Ошибка ключей — уведомления выключены, остальное работает. */
export function initPush(ctx) {
  ctxRef = ctx;
  const db = ctx.db;
  st = {
    upsert: db.prepare(`INSERT INTO push_subs (endpoint, p256dh, auth, hub, uni, grp, session_id, kinds, created_at, updated_at)
      VALUES ($endpoint, $p256dh, $auth, $hub, $uni, $grp, $sid, $kinds, $now, $now)
      ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, hub = excluded.hub,
        uni = excluded.uni, grp = excluded.grp, session_id = excluded.session_id, kinds = excluded.kinds,
        updated_at = excluded.updated_at, fails = 0`),
    exists: db.prepare('SELECT 1 FROM push_subs WHERE endpoint = ?'),
    count: db.prepare('SELECT COUNT(*) n FROM push_subs'),
    remove: db.prepare('DELETE FROM push_subs WHERE endpoint = ?'),
    drop: db.prepare('DELETE FROM push_subs WHERE id = ?'),
    okSent: db.prepare('UPDATE push_subs SET fails = 0 WHERE id = ? AND fails > 0'),
    failed: db.prepare('UPDATE push_subs SET fails = fails + 1 WHERE id = ? RETURNING fails'),
    ofUser: db.prepare(`SELECT p.* FROM push_subs p JOIN sessions s ON s.id = p.session_id
      WHERE s.user_id = ? AND s.expires_at > ?`),
  };
  if (social.push === 'off') { ctx.log.info('уведомления выключены (SOCIAL_PUSH=off)'); return; }
  try {
    const k = loadKeys();
    // subject — https-адрес Para (в разработке PARA_ORIGIN бывает http — тогда адрес из hub.json).
    const subject = ctx.origin.startsWith('https://') ? ctx.origin : 'https://' + ctx.hub.hosts[0];
    vapid = { subject, publicKey: k.publicKey, privateKey: k.privateKey };
  } catch (err) {
    vapid = null;
    ctx.log.error({ msg: err && err.message }, 'уведомления: нет ключей VAPID — отправка выключена');
  }
}

// ─── Маршруты ───

function endpointField(v) {
  if (typeof v !== 'string' || v.length > 1024) throw invalid(TEXT.endpoint, 'endpoint');
  if (!social.production && DEV_ENDPOINT.test(v)) return v;
  let u;
  try { u = new URL(v); } catch { throw invalid(TEXT.endpoint, 'endpoint'); }
  if (u.protocol !== 'https:' || u.port || u.username || !PUSH_HOST.test(u.hostname)) throw invalid(TEXT.endpoint, 'endpoint');
  return v;
}

/** Ключ устройства base64url ровно из n байт (p256dh — точка P-256 без сжатия, 65 байт с 0x04). */
function keyField(v, field, n) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(v) || v.length > 200) throw invalid(TEXT.endpoint, field);
  const buf = Buffer.from(v, 'base64url');
  if (buf.length !== n || (n === 65 && buf[0] !== 4)) throw invalid(TEXT.endpoint, field);
  return buf.toString('base64url');
}

/**
 * GET  /api/social/push/key     — { key }: открытый ключ VAPID (applicationServerKey).
 * POST /api/social/push         — { endpoint, p256dh, auth, group, kinds }: подписать устройство или обновить подписку
 *                                 (вуз — из адреса, сессия — из куки; гостю можно: изменения пар без аккаунта).
 * POST /api/social/push/remove  — { endpoint }: забыть устройство.
 * Работают во всех режимах SOCIAL_MODE (изменения пар от обсуждений не зависят); SOCIAL_PUSH=off — 503.
 */
export function pushRoutes(inst) {
  const need = () => { if (!vapid) throw new SocialError(503, 'unavailable', TEXT.off); };

  inst.get('/api/social/push/key', async () => {
    need();
    return ok({ key: vapid.publicKey });
  });

  inst.post('/api/social/push', async (req) => {
    need();
    const b = bodyOf(req);
    limit('push', keyOf(req));
    const endpoint = endpointField(b.endpoint);
    const p256dh = keyField(b.p256dh, 'p256dh', 65);
    const auth = keyField(b.auth, 'auth', 16);
    const kinds = Array.isArray(b.kinds) ? KINDS.filter((k) => b.kinds.includes(k)) : [];
    const uni = req.tenant ? req.tenant.id : null;
    const grp = uni && typeof b.group === 'string' && b.group && b.group.length <= 300 ? b.group : null;
    if (!st.exists.get(endpoint) && Number(st.count.get().n) >= MAX_SUBS) throw new SocialError(503, 'unavailable', TEXT.off);
    st.upsert.run({
      $endpoint: endpoint, $p256dh: p256dh, $auth: auth, $hub: req.hub ? 1 : 0, $uni: uni, $grp: grp,
      $sid: req.sid || null, $kinds: kinds.join(','), $now: nowIso(),
    });
    return ok({});
  });

  inst.post('/api/social/push/remove', async (req) => {
    const b = bodyOf(req);
    limit('push', keyOf(req));
    if (typeof b.endpoint !== 'string' || b.endpoint.length > 1024) throw invalid(TEXT.endpoint, 'endpoint');
    st.remove.run(b.endpoint);
    return ok({});
  });
}

// ─── Отправка ───

const queue = [];
let active = 0;
let queueWarned = 0;

function enqueue(job) {
  if (queue.length >= MAX_QUEUE) {
    if (Date.now() - queueWarned > MIN) { queueWarned = Date.now(); ctxRef.log.warn('уведомления: очередь полна'); }
    return;
  }
  queue.push(job);
  pump();
}
function pump() {
  while (active < WORKERS && queue.length) {
    const job = queue.shift();
    active++;
    job().catch(() => {}).finally(() => { active--; pump(); });
  }
}

const hostOf = (endpoint) => { try { return new URL(endpoint).hostname; } catch { return '?'; } };

/** Одна отправка: 2xx — хорошо; 404/410 — подписки больше нет; иначе fails + 1, после MAX_FAILS подряд — забыть. */
async function send(row, payload, o) {
  let d;
  try {
    d = webpush.generateRequestDetails({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload), { TTL: o.ttl, urgency: o.urgency || 'normal', topic: o.topic, vapidDetails: vapid });
  } catch (err) {
    st.drop.run(row.id);   // ключи устройства не годятся — подписка бесполезна
    return;
  }
  const headers = { ...d.headers };
  delete headers['Content-Length'];
  let status = 0;
  try {
    const res = await fetch(d.endpoint, { method: 'POST', headers, body: d.body, signal: AbortSignal.timeout(15_000) });
    status = res.status;
    await res.arrayBuffer().catch(() => null);
  } catch { status = 0; }
  if (status >= 200 && status < 300) { st.okSent.run(row.id); return; }
  if (status === 404 || status === 410) { st.drop.run(row.id); return; }
  const r = st.failed.get(row.id);
  if (r && r.fails >= MAX_FAILS) st.drop.run(row.id);
  if (status === 400 || status === 403 || status === 413) {
    ctxRef.log.warn({ host: hostOf(row.endpoint), status }, 'уведомления: служба push отказала');
  }
}

const hasKind = (row, kind) => String(row.kinds || '').split(',').includes(kind);

/** Ссылка в уведомлении: на адресе Para — с вузом (uni), на адресе вуза вуз и так понятен. */
const link = (row, q, uni = row.uni) => '/?' + (row.hub && uni ? 'uni=' + encodeURIComponent(uni) + '&' : '') + q;

const recent = new Map();   // ключ → мс: одно и то же — не чаще раза в окно
function once(key, ms) {
  const now = Date.now();
  const at = recent.get(key);
  if (at && now - at < ms) return false;
  if (recent.size >= 20_000) for (const [k, v] of recent) if (now - v > 60 * MIN) recent.delete(k);
  recent.set(key, now);
  return true;
}

const clip = (s, n) => { const a = [...String(s || '').replace(/\s+/g, ' ').trim()]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const nameOf = (u) => clip(u.name || (u.username ? '@' + u.username : 'Кто-то'), 40);

/**
 * Личное уведомление человеку userId (все его устройства с этим видом и живой сессией). Если приложение сейчас
 * открыто (живой поток) — не шлём: событие уже на экране. dedupe — ключ «не чаще раза в dedupeMs».
 * Не бросает, не ждёт отправки.
 */
function pushUser(userId, kind, make, o) {
  try {
    if (!vapid || !userId || isLiveUser(userId)) return;
    const rows = st.ofUser.all(userId, nowIso()).filter((r) => hasKind(r, kind));
    if (!rows.length || (o.dedupe && !once(o.dedupe, o.dedupeMs))) return;
    for (const r of rows) enqueue(() => send(r, make(r), o));
  } catch (err) {
    ctxRef.log.warn({ msg: err && err.message }, 'уведомления: ' + kind);
  }
}

/** Заявка в друзья (relation 'incoming') или её принятие ('friends') — второму человеку toId. actor — строка users. */
export function pushFriend(toId, actor, relation) {
  const incoming = relation === 'incoming';
  pushUser(toId, 'friends', (r) => ({
    t: incoming ? 'Заявка в друзья' : 'Новый друг',
    b: nameOf(actor) + (incoming ? ' хочет добавить тебя в друзья' : ' теперь в друзьях'),
    u: link(r, 'user=' + encodeURIComponent(actor.username || '')),
    g: 'friend-' + actor.id,
  }), { ttl: DAY_S, topic: 'f' + actor.id, dedupe: `f:${toId}:${actor.id}:${relation}`, dedupeMs: 10 * MIN });
}

/** Ответ row (строка posts) — автору публикации или ответа, на который отвечают (toId). author — строка users. */
export function pushReply(toId, author, row) {
  const text = clip(maskProfanity(row.text || ''), 120) || (row.media_count ? 'Фото' : '');
  pushUser(toId, 'replies', (r) => ({
    t: 'Новый ответ',
    b: nameOf(author) + ': ' + text,
    u: link(r, 'post=' + row.root_id, row.uni),
    g: 'reply-' + row.root_id,
  }), { ttl: DAY_S, topic: 'r' + row.root_id, dedupe: `r:${toId}:${row.root_id}`, dedupeMs: 30_000 });
}

/** Приглашение в покер (живёт 10 минут) — другу toId. from — строка users. */
export function pushInvite(toId, from) {
  pushUser(toId, 'game', (r) => ({
    t: 'Покер',
    b: nameOf(from) + ' зовёт тебя за стол',
    u: link(r, 'game=1'),
    g: 'game',
  }), { ttl: 600, urgency: 'high', topic: 'game' });
}

/** Модератор начислил (amount > 0) или снял фишки покера — человеку toId (вид «Приглашения в игру»). */
export function pushChips(toId, amount) {
  const n = Math.abs(amount).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
  pushUser(toId, 'game', (r) => ({
    t: 'Покер',
    b: (amount > 0 ? 'Тебе начислили ' : 'Модератор снял ') + n + ' ' + plural(Math.abs(amount), 'фишку', 'фишки', 'фишек'),
    u: link(r, 'game=1'),
    g: 'chips',
  }), { ttl: DAY_S, topic: 'chips' });
}

// ─── Изменения пар ───

const PAIR_TYPES = new Set(['added', 'removed', 'changed']);
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

/** Изменения пар по названию группы (diffSchedules: только ячейки пар). */
export function pairChangesByGroup(changes) {
  const out = new Map();
  for (const c of changes || []) {
    if (!c || !PAIR_TYPES.has(c.type) || !c.group) continue;
    if (!out.has(c.group)) out.set(c.group, []);
    out.get(c.group).push(c);
  }
  return out;
}

/** Текст уведомления об изменениях одной группы: первая правка и «ещё N». */
export function schedText(list) {
  const c = list[0];
  // Время начала — однозначнее номера пары (у магистратуры номер в приложении и «1-я пара» в таблице могут разниться).
  const start = (String(c.time || '').match(/^\d{1,2}:\d{2}/) || [''])[0];
  const where = `${c.day}, ${c.pair}-я пара` + (start ? ` в ${start}` : '') + (c.week ? ` (${c.week})` : '');
  const what = c.type === 'removed' ? `${where}: ${clip(c.before, 70)} — отменена` : `${where}: ${clip(c.after, 90)}`;
  const n = list.length - 1;
  return {
    t: 'Изменения в расписании',
    b: what + (n > 0 ? `\nИ ещё ${n} ${plural(n, 'изменение', 'изменения', 'изменений')}` : ''),
  };
}

/**
 * После сверки расписания вуза t (poller.js): каждому устройству, которое следит за изменившейся группой
 * и не выключило «Изменения пар», — одно уведомление. sched — новый снимок (ключи групп по названиям).
 */
export function pushSchedule(t, changes, sched) {
  try {
    if (!vapid) return;
    const byName = pairChangesByGroup(changes);
    if (!byName.size) return;
    const byKey = new Map();
    for (const g of (sched && sched.groups) || []) if (byName.has(g.name)) byKey.set(g.key, byName.get(g.name));
    const keys = [...byKey.keys()];
    for (let i = 0; i < keys.length; i += 500) {
      const part = keys.slice(i, i + 500);
      const rows = ctxRef.db.prepare(`SELECT * FROM push_subs WHERE uni = ? AND grp IN (${part.map(() => '?').join(',')})`)
        .all(t.id, ...part);
      for (const r of rows) {
        if (!hasKind(r, 'sched')) continue;
        const text = schedText(byKey.get(r.grp));
        enqueue(() => send(r, { ...text, u: link(r, 'tab=schedule'), g: 'sched' }, { ttl: DAY_S, topic: 'sched' }));
      }
    }
  } catch (err) {
    ctxRef.log.warn({ msg: err && err.message }, 'уведомления: изменения пар');
  }
}
