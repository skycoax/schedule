// Друзья и заявки (экран в стеке «Профиля»). Списки видит только их владелец.
// Принять — через ensure('friend'); отклонить и отменить — сразу (работают и в режиме «только чтение»).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { NavBar, BackButton } from '../../shell/NavBar';
import { Segmented } from '../../ui/Segmented';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { toast } from '../../ui/Toast';
import { socialApi } from '../api';
import { emit, useSocialEvents } from '../events';
import { currentReturnTo, useSession } from '../session';
import type { FriendLists, FriendRow } from '../types';
import { Avatar } from '../ui/Avatar';
import { EmptyState } from '../ui/EmptyState';
import { TeamBadge } from '../ui/Badges';
import { ListSkeleton, LoadError } from './ProfileHeader';
import { failText, isAbort, toastFail } from './UsernameField';
import './profile.css';

type Tab = 'friends' | 'requests';

/** Строка человека: фото, имя, @имя, вуз; справа — кнопки. Нажатие на строку открывает профиль. */
export function PersonRow(p: {
  user: { id: number; name: string; username: string; avatar: string | null; uniShort: string | null; team: boolean };
  onOpen: () => void;
  children?: JSX.Element | false | null;
}): JSX.Element {
  const u = p.user;
  return (
    <li className="frd-row">
      <button type="button" className="frd-row__main" onClick={p.onOpen} aria-label={`${u.name}, @${u.username}`}>
        <Avatar user={u} size={44} />
        <span className="frd-row__txt">
          <span className="frd-row__name"><span className="frd-row__name-t">{u.name}</span>{u.team && <TeamBadge />}</span>
          <span className="frd-row__sub">@{u.username}{u.uniShort ? ' · ' + u.uniShort : ''}</span>
        </span>
        {!p.children && <Icon name="chevronRight" size={16} className="frd-row__chev" />}
      </button>
      {p.children && <div className="frd-row__acts">{p.children}</div>}
    </li>
  );
}

export function FriendsView(p: {
  active: boolean;
  onBack: () => void;
  onOpenUser: (username: string) => void;
  onSearch: () => void;
}): JSX.Element {
  const s = useSession();
  const [tab, setTab] = useState<Tab>(() => ((s.me?.requestsIn || 0) > 0 ? 'requests' : 'friends'));
  const [data, setData] = useState<FriendLists | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setError('');
    socialApi.friends(c.signal).then(
      (d) => { if (!c.signal.aborted) setData(d); },
      (e) => { if (!c.signal.aborted && !isAbort(e)) setError(failText(e)); },
    );
  }, []);

  // Экран снова на виду или вернулась сеть — обновляем (заявки могли прийти, пока смотрели чужой профиль).
  const online = s.online;
  const had = useRef(false);
  had.current = !!data;
  useEffect(() => {
    if (!p.active || (!online && had.current)) return;
    load();
  }, [p.active, online, load]);
  useEffect(() => () => ctrl.current?.abort(), []);

  // Отношения поменялись в другом месте (профиль, поиск) — перечитываем.
  const debounce = useRef(0);
  useSocialEvents((e) => {
    if (e.type !== 'relation' && e.type !== 'block' && e.type !== 'unblock') return;
    clearTimeout(debounce.current);
    debounce.current = window.setTimeout(load, 400);
  });
  useEffect(() => () => clearTimeout(debounce.current), []);

  const act = async (row: FriendRow, action: 'accept' | 'decline' | 'cancel') => {
    if (busy[row.id]) return;
    if (action === 'accept' && !(await s.ensure('friend', currentReturnTo()))) return;
    setBusy((b) => ({ ...b, [row.id]: true }));
    const before = data;
    // Сразу меняем список, при ошибке возвращаем.
    setData((d) => {
      if (!d) return d;
      if (action === 'accept') {
        return { ...d, incoming: d.incoming.filter((x) => x.id !== row.id), friends: [row, ...d.friends] };
      }
      if (action === 'decline') return { ...d, incoming: d.incoming.filter((x) => x.id !== row.id) };
      return { ...d, outgoing: d.outgoing.filter((x) => x.id !== row.id) };
    });
    try {
      const relation = await socialApi.friend(row.id, action);
      emit({ type: 'relation', userId: row.id, relation });
      if (action === 'accept') toast('Теперь вы друзья');
    } catch (e) {
      setData(before);
      toastFail(e);
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[row.id]; return c; });
    }
  };

  const nIn = data?.incoming.length ?? s.me?.requestsIn ?? 0;
  const nOut = data?.outgoing.length ?? 0;
  const open = (u: FriendRow) => p.onOpenUser(u.username);

  let body: JSX.Element;
  if (!data && error) body = <LoadError text="Не удалось загрузить друзей" detail={error} onRetry={load} />;
  else if (!data) body = <ListSkeleton />;
  else if (tab === 'friends') {
    body = data.friends.length ? (
      <ul className="frd-list">
        {data.friends.map((u) => <PersonRow key={u.id} user={u} onOpen={() => open(u)} />)}
      </ul>
    ) : (
      <EmptyState icon="people" title="Пока нет друзей" text="Найди одногруппников через поиск."
        action={{ label: 'Найти людей', onClick: p.onSearch }} />
    );
  } else if (!nIn && !nOut) {
    body = <EmptyState icon="people" title="Новых заявок нет" />;
  } else {
    body = (
      <>
        {nIn > 0 && (
          <section>
            <h3 className="frd-h">Входящие</h3>
            <ul className="frd-list">
              {data.incoming.map((u) => (
                <PersonRow key={u.id} user={u} onOpen={() => open(u)}>
                  <>
                    <Button size={32} disabled={!!busy[u.id]} onClick={() => void act(u, 'accept')}>Принять</Button>
                    <button type="button" className="frd-x" aria-label="Отклонить" disabled={!!busy[u.id]}
                      onClick={() => void act(u, 'decline')}>
                      <Icon name="close" size={16} />
                    </button>
                  </>
                </PersonRow>
              ))}
            </ul>
          </section>
        )}
        {nOut > 0 && (
          <section>
            <h3 className="frd-h">Исходящие</h3>
            <ul className="frd-list">
              {data.outgoing.map((u) => (
                <PersonRow key={u.id} user={u} onOpen={() => open(u)}>
                  <Button size={32} variant="tinted" disabled={!!busy[u.id]} onClick={() => void act(u, 'cancel')}>Отменить</Button>
                </PersonRow>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <div className="wrap wrap--prof prof-screen">
      {p.active && <NavBar left={<BackButton onClick={p.onBack} />} title="Друзья" />}
      <div className="frd-seg">
        <Segmented<Tab>
          ariaLabel="Друзья и заявки" value={tab} onChange={setTab} asTabs controls="frd-panel"
          options={[
            { value: 'friends', label: data ? `Друзья · ${data.friends.length}` : 'Друзья' },
            { value: 'requests', label: `Заявки · ${nIn}` },
          ]}
        />
      </div>
      <div id="frd-panel" role="tabpanel" className="frd-panel">
        {data && error && <p className="prof-note" role="status">{error}</p>}
        {body}
      </div>
    </div>
  );
}
