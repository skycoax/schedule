// «Para» за столом: вместо робота — живой орб приложения (тот же, что на экране запуска и при «потянуть,
// чтобы обновить»), точки медленно вращаются в тёмном круге. С «Уменьшить движение» — один неподвижный кадр.
import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { MODE_DRAWS, resolvePreset } from '../lib/orbs';
import { reducedMotion } from '../social/instants/motion';

type DrawFn = (ctx: CanvasRenderingContext2D, n: number, t: number, dark: boolean, opts: unknown) => void;

const BOX = 64;          // орб рисуется в квадрате 64 и масштабируется
const FILL = 0.94;       // доля круга, которую занимает орб

/** Имя бота за столом и в текстах («Para забирает 30», «Ход: Para»). */
export const BOT_NAME = 'Para';

export function BotOrb({ size = 44 }: { size?: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
    if (!cv || !ctx) return;
    const preset = resolvePreset('composing', BOX);
    const draw = (MODE_DRAWS as Record<string, DrawFn>)[preset.mode];
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    const k = ((size * FILL) / BOX) * dpr;
    const off = ((size * (1 - FILL)) / 2) * dpr;
    const paint = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(k, 0, 0, k, off, off);
      // Стол всегда тёмный — точки светлые.
      draw(ctx, BOX, t, true, preset.opts);
    };
    if (reducedMotion()) { paint(1.4); return; }
    let raf = 0;
    let t0 = 0;
    const frame = (now: number) => {
      if (!t0) t0 = now;
      // Чуть медленнее, чем на экране запуска: за столом орб «дышит», а не грузится.
      paint(((now - t0) / 1000) * preset.speed * 0.6);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);
  return (
    <span className="pk-orb" style={{ width: size, height: size }} aria-hidden="true">
      <canvas ref={ref} style={{ width: size, height: size }} />
    </span>
  );
}
