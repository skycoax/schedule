// Бот шахмат — в отдельном потоке (Web Worker), чтобы доска не замирала, пока он думает. Правила и ходы — chess.js.
// Поиск — негамакс с альфа-бета отсечением и «тихим» продолжением (только взятия), оценка — материал плюс таблицы
// позиций фигур (простые таблицы Томаша Михневского). Уровни: 1 — глубина 1 и заметный шум (ошибается),
// 2 — глубина 2 и лёгкий шум, 3 — до глубины 4 за отведённое время.
import { Chess } from 'chess.js';
import type { Move, PieceSymbol } from 'chess.js';

type Level = 1 | 2 | 3;
interface Req { id: number; fen: string; level: Level }

const VALUE: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100_000;

// Таблицы позиций с точки зрения белых: строка 0 — восьмая горизонталь (как Chess.board()).
const PST: Record<PieceSymbol, number[][]> = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0], [50, 50, 50, 50, 50, 50, 50, 50], [10, 10, 20, 30, 30, 20, 10, 10], [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0], [5, -5, -10, 0, 0, -10, -5, 5], [5, 10, 10, -20, -20, 10, 10, 5], [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50], [-40, -20, 0, 0, 0, 0, -20, -40], [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30], [-30, 0, 15, 20, 20, 15, 0, -30], [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40], [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20], [-10, 0, 0, 0, 0, 0, 0, -10], [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10], [-10, 0, 10, 10, 10, 10, 0, -10], [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10], [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0], [5, 10, 10, 10, 10, 10, 10, 5], [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5], [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20], [-10, 0, 0, 0, 0, 0, 0, -10], [-10, 0, 5, 5, 5, 5, 0, -10], [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5], [-10, 5, 5, 5, 5, 5, 0, -10], [-10, 0, 5, 0, 0, 0, 0, -10], [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30], [-30, -40, -40, -50, -50, -40, -40, -30], [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30], [-20, -30, -30, -40, -40, -30, -30, -20], [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20], [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

/** Оценка позиции для того, чей ход (сантипешки). */
function evaluate(c: Chess): number {
  let score = 0;
  const board = c.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (!sq) continue;
      const v = VALUE[sq.type] + (sq.color === 'w' ? PST[sq.type][r][f] : PST[sq.type][7 - r][f]);
      score += sq.color === 'w' ? v : -v;
    }
  }
  return c.turn() === 'w' ? score : -score;
}

/** Порядок ходов: сначала превращения и выгодные взятия (жертва дороже — раньше), потом остальные. */
function ordered(moves: Move[]): Move[] {
  const key = (m: Move) => (m.promotion ? 2000 : 0) + (m.captured ? 10 * VALUE[m.captured] - VALUE[m.piece] + 1000 : 0);
  return moves.sort((a, b) => key(b) - key(a));
}

let deadline = Infinity;
let nodes = 0;
class Timeout extends Error {}

function quiesce(c: Chess, alpha: number, beta: number, depth: number): number {
  if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
  const stand = evaluate(c);
  if (stand >= beta || depth === 0) return stand;
  if (stand > alpha) alpha = stand;
  for (const m of ordered(c.moves({ verbose: true }).filter((x) => x.captured || x.promotion))) {
    c.move(m);
    const s = -quiesce(c, -beta, -alpha, depth - 1);
    c.undo();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function search(c: Chess, depth: number, alpha: number, beta: number, ply: number): number {
  if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
  const moves = c.moves({ verbose: true });
  if (!moves.length) return c.inCheck() ? -MATE + ply : 0;
  if (c.isDraw()) return 0;
  if (depth === 0) return quiesce(c, alpha, beta, 4);
  let best = -Infinity;
  for (const m of ordered(moves)) {
    c.move(m);
    const s = -search(c, depth - 1, -beta, -alpha, ply + 1);
    c.undo();
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  return best;
}

/** Оценки всех ходов на глубине depth (для шума и выбора среди почти равных). */
function scoreMoves(c: Chess, depth: number): { m: Move; s: number }[] {
  const out: { m: Move; s: number }[] = [];
  let alpha = -Infinity;
  for (const m of ordered(c.moves({ verbose: true }))) {
    c.move(m);
    const s = -search(c, depth - 1, -Infinity, -alpha + 1, 1);
    c.undo();
    out.push({ m, s });
    if (s > alpha) alpha = s;
  }
  return out.sort((a, b) => b.s - a.s);
}

const uci = (m: Move) => m.from + m.to + (m.promotion || '');

function pick(fen: string, level: Level): string | null {
  const c = new Chess(fen);
  const legal = c.moves({ verbose: true });
  if (!legal.length) return null;
  if (legal.length === 1) return uci(legal[0]);
  nodes = 0;
  if (level === 3) {
    // До глубины 4, пока есть время; не успел — лучший ход прошлой глубины.
    deadline = performance.now() + 1500;
    let best: { m: Move; s: number }[] = scoreMoves(c, 1);
    try {
      for (let d = 2; d <= 4; d++) best = scoreMoves(c, d);
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
    }
    deadline = Infinity;
    // Среди равных лучших — любой (разнообразие).
    const top = best.filter((x) => x.s >= best[0].s - 5);
    return uci(top[Math.floor(Math.random() * top.length)].m);
  }
  deadline = Infinity;
  const depth = level === 1 ? 1 : 2;
  const noise = level === 1 ? 120 : 25;
  const scored = scoreMoves(c, depth).map((x) => ({ m: x.m, s: x.s + (Math.random() * 2 - 1) * noise }));
  scored.sort((a, b) => b.s - a.s);
  // «Лёгкий» иногда просто ходит не лучшим из трёх.
  if (level === 1 && Math.random() < 0.3) return uci(scored[Math.min(scored.length - 1, Math.floor(Math.random() * 3))].m);
  return uci(scored[0].m);
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, fen, level } = e.data;
  let move: string | null = null;
  try { move = pick(fen, level); } catch { move = null; }
  (self as unknown as Worker).postMessage({ id, move });
};
