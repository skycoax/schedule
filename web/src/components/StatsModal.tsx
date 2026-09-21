// Статистика — открыта всем, без пароля: данные обезличены, скрывать нечего.
// Сверху — люди и график по дням; «Вся статистика» раскрывает подробности
// тут же, в этом модале, а не отдельной полноэкранной страницей.
import { Suspense, lazy, useEffect, useState } from 'react';
import { getStats, type Stats } from '../api';
import { fromFirstVisit } from '../lib/trend';

// recharts тяжёлый — грузим, только когда модал реально открыли.
const TrendChart = lazy(() => import('./charts').then((m) => ({ default: m.TrendChart })));
const StatsDetails = lazy(() => import('./StatsDetails').then((m) => ({ default: m.StatsDetails })));

export function StatsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMore(false); setErr('');
    getStats().then(setData).catch((e) => setErr(String(e.message || e)));
  }, [open]);

  return (
    <div className={'modal' + (open ? ' open' : '')}>
      <div className="modal__c modal__c--scroll" style={{ maxWidth: 440 }}>
        <div className="eyebrow">Открыто для всех</div>
        <div className="modal__h">Статистика</div>

        {err && <div className="modal__sub" style={{ color: 'var(--red-ink)' }}>{err}</div>}
        {!data && !err && <div className="skel" style={{ height: 240, marginTop: 16 }} />}

        {data && (
          <>
            <div className="kpi3">
              <div><b>{data.uniquePeople}</b><span>всего людей</span></div>
              <div><b>{data.todayUsers}</b><span>сегодня</span></div>
              <div><b>+{data.todayNew}</b><span>новых сегодня</span></div>
            </div>

            <Suspense fallback={<div className="skel" style={{ height: 210, marginBottom: 0 }} />}>
              <TrendChart data={fromFirstVisit(data.trend)} />
            </Suspense>

            <button className={'more-btn' + (more ? ' is-open' : '')} aria-expanded={more} onClick={() => setMore((v) => !v)}>
              {more ? 'Скрыть подробности' : 'Вся статистика'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>

            {more && (
              <Suspense fallback={<div className="skel" style={{ height: 320, marginTop: 12 }} />}>
                <StatsDetails data={data} />
              </Suspense>
            )}
          </>
        )}

        <button className="modal__doc" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}
