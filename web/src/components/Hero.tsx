// Герой экрана «Сегодня»: что идёт/следующее и обратный отсчёт флип-часами.
import type { Group } from '../types';
import { parseCell, pairsOf, pairCount, type CellInfo } from '../lib/parse';
import { minutesOf, hhmm, DAYS } from '../lib/format';
import { FlipClock } from './FlipClock';

function meta(info: CellInfo): string {
  return [info.room, info.who].filter(Boolean).join(' · ');
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
      return { kind: 'ok', live: true, a: mm.a, b: mm.b, target: mm.b, label: 'Сейчас', title: info.subj, sub: meta(info), cap: 'до конца пары' };
    if (nowMin < mm.a)
      return { kind: 'ok', live: false, a: mm.a, b: mm.b, target: mm.a, label: 'Следующая', title: info.subj, sub: meta(info), cap: 'до начала · в ' + hhmm((g.times || [])[i], 0) };
  }
  const ni = DAYS.indexOf(nowDay) + 1;
  const nd = (DAYS[ni] === 'Вс' || !DAYS[ni]) ? 'Пн' : DAYS[ni];
  const np = pairsOf(g, nd);
  for (let j = 0; j < pairCount(g); j++) {
    const info = parseCell(np[j]);
    if (info) return {
      kind: 'idle', label: 'На сегодня всё', title: info.subj,
      sub: (nd === 'Пн' && nowDay !== 'Сб' ? 'В понедельник' : 'Завтра') + ' в ' + hhmm((g.times || [])[j], 0) + ' · ' + meta(info),
    };
  }
  return { kind: 'idle', label: 'На сегодня всё', title: 'Пар больше нет', sub: '' };
}

export function Hero({ group, nowMin, nowDay }: { group: Group; nowMin: number; nowDay: string }) {
  const h = heroState(group, nowMin, nowDay);

  if (h.kind === 'idle') {
    return (
      <div className="hero">
        <div className="hero__lbl is-idle">{h.label}</div>
        <div className="hero__title">{h.title}</div>
        {h.sub && <div className="hero__meta">{h.sub}</div>}
      </div>
    );
  }

  const left = (h.target - nowMin) * 60;
  const cp = clockParts(left);
  const span = (h.b - h.a) * 60;
  const done = h.live ? (span - left) / span : Math.max(0, 1 - left / 3600);

  return (
    <div className="hero">
      <div className="hero__lbl">{h.label}</div>
      <FlipClock digits={cp.d} labels={[cp.a, cp.b]} />
      <div className="hero__cap">{h.cap}</div>
      <div className="hero__bar"><i style={{ width: Math.max(0, Math.min(1, done)) * 100 + '%' }} /></div>
      <div className="hero__title">{h.title}</div>
      {h.sub && <div className="hero__meta">{h.sub}</div>}
    </div>
  );
}
