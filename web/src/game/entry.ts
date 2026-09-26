// Игра «Код» — вход в основном бандле (маленький): пять быстрых нажатий на флип-часы героя
// (или на весь герой, когда часов нет) открывают игру; точка «Тебя ждёт игра» на герое;
// открытие и закрытие оверлея. Сама игра — отдельный файл (GameHost.tsx), его грузит AppShell.
// Без registerGameHost() (адрес без Para, SingleShell) нажатия ничего не делают и часы не переворачиваются.
// Нажатия считаются в ref: переживают перерисовки героя и смену «идёт пара» ↔ «на сегодня всё».
// preventDefault и stopPropagation не вызываем никогда: прокрутка и «потянуть, чтобы обновить» — как были.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { store } from '../lib/store';
import { openLayerCount } from '../ui/layers';
import { reducedMotion, setIxOrigin } from '../social/instants/motion';
import { useSession } from '../social/session';

/** Какой экран открыть первым (кроме лобби, которое всегда под ним). */
export type GameScreenName = 'lobby' | 'daily' | 'practice' | 'join';
/** Запрос на открытие: n — номер открытия (новый оверлей), duel — код вызова из ссылки. */
export interface GameReq { n: number; duel?: string; screen?: GameScreenName }
export type GameStatus = 'closed' | 'opening' | 'open';
interface GameState { status: GameStatus; req: GameReq | null; host: boolean }

const MOVE_PX = 10;          // сдвиг пальца больше — это прокрутка, не нажатие
const PRESS_MS = 600;        // дольше — долгое нажатие
const SERIES_MS = 1500;      // между нажатиями серии — не дольше
const COOLDOWN_MS = 1000;    // после открытия новая серия не раньше
const TAPS = 5;
const OPEN_DELAY = 420;      // «??:??» успевает перевернуться, потом оверлей вырастает из часов
const PRESS_FX_MS = 120;

let state: GameState = { status: 'closed', req: null, host: false };
let seq = 0;
const subs = new Set<() => void>();
const set = (next: Partial<GameState>) => { state = { ...state, ...next }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => state;

/** AppShell (HubShell) при монтировании: без этого нажатия на часы ничего не делают. Возвращает отмену. */
export function registerGameHost(): () => void {
  set({ host: true });
  return () => set({ host: false, status: 'closed', req: null });
}

/** Открыть игру. originEl — откуда «вырастает» оверлей (часы, точка); по умолчанию часы героя, если они есть. */
export function openGame(o: { originEl?: Element | null; duel?: string; screen?: GameScreenName } = {}): void {
  if (!state.host) return;
  setIxOrigin(o.originEl ?? document.querySelector('.hero .clk') ?? document.querySelector('.hero'));
  const req: GameReq = { n: ++seq };
  if (o.duel) req.duel = o.duel;
  if (o.screen) req.screen = o.screen;
  set({ status: 'open', req });
}

/** Оверлей начал уходить: часы переворачиваются обратно, пока он сжимается в них. */
export function gameClosing(): void {
  if (state.status !== 'closed') set({ status: 'closed' });
}

/** Оверлей убран совсем (или его файл не загрузился). */
export function closeGame(): void {
  set({ status: 'closed', req: null });
}

export function useGameRequest(): { req: GameReq | null; status: GameStatus } {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Точка на герое: игру уже находили, и в ней что-то ждёт (ход, итог, вызов друга). */
export function useGameDot(): boolean {
  const s = useSession();
  const st = useSyncExternalStore(subscribe, snapshot, snapshot);
  const waiting = s.status === 'signed' ? s.me?.game?.waiting ?? 0 : 0;
  return st.host && st.status === 'closed' && waiting > 0 && store('game_found') === '1';
}

export interface SecretTaps {
  className: string;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel?: () => void;
}

/** Счётчик секретных нажатий. kind: 'clock' — обёртка часов (.clk-tap), 'hero' — весь герой без часов (.is-egg). */
export function useSecretTaps(kind: 'clock' | 'hero'): SecretTaps {
  const st = useSyncExternalStore(subscribe, snapshot, snapshot);
  const r = useRef({ down: null as null | { x: number; y: number; t: number }, count: 0, last: 0, fired: -Infinity });

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) { r.current.down = null; return; }
    r.current.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  }, []);

  const onPointerCancel = useCallback(() => { r.current.down = null; }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const c = r.current;
    const d = c.down;
    c.down = null;
    if (!d || state.status !== 'closed') return;
    const t = performance.now();
    const tab = document.documentElement.dataset.tab;
    if (Math.abs(e.clientX - d.x) > MOVE_PX || Math.abs(e.clientY - d.y) > MOVE_PX || t - d.t > PRESS_MS) return;
    if (openLayerCount(['tab']) !== 0 || (tab && tab !== 'schedule') || t - c.fired < COOLDOWN_MS) return;
    c.count = t - c.last <= SERIES_MS ? c.count + 1 : 1;
    c.last = t;
    const el = e.currentTarget;
    if (c.count === 3 || c.count === 4) {
      // Тайна остаётся тайной: первые два нажатия — ничего, третье и четвёртое — едва заметный отклик.
      if (!reducedMotion()) {
        el.classList.add('is-press');
        window.setTimeout(() => el.classList.remove('is-press'), PRESS_FX_MS);
      }
      navigator.vibrate?.(8);
      return;
    }
    if (c.count < TAPS) return;
    c.count = 0;
    c.fired = t;
    navigator.vibrate?.(12);
    set({ status: 'opening' });
    const go = () => {
      if (state.status !== 'opening' || !state.host) return;
      setIxOrigin(el.isConnected ? el : document.querySelector('.hero'));
      set({ status: 'open', req: { n: ++seq } });
    };
    if (reducedMotion()) go();
    else window.setTimeout(go, OPEN_DELAY);
  }, []);

  const className = kind === 'clock' ? 'clk-tap' : 'is-egg';
  if (!st.host) return { className };
  return { className, onPointerDown, onPointerUp, onPointerCancel };
}
