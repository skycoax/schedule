// Клиент API покера: /api/social/games/* (CONTRACT.md §I, формы — social/types.ts).
// Транспорт общий с «Обсуждениями» (apiCall): uni=, X-Para у изменений, конверт {ok,data} и тексты ошибок.
import { apiCall } from '../social/api';
import type { GameReaction, PokerAction, PokerTop, PokerTopScope, PokerView } from '../social/types';

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
  /** Забрать ежедневный бонус: got — сколько фишек пришло, table — стол со свежим me. */
  bonus(): Promise<{ got: number; table: PokerView }> {
    return apiCall<{ got: number; table: PokerView }>('POST', base + '/bonus', { body: {} });
  },
  /** Рейтинг по фишкам: друзья или все (в «Все» — взрослые из поиска и друзья). */
  top(scope: PokerTopScope, signal?: AbortSignal): Promise<PokerTop> {
    return apiCall<PokerTop>('GET', base + '/top', { params: { scope }, signal });
  },
  /** Позвать друга: у него сразу появится «… зовёт тебя в покер». */
  async invite(to: number): Promise<void> {
    await apiCall<unknown>('POST', base + '/invite', { body: { to } });
  },
};

/** Адрес потока событий (EventSource сам uni= не добавит). */
export const streamUrl = (uni: string) => base + '/stream?uni=' + encodeURIComponent(uni);
