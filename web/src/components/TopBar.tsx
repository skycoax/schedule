// Верх экрана как в Telegram: контент не обрывается о статус-бар, а мягко уходит
// под него (затухание + лёгкое размытие), а когда большой заголовок уехал вверх —
// появляется закреплённая компактная шапка: логотип (выбор вуза) и название
// группы (выбор группы) — две разные кнопки, а не две одинаковые.
import { useEffect, useState } from 'react';

export function TopBar({ name, onPick, onUniversities }: {
  name: string; onPick: () => void; onUniversities: (el: HTMLElement) => void;
}) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    // 56px — большой заголовок к этому моменту почти скрылся.
    const on = () => setCompact(window.scrollY > 56);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <>
      <div className={'topfade' + (compact ? ' is-compact' : '')} aria-hidden="true" />
      <div className={'cbar' + (compact ? ' is-on' : '')} inert={!compact}>
        <button className="cbar__logo" onClick={(e) => onUniversities(e.currentTarget)} aria-label="Выбрать вуз" aria-haspopup="menu">
          <span className="hdr__logo" />
        </button>
        <button className="cbar__title" onClick={onPick} aria-label={`Группа ${name} — выбрать другую`}>
          <span className="cbar__name">{name}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
    </>
  );
}
