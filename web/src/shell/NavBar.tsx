// Верх экрана: закреплённая строка со стеклянными кнопками и затухание под статус-баром.
// Рисовать ТОЛЬКО пока экран-владелец виден (активная вкладка, верхний экран стека):
// строка fixed, и две строки на экране легли бы друг на друга.
// Слева обычно логотип (выбор вуза) или «Назад», в центре — сегменты или короткий
// заголовок, справа — действие экрана.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { JSX } from 'react';
import { brand } from '../brand';
import { RESELECT_EVENT, type TabId } from '../tabs';
import './shell.css';

/** Наверх страницы: плавно, а при «уменьшении движения» — сразу. */
export function scrollToTop(): void {
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
}

/** Повторное нажатие на уже открытую вкладку tab (событие para:reselect от оболочки). */
export function useReselect(tab: TabId, fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<TabId>).detail === tab) ref.current(); };
    window.addEventListener(RESELECT_EVENT, on);
    return () => window.removeEventListener(RESELECT_EVENT, on);
  }, [tab]);
}

// Большой заголовок на экране (LargeTitle) или шапка профиля с атрибутом data-nav-hero:
// пока они видны, короткий заголовок в строке не нужен.
const HERO = '.ltitle, [data-nav-hero]';
function heroVisible(): boolean {
  const list = document.querySelectorAll<HTMLElement>(HERO);
  for (const el of list) if (el.getClientRects().length > 0) return true;
  return false;
}

export function NavBar({ left, center, right, title }: {
  left?: ReactNode; center?: ReactNode; right?: ReactNode; title?: string;
}): JSX.Element {
  const [compact, setCompact] = useState(false);
  const [hero, setHero] = useState(true);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => {
      const y = window.scrollY;
      setCompact(y > 4);
      setScrolled(y > 48);
      if (title) setHero(heroVisible());
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    // Большой заголовок может появиться позже (профиль загрузился) — следим за страницей,
    // но не чаще раза в кадр и только пока в строке есть короткий заголовок.
    let raf = requestAnimationFrame(on);
    let mo: MutationObserver | null = null;
    if (title && typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setHero(heroVisible())); });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    }
    return () => { cancelAnimationFrame(raf); mo?.disconnect(); window.removeEventListener('scroll', on); };
  }, [title]);

  const hasRow = left != null || center != null || right != null || !!title;
  const titleOn = !hero || scrolled;
  let mid: ReactNode = center;
  if (mid == null && title) {
    mid = (
      <div className={'navtitle' + (titleOn ? ' is-on' : '')}
        {...(hero ? { 'aria-hidden': true } : { role: 'heading', 'aria-level': 1 })}>
        {title}
      </div>
    );
  }

  return (
    <>
      <div className={'topfade' + (compact ? ' is-compact' : '')} aria-hidden="true" />
      {hasRow && (
        <div className="navrow">
          <div>{left}</div>
          <div>{mid}</div>
          <div>{right}</div>
        </div>
      )}
    </>
  );
}

/** Круглая стеклянная кнопка 44×44 с иконкой. label — для экранных чтецов (иконка без текста). */
export function NavButton({ label, onClick, dot, haspopup, disabled, children }: {
  label: string; onClick: (el: HTMLElement) => void; dot?: boolean; haspopup?: 'menu' | 'dialog';
  disabled?: boolean; children: ReactNode;
}): JSX.Element {
  return (
    <button type="button" className="navbtn" aria-label={label} aria-haspopup={haspopup} disabled={disabled}
      onClick={(e) => onClick(e.currentTarget)}>
      {children}
      {dot && <span className="navbtn__dot" aria-hidden="true" />}
    </button>
  );
}

/** Текстовая кнопка в строке: «Готово», «Опубликовать» (filled — главное действие). */
export function NavTextButton({ children, onClick, variant = 'glass', disabled }: {
  children: string; onClick: () => void; variant?: 'glass' | 'filled'; disabled?: boolean;
}): JSX.Element {
  return (
    <button type="button" className={'navbtn navbtn--text' + (variant === 'filled' ? ' navbtn--filled' : '')}
      disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** «Назад» — круглая кнопка со стрелкой влево. */
export function BackButton({ onClick, label = 'Назад' }: { onClick: () => void; label?: string }): JSX.Element {
  return (
    <button type="button" className="navbtn" aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>
    </button>
  );
}

/** Пустое место 44×44 вместо кнопки — центр строки не съезжает. */
export function NavPlaceholder(): JSX.Element {
  return <span className="navbtn__ph" aria-hidden="true" />;
}

/**
 * Большой заголовок экрана (28–30 px, до двух строк) и подзаголовок в одну строку.
 * С onClick весь блок — кнопка; chevron приклеивается к последнему слову.
 */
export function LargeTitle({ title, subtitle, onClick, ariaLabel, chevron }: {
  title: string; subtitle?: string; onClick?: () => void; ariaLabel?: string; chevron?: boolean;
}): JSX.Element {
  const t = title.trim();
  const cut = t.lastIndexOf(' ');
  const head = cut > 0 ? t.slice(0, cut + 1) : '';
  const last = cut > 0 ? t.slice(cut + 1) : t;
  const text = chevron
    ? <>{head}<span className="ltitle__last">{last}<svg className="ltitle__chev" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" /></svg></span></>
    : t;
  return (
    <div className={'ltitle' + (onClick ? ' ltitle--btn' : '')}>
      <h1 className="ltitle__h">
        {onClick
          ? <button type="button" className="ltitle__btn" onClick={onClick} aria-label={ariaLabel}>{text}</button>
          : text}
      </h1>
      {subtitle && <div className="ltitle__sub">{subtitle}</div>}
    </div>
  );
}

/** Логотип слева в строке: открывает меню вузов (useUniversityMenu). */
export function UniLogoButton({ onOpen }: { onOpen: (el: HTMLElement) => void }): JSX.Element {
  const label = brand.hub ? `Para, ${brand.label} — выбрать вуз` : `${brand.university} — выбрать вуз`;
  return (
    <button type="button" className="navbtn" aria-label={label} aria-haspopup="menu"
      onClick={(e) => onOpen(e.currentTarget)}>
      <span className="hdr__logo" />
    </button>
  );
}
