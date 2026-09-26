// Para: какой вуз выбран и переезд настроек со старых адресов вузов.
// Вуз хранится в store('uni'). Кука uni видна и серверу, поэтому страница приходит
// уже с брендом этого вуза (server/src/hub.js). Группа и преподаватель у каждого вуза
// свои: при смене вуза прежние откладываем в prev_<id> и возвращаем, когда человек
// вернётся к тому вузу.
// Ссылки на «Обсуждения», «Профиль» и игру «Код» (?post=, ?user=, ?tab=…, ?duel=, ?game=1, #auth=) переживают
// выбор вуза и переход на его страницу: их разбирает shell/deeplink.ts уже внутри приложения.
import { brand } from '../brand';
import { store } from './store';

const PER_UNI = ['group', 'teacher', 'seenTs'];
// Что приносит старый адрес вуза во фрагменте #m= (server/src/site.js, redirectHtml). Согласия (agreed)
// и номера для статистики (cid) тут нет и не будет: условия Para человек принимает на её первом экране сам.
const MOVED = ['group', 'role', 'teacher', 'seenTs', 'theme', 'homeShown', 'reviewedAt', 'myRating', 'reviewPromptAt'];

/**
 * #m= принимаем только от страницы-переезда старого адреса вуза: переезд включён (redirectOldHosts),
 * а пришли с соседнего адреса того же домена (kfu.skycoax.uz → para.skycoax.uz; Referrer-Policy
 * strict-origin-when-cross-origin отдаёт его origin). Ссылка с #m= из чата или с чужого сайта — не считается.
 */
function fromOldHost(): boolean {
  if (!brand.moveIn) return false;
  let ref: URL;
  try { ref = new URL(document.referrer); } catch { return false; }
  const parent = (h: string) => h.slice(h.indexOf('.') + 1);
  return ref.protocol === location.protocol && ref.host !== location.host && ref.hostname.includes('.')
    && parent(ref.hostname) === parent(location.hostname);
}

/** Параметры адреса для вкладок «Обсуждения», «Профиль» и игры «Код» (их читает shell/deeplink.ts). */
export const DEEP_PARAMS: readonly string[] = ['tab', 'post', 'user', 'compose', 'delete', 'mod', 'duel', 'game'];

const AUTH_HASH = /^#auth=/;

/** true, пока в адресе есть ссылка внутрь приложения (UniversityStart показывает подсказку). */
export function pendingDeepLink(): boolean {
  const q = new URLSearchParams(location.search);
  return DEEP_PARAMS.some((k) => q.has(k)) || AUTH_HASH.test(location.hash);
}

/** Хвост адреса со ссылкой внутрь приложения: «&post=5#auth=ok» или ''. */
function deepTail(): string {
  const q = new URLSearchParams(location.search);
  const out = new URLSearchParams();
  for (const k of DEEP_PARAMS) { const v = q.get(k); if (v !== null) out.set(k, v); }
  const s = out.toString();
  return (s ? '&' + s : '') + (AUTH_HASH.test(location.hash) ? location.hash : '');
}

function stash(id: string) {
  const saved: Record<string, string> = {};
  for (const k of PER_UNI) { const v = store(k); if (v) saved[k] = v; store(k, ''); }
  store('prev_' + id, JSON.stringify(saved));
}

function unstash(id: string) {
  let saved: Record<string, string> = {};
  try { saved = JSON.parse(store('prev_' + id) || '{}'); } catch { /* испорчено — начнём с нуля */ }
  for (const k of PER_UNI) store(k, saved[k] || '');
}

/** До первого рендера. false — страница уходит на другой адрес, рисовать нечего. */
export function initUni(): boolean {
  if (!brand.hub) return true;
  const url = new URL(location.href);
  const asked = url.searchParams.get('uni') || '';
  const saved = store('uni') || '';

  // Ссылка на пост, профиль или вызов в игру из другого вуза: остаёмся в своём вузе (лента — своя),
  // а пост, профиль или игра всё равно откроются. Остальные параметры и фрагмент — как были.
  const q = url.searchParams;
  if ((q.has('post') || q.has('user') || q.has('duel') || q.has('game')) && saved && (asked || brand.id) !== saved) {
    url.searchParams.set('uni', saved);
    location.replace('/?' + url.searchParams.toString() + url.hash);
    return false;
  }

  let moved: Record<string, unknown> | null = null;
  if (url.hash.startsWith('#m=')) {
    if (fromOldHost()) {
      try { moved = JSON.parse(decodeURIComponent(url.hash.slice(3))); } catch { moved = null; }
      if (!moved || typeof moved !== 'object' || Array.isArray(moved)) moved = null;
    }
    url.hash = '';
    history.replaceState(history.state, '', url.pathname + url.search);
  }

  if (!brand.id) {
    // Вуз не выбран, или в ?uni= незнакомый. Если выбор остался в localStorage, а кука
    // пропала — просим страницу этого вуза, но один раз: с ?uni= уже не переходим.
    // Ссылка внутрь приложения (?user=…, #auth=…) едет вместе с нами.
    if (saved && !asked) { location.replace('/?uni=' + encodeURIComponent(saved) + deepTail()); return false; }
    if (asked) store('uni', '');
    return true;
  }

  // Незнакомый ?uni= сервер пропустил и взял вуз из куки — исправляем его в адресе,
  // не трогая остальные параметры и фрагмент.
  if (asked && asked !== brand.id) {
    url.searchParams.set('uni', brand.id);
    history.replaceState(history.state, '', url.pathname + '?' + url.searchParams.toString() + url.hash);
  }

  const cur = saved;
  if (cur !== brand.id) {
    if (cur) stash(cur);
    unstash(brand.id);
    store('uni', brand.id);
  }
  if (moved) {
    for (const k of MOVED) {
      const v = moved[k];
      if (typeof v !== 'string' || !v) continue;
      // Группа, роль и преподаватель — про этот вуз, берём их; остальное — если своего ещё нет.
      if (PER_UNI.includes(k) || k === 'role' || !store(k)) store(k, v);
    }
  }
  return true;
}

/** Сменить вуз: страница откроется заново уже с его расписанием (и с ссылкой внутрь, если была). */
export function openUni(id: string) {
  location.href = '/?uni=' + encodeURIComponent(id) + deepTail();
}

/** «КФУ · Джизак» → «КФУ». */
export const abbrOf = (short: string) => short.split('·')[0].trim();

/** Цвет значка вуза — из палитры приложения, постоянный для каждого вуза. */
export function colorOf(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--c${1 + (h % 8)})`;
}
