// Обезличенный заход. Шлём только после согласия. Ни имени, ни почты, ни телефона —
// см. экран «Условия и данные». IP/устройство/браузер разбирает сервер сам.
import { store } from './store';
import { sendHit } from '../api';

let sent = false;

export function trackVisit(groupName: string): void {
  if (sent) return;
  sent = true;

  let cid = store('cid');
  const first = cid ? '' : '1';
  if (!cid) {
    cid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    store('cid', cid);
  }

  const from = new URLSearchParams(location.search).get('from') || '';
  // Свой же домен как источник не считаем.
  let ref = '';
  try {
    if (document.referrer && new URL(document.referrer).host !== location.host) ref = document.referrer;
  } catch { /* пусто */ }

  sendHit({
    cid, first, from, ref,
    grp: groupName || '',
    scr: (screen.width || 0) + 'x' + (screen.height || 0),
    lang: navigator.language || '',
  });
}
