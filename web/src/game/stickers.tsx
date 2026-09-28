// Стикеры чата стола — живые: у каждого свой ритм (огонь дрожит, смех раскачивается, сердце бьётся, корона падает
// и пружинит) и частицы вокруг (конфетти, искры, слёзы, пар, сердечки, купюры, блики). Всё — CSS-анимации transform
// и opacity: дёшево для телефона. Частицы разложены заранее детерминированно (одинаково у всех). «Меньше движения»
// в системе — стикер просто появляется (stickers.css). Список — как server/src/social/poker-table.js STICKERS.
import type { CSSProperties, JSX } from 'react';
import type { PokerSticker } from '../social/types';
import './stickers.css';

type Fx = 'confetti' | 'speed' | 'embers' | 'drops' | 'streams' | 'glint' | 'dots' | 'burst' | 'steam' | 'hearts'
  | 'claps' | 'sparkle' | 'bills' | 'marks' | 'ghost' | 'clover';

interface Def { id: PokerSticker; label: string; glyph?: string; text?: string; fx: Fx }

export const STICKER_LIST: readonly Def[] = [
  { id: 'gg', label: 'GG', text: 'GG', fx: 'confetti' },
  { id: 'allin', label: 'Олл-ин', text: 'ОЛЛ-ИН', fx: 'speed' },
  { id: 'fire', label: 'Огонь', glyph: '🔥', fx: 'embers' },
  { id: 'lol', label: 'Смешно', glyph: '😂', fx: 'drops' },
  { id: 'cry', label: 'Плачу', glyph: '😭', fx: 'streams' },
  { id: 'cool', label: 'Круто', glyph: '😎', fx: 'glint' },
  { id: 'think', label: 'Думаю', glyph: '🤔', fx: 'dots' },
  { id: 'shock', label: 'Шок', glyph: '😱', fx: 'burst' },
  { id: 'angry', label: 'Злюсь', glyph: '😤', fx: 'steam' },
  { id: 'love', label: 'Люблю', glyph: '❤️', fx: 'hearts' },
  { id: 'clap', label: 'Браво', glyph: '👏', fx: 'claps' },
  { id: 'crown', label: 'Король стола', glyph: '👑', fx: 'sparkle' },
  { id: 'money', label: 'Деньги', glyph: '💰', fx: 'bills' },
  { id: 'bluff', label: 'Блеф?', glyph: '😏', fx: 'marks' },
  { id: 'skull', label: 'Я всё', glyph: '💀', fx: 'ghost' },
  { id: 'lucky', label: 'Удача', glyph: '🍀', fx: 'clover' },
];
const BY_ID = new Map(STICKER_LIST.map((d) => [d.id, d]));
export const stickerLabel = (id: PokerSticker): string => BY_ID.get(id)?.label || '';

// ─── Частицы: координаты в долях размера стикера (--stk), задержки в мс ───

/** Детерминированный «случай» — у всех одинаковые частицы. */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}
type P = Record<string, string | number>;
const v = (o: P): CSSProperties => {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(o)) out['--' + k] = String(val);
  return out as CSSProperties;
};
const CONFETTI = ['#FFD60A', '#FF375F', '#64D2FF', '#30D158', '#BF5AF2', '#FF9F0A', '#fff'];

function parts(fx: Fx): JSX.Element[] {
  const r = rng(fx.length * 7919 + fx.charCodeAt(0) * 131);
  const out: JSX.Element[] = [];
  const add = (cls: string, o: P, text?: string) => out.push(<i key={out.length} className={cls} style={v(o)}>{text}</i>);
  switch (fx) {
    case 'confetti':
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + r() * 0.3;
        const d = 0.55 + r() * 0.4;
        add('stk-p stk-conf', { x: (Math.cos(a) * d).toFixed(3), y: (Math.sin(a) * d - 0.1).toFixed(3), r: Math.round(r() * 720 - 360) + 'deg',
          c: CONFETTI[i % CONFETTI.length], d: Math.round(120 + r() * 160) + 'ms', w: (0.05 + r() * 0.04).toFixed(3) });
      }
      break;
    case 'speed':
      for (let i = 0; i < 6; i++) add('stk-p stk-line', { y: (-0.3 + i * 0.12).toFixed(3), d: Math.round(i * 70 + r() * 60) + 'ms', l: (0.35 + r() * 0.35).toFixed(3) });
      break;
    case 'embers':
      for (let i = 0; i < 12; i++) {
        add('stk-p stk-ember', { x: (r() * 0.7 - 0.35).toFixed(3), y: (-0.55 - r() * 0.45).toFixed(3), d: Math.round(r() * 1400) + 'ms',
          s: (0.04 + r() * 0.05).toFixed(3), c: r() > 0.5 ? '#FFD60A' : '#FF9F0A' });
      }
      break;
    case 'drops':
      for (let i = 0; i < 10; i++) {
        const side = i % 2 ? 1 : -1;
        add('stk-p stk-drop', { x: (side * (0.45 + r() * 0.35)).toFixed(3), y: (-0.25 + r() * 0.45).toFixed(3),
          d: Math.round(300 + i * 110) + 'ms', r: side * Math.round(20 + r() * 40) + 'deg' });
      }
      break;
    case 'streams':
      for (let i = 0; i < 12; i++) {
        const side = i % 2 ? 1 : -1;
        add('stk-p stk-tear', { x: (side * 0.2).toFixed(3), sx: (side * (0.08 + r() * 0.14)).toFixed(3), d: Math.round(260 + Math.floor(i / 2) * 230) + 'ms' });
      }
      break;
    case 'glint':
      add('stk-p stk-shine', {});
      for (let i = 0; i < 3; i++) add('stk-p stk-star', { x: (0.2 + r() * 0.3).toFixed(3), y: (-0.4 + r() * 0.2).toFixed(3), d: Math.round(700 + i * 160) + 'ms', s: (0.1 + r() * 0.06).toFixed(3) }, '✦');
      break;
    case 'dots':
      add('stk-p stk-cloud', {});
      for (let i = 0; i < 3; i++) add('stk-p stk-dot', { i, d: Math.round(i * 180) + 'ms' });
      break;
    case 'burst':
      for (let i = 0; i < 14; i++) add('stk-p stk-ray', { a: Math.round((i / 14) * 360) + 'deg', d: Math.round(r() * 120) + 'ms', l: (0.14 + r() * 0.12).toFixed(3) });
      break;
    case 'steam':
      for (let i = 0; i < 8; i++) {
        const side = i % 2 ? 1 : -1;
        add('stk-p stk-puff', { x: (side * (0.38 + r() * 0.12)).toFixed(3), y: (-0.2 - r() * 0.1).toFixed(3),
          dx: (side * (0.25 + r() * 0.2)).toFixed(3), d: Math.round(Math.floor(i / 2) * 330 + r() * 80) + 'ms', s: (0.16 + r() * 0.1).toFixed(3) });
      }
      break;
    case 'hearts':
      for (let i = 0; i < 8; i++) {
        add('stk-p stk-heart', { x: (r() * 1.1 - 0.55).toFixed(3), y: (-0.6 - r() * 0.4).toFixed(3), d: Math.round(200 + i * 170) + 'ms',
          s: (0.16 + r() * 0.12).toFixed(3), r: Math.round(r() * 40 - 20) + 'deg' }, '❤️');
      }
      break;
    case 'claps':
      for (let k = 0; k < 3; k++) {
        for (let i = 0; i < 6; i++) add('stk-p stk-ray stk-ray--clap', { a: Math.round(-150 + i * 24 + r() * 8) + 'deg', d: Math.round(k * 380 + 180) + 'ms', l: (0.1 + r() * 0.06).toFixed(3) });
      }
      break;
    case 'sparkle':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const d = 0.5 + r() * 0.2;
        add('stk-p stk-star stk-star--tw', { x: (Math.cos(a) * d).toFixed(3), y: (Math.sin(a) * d * 0.8 - 0.05).toFixed(3),
          d: Math.round(500 + r() * 900) + 'ms', s: (0.1 + r() * 0.1).toFixed(3) }, '✦');
      }
      break;
    case 'bills':
      for (let i = 0; i < 7; i++) {
        const side = i % 2 ? 1 : -1;
        add('stk-p stk-bill', { x: (side * (0.3 + r() * 0.5)).toFixed(3), y: (-0.35 - r() * 0.35).toFixed(3), d: Math.round(260 + i * 140) + 'ms',
          r: side * Math.round(20 + r() * 50) + 'deg', s: (0.24 + r() * 0.08).toFixed(3) }, '💵');
      }
      break;
    case 'marks':
      for (let i = 0; i < 3; i++) add('stk-p stk-mark', { x: (0.3 + i * 0.16).toFixed(3), y: (-0.42 + i * 0.06).toFixed(3), d: Math.round(380 + i * 220) + 'ms', r: (i - 1) * 14 + 'deg' }, '?');
      break;
    case 'ghost':
      for (let i = 0; i < 2; i++) add('stk-p stk-echo', { d: Math.round(700 + i * 380) + 'ms' }, '💀');
      break;
    case 'clover':
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        add('stk-p stk-star stk-star--tw', { x: (Math.cos(a) * 0.62).toFixed(3), y: (Math.sin(a) * 0.52).toFixed(3), d: Math.round(420 + r() * 700) + 'ms', s: (0.09 + r() * 0.08).toFixed(3) }, '✦');
      }
      break;
  }
  return out;
}
const PARTS = new Map<Fx, JSX.Element[]>();
const partsOf = (fx: Fx) => { let p = PARTS.get(fx); if (!p) { p = parts(fx); PARTS.set(fx, p); } return p; };

/**
 * Стикер размером size px. play — проиграть анимацию (каждый новый key — заново); иначе — неподвижный (плитка в наборе,
 * старые строки чата). Для стола — size ≈ 104, в чате — 76, в наборе — 56.
 */
export function Sticker({ id, size = 96, play = true }: { id: PokerSticker; size?: number; play?: boolean }): JSX.Element | null {
  const d = BY_ID.get(id);
  if (!d) return null;
  return (
    <span className={'stk stk--' + d.id + ' stk-fx--' + d.fx + (play ? ' is-play' : '')} style={{ '--stk': size + 'px' } as CSSProperties}
      role="img" aria-label={d.label}>
      <span className="stk__glow" aria-hidden="true" />
      {play && <span className="stk__fx" aria-hidden="true">{partsOf(d.fx)}</span>}
      {d.text
        ? <span className="stk__txt" aria-hidden="true">{d.id === 'allin' && <i className="stk__chips"><b /><b /><b /></i>}{d.text}</span>
        : <span className="stk__g" aria-hidden="true">{d.glyph}</span>}
    </span>
  );
}
