// Плавность экранов стека («Обсуждения», «Профиль»): новый экран мягко въезжает справа (is-push), экран,
// к которому вернулись «Назад», проявляется (is-back). Стили — shell/shell.css.
// Класс снимается, когда анимация закончилась: иначе она повторялась бы при каждом показе экрана
// (display:none → block заново запускает CSS-анимации).
// Сдвиг (transform) — только при открытии: тогда страница прокручена в самый верх, и закреплённая строка
// навигации внутри экрана не прыгает. При возврате прокрутка восстанавливается — там только прозрачность.
import { useLayoutEffect, useRef, useState } from 'react';
import type { AnimationEvent } from 'react';

export function useScreenAnim(hidden: boolean, pushOnMount: boolean): {
  className: string;
  onAnimationEnd: (e: AnimationEvent<HTMLElement>) => void;
} {
  const [anim, setAnim] = useState<'' | 'push' | 'back'>(pushOnMount && !hidden ? 'push' : '');
  const was = useRef(hidden);
  useLayoutEffect(() => {
    if (was.current && !hidden) setAnim('back');
    else if (hidden) setAnim('');
    was.current = hidden;
  }, [hidden]);
  return {
    className: anim ? ' is-' + anim : '',
    onAnimationEnd: (e) => { if (e.target === e.currentTarget) setAnim(''); },
  };
}

/** «Нравится»: сердце коротко подпрыгивает (класс is-pop снимается по окончании анимации). */
export function popOnce(el: HTMLElement): void {
  el.classList.remove('is-pop');
  void el.offsetWidth;   // перезапуск анимации при быстром повторном нажатии
  el.classList.add('is-pop');
  const done = (e: Event) => {
    if (e.target !== el.querySelector('svg')) return;
    el.classList.remove('is-pop');
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}
