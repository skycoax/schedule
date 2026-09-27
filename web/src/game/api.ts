// Клиент API покера: /api/social/games/* (CONTRACT.md §I, формы — social/types.ts).
// Транспорт общий с «Обсуждениями» (apiCall): uni=, X-Para у изменений, конверт {ok,data} и тексты ошибок.
import { apiCall } from '../social/api';
import type { GameReaction, PokerAction, PokerView } from '../social/types';

const base = '/api/social/games';

export const gameApi = {
  /** Стол целиком (гостю тоже). */
  table(signal?: AbortSignal): Promise<PokerView> {
    return apiCall<PokerView>('GET', base, { signal, para: true });
  },
  async sit(): Promise<PokerView> {
    return (await apiCall<{ table: PokerView }>('POST', base + '/sit', { body: {} })).table;
  },
  async stand(): Promise<PokerView> {
    return (await apiCall<{ table: PokerView }>('POST', base + '/stand', { body: {} })).table;
  },
  /** amount — итоговая ставка на улице (raise «до»); у fold/check/call/allin не нужен. */
  async act(hand: number, action: PokerAction, amount?: number): Promise<PokerView> {
    const body: Record<string, unknown> = { hand, action };
    if (amount !== undefined) body.amount = amount;
    return (await apiCall<{ table: PokerView }>('POST', base + '/act', { body })).table;
  },
  async react(r: GameReaction): Promise<void> {
    await apiCall<unknown>('POST', base + '/react', { body: { r } });
  },
};

/** Адрес потока событий (EventSource сам uni= не добавит). */
export const streamUrl = (uni: string) => base + '/stream?uni=' + encodeURIComponent(uni);
