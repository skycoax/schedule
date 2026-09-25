// Экранная клавиатура. Вызывать ОДИН раз (AppShell). Пишет --kb (px) на <html> — на сколько клавиатура
// закрывает низ экрана (iOS и запасной путь; Chrome на Android с interactive-widget=resizes-content сам
// уменьшает окно, и --kb остаётся около 0), и, пока клавиатура открыта, скрывает панель вкладок
// (причина 'keyboard'). На компьютере (мышь, без экранной клавиатуры) фокус в поле панель не прячет.
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

export function useKeyboardWatcher(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const touch = touchDevice();
    let timer = 0;
    let lastKb = -1;

    const measure = () => {
      // При увеличении пальцами visualViewport тоже меньше окна — это не клавиатура.
      const kb = vv && vv.scale <= 1.05 ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      if (kb !== lastKb) {
        lastKb = kb;
        root.style.setProperty('--kb', kb + 'px');
      }
      const small = !!vv && vv.height < window.innerHeight * 0.75;
      setOpen((touch && typing()) || (small && kb > 0));
    };
    const onFocusIn = () => { clearTimeout(timer); measure(); };
    // После ухода фокуса ждём 60 мс: фокус может перейти в соседнее поле.
    const onFocusOut = () => { clearTimeout(timer); timer = window.setTimeout(measure, 60); };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--kb');
    };
  }, []);

  useHideTabBar(open, 'keyboard');
  return open;
}
