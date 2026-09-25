// Видимость нижней панели вкладок: набор причин скрыть её (клавиатура, онбординг, ветка, просмотр фото).
// Панель скрыта, пока есть хоть одна причина. Причины считаются по ссылкам: два экрана с одной причиной
// не мешают друг другу.
import { useEffect, useSyncExternalStore } from 'react';

const reasons = new Map<string, number>();
const subs = new Set<() => void>();
let hidden = false;

function update() {
  const next = reasons.size > 0;
  if (next === hidden) return;
  hidden = next;
  subs.forEach((f) => f());
}

function add(reason: string) {
  reasons.set(reason, (reasons.get(reason) || 0) + 1);
  update();
}

function remove(reason: string) {
  const n = (reasons.get(reason) || 0) - 1;
  if (n > 0) reasons.set(reason, n);
  else reasons.delete(reason);
  update();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => { subs.delete(f); };
};
const snapshot = () => hidden;
const serverSnapshot = () => false;

/** Пока hidden === true, панель вкладок скрыта по причине reason. */
export function useHideTabBar(hidden: boolean, reason: string): void {
  useEffect(() => {
    if (!hidden) return;
    add(reason);
    return () => remove(reason);
  }, [hidden, reason]);
}

export function useTabBarHidden(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
