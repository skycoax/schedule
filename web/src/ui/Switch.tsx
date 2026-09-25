// Переключатель iOS: <input type="checkbox" role="switch">. label — подпись для экранных чтецов.
import type { JSX } from 'react';
import './ui.css';

export function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }): JSX.Element {
  return (
    <span className={'ui-switch' + (p.disabled ? ' is-disabled' : '')}>
      <input
        id={p.id} type="checkbox" role="switch" className="ui-switch__input"
        checked={p.checked} disabled={p.disabled} aria-label={p.label}
        onChange={(e) => p.onChange(e.currentTarget.checked)}
      />
      <span className="ui-switch__track" aria-hidden="true"><span className="ui-switch__thumb" /></span>
    </span>
  );
}
