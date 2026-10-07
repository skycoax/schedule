// Кинематографичные титры: слова проявляются из размытия по очереди, уходят мягко.
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { FPS } from './timeline';

export const FONT = '"Inter Display", "Inter", system-ui, sans-serif';
const out = Easing.bezier(0.16, 1, 0.3, 1);

export type Line = { text: string; size?: number; color?: string; weight?: number; gap?: number; tracking?: number };

export const Title: React.FC<{
  from: number; to: number;           // секунды (абсолютные)
  lines: Line[];
  x: number; y: number;               // точка привязки, px
  align?: 'left' | 'center' | 'right';
  stagger?: number;                    // кадров между словами
}> = ({ from, to, lines, x, y, align = 'left', stagger = 3 }) => {
  const f = useCurrentFrame();
  const f0 = Math.round(from * FPS), f1 = Math.round(to * FPS);
  if (f < f0 - 1 || f > f1 + 1) return null;
  const exit = interpolate(f, [f1 - 12, f1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  let wi = 0;
  const transform = align === 'center' ? 'translate(-50%, -50%)' : align === 'right' ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
  return (
    <div style={{
      position: 'absolute', left: x, top: y, transform, textAlign: align, fontFamily: FONT,
      opacity: 1 - exit, filter: exit > 0 ? `blur(${exit * 8}px)` : undefined, whiteSpace: 'nowrap',
    }}>
      {lines.map((ln, li) => (
        <div key={li} style={{
          fontSize: ln.size ?? 88, fontWeight: ln.weight ?? 600, color: ln.color ?? '#f5f5f7',
          letterSpacing: `${ln.tracking ?? -0.028}em`, lineHeight: 1.06, marginTop: li ? (ln.gap ?? 6) : 0,
        }}>
          {ln.text.split(' ').map((w, i) => {
            const s = f0 + (wi++) * stagger;
            const p = interpolate(f, [s, s + 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: out });
            return (
              <span key={i} style={{
                display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 0.32}em)`,
                filter: p < 1 ? `blur(${(1 - p) * 14}px)` : undefined, marginRight: '0.24em',
              }}>{w}</span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
