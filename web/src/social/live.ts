// Живые обновления приложения: один поток SSE (GET /api/social/live) на вошедшего, пока приложение открыто и видно.
// Сервер присылает чужие события — посты, ответы, «нравится», заявки в друзья, моменты, приглашения в покер, — а здесь
// они превращаются в те же локальные события (events.ts), на которые уже подписаны лента, ветки, профиль и друзья:
// экраны обновляются сами, без перезахода. После каждого (пере)подключения (hello) — «перечитай экран» (resync)
// и свежий Me: так догоняется всё, что пришло, пока приложение было свёрнуто.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { brand } from '../brand';
import { SseStream } from '../lib/sse';
import { toast } from '../ui/Toast';
import { notifyOn } from '../lib/notify';
import { pushSync } from '../lib/push';
import { emit, useSocialEvents } from './events';
import { useSession } from './session';
import type { GameInvite, Post, Relation, UserCard } from './types';

// ─── Приглашение в покер: из потока или из Me (открыл приложение позже, но в пределах 10 минут) ───

let invite: GameInvite | null = null;
const dismissed = new Set<string>();   // уже закрытые (по from.id + at): Me может ещё помнить их до обновления
const inviteSubs = new Set<() => void>();
const keyOf = (v: GameInvite) => v.from.id + ':' + String(v.at);

export function setInvite(v: GameInvite | null): void {
  if (v && (dismissed.has(keyOf(v)) || !notifyOn('game'))) return;
  invite = v;
  inviteSubs.forEach((f) => f());
}
/** Приглашение больше не показывать (закрыли, приняли, ушло время). */
export function dropInvite(): void {
  if (invite) dismissed.add(keyOf(invite));
  setInvite(null);
}
export function useInvite(): GameInvite | null {
  return useSyncExternalStore((f) => { inviteSubs.add(f); return () => { inviteSubs.delete(f); }; }, () => invite, () => null);
}

const SEEN_MAX = 500;

/** Поток живых обновлений (HubShell): включён, пока человек вошёл, «Обсуждения» не выключены и есть сеть. */
export function useLive(): void {
  const s = useSession();
  const sRef = useRef(s);
  sRef.current = s;

  // Посты и ответы, которые это устройство уже знает (своё — из локальных событий): эхо с сервера не дублируем.
  const seen = useRef(new Set<number>());
  const remember = (id: number) => {
    const set = seen.current;
    set.add(id);
    if (set.size > SEEN_MAX) set.delete(set.values().next().value as number);
  };
  // Свои посты этого запуска — чтобы сказать «Новый ответ», когда на них отвечают.
  const mine = useRef(new Set<number>());
  useSocialEvents((e) => {
    if (e.type === 'post-created') { remember(e.post.id); if (e.post.rootId === null) mine.current.add(e.post.id); }
    else if (e.type === 'reply-created') remember(e.reply.id);
  });

  const meT = useRef(0);
  const refreshMe = () => {
    clearTimeout(meT.current);
    meT.current = window.setTimeout(() => { if (sRef.current.status === 'signed') void sRef.current.refresh(); }, 400);
  };

  const [stream] = useState(() => new SseStream('/api/social/live?uni=' + encodeURIComponent(brand.id || ''), () => ({
    resync: () => { emit({ type: 'resync' }); refreshMe(); },
    on: {
      post: (d) => {
        const p = d.post as Post | undefined;
        if (!p || typeof p.id !== 'number' || seen.current.has(p.id)) return;
        remember(p.id);
        emit({ type: 'remote-post', post: p });
      },
      reply: (d) => {
        const r = d.reply as Post | undefined;
        if (!r || typeof r.id !== 'number' || seen.current.has(r.id)) return;
        remember(r.id);
        emit({ type: 'reply-created', reply: r });
        const me = sRef.current.me;
        const toMe = !!me && r.author?.id !== me.id
          && ((r.rootId !== null && mine.current.has(r.rootId)) || (!!me.username && r.replyTo?.username === me.username));
        if (toMe && notifyOn('replies')) toast('Новый ответ — ' + (r.author?.name || 'кто-то') + ': ' + r.text.slice(0, 60));
      },
      likes: (d) => {
        if (typeof d.id === 'number' && typeof d.likes === 'number') emit({ type: 'likes', id: d.id, likes: d.likes });
      },
      gone: (d) => {
        if (typeof d.id === 'number') emit({ type: 'post-deleted', id: d.id, rootId: typeof d.rootId === 'number' ? d.rootId : null });
      },
      relation: (d) => {
        const u = d.user as UserCard | undefined;
        const rel = d.relation as Relation;
        if (!u || typeof u.id !== 'number' || typeof rel !== 'string') return;
        emit({ type: 'relation', userId: u.id, relation: rel });
        if (notifyOn('friends')) {
          if (rel === 'incoming') toast(u.name + ' хочет добавить тебя в друзья');
          else if (rel === 'friends') toast(u.name + ' теперь в друзьях');
        }
        refreshMe();
      },
      me: () => refreshMe(),
      instants: () => emit({ type: 'instants' }),
      invite: (d) => {
        const from = d.from as UserCard | undefined;
        if (from && typeof from.id === 'number') setInvite({ from, at: (d.at as number | string) ?? Date.now() });
      },
      players: (d) => {
        const cur = sRef.current;
        if (typeof d.n !== 'number' || cur.status !== 'signed' || !cur.me || !cur.me.game) return;
        if (cur.me.game.players !== d.n) cur.setMe({ ...cur.me, game: { ...cur.me.game, players: d.n } });
      },
    },
  })));

  const on = s.status === 'signed' && s.mode !== 'off' && s.online;
  // Уведомления, когда Para закрыта: при запуске и при входе/выходе сервер узнаёт сессию этого устройства.
  const uid = s.status === 'signed' ? s.me?.id ?? 0 : 0;
  useEffect(() => { pushSync(); }, [uid]);
  useEffect(() => { stream.enable(on); }, [stream, on]);
  useEffect(() => () => { stream.enable(false); clearTimeout(meT.current); }, [stream]);

  // Приглашение, которое помнит сервер (Me), — если приложение открыли уже после него.
  const meInvite = s.status === 'signed' ? s.me?.game?.invite ?? null : null;
  const meKey = meInvite ? keyOf(meInvite) : '';
  useEffect(() => {
    if (meInvite && (!invite || keyOf(invite) !== meKey)) setInvite(meInvite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meKey]);
}
