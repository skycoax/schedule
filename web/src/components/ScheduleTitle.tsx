// Большой заголовок расписания: группа (или преподаватель) с шевроном и строка «КФУ · Джизак · 1 курс».
// Нажатие на весь блок открывает выбор группы / преподавателя. Заменяет старый Header.
import type { JSX } from 'react';
import { brand } from '../brand';
import { LargeTitle } from '../shell/NavBar';

/** Короткое имя вуза для подзаголовков: «Расписание КФУ · Джизак» → «КФУ · Джизак». */
export function uniShort(): string {
  return brand.label.replace(/^Расписание\s+/i, '');
}

export function ScheduleTitle({ kind, title, subtitle, onPick }: {
  kind: 'group' | 'teacher'; title: string; subtitle: string; onPick: () => void;
}): JSX.Element {
  const aria = kind === 'teacher'
    ? `${title || 'Преподаватель'} — выбрать преподавателя`
    : `Группа ${title}${subtitle ? ', ' + subtitle : ''} — выбрать другую`;
  // Пока расписание грузится, вместо названия — бледное «Загрузка».
  if (!title) {
    return (
      <div className="ltitle-wait">
        <LargeTitle title="Загрузка" subtitle={subtitle || undefined} />
      </div>
    );
  }
  return <LargeTitle title={title} subtitle={subtitle || undefined} onClick={onPick} ariaLabel={aria} chevron />;
}
