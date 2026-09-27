// «Покер» (CONTRACT.md §I): правила без стола и базы — колода и честная тасовка (crypto.randomInt), сила руки
// из 5–7 карт (evaluate7), сравнение, русские названия комбинаций, побочные банки (sidePots), формула Чена
// для двух закрытых карт (бот, poker-bot.js) и ежедневный бонус (сутки по Ташкенту, серия дней — §I.10).
// Карта — строка «As», «Td», «7h», «2c»: ранг A K Q J T 9 8 7 6 5 4 3 2, масть s h d c. Всё здесь — чистые функции:
// их проверяет poker-logic.test.mjs.
import { randomInt } from 'node:crypto';

export const RANKS = 'AKQJT98765432';
export const SUITS = 'shdc';
export const RANK_VALUE = { A: 14, K: 13, Q: 12, J: 11, T: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 };

/** Полная колода в постоянном порядке (52 карты). */
export const FULL_DECK = Object.freeze([...RANKS].flatMap((r) => [...SUITS].map((s) => r + s)));

export const CARD_RE = /^[AKQJT98765432][shdc]$/;
export const isCard = (c) => typeof c === 'string' && CARD_RE.test(c);
export const rankOf = (c) => RANK_VALUE[c[0]];
export const suitOf = (c) => c[1];

/** Новая перетасованная колода: Фишер — Йетс на crypto.randomInt — ни Math.random, ни зерна. */
export function newDeck() {
  const d = FULL_DECK.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ─── Сила руки ───

// Категории: 0 старшая карта, 1 пара, 2 две пары, 3 сет, 4 стрит, 5 флеш, 6 фулл-хаус, 7 каре, 8 стрит-флеш
// (флеш-рояль — стрит-флеш от туза). score — одно число: категория и кикеры по убыванию (основание 15),
// так что compare — просто разность.
export const CATEGORY_NAMES = ['Старшая карта', 'Пара', 'Две пары', 'Сет', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш'];
const BASE = 15;

/** Старшая карта стрита из пяти РАЗНЫХ рангов (по убыванию) или 0; «колесо» A-2-3-4-5 — 5. */
function straightHigh(vals) {
  if (vals.length !== 5) return 0;
  if (vals[0] - vals[4] === 4) return vals[0];
  if (vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) return 5;
  return 0;
}

/** Ровно пять карт → { cat, kick, score }. */
export function evaluate5(cards) {
  const vals = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const count = new Map();
  for (const v of vals) count.set(v, (count.get(v) || 0) + 1);
  // Группы: по числу карт, потом по рангу — обе по убыванию.
  const groups = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const distinct = groups.map((g) => g[0]);
  const sh = groups.length === 5 ? straightHigh(distinct) : 0;
  let cat;
  let kick;
  if (sh && flush) { cat = 8; kick = [sh]; }
  else if (groups[0][1] === 4) { cat = 7; kick = [groups[0][0], groups[1][0]]; }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { cat = 6; kick = [groups[0][0], groups[1][0]]; }
  else if (flush) { cat = 5; kick = vals; }
  else if (sh) { cat = 4; kick = [sh]; }
  else if (groups[0][1] === 3) { cat = 3; kick = distinct; }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { cat = 2; kick = distinct; }
  else if (groups[0][1] === 2) { cat = 1; kick = distinct; }
  else { cat = 0; kick = vals; }
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * BASE + (kick[i] || 0);
  return { cat, kick, score };
}

/**
 * Лучшая пятёрка из 5–7 карт: { cat, kick, score, best: Card[5] }. Перебор сочетаний (≤ 21) — дёшево и без ошибок.
 * best — карты пятёрки в порядке значимости (кикеры по убыванию), чтобы приложение показывало их как есть.
 */
export function evaluate7(cards) {
  const n = cards.length;
  if (n < 5 || n > 7) throw new Error('evaluate7: нужно от 5 до 7 карт');
  let top = null;
  const pick = [];
  const walk = (start) => {
    if (pick.length === 5) {
      const e = evaluate5(pick);
      if (!top || e.score > top.score) top = { ...e, best: pick.slice() };
      return;
    }
    for (let i = start; i <= n - (5 - pick.length); i++) {
      pick.push(cards[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  // Порядок карт в пятёрке — по значимости: группы (каре, сет, пары) впереди, потом кикеры по убыванию;
  // у «колеса» туз — последним.
  const order = new Map();
  top.kick.forEach((v, i) => order.set(v, i));
  const wheel = (top.cat === 4 || top.cat === 8) && top.kick[0] === 5;
  top.best.sort((a, b) => {
    const va = rankOf(a);
    const vb = rankOf(b);
    if (wheel) return (va === 14 ? 1 : va) < (vb === 14 ? 1 : vb) ? 1 : -1;
    const ia = order.has(va) ? order.get(va) : 99;
    const ib = order.has(vb) ? order.get(vb) : 99;
    return ia - ib || vb - va;
  });
  return top;
}

/** Сравнение оценок: > 0 — a сильнее, < 0 — b сильнее, 0 — делят банк. */
export const compare = (a, b) => Math.sign(a.score - b.score);

/** Название комбинации по-русски: «Две пары», «Флеш-рояль»… */
export function handName(ev) {
  if (ev.cat === 8 && ev.kick[0] === 14) return 'Флеш-рояль';
  return CATEGORY_NAMES[ev.cat];
}

// ─── Банки ───

/**
 * Побочные банки по вкладам в раздачу. players — [{ seat, put, folded }] (put — всё, что игрок поставил в раздаче).
 * Уровни — по вкладам не сбросивших: каждый банк собирает min(put, уровень) − прошлый уровень со всех игроков
 * (сбросившие тоже платят), а претендуют на него не сбросившие с вкладом ≥ уровня. Невостребованный остаток
 * (не бывает: самый большой вклад всегда у не сбросившего) — в последний банк. Пустые банки не возвращаются.
 * @returns {{ amount: number, seats: number[] }[]}
 */
export function sidePots(players) {
  const alive = players.filter((p) => !p.folded && p.put > 0);
  const levels = [...new Set(alive.map((p) => p.put))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.put, level) - prev);
    const seats = alive.filter((p) => p.put >= level).map((p) => p.seat);
    if (amount > 0) pots.push({ amount, seats });
    prev = level;
  }
  const total = players.reduce((s, p) => s + p.put, 0);
  const counted = pots.reduce((s, p) => s + p.amount, 0);
  if (total > counted && pots.length) pots[pots.length - 1].amount += total - counted;
  return pots;
}

// ─── Формула Чена (сила двух закрытых карт префлоп) ───

/**
 * Очки Чена: A 10, K 8, Q 7, J 6, остальные — половина ранга; пара — вдвое (не меньше 5); одномастные +2;
 * промежуток 1/2/3/4+ → −1/−2/−4/−5; промежуток ≤ 1 и обе ниже дамы → +1. Половинки округляются вверх.
 * AA = 20, AKs = 12, 72o = −1.
 */
export function chen(cards) {
  const a = rankOf(cards[0]);
  const b = rankOf(cards[1]);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const pts = (v) => (v === 14 ? 10 : v === 13 ? 8 : v === 12 ? 7 : v === 11 ? 6 : v / 2);
  let s = pts(hi);
  if (hi === lo) return Math.max(5, Math.ceil(s * 2));
  if (suitOf(cards[0]) === suitOf(cards[1])) s += 2;
  const gap = hi - lo - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 12) s += 1;
  return Math.ceil(s);
}

// ─── Ежедневный бонус (§I.10) ───
// Сутки — по Ташкенту: UTC+5 круглый год, без перехода на летнее время. День — строка 'YYYY-MM-DD'.

/** Бонус k-го дня серии (k = 1…): 500, 600 … 1000, с седьмого дня подряд — 1200. */
export const BONUS = Object.freeze([500, 600, 700, 800, 900, 1000, 1200]);
const TZ_MS = 5 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** День по Ташкенту для момента ms: 'YYYY-MM-DD'. */
export const tashkentDay = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);
/** Ближайшая полночь по Ташкенту после момента ms (epoch ms): с неё — новый бонус. */
export const nextMidnight = (ms) => Date.parse(tashkentDay(ms) + 'T00:00:00Z') - TZ_MS + DAY_MS;
/** Вчера для дня 'YYYY-MM-DD'. */
export const dayBefore = (day) => new Date(Date.parse(day + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10);
/** Бонус k-го дня серии (k < 1 считается первым днём). */
export const bonusAmount = (k) => BONUS[Math.min(Math.max(1, k), BONUS.length) - 1];

/**
 * Бонус игрока на день today. row — строка poker_players { bonus_day, streak } (null — строки ещё нет).
 * → { available, streak, next, amount, tomorrow }:
 *   available — сегодня ещё не забирал (день последнего бонуса «из будущего» после перевода часов — тоже нельзя);
 *   streak — текущая серия: забрал сегодня или вчера — как в базе, раньше — 0 (сгорела);
 *   next — серия, с которой записывается сегодняшний бонус: вчера → streak + 1, иначе 1 (уже забран — та же);
 *   amount — бонус сегодняшнего дня серии: сколько дадут сейчас, а если уже забран — сколько пришло;
 *   tomorrow — сколько завтра, если не пропустить день.
 */
export function bonusFor(row, today) {
  const last = row && row.bonus_day ? String(row.bonus_day) : null;
  const had = Math.max(0, Math.floor(Number(row && row.streak) || 0));
  if (last && last >= today) {
    const k = Math.max(1, had);
    return { available: false, streak: k, next: k, amount: bonusAmount(k), tomorrow: bonusAmount(k + 1) };
  }
  const streak = last === dayBefore(today) ? had : 0;
  const next = streak + 1;
  return { available: true, streak, next, amount: bonusAmount(next), tomorrow: bonusAmount(next + 1) };
}
