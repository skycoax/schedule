// Анимации экранов моментов: как экран появляется (класс ix--zoom | up | push | back, см. instants.css) и
// плавное закрытие — сначала класс is-leaving (обратная анимация), через ~230 мс экран убирается.
import { useCallback, useEffect, useRef, useState } from 'react';

export type IxAnim = 'zoom' | 'up' | 'push' | 'back';

const LEAVE_MS = 230;

export const reducedMotion = (): boolean => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Класс корня экрана: как он появился и уходит ли. */
export const ixMotion = (anim: IxAnim, leaving: boolean): string => 'ix--' + anim + (leaving ? ' is-leaving' : '');

/** [уходит ли экран, закрыть с анимацией]. Повторные вызовы во время ухода ничего не делают. */
export function useLeave(onDone: () => void): [boolean, () => void] {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const busy = useRef(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const leave = useCallback(() => {
    if (busy.current) return;
    if (reducedMotion()) { done.current(); return; }
    busy.current = true;
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      busy.current = false;
      setLeaving(false);
      done.current();
    }, LEAVE_MS);
  }, []);
  return [leaving, leave];
}

/** Точка, откуда «вырастает» экран (карточка у края), — в CSS-переменные --ix-ox/--ix-oy. */
export function setIxOrigin(el: Element | null): void {
  const s = document.documentElement.style;
  if (!el) { s.removeProperty('--ix-ox'); s.removeProperty('--ix-oy'); return; }
  const r = el.getBoundingClientRect();
  s.setProperty('--ix-ox', Math.round(r.left + Math.min(r.width, window.innerWidth - r.left) / 2) + 'px');
  s.setProperty('--ix-oy', Math.round(r.top + r.height / 2) + 'px');
}
