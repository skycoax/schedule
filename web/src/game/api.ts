// Клиент API игры «Код»: /api/social/games/* (CONTRACT.md §I, формы — social/types.ts).
// Транспорт общий с «Обсуждениями» (apiCall): uni=, X-Para у изменений, конверт {ok,data} и тексты ошибок.
import { apiCall } from '../social/api';
import type { BoardScope, DailyBoard, DailyView, DuelView, GameInvite, GameLobby, GameReaction } from '../social/types';

const base = '/api/social/games';
const duel = (id: number) => base + '/duels/' + id;

export const gameApi = {
  lobby(signal?: AbortSignal): Promise<GameLobby> {
    return apiCall<GameLobby>('GET', base, { signal });
  },
  async daily(signal?: AbortSignal): Promise<DailyView> {
    return (await apiCall<{ daily: DailyView }>('GET', base + '/daily', { signal })).daily;
  },
  async dailyGuess(day: string, guess: string, n: number): Promise<DailyView> {
    return (await apiCall<{ daily: DailyView }>('POST', base + '/daily/guess', { body: { day, guess, n } })).daily;
  },
  board(scope: BoardScope, signal?: AbortSignal): Promise<DailyBoard> {
    return apiCall<DailyBoard>('GET', base + '/daily/board', { params: { scope }, signal });
  },
  create(mode: 'link' | 'friend' | 'quick', code: string, to?: number): Promise<{ duel: DuelView; matched: boolean }> {
    const body: Record<string, unknown> = { mode, code };
    if (to !== undefined) body.to = to;
    return apiCall<{ duel: DuelView; matched: boolean }>('POST', base + '/duels', { body });
  },
  async invite(t: string, signal?: AbortSignal): Promise<GameInvite> {
    return (await apiCall<{ invite: GameInvite }>('GET', base + '/invite', { params: { t }, signal, para: true })).invite;
  },
  async join(t: string, code: string): Promise<DuelView> {
    return (await apiCall<{ duel: DuelView }>('POST', base + '/join', { body: { t, code } })).duel;
  },
  async accept(id: number, code: string): Promise<DuelView> {
    return (await apiCall<{ duel: DuelView }>('POST', duel(id) + '/accept', { body: { code } })).duel;
  },
  async decline(id: number): Promise<void> {
    await apiCall<unknown>('POST', duel(id) + '/decline', { body: {} });
  },
  async duel(id: number, signal?: AbortSignal): Promise<DuelView> {
    return (await apiCall<{ duel: DuelView }>('GET', duel(id), { signal })).duel;
  },
  async guess(id: number, guess: string, n: number): Promise<DuelView> {
    return (await apiCall<{ duel: DuelView }>('POST', duel(id) + '/guess', { body: { guess, n } })).duel;
  },
  async react(id: number, r: GameReaction): Promise<void> {
    await apiCall<unknown>('POST', duel(id) + '/react', { body: { r } });
  },
  /**
   * expect — что было на экране: 'open' — «Отменить вызов/поиск», 'active' — «Сдаться». Вызов успели принять,
   * пока подтверждали отмену, — 409 conflict (не поражение): перечитать игру.
   */
  async leave(id: number, expect: 'open' | 'active'): Promise<DuelView> {
    return (await apiCall<{ duel: DuelView }>('POST', duel(id) + '/leave', { body: { expect } })).duel;
  },
  async rematch(id: number, code: string): Promise<DuelView> {
    return (await apiCall<{ duel: DuelView }>('POST', duel(id) + '/rematch', { body: { code } })).duel;
  },
  async seen(ids: number[]): Promise<void> {
    await apiCall<unknown>('POST', base + '/seen', { body: { ids: ids.slice(0, 30) } });
  },
};

/** Адрес потока событий (EventSource сам uni= не добавит). */
export const streamUrl = (uni: string) => base + '/stream?uni=' + encodeURIComponent(uni);
