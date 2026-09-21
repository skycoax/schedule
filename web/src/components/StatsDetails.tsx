// Подробная статистика — раскрывается в том же модале по кнопке «Вся статистика».
// Только сводные числа: сколько людей, а не кто именно. Файл грузится лениво
// вместе с графиками — обычный студент его никогда не скачивает.
import type { Row, Stats } from '../api';
import { HourChart } from './charts';

function BarList({ title, note, rows }: { title: string; note?: string; rows: Row[] }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="sx">
      <h3 className="sx__h">{title}</h3>
      {note && <p className="sx__note">{note}</p>}
      {rows.map((r) => (
        <div className={'bl' + (r.name === 'Другие' ? ' bl--rest' : '')} key={r.name}>
          <div className="bl__top">
            <span className="bl__name">{r.name}</span>
            <span className="bl__n">{r.n}</span>
          </div>
          <div className="bl__bar"><i style={{ width: (r.n / max) * 100 + '%' }} /></div>
        </div>
      ))}
    </section>
  );
}

const pad2 = (h: number) => String(h).padStart(2, '0');

export function StatsDetails({ data }: { data: Stats }) {
  const hours = data.byHour || [];
  const peak = hours.reduce((a, b) => (b.n > a.n ? b : a), hours[0] || { h: 0, n: 0 });
  const perPerson = data.uniquePeople ? data.total / data.uniquePeople : 0;
  const retPct = data.uniquePeople ? Math.round((data.returning / data.uniquePeople) * 100) : 0;

  return (
    <div className="sxs">
      <div className="tiles">
        <div className="tile">
          <span className="tile__l">Вернулись</span>
          <b className="tile__v">{retPct}%</b>
          <span className="tile__s">{data.returning} из {data.uniquePeople} заходили в разные дни</span>
        </div>
        <div className="tile">
          <span className="tile__l">На человека</span>
          <b className="tile__v">{perPerson.toFixed(1).replace('.', ',')}</b>
          <span className="tile__s">захода в среднем</span>
        </div>
        <div className="tile">
          <span className="tile__l">Всего заходов</span>
          <b className="tile__v">{data.total}</b>
          <span className="tile__s">сегодня {data.todayHits}</span>
        </div>
        <div className="tile">
          <span className="tile__l">Пик</span>
          <b className="tile__v">{pad2(peak.h)}:00</b>
          <span className="tile__s">чаще всего открывают</span>
        </div>
      </div>

      <section className="sx">
        <h3 className="sx__h">Когда открывают</h3>
        <p className="sx__note">Заходы по часам за всё время, время Ташкента</p>
        <HourChart data={hours} />
      </section>

      <p className="sx__lead">Дальше в списках — число людей.</p>
      <BarList title="Откуда приходят" note="Где человек впервые открыл ссылку" rows={data.bySource} />
      <BarList title="Устройства" rows={data.byDevice} />
      <BarList title="Марки телефонов" rows={data.byBrand} />
      <BarList title="Модели" note="iPhone не сообщает модель — только что это iPhone" rows={data.byModel} />
      <BarList title="Группы" rows={data.byGroup} />
      <BarList title="Браузеры" rows={data.byBrowser} />
      <BarList title="Системы" rows={data.byOs} />
      <BarList title="Язык телефона" rows={data.byLang} />

      <p className="sx__foot">
        Люди считаются по случайному номеру браузера, без имён и IP. Числа обновляются раз в минуту.
      </p>
    </div>
  );
}
