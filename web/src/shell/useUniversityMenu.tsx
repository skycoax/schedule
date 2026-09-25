// Меню вузов (существующий UniversityMenu), привязанное к нажатой кнопке. Одно на экран:
// логотип в строке расписания, «Обсуждений», строка «Вуз» в «Профиле».
// Если кнопка ниже верхних 45 % экрана (строка в списке настроек), меню встаёт у верха,
// под строкой навигации, — иначе ему не хватит места вниз.
// Открытое меню — слой истории (ui/layers): «Назад» закрывает меню, а не уходит с экрана.
// Переход на другой вуз сначала убирает запись меню из истории: иначе после перехода
// «Назад» вёл бы в пустую запись, и возвращаться пришлось бы дважды.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import { UniversityMenu, type MenuAnchor } from '../components/UniversityMenu';
import { pushLayer } from '../ui/layers';

const MENU_MAX = 344;

function anchorFor(el: HTMLElement): MenuAnchor {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const width = Math.min(MENU_MAX, vw - 24);
  const left = Math.max(12, Math.min(r.left, vw - width - 12));
  if (r.bottom + 8 <= vh * 0.45) return { top: r.bottom + 8, left };
  let navBottom = 60;
  for (const row of document.querySelectorAll<HTMLElement>('.navrow')) {
    const b = row.getBoundingClientRect();
    if (b.height > 0) { navBottom = b.bottom; break; }
  }
  return { top: Math.max(navBottom + 8, Math.round(vh * 0.18)), left };
}

export function useUniversityMenu(): { open: (el: HTMLElement) => void; element: JSX.Element | null } {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const open = useCallback((el: HTMLElement) => setAnchor(anchorFor(el)), []);
  const isOpen = !!anchor;

  // Слой истории, пока меню открыто: «Назад» (Android, браузер) закрывает его.
  const dropLayer = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let popped = false;
    const closeLayer = pushLayer('umenu', () => { popped = true; setAnchor(null); });
    dropLayer.current = () => (popped ? Promise.resolve() : closeLayer());
    return () => {
      dropLayer.current = null;
      if (!popped) void closeLayer();
    };
  }, [isOpen]);

  // Выбрали другой вуз: закрываем меню, ждём, пока его запись уйдёт из истории, и переходим.
  const onClickCapture = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest?.('a.umenu__row') as HTMLAnchorElement | null;
    if (!a || a.getAttribute('aria-checked') === 'true') return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const href = a.href;
    const go = () => { location.assign(href); };
    const drop = dropLayer.current;
    const dropped = drop ? drop() : Promise.resolve();
    // Меню закрываем сразу: страница может вернуться из кэша «Назад» — уже без меню.
    setAnchor(null);
    void dropped.then(go, go);
  }, []);

  return {
    open,
    element: anchor
      ? <div style={{ display: 'contents' }} onClickCapture={onClickCapture}>
          <UniversityMenu anchor={anchor} onClose={close} />
        </div>
      : null,
  };
}
