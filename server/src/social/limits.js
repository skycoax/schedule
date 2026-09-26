// Пределы частоты (CONTRACT.md §C.6): «ведёрки» в памяти, ключ — u:<id> или ip:<хеш>.
// Сырой IP нигде не хранится, даже в памяти: только солёный хеш (ipParts из analytics.js).
// Дневные пределы берутся из базы (переживают перезапуск) — их считают сами маршруты.
import { social } from '../config.js';
import { ipParts } from '../analytics.js';
import { SocialError, clientIp } from './http.js';
import { nowIso, DAY } from './db.js';

const SEC = 1000;
const MIN = 60 * SEC;

/** Ведёрки: [запас, мс на один новый жетон]. */
export const BUCKETS = {
  auth: [60, 10 * SEC],       // вход через Google: start + callback, по IP
  read: [300, 100],           // лента, ветка, профиль, /api/auth/me: 10 в секунду
  search: [20, 3 * SEC],      // поиск людей, проверка имени
  post: [3, 2 * MIN],
  reply: [10, 20 * SEC],
  like: [30, 2 * SEC],
  upload: [8, MIN],           // фото к публикации
  thumb: [12, 30 * SEC],
  avatar: [5, 30 * MIN],
  report: [10, 3 * MIN],
  instant: [5, MIN],          // новый момент
  friend: [10, 3 * MIN],      // заявка в друзья и принятие
  unfriend: [30, 2 * SEC],    // отказ, отмена заявки, удаление из друзей
  block: [20, MIN],
  profile: [10, MIN],         // PATCH /me, принятие правил
  delete: [30, 10 * SEC],
  admin: [60, SEC],
  // Мини-игра «Код» (game.js).
  gameGuess: [3, SEC],        // попытка: 3 подряд, потом примерно одна в секунду
  gameNew: [6, 2 * MIN],      // вызов, случайный соперник, реванш, сдаться, отказ
  gameJoin: [10, MIN],        // просмотр вызова, принятие по коду и из лобби — по u:<id>; гость — по IP, только промахи
  gameReact: [5, 3 * SEC],
  gameStream: [10, 30 * SEC], // поток событий игры, по пользователю
};

const buckets = new Map();   // key → { t: жетоны, at: мс }

/** Взять жетон: 0 — можно, иначе сколько секунд подождать. */
export function take(key, cap, refillMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size > 100_000) for (const k of [...buckets.keys()].slice(0, 10_000)) buckets.delete(k);
    b = { t: cap, at: now, cap, refillMs };
    buckets.set(key, b);
  }
  b.t = Math.min(cap, b.t + (now - b.at) / refillMs);
  b.at = now;
  if (b.t >= 1) { b.t -= 1; return 0; }
  return Math.max(1, Math.ceil((1 - b.t) * refillMs / 1000));
}

/** Текст 429 (§B.3). */
export const rateText = (sec) =>
  sec < 60 ? 'Слишком часто — подожди немного' : `Слишком часто — попробуй через ${Math.ceil(sec / 60)} мин.`;

export const rateError = (sec, message = rateText(sec)) => new SocialError(429, 'rate', message, { retryAfter: sec });

/** Ключ: пользователь, если вошёл, иначе хеш IP. */
export const keyOf = (req) => (req.user ? 'u:' + req.user.id : ipKey(req));
export const ipKey = (req) => 'ip:' + ipParts(clientIp(req)).hash;

/** Проверить ведёрко name для key; при превышении — 429. SOCIAL_RATE_LIMITS=off (не production) — без пределов. */
export function limit(name, key) {
  if (!social.rateLimits) return;
  const [cap, ms] = BUCKETS[name];
  const wait = take(name + '|' + key, cap, ms);
  if (wait) throw rateError(wait);
}

/**
 * Как limit, но жетон не берётся: 429, только если ведёрко уже пусто. Для случаев, где жетон списывают
 * отдельно и не всегда (просмотр вызова гостем — только промахи, limited() после).
 */
export function limitPeek(name, key) {
  if (!social.rateLimits) return;
  const [cap, ms] = BUCKETS[name];
  const b = buckets.get(name + '|' + key);
  if (!b) return;
  const t = Math.min(cap, b.t + (Date.now() - b.at) / ms);
  if (t < 1) throw rateError(Math.max(1, Math.ceil((1 - t) * ms / 1000)));
}

/** Как limit, но без исключения: true — предел превышен (для входа через Google, где ответ — переход). */
export function limited(name, key) {
  if (!social.rateLimits) return false;
  const [cap, ms] = BUCKETS[name];
  return take(name + '|' + key, cap, ms) > 0;
}

/** Убрать полные ведёрки (задача раз в 10 минут). */
export function sweepBuckets() {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (Math.min(b.cap, b.t + (now - b.at) / b.refillMs) >= b.cap) buckets.delete(k);
  }
}

/**
 * «Новый аккаунт» (SOCIAL_NEW_ACCOUNT_H, в production всегда 24 ч; 0 — окно выключено):
 * без ссылок, меньшие дневные пределы, свободная смена @имени.
 */
export const isNewAccount = (u) =>
  social.newAccountH > 0 && Date.now() - Date.parse(u.created_at) < social.newAccountH * 3600_000;

/** Дневные пределы (§C.6): [обычный, для нового аккаунта]. Считаются по базе — переживают перезапуск. */
export const CAPS = {
  post: [30, 5],
  reply: [300, 50],
  upload: [60, 12],
  avatar: [20, 20],
  report: [50, 10],
  instant: [40, 10],
  game: [40, 15],             // игры с людьми: созданные и принятые за 24 ч
};
export const CAP_TEXT = {
  post: 'Лимит публикаций на сегодня исчерпан — попробуй позже',
  reply: 'Лимит ответов на сегодня исчерпан — попробуй позже',
  upload: 'Лимит фото на сегодня исчерпан — попробуй позже',
  avatar: 'Фото профиля сегодня менялось слишком часто — попробуй позже',
  report: 'Слишком много жалоб подряд — попробуй позже',
  instant: 'Лимит моментов на сегодня исчерпан — попробуй позже',
  game: 'Лимит игр на сегодня исчерпан — попробуй завтра',
};
/** Начало окна дневного предела: сейчас минус 24 ч (ISO). */
export const dayAgo = () => nowIso(Date.now() - DAY);

/**
 * Проверить дневной предел name для u. stat — { n, first } за последние 24 ч (first — самая ранняя запись).
 * Превышен — 429 со своим текстом и Retry-After до момента, когда самая ранняя запись выйдет из окна.
 * SOCIAL_RATE_LIMITS=off (не production) — без дневных пределов.
 */
export function dailyCap(name, u, stat) {
  if (!social.rateLimits) return;
  const cap = CAPS[name][isNewAccount(u) ? 1 : 0];
  if (Number(stat.n) < cap) return;
  const wait = stat.first ? Math.ceil((Date.parse(stat.first) + DAY - Date.now()) / 1000) : 3600;
  throw rateError(Math.max(60, wait), CAP_TEXT[name]);
}
