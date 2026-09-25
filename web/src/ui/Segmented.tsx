// Сегменты: glass — капсула в верхнем ряду («Сегодня | Неделя»), inset — как в Настройках iOS.
// asTabs — роль tablist (с controls → aria-controls), иначе radiogroup. Стрелки влево/вправо переключают.
// Выбранный сегмент подсвечивает одна «таблетка», которая переезжает между сегментами.
import { useLayoutEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import './ui.css';

export function Segmented<T extends string>(p: {
  value: T; options: { value: T; label: string; badge?: number; disabled?: boolean }[]; onChange: (v: T) => void;
  ariaLabel: string; variant?: 'glass' | 'inset'; asTabs?: boolean; controls?: string;
}): JSX.Element {
  const variant = p.variant ?? 'inset';
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const selIndex = p.options.findIndex((o) => o.value === p.value);
  const shape = p.options.map((o) => o.label + '|' + (o.badge || 0)).join('~');

  // Меряем выбранный сегмент (и при каждом изменении размеров — например, вкладка стала видимой).
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const b = root.querySelectorAll<HTMLElement>('.ui-seg__btn')[selIndex];
      if (!b || !b.offsetWidth) { setThumb(null); return; }
      const next = { x: b.offsetLeft, w: b.offsetWidth };
      setThumb((prev) => (prev && prev.x === next.x && prev.w === next.w ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [selIndex, shape]);

  const enabled = p.options.filter((o) => !o.disabled);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    if (!enabled.length) return;
    let i = enabled.findIndex((o) => o.value === p.value);
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = enabled.length - 1;
    else i = (i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
    const next = enabled[i];
    if (next.value !== p.value) p.onChange(next.value);
    const btns = ref.current?.querySelectorAll<HTMLButtonElement>('.ui-seg__btn');
    btns?.[p.options.indexOf(next)]?.focus();
  };

  // Ни один сегмент не выбран (value вне списка) — фокус по Tab на первый доступный.
  const focusIndex = selIndex >= 0 ? selIndex : p.options.findIndex((o) => !o.disabled);

  return (
    <div
      ref={ref} className={'ui-seg ui-seg--' + variant + (thumb ? ' has-thumb' : '')}
      role={p.asTabs ? 'tablist' : 'radiogroup'} aria-label={p.ariaLabel} onKeyDown={onKey}
    >
      {thumb && (
        <span
          className="ui-seg__thumb" aria-hidden="true"
          style={{ width: thumb.w, transform: 'translateX(' + thumb.x + 'px)' }}
        />
      )}
      {p.options.map((o, i) => {
        const sel = o.value === p.value;
        const badge = o.badge && o.badge > 0 ? (o.badge > 99 ? '99+' : String(o.badge)) : '';
        return (
          <button
            key={o.value} type="button"
            className={'ui-seg__btn' + (sel ? ' is-sel' : '')}
            role={p.asTabs ? 'tab' : 'radio'}
            aria-selected={p.asTabs ? sel : undefined}
            aria-checked={p.asTabs ? undefined : sel}
            aria-controls={p.asTabs ? p.controls : undefined}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={o.disabled}
            onClick={() => { if (!sel) p.onChange(o.value); }}
          >
            <span className="ui-seg__label">{o.label}</span>
            {badge && <span className="ui-seg__badge">{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
