// Pull-to-refresh с настоящим орбом (thinking-orbs, пресет «composing» → ribbon).
// Только на сенсорных экранах. Логика перенесена из старой страницы.
import { useEffect, useRef } from 'react';
import { resolvePreset, MODE_DRAWS } from '../lib/orbs';

export function PullRefresh({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const ptrRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    if (!('ontouchstart' in window)) return; // жест только пальцем
    const ptrEl = ptrRef.current!;
    const cv = canvasRef.current!;
    const spinEl = ptrEl.querySelector('.ptr__spin') as HTMLElement;
    const wrapEl = document.querySelector('.wrap') as HTMLElement | null;
    if (!cv || !wrapEl || !cv.getContext) return;

    const isDark = () => {
      const t = document.documentElement.getAttribute('data-theme');
      if (t === 'dark') return true;
      if (t === 'light') return false;
      return matchMedia('(prefers-color-scheme: dark)').matches;
    };

    const preset = resolvePreset('composing', 64);
    type DrawFn = (ctx: CanvasRenderingContext2D, n: number, t: number, dark: boolean, opts: unknown) => void;
    const draw = (MODE_DRAWS as Record<string, DrawFn>)[preset.mode];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 64 * dpr; cv.height = 64 * dpr;
    const ctx = cv.getContext('2d')!;
    let raf = 0, t0 = 0, baseT = 0;
    const paint = (t: number) => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, 64, 64); draw(ctx, 64, t, isDark(), preset.opts); };
    const frame = (now: number) => { raf = requestAnimationFrame(frame); if (!t0) t0 = now; paint(baseT + (now - t0) / 1000 * preset.speed); };
    const scrub = (px: number) => { if (raf) { cancelAnimationFrame(raf); raf = 0; } baseT = px * 0.02 * preset.speed; paint(baseT); };
    const startAnim = () => { if (!raf) { t0 = 0; raf = requestAnimationFrame(frame); } };
    const stopAnim = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

    const THRESH = 70, MAXPULL = 140, LOAD_GAP = 76;
    let pulling = false, refreshing = false, startY = 0, pull = 0;
    const orbTop = (p: number) => p / 2 - 32;
    const setPull = (p: number) => {
      pull = p;
      spinEl.style.opacity = String(Math.min(1, p / THRESH));
      spinEl.style.transform = 'translateY(' + orbTop(p) + 'px)';
      if (!refreshing) scrub(p);
      wrapEl.style.transform = p ? 'translateY(' + p + 'px)' : '';
    };
    const settle = () => {
      wrapEl.classList.add('is-snap'); ptrEl.classList.add('is-snap');
      spinEl.style.opacity = '1'; spinEl.style.transform = 'translateY(' + orbTop(LOAD_GAP) + 'px)';
      wrapEl.style.transform = 'translateY(' + LOAD_GAP + 'px)';
      setTimeout(() => { wrapEl.classList.remove('is-snap'); ptrEl.classList.remove('is-snap'); }, 280);
    };
    const collapse = () => {
      wrapEl.classList.add('is-snap'); ptrEl.classList.add('is-snap');
      pull = 0; spinEl.style.opacity = '0'; spinEl.style.transform = 'translateY(' + orbTop(0) + 'px)';
      wrapEl.style.transform = '';
      setTimeout(() => { wrapEl.classList.remove('is-snap'); ptrEl.classList.remove('is-snap'); spinEl.style.opacity = ''; spinEl.style.transform = ''; scrub(0); }, 280);
    };

    const onStart = (e: TouchEvent) => { if (refreshing || window.scrollY > 0) return; startY = e.touches[0].clientY; pulling = true; };
    const onMove = (e: TouchEvent) => {
      if (!pulling || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) { if (pull) setPull(0); return; }
      e.preventDefault();
      setPull(Math.min(MAXPULL, dy * 0.45));
    };
    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      if (pull >= THRESH && !refreshing) {
        refreshing = true; startAnim(); settle();
        const ts = Date.now();
        cbRef.current().finally(() => {
          setTimeout(() => { refreshing = false; stopAnim(); collapse(); }, Math.max(0, 700 - (Date.now() - ts)));
        });
      } else collapse();
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      stopAnim();
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove as EventListener);
      document.removeEventListener('touchend', onEnd);
    };
  }, []);

  return (
    <div className="ptr" ref={ptrRef} aria-hidden="true">
      <span className="ptr__spin"><canvas ref={canvasRef} className="ptr__orb" width={64} height={64} /></span>
    </div>
  );
}
