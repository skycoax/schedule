// Локальные данные «Обсуждений» на телефоне — только localStorage через ls() (никаких кук).
// Ключи: me_cache, hiddenUsers, ageBlock (CONTRACT.md §E.7). Черновики draft_post_<вуз> ведёт чат.
import { ls } from '../lib/store';
import type { Me } from './types';

export interface HiddenUser { id: number; username: string; name: string }

const HIDDEN = 'hiddenUsers';
const ME = 'me_cache';
const AGE = 'ageBlock';
const HIDDEN_MAX = 200;
const AGE_MS = 30 * 864e5;

function del(k: string) {
  try { localStorage.removeItem(k); } catch { /* приватный режим */ }
}

function readJson(k: string): unknown {
  const raw = ls(k);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Скрытые авторы, новые первыми. */
export function hiddenUsers(): HiddenUser[] {
  const v = readJson(HIDDEN);
  if (!Array.isArray(v)) return [];
  return v.filter((u): u is HiddenUser =>
    !!u && typeof u === 'object' && typeof u.id === 'number' && typeof u.username === 'string' && typeof u.name === 'string');
}

export function isHiddenUser(id: number): boolean {
  return hiddenUsers().some((u) => u.id === id);
}

/** Не больше 200, новые сохраняются. */
export function hideUser(u: HiddenUser): void {
  const list = [{ id: u.id, username: u.username, name: u.name }, ...hiddenUsers().filter((x) => x.id !== u.id)];
  ls(HIDDEN, JSON.stringify(list.slice(0, HIDDEN_MAX)));
}

export function unhideUser(id: number): void {
  const list = hiddenUsers().filter((x) => x.id !== id);
  if (list.length) ls(HIDDEN, JSON.stringify(list));
  else del(HIDDEN);
}

export function readMeCache(): Pick<Me, 'id' | 'name' | 'username' | 'avatar'> | null {
  const v = readJson(ME) as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || typeof v.id !== 'number') return null;
  return {
    id: v.id,
    name: typeof v.name === 'string' ? v.name : '',
    username: typeof v.username === 'string' ? v.username : null,
    avatar: typeof v.avatar === 'string' ? v.avatar : null,
  };
}

export function writeMeCache(me: Me | null): void {
  if (!me) { del(ME); return; }
  ls(ME, JSON.stringify({ id: me.id, name: me.name, username: me.username, avatar: me.avatar }));
}

/** «Младше {minAge}» выбрано меньше 30 дней назад. */
export function ageBlocked(): boolean {
  const at = Number(ls(AGE) || 0);
  return at > 0 && Date.now() - at < AGE_MS;
}

export function setAgeBlock(): void {
  ls(AGE, String(Date.now()));
}

/** Выход: убрать me_cache и все черновики draft_post_* (скрытых авторов и ageBlock оставить). */
export function clearSocialLocal(): void {
  del(ME);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('draft_post_')) keys.push(k);
    }
    keys.forEach(del);
  } catch { /* приватный режим */ }
}
