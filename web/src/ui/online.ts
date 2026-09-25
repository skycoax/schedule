// Есть ли сеть (navigator.onLine + события online/offline).
import { useSyncExternalStore } from 'react';

const subscribe = (f: () => void) => {
  window.addEventListener('online', f);
  window.addEventListener('offline', f);
  return () => {
    window.removeEventListener('online', f);
    window.removeEventListener('offline', f);
  };
};
const snapshot = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
const serverSnapshot = () => true;

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
