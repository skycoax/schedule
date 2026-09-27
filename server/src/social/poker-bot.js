// «Бот Para» (CONTRACT.md §I, §5 спецификации): решение за один ход по силе руки. Префлоп — формула Чена,
// постфлоп — доля случайных рук соперника, которые мы бьём (Монте-Карло, 160 сдач), в степени числа соперников.
// Чистая функция: стол (poker-table.js) даёт положение и rand, проверяет ответ и при любой ошибке
// сам делает check/fold. Все суммы — кратны 10, где это возможно в пределах [min, max].
import { FULL_DECK, evaluate7, chen } from './poker-logic.js';

const SIMS = 160;

const round10 = (x) => Math.round(x / 10) * 10;
const ceil10 = (x) => Math.ceil(x / 10) * 10;

/** Сумма рейза «до»: цель, округлённая до 10 и втиснутая в [min, max] (min/max сами могут быть некруглыми). */
export function raiseAmount(target, min, max) {
  let a = round10(target);
  if (a < min) a = ceil10(min) <= max ? ceil10(min) : max;
  if (a > max) a = max;
  return a;
}

/**
 * Сила руки постфлоп: доля сдач, где мы сильнее случайной руки соперника при доборе борда до пяти карт
 * (ничья — половина), в степени opponents. rand — [0, 1) (Math.random или зерно в тестах).
 */
export function strength(cards, board, opponents, rand = Math.random, sims = SIMS) {
  const dead = new Set([...cards, ...board]);
  const deck = FULL_DECK.filter((c) => !dead.has(c));
  const need = 2 + (5 - board.length);
  let won = 0;
  for (let i = 0; i < sims; i++) {
    for (let j = 0; j < need; j++) {
      const k = j + Math.floor(rand() * (deck.length - j));
      [deck[j], deck[k]] = [deck[k], deck[j]];
    }
    const rest = deck.slice(2, need);
    const full = board.concat(rest);
    const my = evaluate7(cards.concat(full)).score;
    const op = evaluate7([deck[0], deck[1]].concat(full)).score;
    won += my > op ? 1 : my === op ? 0.5 : 0;
  }
  return Math.pow(won / sims, Math.max(1, opponents));
}

/**
 * Решение бота.
 * @param {{ cards: string[], board: string[], pot: number, toCall: number, minRaise: number, maxRaise: number,
 *   chips: number, opponents: number, phase: string, rand?: () => number, bb?: number, currentBet?: number }} s
 *   pot — весь банк вместе с текущими ставками; toCall — сколько нужно доставить; minRaise/maxRaise — рейз «до»
 *   (maxRaise — вся моя ставка на улице при олл-ине); chips — мой стек; opponents — не сбросившие соперники.
 * @returns {{ action: 'fold'|'check'|'call'|'raise'|'allin', amount?: number }}
 */
export function decide(s) {
  const rand = s.rand || Math.random;
  const bb = s.bb || 20;
  const currentBet = s.currentBet || 0;
  const canRaise = s.chips > 0 && s.maxRaise >= s.minRaise && s.maxRaise > currentBet;
  const check = () => ({ action: 'check' });
  const call = () => ({ action: 'call' });
  const fold = () => ({ action: 'fold' });
  const passive = () => (s.toCall === 0 ? check() : call());
  const raise = (target) => {
    if (canRaise) return { action: 'raise', amount: raiseAmount(target, s.minRaise, s.maxRaise) };
    if (s.chips > 0 && s.toCall < s.chips) return { action: 'allin' };
    return passive();
  };

  if (s.phase === 'preflop') {
    const c = chen(s.cards);
    if (c >= 10 || rand() < 0.08) return raise(currentBet > bb ? 2.5 * currentBet : 3 * bb);
    if (c >= 6) return s.toCall === 0 ? check() : s.toCall <= 3 * bb ? call() : fold();
    return s.toCall === 0 ? check() : fold();
  }

  const st = strength(s.cards, s.board, s.opponents, rand);
  if (st >= 0.8 || rand() < 0.07) return raise(currentBet + 0.7 * s.pot);
  if (st >= 0.55) {
    if (s.toCall > 0) return call();
    return rand() < 0.5 ? raise(0.5 * s.pot) : check();
  }
  if (st >= 0.3) return s.toCall === 0 ? check() : s.toCall <= 0.25 * s.pot ? call() : fold();
  return s.toCall === 0 ? check() : fold();
}
