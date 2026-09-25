// Экранная клавиатура. Вызывать ОДИН раз (AppShell). Пишет на <html>:
//   --kb (px) — на сколько клавиатура закрывает низ экрана (iOS и запасной путь; Chrome на Android
//   с interactive-widget=resizes-content сам уменьшает окно, и --kb остаётся около 0);
//   --vv-fix (px) — поправку для закреплённых элементов при ошибке iOS (см. ниже), иначе её нет.
// Пока клавиатура открыта, скрывает панель вкладок (причина 'keyboard'). На компьютере (мышь,
// без экранной клавиатуры) фокус в поле панель не прячет.
//
// Ошибка iOS 26–27 (WebKit, FB19889436, bugs.webkit.org/297779): после того как клавиатура закрылась,
// visualViewport остаётся меньше окна, и закреплённые элементы рисуются со сдвигом — шапка посреди
// экрана, вкладки за нижним краем; величина сдвига меняется с направлением прокрутки. Сдвиг равен
// innerHeight − visualViewport.height − offsetTop — той же величине, что при открытой клавиатуре
// показывает её высоту. Без клавиатуры (фокус не в поле) она бывает не 0 только в этой ошибке —
// тогда index.css сдвигает закреплённые элементы обратно на --vv-fix.
import { useEffect, useState } from 'react';
import { useHideTabBar } from './bar';

const TYPING = 'input:not([type=checkbox],[type=radio],[type=range],[type=file],[type=button],[type=submit],[type=reset],[type=color]), textarea, [contenteditable=""], [contenteditable=true]';

function typing(): boolean {
  const el = document.activeElement;
  return !!el && el !== document.body && el.matches(TYPING) && !(el as HTMLInputElement).readOnly;
}

function touchDevice(): boolean {
  try { return matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

/** Страница оттянута за край (пружина iOS): offsetTop в это время скачет — поправку не трогаем. */
function overscrolled(): boolean {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return window.scrollY < 0 || window.scrollY > max + 1;
}

export function useKeyboardWatcher(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const touch = touchDevice();
    let timer = 0;
    let frame = 0;
    let lastKb = -1;
    let lastFix = 0;

    const measure = () => {
      frame = 0;
      const t = typing();
      // При увеличении пальцами visualViewport тоже меньше окна — это не клавиатура и не ошибка.
      const gap = vv && vv.scale <= 1.05 ? Math.round(window.innerHeight - vv.height - vv.offsetTop) : 0;
      const kb = t ? Math.max(0, gap) : 0;
      if (kb !== lastKb) {
        lastKb = kb;
        root.style.setProperty('--kb', kb + 'px');
      }
      if (!overscrolled()) {
        const fix = !t && Math.abs(gap) >= 2 ? -gap : 0;
        if (fix !== lastFix) {
          lastFix = fix;
          if (fix) root.style.setProperty('--vv-fix', fix + 'px');
          else root.style.removeProperty('--vv-fix');
        }
      }
      const small = !!vv && vv.height < window.innerHeight * 0.75;
      setOpen(t && (touch || (small && kb > 0)));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const onFocusIn = () => { clearTimeout(timer); measure(); };
    // После ухода фокуса ждём 60 мс: фокус может перейти в соседнее поле. Клавиатура закрылась —
    // прокрутка «на месте» просит iOS заново расставить закреплённые элементы.
    const onFocusOut = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        measure();
        if (!typing()) window.scrollTo(window.scrollX, window.scrollY);
      }, 60);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    // При ошибке iOS сдвиг меняется с прокруткой страницы, а visualViewport об этом не всегда сообщает.
    window.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      root.style.removeProperty('--kb');
      root.style.removeProperty('--vv-fix');
    };
  }, []);

  useHideTabBar(open, 'keyboard');
  return open;
}
