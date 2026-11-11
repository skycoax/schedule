// Клиент API шахмат: /api/social/chess/* (CONTRACT.md §I, формы — social/types.ts). Только партии с друзьями:
// игра с ботом целиком в приложении (bot.ts). Транспорт общий с «Обсуждениями» (apiCall): uni=, X-Para у изменений,
// конверт {ok,data} и тексты ошибок.
import { apiCall } from '../social/api';
import type { ChessGame, ChessList } from '../social/types';

const base = '/api/social/chess';

export const chessApi = {
  /** Мои партии: идущие и последние законченные, счёт побед. */
  list(signal?: AbortSignal): Promise<ChessList> {
    return apiCall<ChessList>('GET', base, { signal });
  },
  async game(id: number, signal?: AbortSignal): Promise<ChessGame> {
    return (await apiCall<{ game: ChessGame }>('GET', base + '/' + id, { signal })).game;
  },
  /** Позвать друга: у него сразу появится «… зовёт тебя сыграть в шахматы». */
  async invite(to: number): Promise<void> {
    await apiCall<unknown>('POST', base + '/invite', { body: { to } });
  },
  async dismiss(): Promise<void> {
    await apiCall<unknown>('POST', base + '/invite/dismiss', { body: {} });
  },
  /** Принять приглашение друга from: партия создаётся, цвет случайный. */
  async accept(from: number): Promise<ChessGame> {
    return (await apiCall<{ game: ChessGame }>('POST', base + '/accept', { body: { from } })).game;
  },
  /** Ход в UCI ('e2e4', 'e7e8q'); ply — сколько полуходов было до него (сервер сверит). */
  async move(id: number, move: string, ply: number): Promise<ChessGame> {
    return (await apiCall<{ game: ChessGame }>('POST', base + '/' + id + '/move', { body: { move, ply } })).game;
  },
  async resign(id: number): Promise<ChessGame> {
    return (await apiCall<{ game: ChessGame }>('POST', base + '/' + id + '/resign', { body: {} })).game;
  },
  async draw(id: number, action: 'offer' | 'accept' | 'decline'): Promise<ChessGame> {
    return (await apiCall<{ game: ChessGame }>('POST', base + '/' + id + '/draw', { body: { action } })).game;
  },
};
