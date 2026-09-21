// Карточка одного дня: полоса пар + строки. Перенос dayCard/strip/rowOf.
import type { Group } from '../types';
import type { ChangeItem } from '../types';
import { parseCell, pairsOf, pairState, pairCount } from '../lib/parse';
import { minutesOf, hhmm, dur, plural, FULL } from '../lib/format';

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
