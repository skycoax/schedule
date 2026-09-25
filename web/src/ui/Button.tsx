// Кнопка в стиле iOS: filled (синяя), tinted (светло-синяя), plain (текстом), destructive, destructive-filled.
import type { JSX, ReactNode } from 'react';
import { Spinner } from './Spinner';
import './ui.css';

export function Button(p: {
  children: ReactNode; onClick?: () => void;
  variant?: 'filled' | 'tinted' | 'plain' | 'destructive' | 'destructive-filled';
  size?: 32 | 44 | 50; full?: boolean; disabled?: boolean; busy?: boolean; type?: 'button' | 'submit';
  ariaLabel?: string; className?: string;
}): JSX.Element {
  const variant = p.variant ?? 'filled';
  const size = p.size ?? 44;
  const cls = 'ui-btn ui-btn--' + variant + ' ui-btn--' + size + (p.full ? ' ui-btn--full' : '')
    + (p.busy ? ' is-busy' : '') + (p.className ? ' ' + p.className : '');
  return (
    <button
      type={p.type ?? 'button'} className={cls} onClick={p.onClick}
      disabled={p.disabled || p.busy} aria-busy={p.busy || undefined} aria-label={p.ariaLabel}
    >
      <span className="ui-btn__label">{p.children}</span>
      {p.busy && <span className="ui-btn__spin"><Spinner size={18} /></span>}
    </button>
  );
}
