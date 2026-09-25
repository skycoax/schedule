// Верхняя строка расписания: логотип (меню вузов) · «Сегодня | Неделя» · «Правки».
// В режиме преподавателя правок нет — справа пустое место, чтобы сегменты стояли по центру.
import type { JSX } from 'react';
import { NavBar, NavButton, NavPlaceholder, UniLogoButton } from '../shell/NavBar';
import { Segmented } from '../ui/Segmented';

type View = 'today' | 'week';
const VIEWS: { value: View; label: string }[] = [{ value: 'today', label: 'Сегодня' }, { value: 'week', label: 'Неделя' }];

export function ScheduleNav({ view, onView, onUniversities, changes }: {
  view: View; onView: (v: View) => void; onUniversities: (el: HTMLElement) => void;
  changes?: { unseen: boolean; onOpen: () => void };
}): JSX.Element {
  return (
    <NavBar
      left={<UniLogoButton onOpen={onUniversities} />}
      center={
        <div className="navseg">
          <Segmented variant="glass" asTabs controls="sched-view" ariaLabel="Вид расписания"
            value={view} options={VIEWS} onChange={onView} />
        </div>
      }
      right={changes
        ? (
          <NavButton label={changes.unseen ? 'Правки расписания — есть новые' : 'Правки расписания'}
            haspopup="dialog" dot={changes.unseen} onClick={() => changes.onOpen()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3.5 4.5v4h4" /><path d="M12 7.5V12l3 2" />
            </svg>
          </NavButton>
        )
        : <NavPlaceholder />}
    />
  );
}
