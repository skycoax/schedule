// Установка на главный экран. Chrome даёт событие beforeinstallprompt — держим его,
// чтобы показать настоящую системную кнопку. У Apple такого API нет — там шаги.
import { useEffect, useState } from 'react';

interface BIPEvent extends Event { prompt: () => void; userChoice: Promise<unknown>; }

const UA = navigator.userAgent || '';
export const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && (navigator.maxTouchPoints || 0) > 1);

export function isStandalone(): boolean {
  try {
    return (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      matchMedia('(display-mode: standalone)').matches;
  } catch { return false; }
}

export function useInstall() {
  const [ev, setEv] = useState<BIPEvent | null>(null);
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setEv(e as BIPEvent); };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  const doInstall = async () => {
    if (!ev) return;
    ev.prompt();
    await ev.userChoice;
    setEv(null);
  };
  return { canInstall: !!ev, doInstall };
}
