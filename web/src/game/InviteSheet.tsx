// «Позвать в покер»: ссылка (в Telegram и куда угодно — открывает стол) и друзья Para — «Позвать», у друга сразу
// появится «… зовёт тебя в покер». Одного друга — не чаще раза в минуту (сервер скажет, если рано).
import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import { brand } from '../brand';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/Toast';
import { socialApi, isApiError } from '../social/api';
import { useSocialActions } from '../social/actions';
import type { FriendRow } from '../social/types';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import { gameApi } from './api';

type RowState = 'idle' | 'busy' | 'sent';

/** Ссылка на стол: открывает приложение сразу со столом (?game=1). */
export const tableLink = (): string => location.origin + '/?uni=' + encodeURIComponent(brand.id) + '&game=1';

export function InviteSheet(p: { open: boolean; onClose: () => void; seated: Set<number> }): JSX.Element {
  const id = useId();
  const actions = useSocialActions();
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<Record<number, RowState>>({});

  useEffect(() => {
    if (!p.open) return;
    const c = new AbortController();
    setErr('');
    socialApi.friends(c.signal).then(
      (d) => { if (!c.signal.aborted) setFriends(d.friends); },
      (e) => { if (!c.signal.aborted) setErr(e instanceof Error ? e.message : 'Не удалось загрузить друзей'); },
    );
    return () => c.abort();
  }, [p.open]);

  const invite = async (f: FriendRow) => {
    if (rows[f.id] === 'busy' || rows[f.id] === 'sent') return;
    setRows((r) => ({ ...r, [f.id]: 'busy' }));
    try {
      await gameApi.invite(f.id);
      setRows((r) => ({ ...r, [f.id]: 'sent' }));
    } catch (e) {
      setRows((r) => ({ ...r, [f.id]: isApiError(e, 'rate') ? 'sent' : 'idle' }));
      toast(e instanceof Error ? e.message : 'Не получилось позвать', { kind: isApiError(e, 'rate') ? 'default' : 'error' });
    }
  };

  const share = () => void actions.share(tableLink(), 'Покер в Para — садись за стол');

  return (
    <Sheet open={p.open} onClose={p.onClose} variant="bottom" detent="large" labelledBy={id} right={null}>
      <div className="pk-inv">
        <h2 id={id} className="pk-inv__h">Позвать в покер</h2>
        <button type="button" className="pk-inv__link" onClick={share}>
          <span className="pk-inv__ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="pk-inv__lt"><b>Отправить ссылку</b><span>В Telegram или куда угодно — откроется сразу стол</span></span>
        </button>
        <h3 className="pk-inv__sec">Друзья в Para</h3>
        {!friends && !err && <p className="pk-inv__empty">Загружаем…</p>}
        {err && <p className="pk-inv__empty">{err}</p>}
        {friends && !friends.length && <p className="pk-inv__empty">Друзей пока нет — отправь ссылку или найди их в «Профиле».</p>}
        {friends && friends.length > 0 && (
          <ul className="pk-inv__list">
            {friends.map((f) => {
              const st = rows[f.id] || 'idle';
              const here = p.seated.has(f.id);
              return (
                <li key={f.id} className="pk-inv__row">
                  <Avatar user={f} size={40} />
                  <span className="pk-inv__main">
                    <span className="pk-inv__name"><span>{f.name}</span><NameBadge u={f} /></span>
                    <span className="pk-inv__user">@{f.username}</span>
                  </span>
                  {here ? <span className="pk-inv__here">за столом</span> : (
                    <button type="button" className={'pk-inv__go' + (st === 'sent' ? ' is-sent' : '')} disabled={st !== 'idle'}
                      onClick={() => void invite(f)}>{st === 'sent' ? 'Позвали' : st === 'busy' ? '…' : 'Позвать'}</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
