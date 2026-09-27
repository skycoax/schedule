// «Покер»: правила без сервера (poker-logic.js) и бот (poker-bot.js). Запуск из корня проекта:
//   node --test server/test/poker-logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_DECK, newDeck, isCard, evaluate5, evaluate7, compare, handName, sidePots, chen, CATEGORY_NAMES,
} from '../src/social/poker-logic.js';
import { decide, strength, raiseAmount } from '../src/social/poker-bot.js';

const ev = (s) => evaluate7(s.split(' '));
const cat = (s) => ev(s).cat;

test('колода: 52 разные карты, тасовка меняет порядок и ничего не теряет', () => {
  assert.equal(FULL_DECK.length, 52);
  assert.equal(new Set(FULL_DECK).size, 52);
  assert.ok(FULL_DECK.every(isCard));
  const d = newDeck();
  assert.equal(d.length, 52);
  assert.deepEqual([...d].sort(), [...FULL_DECK].sort());
  assert.notDeepEqual(d, FULL_DECK);
  const d2 = newDeck();
  assert.notDeepEqual(d, d2, 'две тасовки подряд не совпадают');
});

test('категории: старшая, пара, две пары, сет, стрит (и колесо), флеш, фулл-хаус, каре, стрит-флеш, рояль', () => {
  assert.equal(cat('As Kd 9h 7c 4s 3d 2c'), 0);
  assert.equal(cat('As Ad 9h 7c 4s 3d 2c'), 1);
  assert.equal(cat('As Ad 9h 9c 4s 3d 2c'), 2);
  assert.equal(cat('As Ad Ah 9c 4s 3d 2c'), 3);
  assert.equal(cat('9s 8d 7h 6c 5s Kd 2c'), 4);
  assert.equal(cat('As 2d 3h 4c 5s Kd 9c'), 4);       // колесо A-2-3-4-5
  assert.equal(ev('As 2d 3h 4c 5s Kd 9c').kick[0], 5, 'у колеса старшая — пятёрка');
  assert.equal(cat('As Ks 9s 7s 4s 3d 2c'), 5);
  assert.equal(cat('As Ad Ah 9c 9s 3d 2c'), 6);
  assert.equal(cat('As Ad Ah Ac 9s 3d 2c'), 7);
  assert.equal(cat('9s 8s 7s 6s 5s Kd 2c'), 8);
  assert.equal(cat('As Ks Qs Js Ts 3d 2c'), 8);
  assert.equal(handName(ev('As Ks Qs Js Ts 3d 2c')), 'Флеш-рояль');
  assert.equal(handName(ev('9s 8s 7s 6s 5s Kd 2c')), 'Стрит-флеш');
  assert.equal(handName(ev('As Ad 9h 9c 4s 3d 2c')), 'Две пары');
  assert.equal(handName(ev('As Ad Ah 9c 4s 3d 2c')), 'Сет');
  assert.equal(handName(ev('As Ad Ah 9c 9s 3d 2c')), 'Фулл-хаус');
  assert.equal(handName(ev('As Ad Ah Ac 9s 3d 2c')), 'Каре');
  assert.equal(handName(ev('As Kd 9h 7c 4s 3d 2c')), 'Старшая карта');
  assert.equal(CATEGORY_NAMES.length, 9);
});

test('сравнение: старшая категория бьёт младшую, внутри категории решают кикеры', () => {
  const beats = (a, b) => assert.ok(compare(ev(a), ev(b)) > 0, `${a} должна бить ${b}`);
  beats('As Ad 2h 3c 4s 7d 9c', 'As Kd Qh Jc 9s 7d 2c');       // пара > старшая
  beats('2s 2d 3h 3c 9s Kd 7c', 'As Ad 9h 7c 4s 3d 2c');       // две пары > пара
  beats('As Ad Kh 9c 4s 3d 2c', 'As Ad Qh 9c 4s 3d 2c');       // кикер K > Q
  beats('Ks Kd 9h 7c 4s 3d 2c', 'Qs Qd Ah 7c 4s 3d 2c');       // пара K > пара Q при тузе-кикере
  beats('6s 5d 4h 3c 2s Kd 9c', 'As 2d 3h 4c 5s Kd 9c');       // стрит до 6 > колесо
  beats('As Ad 9h 9c Ks 3d 2c', 'As Ad 9h 9c Qs 3d 2c');       // две пары: кикер
  beats('9s 9d 9h 2c 2s 3d 4c', '8s 8d 8h As Ac 3d 4c');       // фулл-хаус: старше тройка
  beats('As Ks 9s 7s 4s 3d 2c', 'Ad Kd 9d 7d 3d 4s 2c');       // флеш: пятая карта
  beats('9s 8d 7h 6c 5s 5d 5c', 'Ks Kd Kh Ac 9s 3d 2c');       // стрит > сет
});

test('ничья: одинаковые пятёрки делят банк, разные масти не важны', () => {
  assert.equal(compare(ev('As Kd 9h 7c 4s 3d 2c'), ev('Ah Kc 9d 7s 4d 3c 2h')), 0);
  assert.equal(compare(ev('9s 8d 7h 6c 5s Kd 2c'), ev('9h 8c 7d 6s 5h Ad 3c')), 0);
  // Борд играет сам: у обоих один и тот же стрит на столе.
  const board = 'Ts Jd Qh Kc Ad';
  assert.equal(compare(ev(board + ' 2s 3s'), ev(board + ' 7h 8h')), 0);
});

test('evaluate7: лучшая пятёрка из семи, порядок — группы, потом кикеры', () => {
  const e = ev('As Ad 9h 9c 4s 3d 2c');
  assert.deepEqual(e.best, ['As', 'Ad', '9h', '9c', '4s']);
  const f = ev('Kh 5h Ac As 5d Jd 3c');
  assert.deepEqual([f.cat, handName(f), f.best], [2, 'Две пары', ['Ac', 'As', '5h', '5d', 'Kh']]);
  const w = ev('As 2d 3h 4c 5s Kd 9c');
  assert.deepEqual(w.best, ['5s', '4c', '3h', '2d', 'As'], 'колесо: туз последним');
  assert.equal(evaluate5(['As', 'Ad', '9h', '9c', '4s']).cat, 2);
  assert.throws(() => evaluate7(['As', 'Ad']), /от 5 до 7/);
});

test('sidePots: три олл-ина разными стеками и один сбросивший', () => {
  // A 100 (олл-ин), B 300 (олл-ин), C 500 (олл-ин), D поставил 200 и сбросил.
  const pots = sidePots([
    { seat: 0, put: 100, folded: false },
    { seat: 1, put: 300, folded: false },
    { seat: 2, put: 500, folded: false },
    { seat: 3, put: 200, folded: true },
  ]);
  assert.deepEqual(pots, [
    { amount: 400, seats: [0, 1, 2] },   // 100 × 4
    { amount: 500, seats: [1, 2] },      // 200 + 200 + 100 (D)
    { amount: 200, seats: [2] },         // остаток C (никто не уравнял)
  ]);
  assert.equal(pots.reduce((s, p) => s + p.amount, 0), 1100);
  assert.deepEqual(sidePots([{ seat: 0, put: 20, folded: false }, { seat: 1, put: 20, folded: false }]), [{ amount: 40, seats: [0, 1] }]);
  assert.deepEqual(sidePots([]), []);
});

test('chen: AA 20, AKs 12, 72o −1; JTs 9, KQs 10', () => {
  assert.equal(chen(['As', 'Ad']), 20);
  assert.equal(chen(['As', 'Ks']), 12);
  assert.equal(chen(['7s', '2d']), -1);
  assert.equal(chen(['Js', 'Ts']), 9);
  assert.equal(chen(['Ks', 'Qs']), 10);
  assert.equal(chen(['2s', '2d']), 5, 'пара не меньше 5');
});

test('raiseAmount: кратно 10 в пределах [min, max]', () => {
  assert.equal(raiseAmount(63, 40, 1000), 60);
  assert.equal(raiseAmount(10, 40, 1000), 40);
  assert.equal(raiseAmount(10, 46, 1000), 50);
  assert.equal(raiseAmount(2000, 40, 990), 990);
  assert.equal(raiseAmount(10, 46, 48), 48);
});

// Детерминированный генератор для бота.
const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

test('бот: 1000 случайных положений — всегда допустимое действие', () => {
  const rand = mulberry32(7);
  const phases = ['preflop', 'flop', 'turn', 'river'];
  let raises = 0;
  for (let i = 0; i < 1000; i++) {
    const deck = FULL_DECK.slice();
    for (let j = deck.length - 1; j > 0; j--) { const k = Math.floor(rand() * (j + 1)); [deck[j], deck[k]] = [deck[k], deck[j]]; }
    const phase = phases[Math.floor(rand() * 4)];
    const boardN = phase === 'preflop' ? 0 : phase === 'flop' ? 3 : phase === 'turn' ? 4 : 5;
    const cards = deck.slice(0, 2);
    const board = deck.slice(2, 2 + boardN);
    const chips = Math.floor(rand() * 120) * 10;                // 0…1190
    const currentBet = Math.floor(rand() * 8) * 10;             // 0…70
    const myBet = Math.min(currentBet, Math.floor(rand() * 4) * 10);
    const toCall = Math.min(currentBet - myBet, chips);
    const minRaise = currentBet + 20;
    const maxRaise = myBet + chips;
    const pot = 30 + currentBet * 2 + Math.floor(rand() * 200);
    const s = { cards, board, pot, toCall, minRaise, maxRaise, chips, opponents: 1 + Math.floor(rand() * 3), phase, rand, bb: 20, currentBet };
    const d = decide({ ...s, rand: mulberry32(1000 + i) });
    assert.ok(['fold', 'check', 'call', 'raise', 'allin'].includes(d.action), 'действие: ' + d.action);
    if (d.action === 'check') assert.equal(toCall, 0, 'check только без ставки');
    if (d.action === 'fold') assert.ok(toCall > 0, 'без ставки бот не сбрасывает');
    if (d.action === 'allin') assert.ok(chips > 0, 'олл-ин без фишек');
    if (d.action === 'raise') {
      raises++;
      assert.ok(Number.isInteger(d.amount) && d.amount >= minRaise && d.amount <= maxRaise, `рейз ${d.amount} вне [${minRaise}, ${maxRaise}]`);
      assert.ok(d.amount % 10 === 0 || d.amount === maxRaise || d.amount === minRaise, 'сумма кратна 10 (или предел)');
    }
  }
  assert.ok(raises > 20, 'бот иногда повышает: ' + raises);
});

test('бот: AA префлоп повышает, 72o без ставки — check, со ставкой — fold; сила флеша высокая', () => {
  const base = { board: [], pot: 30, toCall: 10, minRaise: 40, maxRaise: 1000, chips: 990, opponents: 1, phase: 'preflop', bb: 20, currentBet: 20 };
  const never = () => 0.99;   // без блефов
  assert.equal(decide({ ...base, cards: ['As', 'Ad'], rand: never }).action, 'raise');
  assert.equal(decide({ ...base, cards: ['As', 'Ad'], rand: never }).amount, 60);
  assert.equal(decide({ ...base, cards: ['7s', '2d'], rand: never }).action, 'fold');
  assert.equal(decide({ ...base, cards: ['7s', '2d'], toCall: 0, rand: never }).action, 'check');
  assert.equal(decide({ ...base, cards: ['Js', 'Ts'], rand: never }).action, 'call');
  assert.equal(decide({ ...base, cards: ['Js', 'Ts'], toCall: 100, currentBet: 110, rand: never }).action, 'fold');
  const st = strength(['As', 'Ks'], ['Qs', 'Js', '2s'], 1, mulberry32(3));
  assert.ok(st > 0.9, 'флеш от туза: ' + st);
  const weak = strength(['7s', '2d'], ['Ah', 'Kh', 'Qc'], 2, mulberry32(4));
  assert.ok(weak < 0.3, 'мусор против двух: ' + weak);
});
