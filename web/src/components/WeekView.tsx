// Экран «Неделя»: матрица дни×пары, сводка и легенда предметов + карточки дней.
import type { Group, ChangeItem } from '../types';
import { parseCell, pairsOf, pairState, pairCount, buildColors } from '../lib/parse';
import { minutesOf, plural, DAYS, FULL } from '../lib/format';
import { DayCard } from './DayCard';

interface Ctx { colorOf: (s: string) => string; nowDay: string; nowMin: number; edits: Record<string, ChangeItem>; }

const D6 = DAYS.slice(0, 6);

function Matrix({ g, ctx }: { g: Group; ctx: Ctx }) {
  return (
    <div className="matrix">
      <table><tbody>
        <tr>
          <th></th>
          {D6.map((d) => <th key={d} className={d === ctx.nowDay ? 'today' : ''}>{d}</th>)}
        </tr>
        {Array.from({ length: pairCount(g) }, (_, i) => i).map((i) => (
          <tr key={i}>
            <td className="n">{i + 1}</td>
            {D6.map((d) => {
              const info = parseCell(pairsOf(g, d)[i]);
              if (!info) return <td key={d} className="cell" />;
              const st = pairState(g, i, d, ctx.nowDay, ctx.nowMin);
              return (
                <td key={d} className={'cell on' + (st === 'live' ? ' live' : '')}
                  style={{ ['--c' as string]: ctx.colorOf(info.subj), ...(st === 'past' ? { opacity: 0.3 } : {}) }}
                  title={info.subj + ' · ' + FULL[d]} />
              );
            })}
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

function Stats({ g }: { g: Group }) {
  let total = 0, gaps = 0;
  const perDay: { day: string; n: number }[] = [];
  D6.forEach((d) => {
    const idx: number[] = [];
    for (let i = 0, n = pairCount(g); i < n; i++) if (parseCell(pairsOf(g, d)[i])) idx.push(i);
    total += idx.length;
    perDay.push({ day: d, n: idx.length });
    for (let k = 1; k < idx.length; k++) {
      const a = minutesOf((g.times || [])[idx[k - 1]]), b = minutesOf((g.times || [])[idx[k]]);
      if (a && b) gaps += Math.max(0, b.a - a.b);
    }
  });
  const heavy = perDay.slice().sort((x, y) => y.n - x.n)[0] || { day: '—', n: 0 };
  return (
    <div className="stats">
      <div className="stat"><b>{total}</b><span>пар в неделю</span></div>
      <div className="stat"><b>{heavy.day}</b><span>плотнее всего</span></div>
      <div className="stat"><b>{gaps ? Math.round(gaps / 60 * 10) / 10 : 0} ч</b><span>в окнах</span></div>
    </div>
  );
}

// week — «Неделя A/B», если у вуза пары чередуются: тогда показана именно она.
export function WeekView({ group, ctx, week }: { group: Group; ctx: Ctx; week?: string }) {
  const colors = buildColors(group);
  const subjects = colors.subjects;
  const max = subjects.reduce((m, s) => Math.max(m, s.n), 1);
  const legend = subjects.slice().sort((a, b) => b.n - a.n);

  return (
    <>
      <div className="card">
        <div className="card__hdr">
          <div className="card__title">{week || 'Неделя целиком'}</div>
          <div className="card__count">{subjects.length} {plural(subjects.length, 'предмет', 'предмета', 'предметов')}</div>
        </div>
        <Matrix g={group} ctx={ctx} />
        <Stats g={group} />
        {!!subjects.length && (
          <div className="legend">
            {legend.map((s) => (
              <div key={s.key} className="leg" style={{ ['--c' as string]: s.color }}>
                <span className="dot dot--sub"></span>
                <span className="leg__name">{s.name}</span>
                <span className="leg__bar"><i style={{ width: Math.round(s.n / max * 100) + '%' }} /></span>
                <span className="leg__n">{s.n}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div id="days">
        {D6.map((d) => <DayCard key={d} g={group} day={d} note={d === ctx.nowDay ? 'сегодня' : ''} ctx={ctx} />)}
      </div>
    </>
  );
}
