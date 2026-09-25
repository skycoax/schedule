// Заблокированные (экран в стеке «Профиля»): «Разблокировать» — сразу, без подтверждения.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { NavBar, BackButton } from '../../shell/NavBar';
import { Button } from '../../ui/Button';
import { useSocialActions } from '../actions';
import { socialApi } from '../api';
import { useSocialEvents } from '../events';
import { useSession } from '../session';
import type { UserCard } from '../types';
import { EmptyState } from '../ui/EmptyState';
import { PersonRow } from './FriendsView';
import { ListSkeleton, LoadError } from './ProfileHeader';
import { failText, isAbort } from './UsernameField';
import './profile.css';

export function BlockedView(p: { active: boolean; onBack: () => void; onOpenUser: (username: string) => void }): JSX.Element {
  const actions = useSocialActions();
  const [items, setItems] = useState<UserCard[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setError('');
    socialApi.blocks(c.signal).then(
      (list) => { if (!c.signal.aborted) setItems(list); },
      (e) => { if (!c.signal.aborted && !isAbort(e)) setError(failText(e)); },
    );
  }, []);
  // Экран на виду или вернулась сеть — перечитываем (без сети список, что уже есть, не трогаем).
  const online = useSession().online;
  const had = useRef(false);
  had.current = !!items;
  useEffect(() => {
    if (!p.active || (!online && had.current)) return;
    load();
  }, [p.active, online, load]);
  useEffect(() => () => ctrl.current?.abort(), []);

  useSocialEvents((e) => {
    if (e.type === 'unblock') setItems((l) => l && l.filter((u) => u.id !== e.userId));
    else if (e.type === 'block') load();
  });

  const unblock = async (u: UserCard) => {
    setBusy((b) => ({ ...b, [u.id]: true }));
    await actions.unblock(u);   // тост и событие 'unblock' — внутри
    setBusy((b) => { const c = { ...b }; delete c[u.id]; return c; });
  };

  let body: JSX.Element;
  if (!items && error) body = <LoadError text="Не удалось загрузить список" detail={error} onRetry={load} />;
  else if (!items) body = <ListSkeleton rows={3} />;
  else if (!items.length) body = <EmptyState icon="hand" title="Ты никого не блокируешь" />;
  else {
    body = (
      <ul className="frd-list">
        {items.map((u) => (
          <PersonRow key={u.id} user={u} onOpen={() => p.onOpenUser(u.username)}>
            <Button size={32} variant="tinted" disabled={!!busy[u.id]} onClick={() => void unblock(u)}>Разблокировать</Button>
          </PersonRow>
        ))}
      </ul>
    );
  }

  return (
    <div className="wrap wrap--prof prof-screen">
      {p.active && <NavBar left={<BackButton onClick={p.onBack} />} title="Заблокированные" />}
      <p className="prof-lead">
        Ты не видишь их посты и ответы, а они не могут отвечать тебе, открывать твой профиль и добавлять тебя в друзья.
        О блокировке они не узнают.
      </p>
      {items && error && <p className="prof-note" role="status">{error}</p>}
      {body}
    </div>
  );
}
