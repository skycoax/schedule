// «Рейтинг»: у кого больше всего фишек — среди друзей и во всей Para (в «Все» — взрослые, которых можно найти
// в поиске, и твои друзья). Свою строку видно всегда: если ты не в двадцатке — прикреплена снизу.
import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import { Sheet } from '../ui/Sheet';
import { Segmented } from '../ui/Segmented';
import type { PokerTop, PokerTopScope } from '../social/types';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import { gameApi } from './api';
import { chips as fmt } from './logic';

export function TopSheet(p: { open: boolean; onClose: () => void }): JSX.Element {
  const id = useId();
  const [scope, setScope] = useState<PokerTopScope>('friends');
  const [data, setData] = useState<Partial<Record<PokerTopScope, PokerTop>>>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!p.open) return;
    const c = new AbortController();
    setErr('');
    gameApi.top(scope, c.signal).then(
      (t) => { if (!c.signal.aborted) setData((d) => ({ ...d, [scope]: t })); },
      (e) => { if (!c.signal.aborted) setErr(e instanceof Error ? e.message : 'Не удалось загрузить рейтинг'); },
    );
    return () => c.abort();
  }, [p.open, scope]);

  const t = data[scope];
  const mineInList = !!t && t.items.some((x) => x.me);
  return (
    <Sheet open={p.open} onClose={p.onClose} variant="bottom" detent="large" labelledBy={id} right={null}>
      <div className="pk-top">
        <h2 id={id} className="pk-top__h">Рейтинг</h2>
        <Segmented value={scope} onChange={setScope} ariaLabel="Кого показать"
          options={[{ value: 'friends', label: 'Друзья' }, { value: 'all', label: 'Все' }]} />
        {!t && !err && <p className="pk-top__empty">Загружаем…</p>}
        {err && !t && <p className="pk-top__empty">{err}</p>}
        {t && !t.items.length && (
          <p className="pk-top__empty">{scope === 'friends' ? 'Позови друзей в покер — здесь будет ваш рейтинг.' : 'Пока никого.'}</p>
        )}
        {t && t.items.length > 0 && (
          <ol className="pk-top__list">
            {t.items.map((x) => (
              <li key={x.user.id} className={'pk-top__row' + (x.me ? ' is-me' : '') + (x.place <= 3 ? ' is-top' + x.place : '')}>
                <span className="pk-top__place">{x.place}</span>
                <Avatar user={x.user} size={36} />
                <span className="pk-top__name"><span>{x.me ? 'Ты' : x.user.name}</span>{!x.me && <NameBadge u={x.user} />}</span>
                <span className="pk-top__chips"><i className="pk-chip" />{fmt(x.chips)}</span>
              </li>
            ))}
          </ol>
        )}
        {t && t.me && !mineInList && (
          <div className="pk-top__row is-me is-pinned">
            <span className="pk-top__place">{t.me.place}</span>
            <span className="pk-top__name"><span>Ты</span></span>
            <span className="pk-top__chips"><i className="pk-chip" />{fmt(t.me.chips)}</span>
          </div>
        )}
        <p className="pk-top__foot">
          Фишки игровые: их не купить и не вывести. Каждый день — бонус, проиграл всё — жди завтра.
          {scope === 'all' ? ' В «Все» — взрослые, которых можно найти в поиске, и твои друзья.' : ''}
        </p>
      </div>
    </Sheet>
  );
}
