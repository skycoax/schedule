// Карточка одного дня: полоса пар + строки. Перенос dayCard/strip/rowOf.
import { useState } from 'react';
import type { Group } from '../types';
import type { ChangeItem } from '../types';
import { parseCell, pairsOf, pairState, pairCount } from '../lib/parse';
import { minutesOf, hhmm, dur, plural, FULL } from '../lib/format';

// Код направления («09.03.02») в хвосте названия группы КФУ — в списке соседей лишний.
const withName = (name: string) => name.replace(/\s*\d{2}\.\d{2}\.\d{2}\s*$/, '').trim();
const WITH_SHOWN = 12;

/** «Вместе с 2 группами» — совместная пара; по нажатию раскрывается список групп. */
function Together({ names }: { names: string[] }) {
  const [open, setOpen] = useState(false);
  const n = names.length;
  const shown = names.slice(0, WITH_SHOWN);
  const people = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M17 13.8a5.5 5.5 0 0 1 3.5 5.2" />
    </svg>
  );
  // Одна соседняя группа с коротким названием — пишем его сразу, раскрывать нечего.
  const one = n === 1 ? withName(names[0]) : '';
  if (one && one.length <= 24) return <div className="with">{people}<span>Вместе с {one}</span></div>;
  return (
    <>
      <button className={'with' + (open ? ' is-open' : '')} aria-expanded={open} onClick={() => setOpen(!open)}>
        {people}
        <span>Вместе с {n} {plural(n, 'группой', 'группами', 'группами')}</span>
        <svg className="with__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </button>
      {open && (
        <div className="with__list">
          {shown.map((x) => <span key={x} className="with__g">{withName(x)}</span>)}
          {n > shown.length && <span className="with__more">и ещё {n - shown.length}</span>}
        </div>
      )}
    </>
  );
}

interface Ctx {
  colorOf: (s: string) => string;
  nowDay: string;
  nowMin: number;
  edits: Record<string, ChangeItem>;
}

function Strip({ g, day, ctx }: { g: Group; day: string; ctx: Ctx }) {
  const p = pairsOf(g, day);
  const n = pairCount(g);
  const cells = [];
  for (let i = 0; i < n; i++) {
    const info = parseCell(p[i]);
    if (info) {
      const st = pairState(g, i, day, ctx.nowDay, ctx.nowMin) || 'busy';
      cells.push(<i key={i} className={st} style={{ ['--c' as string]: ctx.colorOf(info.subj) }} />);
    } else {
      cells.push(<i key={i} />);
    }
  }
  return <div className="strip" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>{cells}</div>;
}

function Row({ g, day, i, txt, ch, ctx }: { g: Group; day: string; i: number; txt: string; ch?: ChangeItem; ctx: Ctx }) {
  const info = parseCell(txt)!;
  const st = pairState(g, i, day, ctx.nowDay, ctx.nowMin);
  const time = (g.times || [])[i] || '';
  const col = ctx.colorOf(info.subj);
  const mates = (g.with || {})[day + '#' + (i + 1)];
  return (
    <div className={'row' + (st ? ' is-' + st : '')} style={{ ['--c' as string]: col }}>
      <div className="row__top">
        <div className="row__name">{info.subj}</div>
        {ch && (
          <span className="chg" title={ch.before ? 'Было: ' + ch.before : 'Пару добавили'}>
            {ch.before ? 'изменено' : 'новая'}
          </span>
        )}
        <div className="row__ms">{hhmm(time, 0)}</div>
      </div>
      {(info.room || info.who) && (
        <div className="row__line2">
          {info.room && <span className="room">{info.room}</span>}
          {info.who && <span className="who">{info.who}</span>}
        </div>
      )}
      {mates && mates.length > 0 && <Together names={mates} />}
    </div>
  );
}

export function DayCard({ g, day, note, ctx }: { g: Group; day: string; note?: string; ctx: Ctx }) {
  const p = pairsOf(g, day);
  const filled: number[] = [];
  for (let i = 0, n = pairCount(g); i < n; i++) if (parseCell(p[i])) filled.push(i);

  const isNow = day === ctx.nowDay;
  const head = (
    <div className="card__hdr">
      <div className="card__title">{FULL[day]}{note ? <span> {note}</span> : null}</div>
      <div className={'card__count' + (isNow && filled.length ? ' is-now' : '')}>
        {filled.length ? filled.length + ' ' + plural(filled.length, 'пара', 'пары', 'пар') : 'нет пар'}
      </div>
    </div>
  );

  if (!filled.length) {
    return <div className="card">{head}<div className="empty">Занятий нет</div></div>;
  }

  const body: React.ReactNode[] = [];
  let prev = -1;
  filled.forEach((i) => {
    if (prev === -1 && i > 0) {
      body.push(<div key={'f' + i} className="free">Начало в {hhmm((g.times || [])[i], 0)}</div>);
    } else if (prev >= 0 && i - prev > 1) {
      const a = minutesOf((g.times || [])[prev]), b = minutesOf((g.times || [])[i]);
      body.push(<div key={'f' + i} className="free">Окно {a && b ? dur(b.a - a.b) : ''}</div>);
    }
    body.push(<Row key={'r' + i} g={g} day={day} i={i} txt={p[i]} ch={ctx.edits[day + '#' + (i + 1)]} ctx={ctx} />);
    prev = i;
  });

  return <div className="card">{head}<Strip g={g} day={day} ctx={ctx} />{body}</div>;
}
