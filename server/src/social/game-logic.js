// Мини-игра «Код» (CONTRACT.md §I): правила без базы — проверка кода, ответ на попытку, случайный код и
// код вызова, день по Ташкенту и settle() — единственная функция, которая решает исход дуэли.
// Те же evaluate/validCode есть в приложении (web/src/game/logic.ts); сервер своим ответам верит сам.
import { randomInt } from 'node:crypto';

export const ATTEMPTS = 12;                 // попыток на код
export const FAIL_SCORE = 13;               // счёт «не взломал» (и «время вышло»)
export const TTL_MS = 24 * 3600_000;        // сутки: на принятие вызова и на саму игру
export const REACTIONS = ['wave', 'like', 'wow', 'lol', 'fire', 'deal'];

// Код вызова: 6 знаков без похожих (нет I, L, O, 0, 1).
export const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TOKEN_RE = /^[A-HJKMNP-Z2-9]{6}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Четыре разные цифры 0–9 (ведущий ноль можно). */
export function validCode(s) {
  return typeof s === 'string' && /^\d{4}$/.test(s) && new Set(s).size === 4;
}

/** Ответ на попытку: on — цифра на своём месте (●), near — есть в коде, но в другом месте (○). */
export function evaluate(code, guess) {
  let on = 0;
  let near = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === code[i]) on++;
    else if (code.includes(guess[i])) near++;
  }
  return { on, near };
}

/** Случайный код: четыре разные цифры (crypto.randomInt, перемешивание Фишера — Йетса). */
export function randomCode() {
  const d = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d.slice(0, 4).join('');
}

/** Код вызова: 6 знаков из TOKEN_ALPHABET. */
export function newToken() {
  let s = '';
  for (let i = 0; i < 6; i++) s += TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)];
  return s;
}

/** День по Ташкенту (UTC+5, без летнего времени): 'YYYY-MM-DD'. «Код дня» меняется в 00:00 по Ташкенту. */
export const tashkentDay = (ms = Date.now()) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);

/** Предыдущий день для 'YYYY-MM-DD'. */
export function prevDay(day) {
  if (!DAY_RE.test(String(day))) return '';
  return new Date(Date.parse(day + 'T00:00:00Z') - 24 * 3600e3).toISOString().slice(0, 10);
}

/** Счёт стороны: взломал — число попыток, не взломал или время вышло — 13, иначе (играет, сдался) — null. */
export function score(side) {
  if (!side) return null;
  if (side.res === 'cracked') return side.n;
  if (side.res === 'failed' || side.res === 'timeout') return FAIL_SCORE;
  return null;
}

const msOf = (t) => (typeof t === 'number' ? t : Date.parse(t));

/**
 * Исход дуэли — единственное место, где он решается (§1). Чистая функция.
 * @param {{ status: string, deadlineAt: string|number, a: { n: number, res: string|null }, b: { n: number, res: string|null } }} d
 * @param {number|string} now
 * @returns {null | { status: 'expired', reason: 'expired', winner: 'none' }
 *   | { status: 'done', winner: 'a'|'b'|'draw', reason: 'score'|'early'|'left'|'timeout', aRes: string|null, bRes: string|null }}
 *   null — ничего не меняется (игра идёт, или она уже не open/active).
 */
export function settle(d, now) {
  const t = msOf(now);
  const deadline = msOf(d.deadlineAt);
  if (d.status === 'open') return t >= deadline ? { status: 'expired', reason: 'expired', winner: 'none' } : null;
  if (d.status !== 'active') return null;
  const a = { n: d.a.n, res: d.a.res ?? null };
  const b = { n: d.b.n, res: d.b.res ?? null };
  const done = (winner, reason) => ({ status: 'done', winner, reason, aRes: a.res, bRes: b.res });
  // Сдался (или его аккаунт ограничили/удалили) — победа другой стороне.
  if (a.res === 'left') return done('b', 'left');
  if (b.res === 'left') return done('a', 'left');
  // Срок вышел: кто не закончил — «время вышло» (13).
  let timedOut = false;
  if (t >= deadline) {
    if (a.res === null) a.res = 'timeout';
    if (b.res === null) b.res = 'timeout';
    timedOut = true;
  }
  const sa = score(a);
  const sb = score(b);
  if (sa !== null && sb !== null) return done(sa < sb ? 'a' : sb < sa ? 'b' : 'draw', timedOut ? 'timeout' : 'score');
  // Досрочно: другая сторона уже сделала не меньше попыток, чем счёт закончившей, — ни победы, ни ничьей ей не видать.
  if (sa !== null && sb === null && b.n >= sa) return done('a', 'early');
  if (sb !== null && sa === null && a.n >= sb) return done('b', 'early');
  return null;
}
