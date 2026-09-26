// Мелкие части экранов «Кода»: верхняя строка, значки ●○·, 12 точек попыток, ячейки цифр, клавиатура,
// код, который переворачивается цифра за цифрой, тексты (попытки, время по Ташкенту) и ошибки.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { FlipDigit } from '../components/FlipClock';
import { Icon } from '../ui/icons';
import { plural } from '../lib/plural';
import { isApiError } from '../social/api';
import { reducedMotion } from '../social/instants/motion';
import type { GameReaction } from '../social/types';
import { markGlyphs, randomCode } from './logic';

// ─── Экран в стеке: сверху ли он (клавиатура компьютера — только у верхнего) ───

export interface ScreenInfo { top: boolean; index: number }
export const ScreenCtx = createContext<ScreenInfo>({ top: true, index: 0 });
export const useScreen = (): ScreenInfo => useContext(ScreenCtx);

// ─── Тексты ───

export const REACTIONS: readonly { id: GameReaction; emoji: string; label: string }[] = [
  { id: 'wave', emoji: '👋', label: 'Привет' },
  { id: 'like', emoji: '👍', label: 'Класс' },
  { id: 'wow', emoji: '😮', label: 'Ого' },
  { id: 'lol', emoji: '😂', label: 'Смешно' },
  { id: 'fire', emoji: '🔥', label: 'Огонь' },
  { id: 'deal', emoji: '🤝', label: 'По рукам' },
];
export const emojiOf = (r: GameReaction): string => REACTIONS.find((x) => x.id === r)?.emoji || '';

/** «1 попытка», «3 попытки», «6 попыток». */
export const attemptsText = (n: number): string => n + ' ' + plural(n, ['попытка', 'попытки', 'попыток']);
/** «за 1 попытку», «за 3 попытки», «за 6 попыток». */
export const inAttempts = (n: number): string => 'за ' + n + ' ' + plural(n, ['попытку', 'попытки', 'попыток']);
/** «Осталась 1 попытка», «Осталось 9 попыток». */
export const leftText = (n: number): string =>
  (plural(n, ['Осталась', 'Осталось', 'Осталось'])) + ' ' + attemptsText(n);

const TZ = 'Asia/Tashkent';
const TZ_MS = 5 * 3600e3;
const DAY = 864e5;
let fmtDay: Intl.DateTimeFormat | null = null;
let fmtHm: Intl.DateTimeFormat | null = null;
const dayKey = (t: number) => Math.floor((t + TZ_MS) / DAY);

/** '2026-09-26' → «26 сентября». */
export function dayTitle(day: string): string {
  const t = Date.parse(day + 'T12:00:00+05:00');
  if (!Number.isFinite(t)) return '';
  fmtDay ??= new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long' });
  return fmtDay.format(t);
}

/** «14:30» по Ташкенту. */
export function hm(t: number): string {
  fmtHm ??= new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return fmtHm.format(t);
}

/** «до 14:30» или «до завтра, 14:30». */
export function untilText(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return dayKey(t) > dayKey(now) ? 'до завтра, ' + hm(t) : 'до ' + hm(t);
}

/** «ещё 18 ч» · «ещё 40 мин». */
export function leftTime(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms < 3600e3) return 'ещё ' + Math.max(1, Math.ceil(ms / 60e3)) + ' мин';
  return 'ещё ' + Math.floor(ms / 3600e3) + ' ч';
}

/** 161000 → «2:41»; час и больше — «1:02:41». */
export function fmtMs(ms: number | null): string {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

/** Код вида «4071» → «4 0 7 1» (для чтения глазами и экранным чтецом). */
export const spaced = (code: string): string => code.split('').join(' ');

// ─── Ошибки ───

/** Эти ошибки показывает сама сессия (вход, профиль, правила, ограничение). */
export function handledBySession(e: unknown): boolean {
  return isApiError(e) && (e.code === 'auth' || e.code === 'profile' || e.code === 'rules' || e.code === 'banned');
}
export function errText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Не получилось — попробуй ещё раз';
}
export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

// ─── Значки ───

type GIconName = 'smile' | 'help';
const GICONS: Record<GIconName, { s: string; f: string }> = {
  smile: {
    s: 'M3.25 12a8.75 8.75 0 1 0 17.5 0a8.75 8.75 0 1 0 -17.5 0M8.3 14.4c.9 1.3 2.2 2 3.7 2s2.8-.7 3.7-2',
    f: 'M8.3 9.8a1.15 1.15 0 1 0 2.3 0a1.15 1.15 0 1 0 -2.3 0ZM13.4 9.8a1.15 1.15 0 1 0 2.3 0a1.15 1.15 0 1 0 -2.3 0Z',
  },
  help: {
    s: 'M3.25 12a8.75 8.75 0 1 0 17.5 0a8.75 8.75 0 1 0 -17.5 0M9.5 9.6a2.6 2.6 0 1 1 3.7 2.3c-.8.4-1.2 1-1.2 1.8v.2',
    f: 'M10.95 16.9a1.05 1.05 0 1 0 2.1 0a1.05 1.05 0 1 0 -2.1 0Z',
  },
};

/** Значки игры, которых нет в общем наборе (ui/icons): улыбка (реакции) и «?» (как играть). */
export function GIcon(p: { name: GIconName; size?: number }): JSX.Element {
  const d = GICONS[p.name];
  const size = p.size ?? 24;
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d.f} fill="currentColor" stroke="none" />
      <path d={d.s} />
    </svg>
  );
}

// ─── Верхняя строка ───

export function Bar(p: { left: 'close' | 'back'; onLeft: () => void; title?: ReactNode; right?: ReactNode }): JSX.Element {
  return (
    <div className="ix__bar gx-bar">
      <button type="button" className="ix__icon" aria-label={p.left === 'close' ? 'Закрыть' : 'Назад'} onClick={p.onLeft}>
        <Icon name={p.left === 'close' ? 'close' : 'back'} size={24} />
      </button>
      {typeof p.title === 'string' ? <h2 className="ix__title">{p.title}</h2> : <div className="gx-bar__mid">{p.title}</div>}
      <div className="gx-bar__r">{p.right}</div>
    </div>
  );
}

// ─── ●○· и точки попыток ───

/** Ответ на попытку: ● на месте, ○ не на месте, · — нет. Порядок значков о цифрах ничего не говорит. */
export function Marks(p: { on: number; near: number; fresh?: boolean; small?: boolean }): JSX.Element {
  const g = markGlyphs(p.on, p.near);
  return (
    <span className={'gx-mk' + (p.fresh ? ' is-new' : '') + (p.small ? ' is-sm' : '')} aria-hidden="true">
      {[...g].map((c, i) => (
        <i key={i} className={c === '●' ? 'on' : c === '○' ? 'near' : 'none'} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  );
}

/** 12 точек: закрашены — сделанные попытки. */
export function Pips(p: { n: number; of?: number }): JSX.Element {
  const of = p.of ?? 12;
  return (
    <span className="gx-pips" aria-hidden="true">
      {Array.from({ length: of }, (_, i) => <i key={i} className={i < p.n ? 'on' : ''} />)}
    </span>
  );
}

// ─── Ячейки и клавиатура ───

/** Четыре ячейки-створки: пустая — «·», набранная цифра переворачивается. */
export function Slots(p: { value: string; small?: boolean }): JSX.Element {
  return (
    <div className={'gx-slots' + (p.small ? ' is-sm' : '')}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="gx-slot" role="img" aria-label={'Цифра ' + (i + 1) + ' из 4' + (p.value[i] ? ': ' + p.value[i] : '')}>
          <FlipDigit char={p.value[i] || '·'} className={p.value[i] ? undefined : 'is-empty'} />
        </span>
      ))}
    </div>
  );
}

/** Цифровая клавиатура 1–9 / [слева] 0 ⌫. Уже набранные цифры — бледные (цифры в коде не повторяются). */
export function Keypad(p: {
  value: string; onDigit: (d: string) => void; onErase: () => void;
  left: { label: string; onClick: () => void }; disabled?: boolean;
}): JSX.Element {
  const key = (d: string) => {
    const used = p.value.includes(d);
    return (
      <button key={d} type="button" className={'gx-key' + (used ? ' is-used' : '')} disabled={p.disabled}
        aria-disabled={used || undefined} onClick={() => { if (!used) p.onDigit(d); }}>{d}</button>
    );
  };
  return (
    <div className="gx-keys">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key)}
      <button type="button" className="gx-key gx-key--word" disabled={p.disabled} onClick={p.left.onClick}>{p.left.label}</button>
      {key('0')}
      <button type="button" className="gx-key gx-key--word" disabled={p.disabled || !p.value} aria-label="Стереть" onClick={p.onErase}>⌫</button>
    </div>
  );
}

/** Набор кода: цифры не повторяются, не больше четырёх. active — ещё и с клавиатуры компьютера (Enter — onEnter). */
export function useCode(active: boolean, onEnter?: () => void): {
  code: string; set: (c: string) => void; add: (d: string) => void; erase: () => void; clear: () => void; random: () => void;
} {
  const [code, setCode] = useState('');
  const enter = useRef(onEnter);
  enter.current = onEnter;
  const add = (d: string) => setCode((c) => (c.length >= 4 || c.includes(d) ? c : c + d));
  const erase = () => setCode((c) => c.slice(0, -1));
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      // Поверх игры открыт лист или меню — клавиши его.
      if (document.querySelector('.ui-layer, .ui-as-layer, .ui-as')) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); setCode((c) => (c.length >= 4 || c.includes(e.key) ? c : c + e.key)); }
      else if (e.key === 'Backspace') { e.preventDefault(); setCode((c) => c.slice(0, -1)); }
      else if (e.key === 'Enter' && !(t instanceof HTMLButtonElement) && enter.current) { e.preventDefault(); enter.current(); }
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [active]);
  return { code, set: setCode, add, erase, clear: () => setCode(''), random: () => setCode(randomCode()) };
}

/** Код, который переворачивается из «····» в цифры по одной (80 мс между ними). */
export function FlipCode(p: { code: string | null; label: string }): JSX.Element {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!p.code) { setShown(0); return; }
    if (reducedMotion()) { setShown(4); return; }
    const ts = [0, 1, 2, 3].map((i) => window.setTimeout(() => setShown((s) => Math.max(s, i + 1)), 200 + i * 80));
    return () => ts.forEach(clearTimeout);
  }, [p.code]);
  return (
    <span className="gx-code" role="img" aria-label={p.label + ': ' + (p.code ? spaced(p.code) : 'неизвестен')}>
      {[0, 1, 2, 3].map((i) => <FlipDigit key={i} className="is-sm" char={p.code && i < shown ? p.code[i] : '·'} />)}
    </span>
  );
}

/** Строка истории: «3   1 0 7 4   ●●○○»; первая ещё и словами — чтобы было понятно, что значат значки. */
export function MoveRow(p: { i: number; g: string; on: number; near: number; fresh: boolean }): JSX.Element {
  return (
    <li className={'gx-move' + (p.fresh ? ' is-new' : '')}
      aria-label={'Попытка ' + p.i + ': ' + spaced(p.g) + ' — ' + p.on + ' на месте, ' + p.near + ' не на месте'}>
      <span className="gx-move__n" aria-hidden="true">{p.i}</span>
      <span className="gx-move__g" aria-hidden="true">{spaced(p.g)}</span>
      <Marks on={p.on} near={p.near} fresh={p.fresh} />
      {p.i === 1 && <span className="gx-move__w" aria-hidden="true">{p.on} на месте · {p.near} не на месте</span>}
    </li>
  );
}
