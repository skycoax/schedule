// «Бот Para» (CONTRACT.md §I.7): решение за один ход. Характер — азартный: играет почти любые две карты (особенно
// один на один), сам ставит и блефует, часто платит «посмотреть», иногда идёт ва-банк; сбрасывает в основном мусор
// против крупной ставки — и то не всегда. Префлоп — формула Чена и цена колла в больших блайндах; постфлоп — доля
// случайных рук соперника, которые мы бьём (Монте-Карло, 160 сдач), в степени числа соперников, против цены колла
// (доли банка после колла). Чистая функция: стол (poker-table.js) даёт положение и rand, проверяет ответ и при любой
// ошибке сам делает check/fold. Все суммы — кратны 10, где это возможно в пределах [min, max].
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
  const chance = (p) => rand() < p;
  const bb = s.bb || 20;
  const currentBet = s.currentBet || 0;
  const toCall = Math.max(0, s.toCall || 0);
  const pot = Math.max(0, s.pot || 0);
  const hu = (s.opponents || 1) <= 1;                  // один на один — азарта больше
  const canRaise = s.chips > 0 && s.maxRaise >= s.minRaise && s.maxRaise > currentBet;
  const check = () => ({ action: 'check' });
  const call = () => ({ action: 'call' });
  const fold = () => ({ action: 'fold' });
  const passive = () => (toCall === 0 ? check() : call());
  const raise = (target) => {
    if (canRaise) return { action: 'raise', amount: raiseAmount(target, s.minRaise, s.maxRaise) };
    if (s.chips > 0 && toCall < s.chips) return { action: 'allin' };
    return passive();
  };
  const shove = () => (s.chips > 0 ? { action: 'allin' } : passive());

  if (s.phase === 'preflop') {
    const c = chen(s.cards);
    const x = toCall / bb;                              // сколько больших блайндов доставить
    const open = () => raise(currentBet > bb ? 2.5 * currentBet : 3 * bb);
    if (c >= 12) return toCall > 0 && chance(0.12) ? call() : open();          // AA–JJ, AKs: повышает (иногда медлит)
    if (toCall === 0) return (c >= 8 && chance(0.6)) || chance(hu ? 0.25 : 0.12) ? open() : check();
    if (c >= 9 && chance(hu ? 0.7 : 0.5)) return open();
    if (x <= 1 && chance(hu ? 0.22 : 0.1)) return open();                       // азарт: повышает с чем угодно
    if (x > 1 && x <= 4 && chance(hu ? 0.08 : 0.03)) return open();            // и в ответ на повышение
    // Колл: чем дороже, тем лучше нужна рука; «на азарте» — и хуже (один на один — заметно чаще).
    const need = hu ? (x <= 1 ? 0 : x <= 4 ? 3 : x <= 10 ? 6 : 9) : (x <= 1 ? 1 : x <= 4 ? 5 : x <= 10 ? 8 : 11);
    const azart = (x <= 1 ? 0.7 : x <= 4 ? 0.45 : x <= 10 ? 0.25 : 0.12) * (hu ? 1 : 0.5);
    if (c >= need) return call();
    if (c >= need - 4) return chance(azart) ? call() : fold();
    return chance(azart / 3) ? call() : fold();
  }

  const eq = strength(s.cards, s.board, s.opponents, rand);
  const price = toCall / (pot + toCall);               // доля банка, которую отдаём коллом
  const bet = (frac) => raise(currentBet + frac * (pot + toCall));
  const size = () => 0.45 + rand() * 0.5;               // 45–95 % банка
  if (eq >= 0.85) {                                     // почти наверняка лучшая
    if (s.chips <= 1.5 * pot && chance(0.35)) return shove();
    return chance(0.8) ? bet(size() + 0.2) : passive(); // иногда медлит, чтобы не спугнуть
  }
  if (eq >= 0.62) {                                     // сильная
    if (toCall === 0) return chance(0.7) ? bet(size()) : check();
    return chance(0.3) ? bet(size() + 0.2) : call();
  }
  if (eq >= 0.42) {                                     // средняя: ставит сама, платит почти всегда
    if (toCall === 0) return chance(0.45) ? bet(0.8 * size()) : check();
    if (price <= eq) return call();
    return chance(0.45) ? call() : fold();
  }
  // Слабая: блефует, часто «платит посмотреть», изредка повышает блефом.
  if (toCall === 0) return chance((hu ? 0.38 : 0.18) * (s.phase === 'river' ? 0.8 : 1)) ? bet(size()) : check();
  if (hu && chance(0.07)) return bet(size() + 0.3);
  const p = (price <= 0.2 ? 0.55 : price <= 0.34 ? 0.35 : price <= 0.45 ? 0.2 : 0.08) * (hu ? 1 : 0.5);
  return chance(p) ? call() : fold();
}
