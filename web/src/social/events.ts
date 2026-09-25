// События «Обсуждений» между вкладками и экранами: window CustomEvent 'para:social'.
// Так ленты, ветки и профили остаются согласованными без общего хранилища.
import { useEffect, useRef } from 'react';
import type { AdminAction, Me, Post, Relation, ReportTarget } from './types';

export const SOCIAL_EVENT = 'para:social';

export type SocialEvent =
  | { type: 'post-created'; post: Post }
  | { type: 'post-deleted'; id: number; rootId: number | null }
  | { type: 'reply-created'; reply: Post }
  | { type: 'like'; id: number; likes: number; liked: boolean }
  | { type: 'block'; userId: number } | { type: 'unblock'; userId: number }
  | { type: 'hide-user'; userId: number }
  | { type: 'relation'; userId: number; relation: Relation }
  | { type: 'reported'; target: ReportTarget; hidden: boolean }
  | { type: 'moderated'; target: ReportTarget; action: AdminAction }
  | { type: 'me-changed'; me: Me | null };

export function emit(e: SocialEvent): void {
  try { window.dispatchEvent(new CustomEvent<SocialEvent>(SOCIAL_EVENT, { detail: e })); } catch { /* нет window */ }
}

/** Подписка на события. fn может меняться между рендерами — берётся последняя. */
export function useSocialEvents(fn: (e: SocialEvent) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const on = (ev: Event) => {
      const d = (ev as CustomEvent<SocialEvent>).detail;
      if (d && typeof d === 'object') ref.current(d);
    };
    window.addEventListener(SOCIAL_EVENT, on);
    return () => window.removeEventListener(SOCIAL_EVENT, on);
  }, []);
}
