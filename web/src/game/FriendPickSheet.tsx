// «Кого вызвать?»: принятые друзья (GET /api/social/friends). Выбрал — «Твой код», потом вызов уходит другу
// и появляется у него в лобби «Тебя вызывают».
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';
import { socialApi } from '../social/api';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import type { FriendRow } from '../social/types';
import { useGx } from './ctx';
import { errText } from './parts';

export function FriendPickSheet(p: { open: boolean; onClose: () => void }): JSX.Element {
  const g = useGx();
  const [items, setItems] = useState<FriendRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!p.open) return;
    const c = new AbortController();
    setErr('');
    socialApi.friends(c.signal).then((f) => setItems(f.friends), (e) => { if (!c.signal.aborted) setErr(errText(e)); });
    return () => c.abort();
  }, [p.open]);

  const pick = (u: FriendRow) => {
    p.onClose();
    g.push({ t: 'pad', purpose: { kind: 'friend', user: u } }, 'up');
  };
  const link = () => {
    p.onClose();
    g.push({ t: 'pad', purpose: { kind: 'link' } }, 'up');
  };

  return (
    <Sheet open={p.open} onClose={p.onClose} variant="bottom" detent="large" title="Кого вызвать?">
      <div className="gx-fr">
        {!items && !err && <div className="gx-fr__load"><Spinner size={22} /></div>}
        {err && !items && <p className="gx-fr__empty">{err}</p>}
        {items && items.length === 0 && (
          <div className="gx-fr__empty">
            <p>Друзей пока нет. Добавь их в «Профиле» или отправь ссылку.</p>
            <button type="button" className="gx-fr__btn" onClick={link}>Отправить ссылку</button>
          </div>
        )}
        {items && items.length > 0 && (
          <ul className="gx-fr__list">
            {items.map((u) => (
              <li key={u.id}>
                <button type="button" className="gx-fr__row" onClick={() => pick(u)}>
                  <Avatar user={u} size={40} />
                  <span className="gx-fr__main">
                    <span className="gx-fr__name"><span>{u.name}</span><NameBadge u={u} /></span>
                    <span className="gx-fr__user">@{u.username}</span>
                  </span>
                  <span className="gx-fr__go">Вызвать</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
