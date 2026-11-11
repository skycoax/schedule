// Шахматная доска: 8×8 полей-кнопок, ход касанием — выбрать свою фигуру, затем поле (точки — куда можно, кольцо —
// взятие). Подсвечены последний ход и король под шахом. Пешка дошла до края — выбор фигуры поверх доски.
// Фигуры — набор cburnett из react-chessboard (MIT), сама доска своя: так проще сделать её тихой, как Para.
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { defaultPieces } from 'react-chessboard';
import type { Chess, Color, PieceSymbol, Square } from 'chess.js';

export type Promo = 'q' | 'r' | 'b' | 'n';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const NAMES: Record<PieceSymbol, [string, boolean]> = {   // название и «женский род» (белая ладья, белый конь)
  k: ['король', false], q: ['ферзь', false], r: ['ладья', true], b: ['слон', false], n: ['конь', false], p: ['пешка', true],
};
const pieceName = (color: Color, type: PieceSymbol): string => {
  const [name, fem] = NAMES[type];
  return (color === 'w' ? (fem ? 'белая' : 'белый') : (fem ? 'чёрная' : 'чёрный')) + ' ' + name;
};

export function Piece({ color, type }: { color: Color; type: PieceSymbol }): JSX.Element | null {
  const render = defaultPieces[(color === 'w' ? 'w' : 'b') + type.toUpperCase()];
  return render ? render() : null;
}

export function Board(p: {
  chess: Chess;
  orientation: Color;
  /** Чьими фигурами можно ходить сейчас; null — смотреть. */
  movable: Color | null;
  lastMove: [string, string] | null;
  onMove: (from: Square, to: Square, promotion?: Promo) => void;
}): JSX.Element {
  const fen = p.chess.fen();
  const [sel, setSel] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  useEffect(() => { setSel(null); setPromo(null); }, [fen, p.movable]);

  const board = useMemo(() => p.chess.board(), [p.chess, fen]);
  const targets = useMemo(() => {
    const m = new Map<string, { capture: boolean; promotion: boolean }>();
    if (!sel) return m;
    for (const x of p.chess.moves({ square: sel, verbose: true })) {
      const prev = m.get(x.to);
      m.set(x.to, { capture: !!x.captured || !!prev?.capture, promotion: !!x.promotion || !!prev?.promotion });
    }
    return m;
  }, [p.chess, sel, fen]);
  const checkSq = useMemo(() => {
    if (!p.chess.inCheck()) return null;
    const turn = p.chess.turn();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const x = board[r][f];
      if (x && x.type === 'k' && x.color === turn) return x.square;
    }
    return null;
  }, [board, p.chess, fen]);

  const rows = p.orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cols = p.orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  const tap = (sq: Square) => {
    if (!p.movable || promo) return;
    const piece = p.chess.get(sq);
    if (sel && targets.has(sq)) {
      if (targets.get(sq)!.promotion) { setPromo({ from: sel, to: sq }); return; }
      p.onMove(sel, sq);
      setSel(null);
      return;
    }
    if (piece && piece.color === p.movable && p.chess.turn() === p.movable) {
      setSel(sel === sq ? null : sq);
      return;
    }
    setSel(null);
  };

  return (
    <div className="ch-board" role="grid" aria-label="Шахматная доска">
      {rows.map((r, ri) => (
        <div key={r} className="ch-rank" role="row">
          {cols.map((f, fi) => {
            const sq = (FILES[f] + (8 - r)) as Square;
            const x = board[r][f];
            const dark = (r + f) % 2 === 1;
            const t = targets.get(sq);
            const last = !!p.lastMove && (p.lastMove[0] === sq || p.lastMove[1] === sq);
            const cls = 'ch-sq' + (dark ? ' is-dark' : ' is-light') + (sel === sq ? ' is-sel' : '') + (last ? ' is-last' : '')
              + (checkSq === sq ? ' is-check' : '');
            const label = sq + (x ? ', ' + pieceName(x.color, x.type) : '') + (t ? (t.capture ? ', взять' : ', сюда можно') : '');
            return (
              <button key={sq} type="button" role="gridcell" className={cls} aria-label={label} onClick={() => tap(sq)}>
                {x && <span className="ch-pc"><Piece color={x.color} type={x.type} /></span>}
                {t && <i className={t.capture ? 'ch-ring' : 'ch-dot'} aria-hidden="true" />}
                {fi === 0 && <span className="ch-co ch-co--r" aria-hidden="true">{8 - r}</span>}
                {ri === 7 && <span className="ch-co ch-co--f" aria-hidden="true">{FILES[f]}</span>}
              </button>
            );
          })}
        </div>
      ))}
      {promo && (
        <div className="ch-promo" role="dialog" aria-label="Во что превратить пешку">
          <div className="ch-promo__box">
            {(['q', 'r', 'b', 'n'] as Promo[]).map((k) => (
              <button key={k} type="button" className="ch-promo__pc" aria-label={NAMES[k][0]}
                onClick={() => { const m = promo; setPromo(null); setSel(null); p.onMove(m.from, m.to, k); }}>
                <Piece color={p.movable || 'w'} type={k} />
              </button>
            ))}
            <button type="button" className="ch-promo__x" onClick={() => setPromo(null)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
