// Вложенные экраны вкладки (ветка, профиль…) поверх ui/layers. Каждый экран — слой истории
// с id 'screen': «Назад» или unwind() снимают его через onPop. Прокрутка окна запоминается
// для каждой глубины и возвращается, когда экран сверху закрывается.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { depth, pushLayer, unwind } from '../ui/layers';

export interface Stack<S> { stack: S[]; top: S | null; push(s: S): void; pop(): Promise<void>; popToRoot(): Promise<void> }

interface Entry { close: () => Promise<void>; scrollY: number; base: number }

export function useStack<S>(): Stack<S> {
  const [stack, setStack] = useState<S[]>([]);
  const entries = useRef<Entry[]>([]);
  const restore = useRef<number | null>(null);

  // Экран сверху закрылся — возвращаем прокрутку, на которой его открыли.
  useLayoutEffect(() => {
    if (restore.current === null) return;
    const y = restore.current;
    restore.current = null;
    window.scrollTo(0, y);
  }, [stack]);

  /** Снять верхний экран из состояния (история уже снята или снимется вызывающим). */
  const dropTop = useCallback(() => {
    const e = entries.current.pop();
    if (!e) return null;
    restore.current = e.scrollY;
    setStack((st) => st.slice(0, -1));
    return e;
  }, []);

  const push = useCallback((s: S) => {
    const base = depth();
    const scrollY = window.scrollY;
    let entry: Entry | null = null;
    const close = pushLayer('screen', () => {
      // «Назад» снимает только верхний экран, поэтому это всегда он.
      if (entry && entries.current[entries.current.length - 1] === entry) dropTop();
    });
    entry = { close, scrollY, base };
    entries.current.push(entry);
    setStack((st) => [...st, s]);
    window.scrollTo(0, 0);
  }, [dropTop]);

  const pop = useCallback(async () => {
    const e = dropTop();
    if (e) await e.close();
  }, [dropTop]);

  const popToRoot = useCallback(async () => {
    const first = entries.current[0];
    if (!first) return;
    // Снимаем всё выше корня вкладки — и экраны, и открытые над ними листы.
    await unwind(first.base);
  }, []);

  return useMemo(() => ({
    stack,
    top: stack.length ? stack[stack.length - 1] : null,
    push, pop, popToRoot,
  }), [stack, push, pop, popToRoot]);
}
