// Тема: авто (по системе) → светлая → тёмная → авто. Выбор запоминается.
// cycle — по кругу, set — сразу нужная (переключатель «Авто | Светлая | Тёмная»).
import { useCallback, useEffect, useState } from 'react';
import { store } from '../lib/store';

export type ThemeMode = 'auto' | 'light' | 'dark';

function read(): ThemeMode {
  const v = store('theme');
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);

    const apply = () => {
      const dark = mode === 'dark' ||
        (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      // Цвет статус-бара = фон приложения (--bg), иначе у верхнего затухания виден шов.
      // Переписываем все мета theme-color, включая те, что с media в index.html:
      // при ручном выборе темы iOS иначе может взять системную.
      const color = dark ? '#000000' : '#f2f2f7';
      const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
      if (!metas.length) {
        const meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta);
        meta.content = color;
      }
      metas.forEach((m) => { m.content = color; });
    };
    apply();

    // В авто-режиме следим за системой, чтобы тема менялась без перезагрузки.
    if (mode === 'auto') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [mode]);

  const cycle = useCallback(() => {
    setMode((m) => {
      const n: ThemeMode = m === 'auto' ? 'light' : m === 'light' ? 'dark' : 'auto';
      store('theme', n);
      return n;
    });
  }, []);

  // Прямой выбор (Профиль → Оформление, ThemeSection): тоже запоминается.
  const set = useCallback((m: ThemeMode) => {
    store('theme', m);
    setMode(m);
  }, []);

  return { mode, cycle, set };
}
