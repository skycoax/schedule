// Покер — вход в основном бандле (маленький): пять быстрых нажатий на флип-часы героя (или на весь герой, когда
// часов нет) открывают стол; точка на герое — «за столом играют»; открытие и закрытие оверлея. Сам стол — отдельный
// файл (GameHost.tsx), его грузит AppShell.
// Без registerGameHost() (адрес без Para, SingleShell) нажатия ничего не делают и часы не переворачиваются.
// Нажатия считаются в ref: переживают перерисовки героя и смену «идёт пара» ↔ «на сегодня всё».
// preventDefault и stopPropagation не вызываем никогда: прокрутка и «потянуть, чтобы обновить» — как были.
// Подсказка (useEggHint): пока стол не находили, при запуске часы подсвечиваются и рядом — «Попробуй нажать на часы
// 5 раз» с пятью точками, которые заполняются по нажатиям. Не больше трёх запусков; закрыли крестиком — больше нет.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ls, store } from '../lib/store';
import { openLayerCount } from '../ui/layers';
import { reducedMotion, setIxOrigin } from '../social/instants/motion';
import { useSession } from '../social/session';

/** Запрос на открытие: n — номер открытия (новый оверлей). */
export interface GameReq { n: number }
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

/** Открыть стол. originEl — откуда «вырастает» оверлей (часы, точка); по умолчанию часы героя, если они есть. */
export function openGame(o: { originEl?: Element | null } = {}): void {
  if (!state.host) return;
  setIxOrigin(o.originEl ?? document.querySelector('.hero .clk') ?? document.querySelector('.hero'));
  set({ status: 'open', req: { n: ++seq } });
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

/** Точка на герое: стол уже находили, и за ним сейчас кто-то играет. */
export function useGameDot(): boolean {
  const s = useSession();
  const st = useSyncExternalStore(subscribe, snapshot, snapshot);
  const players = s.status === 'signed' ? s.me?.game?.players ?? 0 : 0;
  return st.host && st.status === 'closed' && players > 0 && store('game_found') === '1';
}

// ─── Подсказка ───

const HINT_KEY = 'egg_hint';   // сколько запусков показывали (до HINT_MAX); HINT_MAX — больше не показывать
const HINT_MAX = 3;
const HINT_DELAY = 1600;       // после появления расписания
const HINT_RETRY = 1500;       // поверх что-то открыто — пробуем снова, но не дольше ~30 с
const HINT_MS = 15_000;        // сама гаснет через столько

// Один показ за запуск страницы: состояние общее для всех героев (студент, преподаватель).
let hint: 'idle' | 'wait' | 'on' | 'done' = 'idle';
let hintTimer = 0;
const hintSubs = new Set<() => void>();
const setHint = (v: typeof hint) => { hint = v; hintSubs.forEach((f) => f()); };
const subHint = (f: () => void) => { hintSubs.add(f); return () => { hintSubs.delete(f); }; };
const hintOn = () => hint === 'on';

/** Закрыть подсказку насовсем (крестик) или до следующего запуска (нашли игру, погасла сама). */
function hideHint(forever: boolean) {
  window.clearTimeout(hintTimer);
  if (forever) ls(HINT_KEY, String(HINT_MAX));
  if (hint !== 'done') setHint('done');
}

/** Подсказка про пасхалку для героя: on — показывать; close — крестик. */
export function useEggHint(): { on: boolean; close: () => void } {
  const st = useSyncExternalStore(subscribe, snapshot, snapshot);
  const on = useSyncExternalStore(subHint, hintOn, () => false);
  useEffect(() => {
    if (hint !== 'idle' || !st.host) return;
    if (store('game_found') === '1' || Number(ls(HINT_KEY) || 0) >= HINT_MAX) { hint = 'done'; return; }
    hint = 'wait';
    let tries = 20;
    const check = () => {
      if (hint !== 'wait') return;
      const tab = document.documentElement.dataset.tab;
      const busy = (tab && tab !== 'schedule') || openLayerCount(['tab']) > 0 || state.status !== 'closed'
        || !!document.querySelector('.modal.open, .sheet.open, .nudge, .umenu, .coach')
        || !document.querySelector('.clk-tap, .hero.is-egg');
      if (busy) {
        if (--tries > 0) hintTimer = window.setTimeout(check, HINT_RETRY);
        else hint = 'idle';   // не вышло — покажем при следующем запуске
        return;
      }
      ls(HINT_KEY, String(Number(ls(HINT_KEY) || 0) + 1));
      setHint('on');
      hintTimer = window.setTimeout(() => hideHint(false), HINT_MS);
    };
    hintTimer = window.setTimeout(check, HINT_DELAY);
  }, [st.host]);
  // Стол открылся — подсказка сделала своё.
  useEffect(() => { if (on && st.status !== 'closed') hideHint(false); }, [on, st.status]);
  return { on: on && st.status === 'closed', close: () => hideHint(true) };
}

export interface SecretTaps {
  className: string;
  /** Засчитанных нажатий в текущей серии (0–5) — для точек подсказки. */
  count: number;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel?: () => void;
}

/** Счётчик секретных нажатий. kind: 'clock' — обёртка часов (.clk-tap), 'hero' — весь герой без часов (.is-egg). */
export function useSecretTaps(kind: 'clock' | 'hero'): SecretTaps {
  const st = useSyncExternalStore(subscribe, snapshot, snapshot);
  const r = useRef({ down: null as null | { x: number; y: number; t: number }, count: 0, last: 0, fired: -Infinity });
  // Серия для точек подсказки: гаснет, если пауза между нажатиями больше SERIES_MS.
  const [count, setCount] = useState(0);
  const resetT = useRef(0);
  useEffect(() => () => window.clearTimeout(resetT.current), []);
  const show = (n: number) => {
    if (!hintOn()) return;
    setCount(n);
    window.clearTimeout(resetT.current);
    resetT.current = window.setTimeout(() => setCount(0), n >= TAPS ? 800 : SERIES_MS);
  };

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
    show(c.count);
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
  if (!st.host) return { className, count: 0 };
  return { className, count, onPointerDown, onPointerUp, onPointerCancel };
}
