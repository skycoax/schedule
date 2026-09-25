// Поиск людей по имени и @имени (POST, запрос не попадает в журналы). Пауза 300 мс, прошлый запрос отменяется.
// Отношение к каждому найденному берём из своих списков друзей и заявок (их видит только владелец).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { NavBar, BackButton } from '../../shell/NavBar';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Spinner } from '../../ui/Spinner';
import { toast } from '../../ui/Toast';
import { socialApi } from '../api';
import { emit, useSocialEvents } from '../events';
import { textLength } from '../format';
import { currentReturnTo, useSession } from '../session';
import type { FriendLists, Relation, UserCard } from '../types';
import { EmptyState } from '../ui/EmptyState';
import { PersonRow } from './FriendsView';
import { LoadError } from './ProfileHeader';
import { failText, isAbort, toastFail } from './UsernameField';
import './profile.css';

type Rel = Extract<Relation, 'none' | 'outgoing' | 'incoming' | 'friends'>;

function relationsOf(d: FriendLists): Map<number, Rel> {
  const m = new Map<number, Rel>();
  d.outgoing.forEach((u) => m.set(u.id, 'outgoing'));
  d.incoming.forEach((u) => m.set(u.id, 'incoming'));
  d.friends.forEach((u) => m.set(u.id, 'friends'));
  return m;
}

export function PeopleSearch(p: { active: boolean; onBack: () => void; onOpenUser: (username: string) => void }): JSX.Element {
  const s = useSession();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<UserCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rel, setRel] = useState<Map<number, Rel>>(new Map());
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [nonce, setNonce] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const term = q.trim().replace(/^@+/, '');
  const enough = textLength(term) >= 2;

  // Свои списки друзей и заявок — чтобы показать у каждого нужную кнопку.
  const loadRel = useCallback(() => {
    socialApi.friends().then((d) => setRel(relationsOf(d)), () => {});
  }, []);
  useEffect(() => { if (p.active) loadRel(); }, [p.active, loadRel]);
  useSocialEvents((e) => {
    if (e.type === 'relation') {
      setRel((m) => {
        const c = new Map(m);
        if (e.relation === 'none' || e.relation === 'blocked' || e.relation === 'self') c.delete(e.userId);
        else c.set(e.userId, e.relation);
        return c;
      });
    } else if (e.type === 'block') {
      setItems((list) => list && list.filter((u) => u.id !== e.userId));
    }
  });

  // Поиск: пауза 300 мс, прошлый запрос отменяется.
  useEffect(() => {
    if (!enough) { setItems(null); setLoading(false); setError(''); return; }
    const c = new AbortController();
    setLoading(true);
    setError('');
    const t = window.setTimeout(() => {
      socialApi.searchUsers(q.trim(), c.signal).then(
        (list) => { if (!c.signal.aborted) { setItems(list); setLoading(false); } },
        (e) => { if (!c.signal.aborted && !isAbort(e)) { setError(failText(e)); setLoading(false); } },
      );
    }, 300);
    return () => { clearTimeout(t); c.abort(); };
  }, [q, enough, nonce]);

  const act = async (u: UserCard, r: Rel) => {
    if (busy[u.id]) return;
    if (!(await s.ensure('friend', currentReturnTo()))) return;
    setBusy((b) => ({ ...b, [u.id]: true }));
    try {
      const next = await socialApi.friend(u.id, r === 'incoming' ? 'accept' : 'request');
      emit({ type: 'relation', userId: u.id, relation: next });
      toast(next === 'friends' ? 'Теперь вы друзья' : 'Заявка отправлена');
    } catch (e) {
      toastFail(e);
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[u.id]; return c; });
    }
  };

  const relButton = (u: UserCard) => {
    const r = rel.get(u.id) || 'none';
    const b = !!busy[u.id];
    if (r === 'friends') return <span className="ppl-rel">В друзьях</span>;
    if (r === 'outgoing') return <span className="ppl-rel">Заявка отправлена</span>;
    if (r === 'incoming') return <Button size={32} disabled={b} onClick={() => void act(u, r)}>Принять</Button>;
    return <Button size={32} variant="tinted" disabled={b} onClick={() => void act(u, r)}>Добавить</Button>;
  };

  let body: JSX.Element | null = null;
  if (!enough) {
    body = <p className="ppl-hint">Найди одногруппников и друзей по имени или @username</p>;
  } else if (error && !loading) {
    body = <LoadError text="Не удалось выполнить поиск" detail={error} onRetry={() => setNonce((n) => n + 1)} />;
  } else if (items && items.length) {
    body = (
      <ul className={'frd-list' + (loading ? ' is-stale' : '')}>
        {items.map((u) => (
          <PersonRow key={u.id} user={u} onOpen={() => p.onOpenUser(u.username)}>{relButton(u)}</PersonRow>
        ))}
      </ul>
    );
  } else if (items && !loading) {
    body = <EmptyState icon="search" title="Никого не нашли" />;
  }

  return (
    <div className="wrap wrap--prof prof-screen">
      {p.active && <NavBar left={<BackButton onClick={p.onBack} />} title="Найти людей" />}
      <form className="ppl-search" role="search" onSubmit={(e) => { e.preventDefault(); input.current?.blur(); }}>
        <Icon name="search" size={18} className="ppl-search__ico" />
        <input
          ref={input} className="ppl-search__in" type="search" value={q} placeholder="Имя или @username"
          aria-label="Имя или @username" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false}
          enterKeyHint="search" maxLength={40} onChange={(e) => setQ(e.currentTarget.value)}
        />
        {loading && <Spinner size={16} />}
        {q && (
          <button type="button" className="ppl-search__x" aria-label="Очистить"
            onClick={() => { setQ(''); input.current?.focus(); }}>
            <Icon name="close" size={14} />
          </button>
        )}
      </form>
      <div className="ppl-body" aria-live="polite">{body}</div>
    </div>
  );
}
