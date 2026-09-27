// «Покер» (CONTRACT.md §I): один общий стол Para на 4 места — состояние в памяти, таймеры, раздача, ход,
// бот, присутствие, view для каждого зрителя. Всё, что меняет стол, проходит через bump(): seq растёт и каждому
// открытому потоку уходит его view (game-stream.js). База (poker_players) — только стек и счёт людей:
// при посадке, в конце раздачи и когда человек встаёт; история раздач не хранится. Перезапуск сервера
// обрывает раздачу (фишки, поставленные в неё, теряются — допустимо), стол после старта пуст.
// Таймеры ходов, бота, улиц и пауз — один слот ('hand'); тела таймеров — в try/catch: стол не должен
// ни упасть, ни зависнуть (сторож раз в несколько секунд отменяет раздачу без таймера).
import { randomInt } from 'node:crypto';
import { social } from '../config.js';
import { tx, nowIso } from './db.js';
import { SocialError } from './http.js';
import { rateError } from './limits.js';
import { newDeck, evaluate7, handName, sidePots } from './poker-logic.js';
import { decide } from './poker-bot.js';
import { broadcast, sendReact, isLive, streamCount, setStreamHooks } from './game-stream.js';

export const SEATS = 4;
export const BLINDS = Object.freeze({ small: 10, big: 20 });
export const START_STACK = 1000;
export const REACTIONS = ['wave', 'like', 'wow', 'lol', 'fire', 'deal'];
export const ACTIONS = ['fold', 'check', 'call', 'raise', 'allin'];
const MAX_REACTS = 30;                   // реакций за раздачу с одного места

// Таймеры (мс): production и POKER_FAST=1 (разработка, дымовой тест).
export const T = social.pokerFast
  ? { COUNTDOWN: 300, TURN: 2000, BOT_MIN: 50, BOT_MAX: 80, STREET: 50, RUNOUT: 60, DONE_FOLD: 300, DONE_SHOWDOWN: 400,
    AWAY: 1500, AWAY_KICK: 4000, WATCHDOG: 1000 }
  : { COUNTDOWN: 5000, TURN: 20_000, BOT_MIN: 1200, BOT_MAX: 2600, STREET: 900, RUNOUT: 1200, DONE_FOLD: 3500,
    DONE_SHOWDOWN: 6500, AWAY: 15_000, AWAY_KICK: 90_000, WATCHDOG: 5000 };

export const POKER_TEXT = {
  notTurn: 'Сейчас не твой ход',
  mustCall: 'Нужно уравнять или сбросить',
  amount: 'Неверная сумма',
  full: 'Стол заполнен',
  blocked: 'За этот стол сейчас не сесть — попробуй позже',
  notSeated: 'Ты не за столом',
};

const conflict = (message) => new SocialError(409, 'conflict', message, { field: 'status' });
const badAmount = () => new SocialError(400, 'invalid', POKER_TEXT.amount, { field: 'amount' });

// ─── Состояние ───

const table = {
  seq: 1,
  seats: Array(SEATS).fill(null),
  hand: null,
  countdown: null,      // epoch ms старта раздачи
  dealer: null,         // место дилера прошлой раздачи
  botChips: START_STACK,
};
let ctx = null;           // { db, log }
let deps = null;          // { cardsOf(ids) → Map<id, {full, guest}>, blocksAmong(ids) → Set<'a:b'>, blockedWith(id, ids) → boolean }
const timers = { hand: null, presence: null };
const stats = new Map();  // userId → { chips, hands, wins, bestPot, row }
const kickedIdle = new Set();
let handSeq = Math.floor(Date.now() / 1000);   // id раздачи растёт и после перезапуска

const now = () => Date.now();
const log = (level, obj, msg) => { if (ctx && ctx.log) ctx.log[level](obj, msg); };

function makeSeat(seat, { userId = null, bot = false, chips }) {
  return {
    seat, userId, bot, chips,
    bet: 0, put: 0, folded: false, allIn: false, away: false, reserved: false, leaving: false, inHand: false,
    cards: null, last: null, acted: false, timeouts: 0, won: 0, reacts: 0,
    online: bot, seenAt: now(),
  };
}
const seatAt = (i) => table.seats[i];
const seatOf = (userId) => table.seats.find((s) => s && s.userId === userId) || null;
const botSeat = () => table.seats.find((s) => s && s.bot) || null;
const humanSeats = () => table.seats.filter((s) => s && !s.bot);
const inHandSeats = () => table.seats.filter((s) => s && s.inHand);
const aliveSeats = () => table.seats.filter((s) => s && s.inHand && !s.folded);
const activeSeats = () => table.seats.filter((s) => s && s.inHand && !s.folded && !s.allIn);

/** Сколько людей за столом сейчас (Me.game.players). */
export const humans = () => humanSeats().length;

// ─── Таймеры ───

function clearTimer(name) {
  if (timers[name]) clearTimeout(timers[name]);
  timers[name] = null;
}
function setTimer(name, ms, fn) {
  clearTimer(name);
  const id = setTimeout(() => {
    timers[name] = null;
    try { fn(); } catch (err) { log('error', { msg: err && err.message, stack: err && err.stack }, 'покер: ошибка в таймере'); }
  }, Math.max(0, ms));
  id.unref();
  timers[name] = id;
}

/** Каждое изменение стола: seq растёт, всем потокам — их view. */
function bump() {
  table.seq++;
  if (!ctx) return;
  const pre = prepare();
  broadcast((uid) => viewFor(uid, pre));
}

// ─── Места ───

/** Свободное место: напротив opposite, если можно; иначе — подальше от занятых (меньший индекс при равенстве). */
function pickSeat(opposite = null) {
  const free = [];
  for (let i = 0; i < SEATS; i++) if (!table.seats[i]) free.push(i);
  if (!free.length) return -1;
  if (opposite !== null && free.includes((opposite + 2) % SEATS)) return (opposite + 2) % SEATS;
  const taken = table.seats.filter(Boolean).map((s) => s.seat);
  if (!taken.length) return free[0];
  const dist = (i) => Math.min(...taken.map((o) => Math.min(Math.abs(i - o), SEATS - Math.abs(i - o))));
  return free.sort((a, b) => dist(b) - dist(a) || a - b)[0];
}

/** Следующее место по часовой после from среди мест, где pred(seat) — или null. */
function nextSeat(from, pred) {
  for (let k = 1; k <= SEATS; k++) {
    const s = table.seats[(from + k) % SEATS];
    if (s && pred(s)) return s.seat;
  }
  return null;
}
const nextInHand = (from) => nextSeat(from, (s) => s.inHand);
const nextActive = (from) => nextSeat(from, (s) => s.inHand && !s.folded && !s.allIn);

function removeSeat(s, persist) {
  table.seats[s.seat] = null;
  if (s.bot) table.botChips = s.chips;
  else if (persist) persistChips([[s.userId, s.chips]]);
}

/**
 * Планирование, когда раздачи нет: reserved → сидят; людей ровно 1 → садится бот (лучше напротив), иначе бот
 * встаёт; готовых (не away, не leaving) ≥ 2 → отсчёт до раздачи, иначе отсчёт снимается. Идемпотентно.
 */
function plan() {
  if (table.hand) return;
  for (const s of table.seats) if (s && s.reserved) s.reserved = false;
  const ready = (s) => !!s && !s.away && !s.leaving;
  const people = table.seats.filter((s) => ready(s) && !s.bot);
  const bot = botSeat();
  if (people.length === 1) {
    if (!bot) {
      const i = pickSeat(people[0].seat);
      if (i >= 0) table.seats[i] = makeSeat(i, { bot: true, chips: table.botChips });
    }
  } else if (bot) {
    removeSeat(bot, false);
  }
  if (table.seats.filter(ready).length >= 2) {
    if (table.countdown === null || !timers.hand) {
      table.countdown = now() + T.COUNTDOWN;
      setTimer('hand', T.COUNTDOWN, () => { startHand(); bump(); });
    }
  } else {
    table.countdown = null;
    clearTimer('hand');
  }
}

// ─── Раздача ───

function postBlind(s, amount, tag) {
  const pay = Math.min(amount, s.chips);
  s.chips -= pay;
  s.bet += pay;
  s.put += pay;
  if (s.chips === 0) s.allIn = true;
  s.last = { a: tag, amount: pay };
}

function startHand() {
  table.countdown = null;
  if (table.hand) return;
  for (const s of table.seats) if (s && s.reserved) s.reserved = false;
  const players = table.seats.filter((s) => s && !s.away && !s.leaving);
  if (players.length < 2) { plan(); return; }
  // Не хватает на большой блайнд — бесплатно долили до стартового стека (бот — так же).
  const rebuys = [];
  for (const s of players) {
    if (s.chips >= BLINDS.big) continue;
    s.chips = START_STACK;
    if (!s.bot) rebuys.push([s.userId, s.chips]);
  }
  persistChips(rebuys);

  const deck = newDeck();
  for (const s of table.seats) {
    if (!s) continue;
    Object.assign(s, { bet: 0, put: 0, folded: false, allIn: false, cards: null, last: null, acted: false, won: 0, reacts: 0 });
    s.inHand = players.includes(s);
    if (s.inHand) s.cards = [deck.pop(), deck.pop()];
  }
  const order = players.map((s) => s.seat).sort((a, b) => a - b);
  const dealer = table.dealer === null ? order[randomInt(order.length)] : (order.find((i) => i > table.dealer) ?? order[0]);
  table.dealer = dealer;
  const headsUp = players.length === 2;
  const sb = headsUp ? dealer : nextInHand(dealer);
  const bb = nextInHand(sb);
  table.hand = {
    id: ++handSeq, phase: 'preflop', board: [], deck, pot: 0, turn: null, currentBet: BLINDS.big, minRaise: BLINDS.big,
    result: null, dealer, revealed: false, botSlow: randomInt(5) === 0, botSlowUsed: false,
  };
  postBlind(seatAt(sb), BLINDS.small, 'sb');
  postBlind(seatAt(bb), BLINDS.big, 'bb');
  const first = headsUp ? dealer : nextActive(bb);
  if (first === null) endStreet();   // оба блайнда олл-ин с раздачи — сразу добор
  else setTurn(first);
}

/** Чей ход и таймер: человеку — TURN_MS, боту — его «раздумье» (в раздаче раз с вероятностью 20 % — BOT_MAX). */
function setTurn(seat) {
  const h = table.hand;
  const s = seatAt(seat);
  h.turn = { seat, deadline: now() + T.TURN };
  if (s.bot) {
    let ms = T.BOT_MIN + randomInt(Math.max(1, T.BOT_MAX - T.BOT_MIN + 1));
    if (h.botSlow && !h.botSlowUsed) { ms = T.BOT_MAX; h.botSlowUsed = true; }
    setTimer('hand', ms, () => { botAct(); bump(); });
  } else {
    setTimer('hand', T.TURN, () => { onTimeout(); bump(); });
  }
}

/** Что можно сделать месту s сейчас (PokerActions): raise — «до», allin — вся ставка на улице при олл-ине. */
function actionsFor(s) {
  const h = table.hand;
  const toCall = Math.max(0, h.currentBet - s.bet);
  const max = s.bet + s.chips;
  const minTo = h.currentBet + h.minRaise;
  return {
    fold: true,
    check: toCall === 0,
    call: Math.min(toCall, s.chips),
    raise: max >= minTo ? { min: minTo, max } : null,
    allin: max,
  };
}

/** Применить ход к месту s (проверки — как для человека: 409/400). timeouts не трогает. */
function applyAction(s, action, amount) {
  const h = table.hand;
  const a = actionsFor(s);
  const toCall = Math.max(0, h.currentBet - s.bet);
  const raiseTo = (to, tag) => {
    const delta = to - s.bet;
    s.chips -= delta;
    s.bet = to;
    s.put += delta;
    const size = to - h.currentBet;
    if (size >= h.minRaise) h.minRaise = size;   // полный рейз задаёт новый минимум; короткий олл-ин — нет
    h.currentBet = to;
    for (const o of table.seats) if (o && o !== s && o.inHand) o.acted = false;
    if (s.chips === 0) s.allIn = true;
    s.last = { a: s.allIn ? 'allin' : tag, amount: to };
  };
  if (action === 'fold') {
    s.folded = true;
    s.last = { a: 'fold', amount: 0 };
  } else if (action === 'check') {
    if (!a.check) throw conflict(POKER_TEXT.mustCall);
    s.last = { a: 'check', amount: 0 };
  } else if (action === 'call') {
    if (toCall === 0) {
      s.last = { a: 'check', amount: 0 };
    } else {
      const pay = a.call;
      s.chips -= pay;
      s.bet += pay;
      s.put += pay;
      if (s.chips === 0) s.allIn = true;
      s.last = s.allIn && pay < toCall ? { a: 'allin', amount: s.bet } : { a: 'call', amount: pay };
    }
  } else if (action === 'raise') {
    if (!a.raise || !Number.isInteger(amount) || amount < a.raise.min || amount > a.raise.max) throw badAmount();
    raiseTo(amount, h.currentBet === 0 ? 'bet' : 'raise');
  } else if (action === 'allin') {
    if (s.chips <= 0) throw badAmount();
    if (a.allin > h.currentBet) {
      raiseTo(a.allin, 'allin');
    } else {
      s.bet += s.chips;
      s.put += s.chips;
      s.chips = 0;
      s.allIn = true;
      s.last = { a: 'allin', amount: s.bet };
    }
  } else {
    throw badAmount();
  }
  s.acted = true;
}

/** Круг торговли закончен: все, кто может ходить, походили после последнего повышения и уравняли ставку. */
function roundComplete() {
  const h = table.hand;
  return activeSeats().every((s) => s.acted && s.bet === h.currentBet);
}

/** После хода того, чей ход был: победа по сбросам, конец улицы или следующий игрок. */
function afterAction() {
  const h = table.hand;
  const alive = aliveSeats();
  if (alive.length === 1) return finishByFold(alive[0]);
  if (roundComplete()) return endStreet();
  const nxt = nextActive(h.turn ? h.turn.seat : h.dealer);
  if (nxt === null) return endStreet();
  return setTurn(nxt);
}

function collectBets() {
  const h = table.hand;
  for (const s of table.seats) {
    if (!s || !s.inHand) continue;
    h.pot += s.bet;
    s.bet = 0;
  }
}

function dealNext() {
  const h = table.hand;
  if (h.phase === 'preflop') { h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop()); h.phase = 'flop'; }
  else if (h.phase === 'flop') { h.board.push(h.deck.pop()); h.phase = 'turn'; }
  else if (h.phase === 'turn') { h.board.push(h.deck.pop()); h.phase = 'river'; }
  for (const s of table.seats) if (s && s.inHand) { s.last = null; s.acted = false; }
  h.currentBet = 0;
  h.minRaise = BLINDS.big;
}

/** Конец улицы: ставки в банк; все (кроме одного) олл-ин — вскрытие и добор; ривер — вскрытие; иначе улица. */
function endStreet() {
  const h = table.hand;
  collectBets();
  h.turn = null;
  if (activeSeats().length <= 1) {
    h.revealed = true;
    return runoutStep();
  }
  if (h.phase === 'river') return showdown();
  dealNext();
  return setTimer('hand', T.STREET, () => { startStreetTurn(); bump(); });
}

function startStreetTurn() {
  const h = table.hand;
  if (!h || h.turn || h.result) return;
  const first = nextActive(h.dealer);
  if (first === null) return endStreet();
  return setTurn(first);
}

/** Добор борда при олл-инах: по улице за RUNOUT_MS, потом вскрытие. */
function runoutStep() {
  const h = table.hand;
  if (h.phase === 'river') return showdown();
  dealNext();
  return setTimer('hand', T.RUNOUT, () => { runoutStep(); bump(); });
}

/** Порядок мест по часовой от дилера (первому после дилера — лишняя фишка при делёжке). */
const fromDealer = (seats) => seats.slice().sort((a, b) => (a - table.hand.dealer + SEATS - 1) % SEATS - (b - table.hand.dealer + SEATS - 1) % SEATS);

function showdown() {
  const h = table.hand;
  h.turn = null;
  h.revealed = true;
  const alive = aliveSeats();
  const pots = sidePots(inHandSeats().map((s) => ({ seat: s.seat, put: s.put, folded: s.folded })));
  const evals = new Map();
  for (const s of alive) evals.set(s.seat, evaluate7(s.cards.concat(h.board)));
  const won = new Map();
  for (const pot of pots) {
    let best = null;
    let winners = [];
    for (const seat of pot.seats) {
      const e = evals.get(seat);
      if (!e) continue;
      if (!best || e.score > best.score) { best = e; winners = [seat]; } else if (e.score === best.score) winners.push(seat);
    }
    if (!winners.length) continue;
    const share = Math.floor(pot.amount / winners.length);
    let rest = pot.amount - share * winners.length;
    for (const seat of fromDealer(winners)) {
      const amt = share + (rest > 0 ? 1 : 0);
      if (rest > 0) rest--;
      won.set(seat, (won.get(seat) || 0) + amt);
    }
  }
  for (const [seat, amount] of won) {
    const s = seatAt(seat);
    s.chips += amount;
    s.won += amount;
    s.last = { a: 'win', amount };
  }
  h.pot = 0;
  h.currentBet = 0;
  h.result = {
    showdown: true,
    winners: [...won].map(([seat, amount]) => ({ seat, amount, name: handName(evals.get(seat)), cards: evals.get(seat).best.slice() })),
    reveal: alive.map((s) => ({ seat: s.seat, cards: s.cards.slice() })),
  };
  h.phase = 'showdown';
  setTimer('hand', T.DONE_SHOWDOWN, () => { endHand(); bump(); });
}

function finishByFold(w) {
  const h = table.hand;
  collectBets();
  h.turn = null;
  const amount = h.pot;
  w.chips += amount;
  w.won += amount;
  w.last = { a: 'win', amount };
  h.pot = 0;
  h.currentBet = 0;
  h.result = { showdown: false, winners: [{ seat: w.seat, amount, name: '', cards: [] }], reveal: [] };
  h.phase = 'done';
  setTimer('hand', T.DONE_FOLD, () => { endHand(); bump(); });
}

/** Конец раздачи: счёт людей в базу; убрать вставших, выгнанных за два пропуска и отошедших надолго; plan(). */
function endHand() {
  const h = table.hand;
  if (!h) return;
  clearTimer('hand');
  persistResults(inHandSeats().filter((s) => !s.bot).map((s) => ({ id: s.userId, chips: s.chips, won: s.won })));
  const t = now();
  for (const s of table.seats) {
    if (!s) continue;
    const idle = !s.bot && s.timeouts >= 2;
    const awayLong = !s.bot && !s.online && t - s.seenAt >= T.AWAY_KICK;
    if (s.leaving || idle || awayLong) {
      if (idle) kickedIdle.add(s.userId);
      removeSeat(s, !s.inHand);
    }
  }
  for (const s of table.seats) {
    if (!s) continue;
    Object.assign(s, { inHand: false, cards: null, bet: 0, put: 0, folded: false, allIn: false, last: null, acted: false, won: 0 });
  }
  table.hand = null;
  plan();
}

/** Раздача без таймера (после ошибки): ставки возвращаются, раздача отменяется — стол не должен зависнуть. */
function abortHand() {
  const h = table.hand;
  if (!h) return;
  log('error', { hand: h.id, phase: h.phase }, 'покер: раздача без таймера отменена');
  for (const s of table.seats) if (s && s.inHand && !h.result) s.chips += s.put;
  clearTimer('hand');
  if (h.result) return endHand();
  for (const s of table.seats) if (s) Object.assign(s, { inHand: false, cards: null, bet: 0, put: 0, folded: false, allIn: false, last: null, acted: false, won: 0 });
  table.hand = null;
  return plan();
}

// ─── Ходы ───

/** Время вышло: check, если можно, иначе fold; два подряд — после раздачи из-за стола. */
function onTimeout() {
  const h = table.hand;
  if (!h || !h.turn || h.result) return;
  const s = seatAt(h.turn.seat);
  if (!s || s.bot) return;
  applyAction(s, actionsFor(s).check ? 'check' : 'fold');
  s.timeouts += 1;
  afterAction();
}

function botAct() {
  const h = table.hand;
  if (!h || !h.turn || h.result) return;
  const s = seatAt(h.turn.seat);
  if (!s || !s.bot) return;
  const a = actionsFor(s);
  let action = null;
  let amount;
  try {
    const potAll = h.pot + inHandSeats().reduce((sum, x) => sum + x.bet, 0);
    const d = decide({
      cards: s.cards, board: h.board, pot: potAll, toCall: Math.max(0, h.currentBet - s.bet),
      minRaise: h.currentBet + h.minRaise, maxRaise: s.bet + s.chips, chips: s.chips,
      opponents: aliveSeats().length - 1, phase: h.phase, bb: BLINDS.big, currentBet: h.currentBet, rand: Math.random,
    });
    action = d && d.action;
    amount = d && d.amount;
  } catch (err) {
    log('warn', { msg: err && err.message }, 'покер: бот не решил — check/fold');
  }
  const valid = action === 'fold'
    || (action === 'check' && a.check)
    || (action === 'call' && (a.call > 0 || a.check))
    || (action === 'raise' && a.raise && Number.isInteger(amount) && amount >= a.raise.min && amount <= a.raise.max)
    || (action === 'allin' && s.chips > 0);
  if (!valid) { action = a.check ? 'check' : 'fold'; amount = undefined; }
  applyAction(s, action, amount);
  afterAction();
}

/** Ход человека: только в свою очередь и в ту раздачу, которую он видит. */
export function act(userId, handId, action, amount) {
  touch(userId);
  const h = table.hand;
  const s = seatOf(userId);
  if (!h || !s || !s.inHand || s.folded || h.result || !h.turn || h.turn.seat !== s.seat || h.id !== handId) {
    throw conflict(POKER_TEXT.notTurn);
  }
  applyAction(s, action, amount);
  s.timeouts = 0;
  afterAction();
  bump();
  return viewFor(userId);
}

// ─── Сесть, встать, выгнать, реакции ───

/** Сесть: во время раздачи — «ждёт раздачи» (reserved). Повтор — 200 (вставшему во время раздачи — место остаётся). */
export function sit(u) {
  touch(u.id);
  let s = seatOf(u.id);
  if (s) {
    if (s.leaving) { s.leaving = false; bump(); }
    return viewFor(u.id);
  }
  const others = humanSeats().map((x) => x.userId);
  if (others.length && deps.blockedWith(u.id, others)) throw conflict(POKER_TEXT.blocked);
  const i = pickSeat();
  if (i < 0) throw conflict(POKER_TEXT.full);
  const st = ensurePlayer(u.id);
  let chips = st.chips;
  if (chips < BLINDS.big) {
    chips = START_STACK;
    persistChips([[u.id, chips]]);
  }
  s = makeSeat(i, { userId: u.id, chips });
  s.online = isLive(u.id);
  s.reserved = !!table.hand;
  table.seats[i] = s;
  if (!table.hand) plan();
  schedulePresence();
  bump();
  return viewFor(u.id);
}

/**
 * Уйти из-за стола: в раздаче — сброс (в свой ход — как ход) и место освобождается по её окончании (leaving);
 * вне раздачи, «ждёт раздачи» или не сдан — сразу.
 */
function leave(s) {
  const h = table.hand;
  if (h && s.inHand) {
    s.leaving = true;
    if (h.result || s.folded) return;
    if (h.turn && h.turn.seat === s.seat) {
      applyAction(s, 'fold');
      return afterAction();
    }
    s.folded = true;
    s.last = { a: 'fold', amount: 0 };
    s.acted = true;
    const alive = aliveSeats();
    if (alive.length === 1) return finishByFold(alive[0]);
    if (roundComplete()) return endStreet();
    return undefined;
  }
  removeSeat(s, true);
  if (!h) plan();
  return undefined;
}

/** Встать. Не сижу — 200. */
export function stand(userId) {
  const s = seatOf(userId);
  if (s) {
    leave(s);
    bump();
  }
  return viewFor(userId);
}

/** Бан или удаление аккаунта: сброс и встать (место — по окончании раздачи). Потоки закрывает вызывающий. */
export function kick(userId) {
  stats.delete(userId);
  kickedIdle.delete(userId);
  const s = seatOf(userId);
  if (!s) return;
  try { leave(s); } catch (err) { log('error', { msg: err && err.message }, 'покер: kick'); }
  bump();
}

/** Реакция: только сидящим (и «ждёт раздачи»), не больше 30 за раздачу; в потоки остальных. */
export function react(userId, r) {
  const s = seatOf(userId);
  if (!s) throw conflict(POKER_TEXT.notSeated);
  if (s.reacts >= MAX_REACTS) throw rateError(60);
  s.reacts += 1;
  touch(userId);
  sendReact(userId, { seat: s.seat, r });
}

// ─── Присутствие ───

/** 0→1 / 1→0 открытых потоков человека (game-stream.js). Отошёл — не сразу: через AWAY_MS без потока и запросов. */
export function setOnline(userId, online) {
  const s = seatOf(userId);
  if (!s) return;
  s.online = online;
  s.seenAt = now();
  if (online && s.away) {
    s.away = false;
    if (!table.hand) plan();
    bump();
  }
  schedulePresence();
}

/** Любой запрос сидящего к столу (опрос вместо потока тоже считается присутствием). */
function touch(userId) {
  const s = seatOf(userId);
  if (!s) return;
  s.seenAt = now();
  if (s.away) {
    s.away = false;
    if (!table.hand) plan();
    bump();
  }
}

function schedulePresence() {
  let at = Infinity;
  for (const s of table.seats) {
    if (!s || s.bot || s.online) continue;
    at = Math.min(at, s.seenAt + (s.away ? T.AWAY_KICK : T.AWAY));
  }
  clearTimer('presence');
  if (at < Infinity) setTimer('presence', at - now() + 5, () => { checkPresence(); });
}

function checkPresence() {
  const t = now();
  let changed = false;
  for (const s of [...table.seats]) {
    if (!s || s.bot || s.online) continue;
    const off = t - s.seenAt;
    if (off >= T.AWAY_KICK) { leave(s); changed = true; }
    else if (off >= T.AWAY && !s.away) { s.away = true; changed = true; }
  }
  if (changed) {
    if (!table.hand) plan();
    bump();
  }
  schedulePresence();
}

// ─── База: стек и счёт ───

function readStats(userId) {
  if (!ctx) return { chips: START_STACK, hands: 0, wins: 0, bestPot: 0, row: false };
  const row = ctx.db.prepare('SELECT chips, hands, wins, best_pot FROM poker_players WHERE user_id = ?').get(userId);
  const st = row
    ? { chips: Number(row.chips), hands: Number(row.hands), wins: Number(row.wins), bestPot: Number(row.best_pot), row: true }
    : { chips: START_STACK, hands: 0, wins: 0, bestPot: 0, row: false };
  stats.set(userId, st);
  return st;
}
const statsOf = (userId) => stats.get(userId) || readStats(userId);

/** Строка poker_players (первый GET вошедшим, посадка); возвращает счёт. */
export function ensurePlayer(userId) {
  const st = stats.get(userId);
  if (st && st.row) return st;
  tx(ctx.db, () => {
    const iso = nowIso();
    ctx.db.prepare('INSERT OR IGNORE INTO poker_players (user_id, found_at, updated_at) VALUES (?,?,?)').run(userId, iso, iso);
  });
  return readStats(userId);
}

function persistChips(pairs) {
  if (!ctx || !pairs.length) return;
  try {
    tx(ctx.db, () => {
      const st = ctx.db.prepare('UPDATE poker_players SET chips = ?, updated_at = ? WHERE user_id = ?');
      const iso = nowIso();
      for (const [id, chips] of pairs) st.run(chips, iso, id);
    });
    for (const [id, chips] of pairs) { const st = stats.get(id); if (st) st.chips = chips; }
  } catch (err) {
    log('error', { msg: err && err.message }, 'покер: стек не записан');
  }
}

function persistResults(rows) {
  if (!ctx || !rows.length) return;
  try {
    tx(ctx.db, () => {
      const st = ctx.db.prepare(`UPDATE poker_players SET chips = ?, hands = hands + 1, wins = wins + ?, best_pot = MAX(best_pot, ?),
        updated_at = ? WHERE user_id = ?`);
      const iso = nowIso();
      for (const r of rows) st.run(r.chips, r.won > 0 ? 1 : 0, r.won, iso, r.id);
    });
    for (const r of rows) readStats(r.id);
  } catch (err) {
    log('error', { msg: err && err.message }, 'покер: итог раздачи не записан');
  }
}

// ─── View ───

/** Карточки и блокировки сидящих — по разу на рассылку. */
function prepare() {
  const ids = humanSeats().map((s) => s.userId);
  if (!deps) return { cards: new Map(), blocks: new Set() };
  return { cards: deps.cardsOf(ids), blocks: deps.blocksAmong(ids) };
}
const blockedPair = (blocks, a, b) => blocks.has(a + ':' + b) || blocks.has(b + ':' + a);

function seatOut(s, uid, pre) {
  const h = table.hand;
  const mine = uid !== null && s.userId === uid;
  const pair = s.bot ? null : pre.cards.get(s.userId) || null;
  const card = pair ? (uid === null ? pair.guest : pair.full) : null;
  const masked = !s.bot && (!card || (uid !== null && !mine && blockedPair(pre.blocks, uid, s.userId)));
  let cards = null;
  if (s.inHand && s.cards) {
    if (mine) cards = s.cards.slice();
    else if (!s.folded) cards = h && h.revealed ? s.cards.slice() : ['?', '?'];
  }
  return {
    seat: s.seat, user: masked ? null : card, bot: s.bot, masked,
    chips: s.chips, bet: s.bet,
    folded: s.folded, allIn: s.allIn, away: s.away, reserved: s.reserved, inHand: s.inHand, leaving: s.leaving,
    cards, last: s.last ? { ...s.last } : null, dealer: !!h && h.dealer === s.seat,
  };
}

/** Банки из уже собранных ставок (сумма = hand.pot); после итога банк роздан — пусто. */
function potsOut() {
  if (table.hand.result) return [];
  return sidePots(inHandSeats().map((s) => ({ seat: s.seat, put: s.put - s.bet, folded: s.folded })));
}

function meOut(uid) {
  const s = seatOf(uid);
  const h = table.hand;
  const st = statsOf(uid);
  const myTurn = !!(s && h && h.turn && !h.result && h.turn.seat === s.seat);
  let kicked = null;
  if (kickedIdle.has(uid)) { kickedIdle.delete(uid); kicked = 'idle'; }
  return {
    seat: s ? s.seat : null,
    state: !s ? 'none' : s.leaving ? 'leaving' : s.reserved ? 'reserved' : 'seated',
    chips: s ? s.chips : st.chips,
    cards: s && s.inHand && s.cards ? s.cards.slice() : null,
    actions: myTurn ? actionsFor(s) : null,
    stats: { hands: st.hands, wins: st.wins, bestPot: st.bestPot },
    kicked,
  };
}

/** PokerView для зрителя uid (null — гость). pre — карточки и блокировки, общие для одной рассылки. */
export function viewFor(uid = null, pre = null) {
  const p = pre || prepare();
  const h = table.hand;
  return {
    seq: table.seq,
    now: now(),
    seats: table.seats.map((s) => (s ? seatOut(s, uid, p) : null)),
    hand: h ? {
      id: h.id, phase: h.phase, board: h.board.slice(), pot: h.pot, pots: potsOut(),
      turn: h.turn ? { ...h.turn } : null, currentBet: h.currentBet, minRaise: h.minRaise,
      result: h.result ? {
        showdown: h.result.showdown,
        winners: h.result.winners.map((w) => ({ ...w, cards: w.cards.slice() })),
        reveal: h.result.reveal.map((r) => ({ seat: r.seat, cards: r.cards.slice() })),
      } : null,
    } : null,
    countdown: table.countdown,
    watchers: streamCount(),
    blinds: { ...BLINDS },
    startStack: START_STACK,
    me: uid ? meOut(uid) : null,
  };
}

/** GET /api/social/games вошедшим: строка счёта и присутствие. */
export function touchPlayer(userId) {
  ensurePlayer(userId);
  touch(userId);
}

/**
 * Запуск (game.js, когда маршруты игры есть): контекст, карточки/блокировки, хуки потока и сторож.
 * @param {{ db: import('node:sqlite').DatabaseSync, log: object }} c
 * @param {{ cardsOf: (ids: number[]) => Map<number, { full: object, guest: object }>, blocksAmong: (ids: number[]) => Set<string>,
 *   blockedWith: (id: number, ids: number[]) => boolean }} d
 */
export function startTable(c, d) {
  ctx = c;
  deps = d;
  setStreamHooks({ view: (uid) => viewFor(uid), presence: setOnline, log: c.log });
  const dog = setInterval(() => {
    try {
      if (table.hand && !timers.hand) { abortHand(); bump(); }
      else if (!table.hand && table.countdown !== null && !timers.hand) { table.countdown = null; plan(); bump(); }
    } catch (err) {
      log('error', { msg: err && err.message }, 'покер: сторож');
    }
  }, T.WATCHDOG);
  dog.unref();
}

/** Для тестов и диагностики: состояние без карт. */
export function snapshot() {
  return { seq: table.seq, hand: table.hand ? table.hand.id : null, phase: table.hand ? table.hand.phase : null,
    seats: table.seats.map((s) => (s ? { seat: s.seat, userId: s.userId, bot: s.bot, chips: s.chips } : null)) };
}
