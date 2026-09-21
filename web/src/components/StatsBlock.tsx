// Статистика на главном экране: слева мини-график людей за две недели, справа числа.
// Линия нарисована своим SVG, а не recharts: этот блок видят все, и тянуть сюда
// ~190 КБ библиотеки ради одного силуэта незачем. Подробный график — в модале.
import { useState, type PointerEvent } from 'react';
import type { Summary } from '../api';
import { plural } from '../lib/plural';
import { fromFirstVisit, smoothPath } from '../lib/trend';

const PEOPLE: [string, string, string] = ['человек', 'человека', 'человек'];

function StatsCard({ data, onOpen }: { data: Summary; onOpen: () => void }) {
  const [hi, setHi] = useState<number | null>(null);
  const pts = fromFirstVisit(data.trend);
  const n = pts.length;
  const period = n === 14 ? '2 недели' : `${n} ${plural(n, ['день', 'дня', 'дней'])}`;
  const max = Math.max(1, ...pts.map((p) => p.users));

  // Координаты в процентах: SVG тянется на всю ширину, а точка и линейка —
  // обычные HTML-элементы поверх, поэтому не сплющиваются вместе с графиком.
  const px = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const py = (v: number) => 96 - (v / max) * 84;
  const line = smoothPath(pts.map((p, i) => ({ x: px(i), y: py(p.users) })));
  const area = `${line} L100 100 L0 100 Z`;
  const cur = hi ?? n - 1;

  // Наведение мышью показывает день; на телефоне касание просто открывает подробности.
  const scrub = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <button className="panel st" onClick={onOpen}>
      <span className="st__chart">
        <span className="spark" onPointerMove={scrub} onPointerLeave={() => setHi(null)}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="spark__area" d={area} />
            <path className="spark__line" d={line} />
          </svg>
          {hi != null && <i className="spark__rule" style={{ left: px(cur) + '%' }} />}
          {n > 0 && <i className="spark__dot" style={{ left: px(cur) + '%', top: py(pts[cur].users) + '%' }} />}
        </span>
        <span className="st__cap">
          {hi != null
            ? <span><b>{pts[hi].users}</b> {plural(pts[hi].users, PEOPLE)} · {pts[hi].date}</span>
            : <><span>Люди за {period}</span><span>сегодня</span></>}
        </span>
      </span>
      <span className="st__nums">
        <span className="st__big">{data.todayUsers}</span>
        <span className="st__lbl">{plural(data.todayUsers, PEOPLE)} сегодня</span>
        <span className="st__sub">
          <span><b>+{data.todayNew}</b> {plural(data.todayNew, ['новый', 'новых', 'новых'])}</span>
          <span><b>{data.uniquePeople}</b> всего</span>
        </span>
      </span>
    </button>
  );
}

export function StatsBlock({ data, onOpen }: { data: Summary | null; onOpen: () => void }) {
  return (
    <section className="sec">
      <div className="sec__h">
        <h2 className="sec__t">Статистика</h2>
        <button className="sec__a" onClick={onOpen}>Подробнее</button>
      </div>
      {data ? <StatsCard data={data} onOpen={onOpen} /> : <div className="panel st--load" />}
    </section>
  );
}
