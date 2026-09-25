// Темы постов чипами: в ленте — фильтр («Все» + шесть тем), в составителе — обязательный выбор одной.
// Существующие .chips/.chip из index.css; .cats растягивает ряд до краёв экрана и даёт чипам зону 44 px.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { JSX } from 'react';
import { CATEGORIES } from '../types';
import type { CategoryId } from '../types';
import './chat.css';

export function CategoryChips(p: {
  value: CategoryId | '' | null;
  onChange: (v: CategoryId | '') => void;
  /** Первый чип «Все» (value ''). */
  all?: boolean;
  label: string;
  invalid?: boolean;
  id?: string;
  describedBy?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  // Выбранный чип (например, восстановленный из sessionStorage) должен быть виден в ряду —
  // и после смены ширины (поворот экрана).
  const reveal = () => {
    const row = ref.current;
    const el = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !el || !row.clientWidth) return;
    const left = el.offsetLeft - 16;
    const right = el.offsetLeft + el.offsetWidth + 16;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useLayoutEffect(() => revealRef.current(), [p.value]);
  useEffect(() => {
    const row = ref.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    let w = row.clientWidth;
    const ro = new ResizeObserver(() => { if (row.clientWidth !== w) { w = row.clientWidth; revealRef.current(); } });
    ro.observe(row);
    return () => ro.disconnect();
  }, []);

  const sel = p.value || '';
  return (
    <div
      ref={ref} id={p.id} className={'chips cats' + (p.invalid ? ' is-invalid' : '')}
      role="group" aria-label={p.label} aria-describedby={p.describedBy}
    >
      {p.all && (
        <button type="button" className="chip" aria-pressed={sel === ''} onClick={() => p.onChange('')}>Все</button>
      )}
      {CATEGORIES.map((c) => (
        <button key={c.id} type="button" className="chip" aria-pressed={sel === c.id} onClick={() => p.onChange(c.id)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}
