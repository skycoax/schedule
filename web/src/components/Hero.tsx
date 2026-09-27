// Герой экрана «Сегодня»: что идёт/следующее и обратный отсчёт флип-часами.
// Секрет: пять быстрых нажатий на часы (или на весь герой, когда часов нет) открывают покер
// (game/entry.ts); пока он открыт, часы показывают «??:??». Точка в углу — за столом кто-то играет.
// Пока стол не находили — при запуске часы подсвечиваются и рядом подсказка «Попробуй нажать 5 раз» (useEggHint).
import type { JSX } from 'react';
import type { Group } from '../types';
import { parseCell, pairsOf, pairCount, type CellInfo } from '../lib/parse';
import { minutesOf, hhmm, plural, DAYS } from '../lib/format';
import { FlipClock } from './FlipClock';
import { openGame, useEggHint, useGameDot, useGameRequest, useSecretTaps } from '../game/entry';

function meta(info: CellInfo, g?: Group, day?: string, i?: number): string {
  // Совместная пара — коротко в той же строке; список групп есть в карточке дня.
  const n = g && day ? ((g.with || {})[day + '#' + ((i || 0) + 1)] || []).length : 0;
  const mates = n ? 'вместе с ' + n + ' ' + plural(n, 'группой', 'группами', 'группами') : '';
  return [info.room, info.who, mates].filter(Boolean).join(' · ');
}
function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }
function clockParts(sec: number): { d: string; a: string; b: string } {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return h ? { d: pad2(h) + pad2(m), a: 'ч', b: 'мин' } : { d: pad2(m) + pad2(ss), a: 'мин', b: 'сек' };
}

type Hero =
  | { kind: 'idle'; label: string; title: string; sub: string }
  | { kind: 'ok'; live: boolean; a: number; b: number; target: number; label: string; title: string; sub: string; cap: string };

function heroState(g: Group, nowMin: number, nowDay: string): Hero {
  if (nowDay === 'Вс') return { kind: 'idle', label: 'Воскресенье', title: 'Занятий нет', sub: 'Следующий день — понедельник' };
  const pairs = pairsOf(g, nowDay);
  for (let i = 0; i < pairCount(g); i++) {
    const info = parseCell(pairs[i]); if (!info) continue;
    const mm = minutesOf((g.times || [])[i]); if (!mm) continue;
    if (nowMin >= mm.a && nowMin < mm.b)
      return { kind: 'ok', live: true, a: mm.a, b: mm.b, target: mm.b, label: 'Сейчас', title: info.subj, sub: meta(info, g, nowDay, i), cap: 'до конца пары' };
    if (nowMin < mm.a)
      return { kind: 'ok', live: false, a: mm.a, b: mm.b, target: mm.a, label: 'Следующая', title: info.subj, sub: meta(info, g, nowDay, i), cap: 'до начала · в ' + hhmm((g.times || [])[i], 0) };
  }
  const ni = DAYS.indexOf(nowDay) + 1;
  const nd = (DAYS[ni] === 'Вс' || !DAYS[ni]) ? 'Пн' : DAYS[ni];
  const np = pairsOf(g, nd);
  for (let j = 0; j < pairCount(g); j++) {
    const info = parseCell(np[j]);
    if (info) return {
      kind: 'idle', label: 'На сегодня всё', title: info.subj,
      sub: (nd === 'Пн' && nowDay !== 'Сб' ? 'В понедельник' : 'Завтра') + ' в ' + hhmm((g.times || [])[j], 0) + ' · ' + meta(info, g, nd, j),
    };
  }
  return { kind: 'idle', label: 'На сегодня всё', title: 'Пар больше нет', sub: '' };
}

/** Подсказка под часами (или под карточкой без часов): текст, пять точек по нажатиям, крестик. */
function EggHint({ idle, count, onClose }: { idle: boolean; count: number; onClose: () => void }): JSX.Element {
  return (
    <div className={'egg-hint' + (idle ? ' egg-hint--idle' : '')} role="status">
      <span className="egg-hint__t">{idle ? 'Попробуй нажать на карточку 5 раз' : 'Попробуй нажать на часы 5 раз'}</span>
      <span className="egg-hint__dots" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < count ? 'on' : ''} />)}
      </span>
      <button type="button" className="egg-hint__x" aria-label="Скрыть подсказку" onClick={onClose}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** Точка «За столом играют»: нажатие сразу открывает стол (без пяти нажатий). */
function GameDot(): JSX.Element {
  return (
    <button type="button" className="hero__dot" aria-label="Покер: за столом играют или ждёт бонус"
      onClick={(e) => openGame({ originEl: e.currentTarget })}>
      <i />
    </button>
  );
}

export function Hero({ group, nowMin, nowDay }: { group: Group; nowMin: number; nowDay: string }) {
  const h = heroState(group, nowMin, nowDay);
  // Хуки — до раннего выхода: счётчик нажатий переживает смену «идёт пара» ↔ «на сегодня всё».
  const { className: tapClass, count, ...taps } = useSecretTaps(h.kind === 'idle' ? 'hero' : 'clock');
  const game = useGameRequest();
  const dot = useGameDot();
  const hint = useEggHint();
  const hintCls = hint.on ? ' is-hint' : '';

  if (h.kind === 'idle') {
    // Подсказка — рядом с карточкой, а не внутри: нажатия на неё не считаются нажатиями по карточке.
    return (
      <div className="hero-wrap">
        <div className={'hero ' + tapClass + hintCls} {...taps}>
          {dot && <GameDot />}
          <div className="hero__lbl is-idle">{h.label}</div>
          <div className="hero__title">{h.title}</div>
          {h.sub && <div className="hero__meta">{h.sub}</div>}
        </div>
        {hint.on && <EggHint idle count={count} onClose={hint.close} />}
      </div>
    );
  }

  const left = (h.target - nowMin) * 60;
  const cp = clockParts(left);
  const span = (h.b - h.a) * 60;
  const done = h.live ? (span - left) / span : Math.max(0, 1 - left / 3600);

  return (
    <div className="hero">
      {dot && <GameDot />}
      <div className="hero__lbl">{h.label}</div>
      <div className="clk-wrap">
        <div className={tapClass + hintCls} {...taps}>
          <FlipClock digits={cp.d} labels={[cp.a, cp.b]} override={game.status !== 'closed' ? '????' : undefined} />
        </div>
        {hint.on && <EggHint idle={false} count={count} onClose={hint.close} />}
      </div>
      <div className="hero__cap">{h.cap}</div>
      <div className="hero__bar"><i style={{ width: Math.max(0, Math.min(1, done)) * 100 + '%' }} /></div>
      <div className="hero__title">{h.title}</div>
      {h.sub && <div className="hero__meta">{h.sub}</div>}
    </div>
  );
}
