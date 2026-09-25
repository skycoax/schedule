// Экран запуска (#boot в index.html): орбита — тот же орб, что крутится при «потянуть, чтобы обновить»
// (thinking-orbs, пресет «composing», components/PullRefresh). Отдельный маленький файл сборки: грузится
// раньше основного и начинает крутиться почти сразу. Экран запуска убирает lib/boot.ts — тогда рисование
// останавливается само.
import { MODE_DRAWS, resolvePreset } from './lib/orbs';

type DrawFn = (ctx: CanvasRenderingContext2D, n: number, t: number, dark: boolean, opts: unknown) => void;

const boot = document.getElementById('boot');
const cv = boot && boot.querySelector('canvas');
const ctx = cv && cv.getContext ? cv.getContext('2d') : null;

if (boot && cv && ctx) {
  const preset = resolvePreset('composing', 64);
  const draw = (MODE_DRAWS as Record<string, DrawFn>)[preset.mode];
  const SIZE = 64;                                   // орб рисуется в квадрате 64 и растягивается до CSS-размера
  const css = cv.clientWidth || 112;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(css * dpr);
  cv.height = Math.round(css * dpr);
  const k = (css / SIZE) * dpr;
  let still = false;
  try { still = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* старый браузер */ }
  let t0 = 0;
  const frame = (now: number) => {
    if (!boot.isConnected) return;
    if (!t0) t0 = now;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    // Фон экрана запуска всегда чёрный — точки светлые.
    draw(ctx, SIZE, ((now - t0) / 1000) * preset.speed, true, preset.opts);
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
