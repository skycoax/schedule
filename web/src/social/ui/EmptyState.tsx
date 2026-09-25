// Пустое состояние: значок, заголовок, текст и одна кнопка (ux.md §5.14).
import type { JSX } from 'react';
import { Icon } from '../../ui/icons';
import type { IconName } from '../../ui/icons';
import { Button } from '../../ui/Button';
import './social-ui.css';

export function EmptyState(p: { icon?: IconName; title: string; text?: string; action?: { label: string; onClick: () => void } }): JSX.Element {
  return (
    <div className="empty-st">
      {p.icon && <span className="empty-st__icon" aria-hidden="true"><Icon name={p.icon} size={30} /></span>}
      <p className="empty-st__title">{p.title}</p>
      {p.text && <p className="empty-st__text">{p.text}</p>}
      {p.action && (
        <div className="empty-st__act">
          <Button variant="filled" size={44} full onClick={p.action.onClick}>{p.action.label}</Button>
        </div>
      )}
    </div>
  );
}
