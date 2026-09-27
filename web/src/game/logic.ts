// Покер на телефоне: разбор карт, оценка руки (лучшая пятёрка из 2–7 карт) и её название по-русски — для подписи
// под своими картами и «огня» на сильной руке. Итог раздачи решает сервер; здесь только то, что видно игроку.
import type { Card } from '../social/types';

export const RANKS = '23456789TJQKA';
export type Suit = 's' | 'h' | 'd' | 'c';

/** «Td» → { r: 8 (0..12), s: 'd' }; чужая закрытая ('?') → null. */
export function parseCard(c: Card): { r: number; s: Suit } | null {
  if (!c || c.length !== 2) return null;
  const r = RANKS.indexOf(c[0]);
  const s = c[1] as Suit;
  if (r < 0 || !'shdc'.includes(s)) return null;
  return { r, s };
}
export const isRed = (c: Card): boolean => c[1] === 'h' || c[1] === 'd';
export const rankText = (c: Card): string => (c[0] === 'T' ? '10' : c[0]);

/** Категории: 0 старшая · 1 пара · 2 две пары · 3 тройка · 4 стрит · 5 флеш · 6 фулл-хаус · 7 каре · 8 стрит-флеш · 9 роял. */
export interface HandEval { cat: number; score: number; best: Card[]; name: string; short: string }

const CAT_NAMES = ['Старшая карта', 'Пара', 'Две пары', 'Тройка', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш', 'Роял-флеш'];
// Ранги по-русски: родительный множественного (пара валетов) и именительный множественного (дамы и семёрки).
const GEN = ['двоек', 'троек', 'четвёрок', 'пятёрок', 'шестёрок', 'семёрок', 'восьмёрок', 'девяток', 'десяток', 'валетов', 'дам', 'королей', 'тузов'];
const NOM = ['двойки', 'тройки', 'четвёрки', 'пятёрки', 'шестёрки', 'семёрки', 'восьмёрки', 'девятки', 'десятки', 'валеты', 'дамы', 'короли', 'тузы'];
const ONE = ['двойка', 'тройка', 'четвёрка', 'пятёрка', 'шестёрка', 'семёрка', 'восьмёрка', 'девятка', 'десятка', 'валет', 'дама', 'король', 'туз'];

/** Оценка ровно пяти карт: категория и число для сравнения (больше — сильнее). */
function eval5(cs: { r: number; s: Suit }[]): { cat: number; score: number; groups: number[] } {
  const counts = new Array<number>(13).fill(0);
  for (const c of cs) counts[c.r]++;
  const flush = cs.every((c) => c.s === cs[0].s);
  const ranks = cs.map((c) => c.r).sort((a, b) => b - a);
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[4] === 0) straightHigh = 3;   // «колесо» A-2-3-4-5
  }
  // Группы: сначала по числу карт, потом по рангу — фулл-хаус «дамы и семёрки» = [10, 5].
  const groups = [...uniq].sort((a, b) => counts[b] - counts[a] || b - a);
  const kinds = groups.map((r) => counts[r]);
  let cat: number;
  if (straightHigh >= 0 && flush) cat = straightHigh === 12 ? 9 : 8;
  else if (kinds[0] === 4) cat = 7;
  else if (kinds[0] === 3 && kinds[1] === 2) cat = 6;
  else if (flush) cat = 5;
  else if (straightHigh >= 0) cat = 4;
  else if (kinds[0] === 3) cat = 3;
  else if (kinds[0] === 2 && kinds[1] === 2) cat = 2;
  else if (kinds[0] === 2) cat = 1;
  else cat = 0;
  const order = cat === 4 || cat === 8 || cat === 9 ? [straightHigh] : groups;
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 16 + (order[i] ?? 0);
  return { cat, score, groups: order };
}

/** Лучшая пятёрка из 5–7 карт (у 2–4 карт — предварительная оценка: пара, старшая). */
export function evaluate(cards: Card[]): HandEval | null {
  const cs = cards.map(parseCard).filter((x): x is { r: number; s: Suit } => !!x);
  if (cs.length < 2) return null;
  if (cs.length < 5) {
    const counts = new Array<number>(13).fill(0);
    for (const c of cs) counts[c.r]++;
    const groups = [...new Set(cs.map((c) => c.r))].sort((a, b) => counts[b] - counts[a] || b - a);
    const cat = counts[groups[0]] >= 3 ? 3 : counts[groups[0]] === 2 ? (groups.length > 1 && counts[groups[1]] === 2 ? 2 : 1) : 0;
    return { cat, score: cat, best: [], name: describe(cat, groups, cs.length), short: CAT_NAMES[cat] };
  }
  let top: { cat: number; score: number; groups: number[]; five: { r: number; s: Suit }[] } | null = null;
  const n = cs.length;
  const pick = (a: number, b: number, c: number, d: number, e: number) => {
    const five = [cs[a], cs[b], cs[c], cs[d], cs[e]];
    const r = eval5(five);
    if (!top || r.score > top.score) top = { ...r, five };
  };
  if (n === 5) pick(0, 1, 2, 3, 4);
  else {
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
      for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) pick(a, b, c, d, e);
    }
  }
  const t = top as { cat: number; score: number; groups: number[]; five: { r: number; s: Suit }[] } | null;
  if (!t) return null;
  return {
    cat: t.cat, score: t.score, best: t.five.map((c) => RANKS[c.r] + c.s),
    name: describe(t.cat, t.groups, 5), short: CAT_NAMES[t.cat],
  };
}

/** «Пара десяток», «Две пары: дамы и семёрки», «Стрит до короля», «Туз-король». */
function describe(cat: number, groups: number[], n: number): string {
  switch (cat) {
    case 1: return 'Пара ' + GEN[groups[0]];
    case 2: return 'Две пары: ' + NOM[groups[0]] + ' и ' + NOM[groups[1]];
    case 3: return 'Тройка ' + GEN[groups[0]];
    case 4: return 'Стрит до ' + ONE_GEN[groups[0]];
    case 6: return 'Фулл-хаус: ' + NOM[groups[0]] + ' и ' + NOM[groups[1]];
    case 7: return 'Каре ' + GEN[groups[0]];
    case 8: return 'Стрит-флеш до ' + ONE_GEN[groups[0]];
    case 0:
      if (n === 2 && groups.length === 2) return cap(ONE[groups[0]]) + '-' + ONE[groups[1]];
      return 'Старшая — ' + ONE[groups[0]];
    default: return CAT_NAMES[cat];
  }
}
const ONE_GEN = ['двойки', 'тройки', 'четвёрки', 'пятёрки', 'шестёрки', 'семёрки', 'восьмёрки', 'девятки', 'десятки', 'валета', 'дамы', 'короля', 'туза'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * «Огонь» на своих картах: 0 — нет, 1 — сильная рука (тлеет), 2 — очень сильная (искры).
 * Префлоп: пара от десяток, A-K, A-Q одномастные — 1; тузы и короли — 2. После флопа: от двух пар — 1, от стрита — 2.
 */
export function heat(mine: Card[] | null, board: Card[]): 0 | 1 | 2 {
  if (!mine || mine.length < 2) return 0;
  const a = parseCard(mine[0]);
  const b = parseCard(mine[1]);
  if (!a || !b) return 0;
  if (board.length < 3) {
    if (a.r === b.r) return a.r >= 11 ? 2 : a.r >= 8 ? 1 : 0;
    const hi = Math.max(a.r, b.r);
    const lo = Math.min(a.r, b.r);
    if (hi === 12 && (lo === 11 || (lo === 10 && a.s === b.s))) return 1;
    return 0;
  }
  const e = evaluate([...mine, ...board]);
  if (!e) return 0;
  return e.cat >= 4 ? 2 : e.cat >= 2 ? 1 : 0;
}

/** Только рука на борде (без своих карт) — чтобы «две пары на столе» не считались силой игрока. */
export function boardOnly(board: Card[]): HandEval | null {
  return board.length >= 3 ? evaluate(board) : null;
}

/** «1 000», «12 400» — тонкими пробелами. */
export const chips = (n: number): string => String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
