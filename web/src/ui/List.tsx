// Сгруппированный список в стиле Настроек iOS: секции со строками.
// Строка — кнопка (onClick), ссылка (href) или просто текст. Справа: значение, счётчик, trailing
// (переключатель, сегменты), шеврон или ↗ для внешней ссылки.
import type { JSX, ReactNode } from 'react';
import { Icon } from './icons';
import type { IconName } from './icons';
import './ui.css';

export function ListSection(p: { header?: string; footer?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="ui-list">
      {p.header && <h3 className="ui-list__head">{p.header}</h3>}
      <div className="ui-list__body">{p.children}</div>
      {p.footer && <div className="ui-list__foot">{p.footer}</div>}
    </section>
  );
}

export function ListRow(p: {
  label: ReactNode; value?: ReactNode; icon?: { name: IconName; color: string /* 'var(--c3)' */ };
  onClick?: (el: HTMLElement) => void; href?: string; external?: boolean; chevron?: boolean;
  tone?: 'default' | 'accent' | 'destructive'; badge?: number; disabled?: boolean; trailing?: ReactNode; ariaLabel?: string;
}): JSX.Element {
  const tone = p.tone ?? 'default';
  const trail = p.trailing !== undefined && p.trailing !== null && p.trailing !== false;
  const cls = 'ui-row ui-row--' + tone + (p.disabled ? ' is-disabled' : '') + (p.icon ? ' has-icon' : '')
    + (trail ? ' has-trail' : '');
  const chevron = p.chevron ?? (!!p.onClick || (!!p.href && !p.external));
  const badge = p.badge && p.badge > 0 ? (p.badge > 99 ? '99+' : String(p.badge)) : '';
  const inner = (
    <>
      {p.icon && (
        <span className="ui-row__icon" style={{ background: p.icon.color }} aria-hidden="true">
          <Icon name={p.icon.name} size={18} />
        </span>
      )}
      <span className="ui-row__main">
        <span className="ui-row__label">{p.label}</span>
        {p.value != null && p.value !== '' && <span className="ui-row__value">{p.value}</span>}
      </span>
      {badge && <span className="ui-row__badge">{badge}</span>}
      {trail && <span className="ui-row__trail">{p.trailing}</span>}
      {p.external
        ? <span className="ui-row__ext" aria-hidden="true">↗</span>
        : chevron && <Icon name="chevronRight" size={16} className="ui-row__chev" />}
      {p.external && <span className="ui-vh"> (откроется в новой вкладке)</span>}
    </>
  );
  if (p.href && !p.disabled) {
    return (
      <a
        className={cls} href={p.href} aria-label={p.ariaLabel}
        target={p.external ? '_blank' : undefined} rel={p.external ? 'noopener noreferrer' : undefined}
      >
        {inner}
      </a>
    );
  }
  if (p.onClick) {
    const onClick = p.onClick;
    return (
      <button
        type="button" className={cls} disabled={p.disabled} aria-label={p.ariaLabel}
        onClick={(e) => onClick(e.currentTarget)}
      >
        {inner}
      </button>
    );
  }
  return <div className={cls} aria-label={p.ariaLabel}>{inner}</div>;
}
