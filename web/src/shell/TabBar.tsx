// Нижние вкладки Para: стеклянная капсула над нижним краем, иконка над подписью,
// у активной — тёмная «таблетка» и синий цвет (ux.md §3.1). Вкладок две или три
// (при SOCIAL_MODE=off «Обсуждений» нет) — капсула сужается.
// Клавиатура: ←/→ переключают вкладки, Home/End — первая/последняя (фокус «бегает» по вкладкам).
import { useRef } from 'react';
import type { CSSProperties, JSX, KeyboardEvent } from 'react';
import type { TabId } from '../tabs';
import { Icon, type IconName } from '../ui/icons';
import { Avatar } from '../social/ui/Avatar';
import './shell.css';

const LABEL: Record<TabId, string> = { schedule: 'Расписание', chat: 'Обсуждения', profile: 'Профиль' };
const ICON: Record<TabId, [IconName, IconName]> = {
  schedule: ['calendar', 'calendarFill'],
  chat: ['bubbles', 'bubblesFill'],
  profile: ['person', 'personFill'],
};
// Точка на вкладке дописывается к её названию для экранных чтецов.
const BADGE_TEXT: Partial<Record<TabId, string>> = {
  schedule: ', есть непросмотренные правки',
  profile: ', есть заявки в друзья',
};

export function TabBar(p: {
  tab: TabId; onSelect: (t: TabId) => void; hidden: boolean;
  items: TabId[];
  badges: Partial<Record<TabId, boolean>>;
  me: { id: number; name: string; avatar: string | null } | null;
}): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const index = p.items.indexOf(p.tab);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = p.items.length;
    if (!n) return;
    let i: number;
    if (e.key === 'ArrowRight') i = (Math.max(0, index) + 1) % n;
    else if (e.key === 'ArrowLeft') i = (Math.max(0, index) - 1 + n) % n;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    else return;
    e.preventDefault();
    const next = p.items[i];
    listRef.current?.querySelector<HTMLElement>('#tab-' + next)?.focus();
    if (next !== p.tab) p.onSelect(next);
  };

  const style = { '--n': p.items.length, '--i': Math.max(0, index) } as CSSProperties;

  return (
    <nav className={'tabbar' + (p.hidden ? ' is-hidden' : '')} aria-label="Разделы" inert={p.hidden} style={style}>
      <div className="tabbar__list" role="tablist" aria-label="Разделы" ref={listRef} onKeyDown={onKey}>
        {index >= 0 && <span className="tabbar__pill" aria-hidden="true" />}
        {p.items.map((id) => {
          const on = id === p.tab;
          const badge = !!p.badges[id];
          const avatar = id === 'profile' && p.me;
          return (
            <button
              key={id} type="button" role="tab" id={'tab-' + id} aria-controls={'panel-' + id}
              aria-selected={on} tabIndex={on ? 0 : -1}
              className={'tabbar__item' + (on ? ' is-on' : '')}
              onClick={() => p.onSelect(id)}
            >
              <span className="tabbar__ico">
                {avatar
                  ? <Avatar user={p.me} size={26} ring={on} />
                  : <Icon name={ICON[id][on ? 1 : 0]} size={24} />}
                {badge && <span className={'tabbar__dot tabbar__dot--' + id} aria-hidden="true" />}
              </span>
              <span className="tabbar__lbl">{LABEL[id]}</span>
              {avatar && p.me && <span className="ui-vh">, {p.me.name}</span>}
              {badge && BADGE_TEXT[id] && <span className="ui-vh">{BADGE_TEXT[id]}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
