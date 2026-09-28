// Поток событий стола (SSE, GET /api/social/games/stream) — на общем lib/sse.ts. Живёт, только пока открыт оверлей и
// страница видна. Сервер после каждого изменения присылает стол целиком (событие table), на hello и при возвращении
// на страницу приложение запрашивает стол заново. Не вышло с потоком — опрос раз в 2 с.
import { useEffect, useRef, useState } from 'react';
import { SseStream } from '../lib/sse';
import type { SseStatus } from '../lib/sse';
import type { GameReaction, PokerChatItem, PokerView } from '../social/types';

export type StreamStatus = SseStatus;

export interface StreamHandlers {
  resync(): void;
  table(v: PokerView): void;
  react(seat: number, r: GameReaction): void;
  chat(item: PokerChatItem): void;
  ended(reason: 'session' | 'ban'): void;
  poll(): Promise<boolean>;
}

/** Поток на время жизни оверлея. enabled — все условия (видно, игра не выключена, есть сеть). */
export function useGameStream(url: string, enabled: boolean, handlers: StreamHandlers): {
  status: StreamStatus; offset: () => number; resume: () => void; clock: (now: unknown) => void;
} {
  const h = useRef(handlers);
  h.current = handlers;
  const [s] = useState(() => new SseStream(url, () => ({
    resync: () => h.current.resync(),
    poll: () => h.current.poll(),
    ended: (reason) => h.current.ended(reason),
    on: {
      table: (d) => {
        const v = d.view;
        if (v && typeof v === 'object') { s.clock((v as PokerView).now); h.current.table(v as PokerView); }
      },
      react: (d) => { if (typeof d.seat === 'number' && typeof d.r === 'string') h.current.react(d.seat, d.r as GameReaction); },
      chat: (d) => {
        const it = d.item as PokerChatItem | undefined;
        if (it && typeof it.id === 'number' && typeof it.seat === 'number') h.current.chat(it);
      },
    },
  }), { pollMs: 2000 }));
  const [status, setStatus] = useState<StreamStatus>(s.status);
  useEffect(() => s.subscribe(() => setStatus(s.status)), [s]);
  useEffect(() => { s.enable(enabled); }, [s, enabled]);
  useEffect(() => () => s.enable(false), [s]);
  return { status, offset: () => s.offset, resume: () => s.resume(), clock: (now) => s.clock(now) };
}
