// Уведомления в приложении (на этом телефоне): изменения пар, приглашения в игру, заявки в друзья, ответы.
// По умолчанию всё включено; выключенное просто не показывается (точка правок, плашка приглашения, тосты).
import { useSyncExternalStore } from 'react';
import { ls } from './store';

export type NotifyKey = 'sched' | 'game' | 'friends' | 'replies';

const subs = new Set<() => void>();
export const notifyOn = (k: NotifyKey): boolean => ls('n_' + k) !== '0';

export function setNotify(k: NotifyKey, on: boolean): void {
  ls('n_' + k, on ? '1' : '0');
  subs.forEach((f) => f());
}

export function useNotify(k: NotifyKey): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => notifyOn(k), () => true);
}
