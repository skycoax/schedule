// Экран «Правки»: журнал изменений для выбранной группы.
import type { Group, ChangeEntry, ChangeItem } from '../types';
import { plural, FULL } from '../lib/format';

function ChRow({ slot, from, to, bad }: { slot: string; from?: string; to: string; bad: boolean }) {
  return (
    <div className="ch">
      <div className="ch__slot">{slot}</div>
      {from && <div className="ch__from">{from}</div>}
      <div className="ch__to"><span className={'dot ' + (bad ? 'dot--bad' : 'dot--ok')}></span>{to}</div>
    </div>
  );
}

function renderChange(c: ChangeItem, k: number) {
  if (c.type === 'link') return <ChRow key={k} slot="Телемост" to="Ссылка изменилась" bad={false} />;
  if (c.type === 'group_added') return <ChRow key={k} slot="Группа" to="Появилась в таблице" bad={false} />;
  if (c.type === 'group_removed') return <ChRow key={k} slot="Группа" to="Убрана из таблицы" bad={true} />;
  const slot = (FULL[c.day || ''] || c.day) + ' · ' + c.pair + '-я пара' + (c.time ? ' · ' + c.time : '') +
    (c.week ? ' · ' + c.week : '');
  return <ChRow key={k} slot={slot} from={c.before || ''} to={c.after || 'Пару убрали'} bad={!c.after} />;
}

export function ChangesView({ group, changes }: { group: Group; changes: ChangeEntry[] }) {
  const mine = changes
    .map((e) => ({ ts: e.ts, changes: (e.changes || []).filter((c) => c.group === group.name) }))
    .filter((e) => e.changes.length);

  if (!mine.length) {
    return (
      <div className="hero">
        <div className="hero__lbl">Журнал правок</div>
        <div className="hero__title">Расписание не меняли</div>
        <div className="hero__meta">Расписание сверяется автоматически</div>
      </div>
    );
  }

  const n = mine[0].changes.length;
  const when = (ts: string, opts: Intl.DateTimeFormatOptions) => new Date(ts).toLocaleString('ru-RU', opts);

  return (
    <>
      <div className="hero">
        <div className="hero__lbl is-bad">Последняя правка</div>
        <div className="hero__title">{when(mine[0].ts, { day: 'numeric', month: 'long' })}</div>
        <div className="hero__meta">{n} {plural(n, 'изменение', 'изменения', 'изменений')} в твоей группе</div>
      </div>
      <div className="card">
        {mine.map((e, i) => (
          <div key={i} className="ent">
            <div className="ent__when">{when(e.ts, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</div>
            {e.changes.map((c, k) => renderChange(c, k))}
          </div>
        ))}
      </div>
    </>
  );
}
