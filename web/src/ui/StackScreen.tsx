// Экран стека вкладки (ветка, профиль, настройки…): при открытии мягко въезжает, при возврате проявляется.
import type { JSX, ReactNode } from 'react';
import { useScreenAnim } from './screen-anim';

export function StackScreen({ className, hidden, children }: {
  className: string; hidden: boolean; children: ReactNode;
}): JSX.Element {
  const a = useScreenAnim(hidden, true);
  return <div className={className + a.className} hidden={hidden} onAnimationEnd={a.onAnimationEnd}>{children}</div>;
}
