// Эффекты стола: летящие фишки (ставка → перед игроком, ставки → банк, банк → победителю), плавно бегущие числа.
// Всё через Web Animations API поверх .pk (стол): элементы создаются на время полёта и убираются сами.
// С «Уменьшить движение» полётов нет, числа меняются сразу.
import { useEffect, useRef, useState } from 'react';
import { reducedMotion } from '../social/instants/motion';

const EASE = 'cubic-bezier(.2,.8,.2,1)';

function center(el: Element, root: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top };
}

/**
 * Полёт фишек от from к to внутри root (position: relative). n — сколько фишек (1–6 по сумме), delay — старт.
 * Резолвится, когда долетела последняя.
 */
export function flyChips(root: HTMLElement | null, from: Element | null, to: Element | null, amount: number, delay = 0): Promise<void> {
  if (!root || !from || !to || reducedMotion()) return Promise.resolve();
  const n = Math.max(1, Math.min(6, Math.round(Math.log2(Math.max(2, amount / 10)))));
  const a = center(from, root);
  const b = center(to, root);
  const dur = 520;
  const gap = 55;
  const anims: Animation[] = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i');
    el.className = 'pk-chip pk-chip--fly';
    const jx = (Math.random() - 0.5) * 14;
    const jy = (Math.random() - 0.5) * 10;
    el.style.left = a.x + 'px';
    el.style.top = a.y + 'px';
    root.appendChild(el);
    const anim = el.animate([
      { transform: 'translate(-50%,-50%) scale(.7)', opacity: 0, offset: 0 },
      { transform: 'translate(-50%,-50%) scale(1.05)', opacity: 1, offset: 0.18 },
      { transform: `translate(calc(-50% + ${b.x - a.x + jx}px), calc(-50% + ${b.y - a.y + jy}px)) scale(.9)`, opacity: 1, offset: 0.92 },
      { transform: `translate(calc(-50% + ${b.x - a.x + jx}px), calc(-50% + ${b.y - a.y + jy}px)) scale(.6)`, opacity: 0, offset: 1 },
    ], { duration: dur, delay: delay + i * gap, easing: EASE, fill: 'forwards' });
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
    anims.push(anim);
  }
  return new Promise((resolve) => {
    const last = anims[anims.length - 1];
    const done = () => resolve();
    last.addEventListener('finish', done, { once: true });
    last.addEventListener('cancel', done, { once: true });
  });
}

/** Число, которое бежит к новому значению за ms (банк, стек). Первое значение — сразу. */
export function useTween(value: number, ms = 600): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (reducedMotion() || Math.abs(value - from.current) < 1) { from.current = value; setShown(value); return; }
    const start = performance.now();
    const a = from.current;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(a + (value - a) * e);
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else from.current = value;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, ms]);
  return shown;
}

/** Короткая вибрация (Android; iOS её не даёт). */
export const buzz = (ms: number): void => { try { navigator.vibrate?.(ms); } catch { /* нет API */ } };
