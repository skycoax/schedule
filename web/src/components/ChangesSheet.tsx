// «Правки» — нижний лист поверх расписания с неизменным журналом ChangesView.
// Закрывается «Готово», шторкой, тапом по затемнению, Esc и «Назад» (слой истории — внутри ui/Sheet).
import type { JSX } from 'react';
import type { ChangeEntry, Group } from '../types';
import { Sheet } from '../ui/Sheet';
import { ChangesView } from './ChangesView';
import '../shell/shell.css';

export function ChangesSheet({ open, group, changes, onClose }: {
  open: boolean; group: Group; changes: ChangeEntry[]; onClose: () => void;
}): JSX.Element | null {
  return (
    <Sheet open={open} onClose={onClose} variant="bottom" detent="large" title="Правки" className="sheet--changes">
      <ChangesView group={group} changes={changes} />
    </Sheet>
  );
}
