// Лист поверх экрана: нижний (bottom, со шторкой и затемнением) или во весь экран (full).
// Портал в body, role="dialog" aria-modal. Фокус заходит внутрь, не выходит по Tab и возвращается
// к кнопке, открывшей лист. Прокрутка страницы под листом заблокирована (со счётчиком — листов может
// быть несколько). Закрытие: затемнение, Esc, «Назад» (слой истории), потянуть вниз — если dismissible.
// После закрытия лист ещё ~0,2 с доигрывает анимацию ухода (без фокуса и нажатий).
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLayer } from './layers';
import './ui.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  variant: 'bottom' | 'full';
  /** Только bottom: высота до 55dvh | 92dvh (по умолчанию large). */
  detent?: 'medium' | 'large';
  /** 17/600 по центру полосы листа. */
  title?: string;
  left?: ReactNode;
  /** bottom по умолчанию — «Готово» (закрывает). null — ничего. */
  right?: ReactNode;
  /** По умолчанию true: затемнение, свайп вниз, Esc, «Назад». */
  dismissible?: boolean;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}

const EXIT_MS = 230;
const EXIT_MS_REDUCED = 130;
const DRAG_START = 8;         // px: движение меньше — ещё не перетаскивание
const DRAG_CLOSE = 100;       // px: отпустили ниже — закрываем
const DRAG_VELOCITY = 0.6;    // px/мс: или смахнули быстро

let locks = 0;
/** Страница под окном не прокручивается (счётчик: листы и оверлей игры «Код» делят его). */
export function lockScroll(): void {
  if (locks++ === 0) document.documentElement.classList.add('ui-lock');
}
export function unlockScroll(): void {
  locks = Math.max(0, locks - 1);
  if (locks === 0) document.documentElement.classList.remove('ui-lock');
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Есть ли между target и листом прокрученный вниз блок — тогда жест принадлежит ему. */
function scrolledInside(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el instanceof HTMLElement && el.scrollTop > 0) return true;
  }
  return false;
}

export function Sheet(p: SheetProps): JSX.Element | null {
  const dismissible = p.dismissible !== false;
  const bottom = p.variant === 'bottom';
  const ref = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(p.onClose);
  onCloseRef.current = p.onClose;

  // mounted держит лист на экране, пока доигрывает анимация ухода.
  const [mounted, setMounted] = useState(p.open);
  if (p.open && !mounted) setMounted(true);
  const leaving = !p.open && mounted;
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setMounted(false), reducedMotion() ? EXIT_MS_REDUCED : EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  useLayer(p.open && dismissible, p.onClose);

  // Блокировка прокрутки и возврат фокуса.
  useLayoutEffect(() => {
    if (!p.open) return;
    const opener = document.activeElement as HTMLElement | null;
    lockScroll();
    return () => {
      unlockScroll();
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') {
        try { opener.focus({ preventScroll: true }); } catch { /* элемент уже не в документе */ }
      }
    };
  }, [p.open]);

  // Фокус внутрь листа (сам лист, не первое поле: иначе на телефоне сразу выскочит клавиатура).
  useEffect(() => {
    if (!p.open) return;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [p.open]);

  // Потянуть нижний лист вниз — закрыть (когда содержимое прокручено к началу).
  useEffect(() => {
    if (!p.open || !bottom || !dismissible) return;
    const sheet = ref.current;
    if (!sheet) return;
    // Открыли снова, пока доигрывал уход после свайпа, — убираем следы перетаскивания.
    sheet.style.transform = '';
    sheet.style.transition = '';
    if (scrimRef.current) { scrimRef.current.style.opacity = ''; scrimRef.current.style.transition = ''; }
    let eligible = false;
    let dragging = false;
    let x0 = 0, y0 = 0, origin = 0, off = 0, lastY = 0, lastT = 0, vel = 0;

    const setScrim = (v: string) => { if (scrimRef.current) scrimRef.current.style.opacity = v; };
    const reset = () => {
      sheet.style.transition = 'transform 260ms cubic-bezier(.2,.85,.3,1)';
      sheet.style.transform = '';
      if (scrimRef.current) scrimRef.current.style.transition = 'opacity 260ms ease';
      setScrim('');
    };

    const onStart = (e: TouchEvent) => {
      dragging = false;
      // Поля ввода не тянут лист (в них выделяют текст), кроме полосы с заголовком и шторки.
      const t0 = e.target instanceof Element ? e.target : null;
      const onBar = !!t0?.closest('.ui-sheet__grab, .ui-sheet__bar');
      eligible = e.touches.length === 1 && (onBar || (!scrolledInside(e.target, sheet)
        && !t0?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-no-drag]')));
      if (!eligible) return;
      const t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY; lastY = y0; lastT = e.timeStamp; vel = 0; off = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!eligible) return;
      const t = e.touches[0];
      if (!dragging) {
        const dy = t.clientY - y0, dx = t.clientX - x0;
        if (dy < -DRAG_START || Math.abs(dx) > DRAG_START) { eligible = false; return; }
        if (dy < DRAG_START || dy < Math.abs(dx)) return;
        dragging = true;
        origin = t.clientY;
        sheet.style.transition = 'none';
        if (scrimRef.current) scrimRef.current.style.transition = 'none';
      }
      if (e.cancelable) e.preventDefault();
      off = Math.max(0, t.clientY - origin);
      const dt = e.timeStamp - lastT;
      if (dt > 0) vel = 0.7 * ((t.clientY - lastY) / dt) + 0.3 * vel;
      lastY = t.clientY; lastT = e.timeStamp;
      sheet.style.transform = 'translateY(' + off + 'px)';
      setScrim(String(Math.max(0, 1 - off / Math.max(1, sheet.offsetHeight))));
    };
    const onEnd = () => {
      if (!dragging) { eligible = false; return; }
      dragging = false;
      eligible = false;
      if (off > DRAG_CLOSE || vel > DRAG_VELOCITY) {
        sheet.style.transition = 'transform 200ms cubic-bezier(.4,0,1,1)';
        sheet.style.transform = 'translateY(100%)';
        if (scrimRef.current) scrimRef.current.style.transition = 'opacity 200ms ease';
        setScrim('0');
        onCloseRef.current();
      } else {
        reset();
      }
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, [p.open, bottom, dismissible]);

  if (!p.open && !mounted) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (leaving) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (dismissible) onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) { e.preventDefault(); el.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const right = p.right !== undefined ? p.right : bottom
    ? <button type="button" className="ui-sheet__done" onClick={() => onCloseRef.current()}>Готово</button>
    : null;
  const hasBar = !!(p.title || p.left || right);
  const labelledBy = p.labelledBy || (p.title ? titleId : undefined);

  const cls = 'ui-sheet ui-sheet--' + p.variant
    + (bottom ? ' ui-sheet--' + (p.detent ?? 'large') : '')
    + (hasBar ? '' : ' ui-sheet--nobar')
    + (p.className ? ' ' + p.className : '');

  return createPortal(
    <div
      className={'ui-layer' + (bottom ? ' ui-layer--bottom' : ' ui-layer--full') + (leaving ? ' is-leaving' : '')}
      inert={leaving || undefined}
    >
      {bottom && (
        <div
          ref={scrimRef} className="ui-scrim" aria-hidden="true"
          onClick={dismissible && !leaving ? () => onCloseRef.current() : undefined}
        />
      )}
      <div
        ref={ref} className={cls} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        tabIndex={-1} onKeyDown={onKeyDown}
      >
        {bottom && <div className="ui-sheet__grab" aria-hidden="true" />}
        {hasBar && (
          <div className="ui-sheet__bar">
            <div className="ui-sheet__side ui-sheet__side--l">{p.left}</div>
            {p.title ? <h2 id={titleId} className="ui-sheet__title">{p.title}</h2> : <span className="ui-sheet__title" />}
            <div className="ui-sheet__side ui-sheet__side--r">{right}</div>
          </div>
        )}
        <div className="ui-sheet__body">{p.children}</div>
      </div>
    </div>,
    document.body,
  );
}
