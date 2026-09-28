// Уведомления, когда Para закрыта (Web Push). Подписка — это устройство: сервер (server/src/social/push.js) знает
// вуз и группу (изменения пар), сессию (заявки, ответы, приглашения — пока здесь выполнен вход) и что присылать
// (переключатели «Уведомлений», lib/notify.ts). Включает человек сам: «Профиль» → «Уведомления» или предложение
// (PushPrompt). Дальше всё, что меняется (группа, вход, переключатели), сообщается серверу само — pushSync().
import { useSyncExternalStore } from 'react';
import { apiCall } from '../social/api';
import { IS_IOS, isStandalone } from '../hooks/useInstall';
import { ls, store } from './store';
import { notifyOn, onNotifyChange, type NotifyKey } from './notify';

const KINDS: NotifyKey[] = ['sched', 'game', 'friends', 'replies'];

/**
 * no — браузер не умеет; install — iPhone: только с иконки на экране «Домой» (iOS 16.4+);
 * denied — запрещено в настройках; off — можно включить; on — включено.
 */
export type PushState = 'no' | 'install' | 'denied' | 'off' | 'on';

const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

export function pushState(): PushState {
  if (IS_IOS && !isStandalone()) return 'install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'no';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && ls('push') === '1' ? 'on' : 'off';
}

export function usePushState(): PushState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, pushState, () => 'no');
}

let keyP: Promise<string> | null = null;
const serverKey = (): Promise<string> => {
  keyP ??= apiCall<{ key: string }>('GET', '/api/social/push/key').then((d) => d.key);
  keyP.catch(() => { keyP = null; });
  return keyP;
};

const bytes = (b64: string): Uint8Array => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const sameKey = (sub: PushSubscription, key: Uint8Array): boolean => {
  const k = sub.options?.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k);
  return a.length === key.length && a.every((x, i) => x === key[i]);
};

async function registration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** Подписать устройство (или обновить подписку) с тем, что сейчас выбрано. */
async function syncNow(): Promise<void> {
  if (pushState() !== 'on') return;
  const key = bytes(await serverKey());
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // Ключ сервера сменился — старая подписка ему не годится.
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe().catch(() => false); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
  const j = sub.toJSON();
  await apiCall('POST', '/api/social/push', { body: {
    endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth,
    group: store('role') === 'teacher' ? null : store('group') || null,
    kinds: KINDS.filter(notifyOn),
  } });
}

let timer = 0;
/** Что-то поменялось (группа, вход, переключатели) — сообщить серверу, одним запросом чуть позже. */
export function pushSync(): void {
  if (pushState() !== 'on') return;
  clearTimeout(timer);
  timer = window.setTimeout(() => { syncNow().catch(() => {}); }, 700);
}
onNotifyChange(pushSync);

/**
 * Включить. Вызывать прямо из нажатия (до любого await): Safari спрашивает разрешение только в ответ на жест.
 * true — включено; false — не разрешили или не вышло подписаться.
 */
export function enablePush(): Promise<boolean> {
  let asked: Promise<NotificationPermission>;
  try { asked = Notification.requestPermission(); } catch { return Promise.resolve(false); }
  return asked.then(async (perm) => {
    if (perm !== 'granted') { changed(); return false; }
    ls('push', '1');
    changed();
    try {
      await syncNow();
      return true;
    } catch {
      ls('push', '0');
      changed();
      return false;
    }
  });
}

/** Выключить на этом устройстве: сервер забывает подписку, браузер — тоже. */
export async function disablePush(): Promise<void> {
  ls('push', '0');
  changed();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    await apiCall('POST', '/api/social/push/remove', { body: { endpoint: sub.endpoint } }).catch(() => null);
    await sub.unsubscribe();
  } catch { /* браузер уже забыл */ }
}

/** Предложение включить (PushPrompt) показываем один раз — и только там, где включить можно. */
export const pushAskable = (): boolean => pushState() === 'off' && !ls('pushAsked');
export const pushAsked = (): void => { ls('pushAsked', '1'); };
