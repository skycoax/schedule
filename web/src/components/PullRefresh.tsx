// Pull-to-refresh с настоящим орбом (thinking-orbs, пресет «composing» → ribbon).
// Только на сенсорных экранах. Логика перенесена из старой страницы.
// enabled — только у активной вкладки (иначе два экземпляра дерутся за одно касание);
// target — какой контейнер сдвигать вниз. Касания внутри открытых окон жест не начинают.
// Рисовалка орба (lib/orbs) грузится отдельным файлом сразу после показа — основной файл легче.
import { useEffect, useRef } from 'react';

// Внутри этих окон своя прокрутка: тянуть их список вниз — не «обновить страницу».
const IGNORE = '.sheet, .modal, .ui-sheet, .ui-as, .umenu, .pview, .rcmp, [data-no-ptr]';

type Orbs = typeof import('../lib/orbs');
let orbs: Promise<Orbs> | null = null;
const loadOrbs = () => (orbs ??= import('../lib/orbs').catch((e: unknown) => { orbs = null; throw e; }));

export function PullRefresh({ onRefresh, enabled = true, target = '.wrap' }: {
  onRefresh: () => Promise<void>; enabled?: boolean; target?: string;
}) {
  const ptrRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || !('ontouchstart' in window)) return; // жест только пальцем и только на активной вкладке
    let dispose: (() => void) | null = null;
    let cancelled = false;
    // Без рисовалки (нет сети при самом первом запуске) жест просто не включается.
    loadOrbs().then((m) => { if (!cancelled) dispose = attach(m); }).catch(() => {});
    return () => { cancelled = true; dispose?.(); };

    function attach({ resolvePreset, MODE_DRAWS }: Orbs): (() => void) | null {
      const ptrEl = ptrRef.current;
      const cv = canvasRef.current;
      if (!ptrEl || !cv || !cv.getContext) return null;
      const spinEl = ptrEl.querySelector('.ptr__spin') as HTMLElement;
      const wrapEl = document.querySelector(target) as HTMLElement | null;
      if (!wrapEl) return null;

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

      const onStart = (e: TouchEvent) => {
        if (refreshing || window.scrollY > 0) return;
        const t = e.target;
        if (t instanceof Element && t.closest(IGNORE)) return;
        startY = e.touches[0].clientY; pulling = true;
      };
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
          cbRef.current().catch(() => {}).finally(() => {
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
        // Вкладку сменили посреди жеста — вернуть контейнер на место.
        wrapEl.style.transform = '';
        wrapEl.classList.remove('is-snap');
      };
    }
  }, [enabled, target]);

  return (
    <div className="ptr" ref={ptrRef} aria-hidden="true">
      <span className="ptr__spin"><canvas ref={canvasRef} className="ptr__orb" width={64} height={64} /></span>
    </div>
  );
}
