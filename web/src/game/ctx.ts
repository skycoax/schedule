// Общее для экранов игры «Код»: стек экранов, данные (лобби, игры, код дня), доступ и поток событий.
// Хозяин — GameHost.tsx; экраны берут всё через useGx().
import { createContext, useContext } from 'react';
import type { IxAnim } from '../social/instants/motion';
import type { DailyView, DuelView, GameLobby, GameReaction, UserCard } from '../social/types';
import type { StreamStatus } from './stream';

/** Для чего открыт экран «Твой код»: от этого — надпись на кнопке и что будет после. */
export type PadPurpose =
  | { kind: 'link' }
  | { kind: 'friend'; user: UserCard }
  | { kind: 'quick' }
  | { kind: 'join'; token: string }
  /** fromDuel — «Твой код» открыт поверх экрана этой же игры: после принятия просто вернуться к нему. */
  | { kind: 'accept'; id: number; fromDuel?: boolean }
  | { kind: 'rematch'; id: number; counter: boolean }
  | { kind: 'practice' };

export type Screen =
  | { t: 'lobby' }
  | { t: 'pad'; purpose: PadPurpose }
  | { t: 'invite'; id: number }
  | { t: 'join'; token?: string }
  | { t: 'search'; id: number }
  | { t: 'duel'; id: number }
  | { t: 'daily' }
  | { t: 'board' }
  | { t: 'practice'; code: string };

/** Анимация экрана: как у моментов, плюс still — показаться без движения (под уезжающим вниз листом). */
export type GxAnim = IxAnim | 'still';

/**
 * Что можно с людьми: ok — всё; loading — сессия ещё не ответила; guest — нужен вход; offline — нет сети;
 * banned — ограничение (лобби только читать); readonly — «Обсуждения» только для чтения; off — игры с людьми нет.
 */
export type Access = 'ok' | 'loading' | 'guest' | 'offline' | 'banned' | 'readonly' | 'off';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface Gx {
  push(s: Screen, anim?: GxAnim): void;
  /** Заменить верхний экран (например, «Твой код» → «Вызов готов»); drop — сколько экранов сверху убрать (1). */
  replace(s: Screen, anim?: GxAnim, drop?: number): void;
  back(): void;
  closeAll(): void;
  /** Вернуться в лобби (снять всё, что над ним). */
  home(): void;

  access: Access;
  mode: 'on' | 'friends' | 'off';
  signed: boolean;
  /** Проверки сессии перед игрой с людьми: вход (гостю — с возвратом в игру), профиль, правила, ограничение. */
  ensure(returnTo?: string): Promise<boolean>;

  lobby: GameLobby | null;
  lobbyState: LoadState;
  /** false — сервер не ответил (сеть, 5xx). */
  loadLobby(quiet?: boolean): Promise<boolean>;
  duels: Record<number, DuelView>;
  applyDuel(d: DuelView): void;
  /** GET игры: 404 → null («Игра не найдена»), другая ошибка → undefined (quiet — без тоста). */
  loadDuel(id: number, quiet?: boolean): Promise<DuelView | null | undefined>;
  markSeen(id: number): void;
  daily: DailyView | null;
  setDaily(d: DailyView): void;
  loadDaily(quiet?: boolean): Promise<boolean>;

  /** Серверное «сейчас» (по потоку) — для «до 14:30». */
  now(): number;
  stream: StreamStatus;
  /** Реакции соперников: подписка экрана игры. */
  onReact(fn: (duel: number, r: GameReaction) => void): () => void;
  noReact: boolean;
  setNoReact(v: boolean): void;
  howTo(): void;
  pickFriend(): void;
}

export const GxCtx = createContext<Gx | null>(null);

export function useGx(): Gx {
  const g = useContext(GxCtx);
  if (!g) throw new Error('useGx вне GameHost');
  return g;
}
