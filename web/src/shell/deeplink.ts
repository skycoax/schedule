// Ссылки внутрь приложения Para: /?uni=kfu&post=12, &user=alice, &tab=profile&delete=1, #auth=ok…
// Читаются один раз при запуске (AppShell) и сразу убираются из адреса, чтобы перезагрузка
// или «Поделиться» не открывали то же самое снова. uni, group, from, ok, u и #m= не трогаем.
import type { TabId } from '../tabs';
import type { AuthOutcome } from '../social/types';
import { DEEP_PARAMS } from '../lib/uni';

export interface DeepLink {
  tab?: TabId; post?: number; user?: string; compose?: boolean; del?: boolean; mod?: boolean; auth?: AuthOutcome;
}

const TABS: readonly TabId[] = ['schedule', 'chat', 'profile'];
const OUTCOMES: readonly AuthOutcome[] =
  ['ok', 'cancelled', 'expired', 'failed', 'browser', 'limited', 'unavailable', 'unverified', 'consent', 'none'];

/** Разбирает адрес и убирает из него tab, post, user, compose, delete, mod и #auth=…. */
export function readDeepLink(): DeepLink {
  const url = new URL(location.href);
  const q = url.searchParams;
  const dl: DeepLink = {};

  const tab = q.get('tab') as TabId | null;
  if (tab && TABS.includes(tab)) dl.tab = tab;
  const post = Number(q.get('post'));
  if (q.has('post') && Number.isSafeInteger(post) && post > 0) dl.post = post;
  const user = (q.get('user') || '').trim().replace(/^@/, '').toLowerCase();
  if (/^[a-z0-9_]{3,20}$/.test(user)) dl.user = user;
  if (q.get('compose') === '1') dl.compose = true;
  if (q.get('delete') === '1') dl.del = true;
  if (q.get('mod') === '1') dl.mod = true;

  let changed = false;
  const m = /^#auth=([a-z]+)/.exec(url.hash);
  if (url.hash.startsWith('#auth=')) {
    const o = (m ? m[1] : '') as AuthOutcome;
    if (OUTCOMES.includes(o)) dl.auth = o;
    url.hash = '';
    changed = true;
  }
  for (const k of DEEP_PARAMS) if (q.has(k)) { q.delete(k); changed = true; }
  if (changed) {
    const qs = q.toString();
    history.replaceState(history.state, '', url.pathname + (qs ? '?' + qs : '') + url.hash);
  }
  return dl;
}
