// Профиль человека (экран в стеке «Профиля» и «Обсуждений»): шапка, кнопка дружбы, посты со всех вузов.
// Свой профиль — с «Изменить профиль». Только для вошедших (сервер отвечает 401 гостю).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { NavBar, NavButton, BackButton } from '../../shell/NavBar';
import { chooseAction, confirmDialog } from '../../ui/ActionSheet';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Spinner } from '../../ui/Spinner';
import { toast } from '../../ui/Toast';
import { useSocialActions, userLink } from '../actions';
import { isApiError, socialApi } from '../api';
import { emit, useSocialEvents } from '../events';
import { banText } from '../format';
import { currentReturnTo, useSession } from '../session';
import type { Post, ProfilePage, Relation, UserProfile } from '../types';
import { PostCard } from '../chat/PostCard';
import { EmptyState } from '../ui/EmptyState';
import { ListSkeleton, LoadError, ProfileHeader, ProfileHeaderSkeleton } from './ProfileHeader';
import { OPEN_FAIL, failText, isAbort, toastFail } from './UsernameField';
import './profile.css';

interface UserProfileViewProps {
  username: string;
  onBack: () => void;
  onOpenThread: (postId: number) => void;
  onOpenUser: (username: string) => void;
}

type Load = { kind: 'loading' } | { kind: 'ok' } | { kind: 'gone' } | { kind: 'error'; text: string };

// Лист «Изменить профиль» нужен только в своём профиле — грузим его по требованию (UserProfileView есть и в «Обсуждениях»).
type EditComp = typeof import('./EditProfileSheet').EditProfileSheet;
let editMod: Promise<EditComp> | null = null;
const loadEdit = () => {
  editMod ??= import('./EditProfileSheet').then((m) => m.EditProfileSheet, (e) => { editMod = null; throw e; });
  return editMod;
};

/** Посты списком с подгрузкой: следующая страница — когда низ списка показался (или по кнопке). */
export function PostList(p: {
  posts: Post[];
  next: string | null;
  loadMore: () => Promise<void>;
  onOpenThread: (postId: number) => void;
  onOpenUser: (username: string) => void;
  onChange: (id: number, post: Post | null) => void;
}): JSX.Element {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const sentinel = useRef<HTMLDivElement>(null);
  const more = useRef(p.loadMore);
  more.current = p.loadMore;

  const go = useCallback(async () => {
    setState('loading');
    try { await more.current(); setState('idle'); } catch { setState('error'); }
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !p.next || state !== 'idle' || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void go(); }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [p.next, state, go]);

  return (
    <>
      <div className="prof-posts">
        {p.posts.map((post) => (
          <PostCard
            key={post.id} post={post} clamp
            onOpen={() => p.onOpenThread(post.rootId ?? post.id)}
            onOpenUser={p.onOpenUser}
            onChange={(np) => p.onChange(post.id, np)}
          />
        ))}
      </div>
      {p.next && (
        <div ref={sentinel} className="prof-more">
          {state === 'loading' && <Spinner size={20} />}
          {state === 'error' && (
            <div className="prof-err prof-err--row" role="alert">
              <p className="prof-err__t">Не удалось загрузить</p>
              <Button variant="tinted" size={32} onClick={() => void go()}>Повторить</Button>
            </div>
          )}
          {state === 'idle' && <Button variant="plain" size={44} onClick={() => void go()}>Показать ещё</Button>}
        </div>
      )}
    </>
  );
}

export function UserProfileView(p: UserProfileViewProps): JSX.Element {
  const s = useSession();
  const actions = useSocialActions();
  const [page, setPage] = useState<ProfilePage | null>(null);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [Edit, setEdit] = useState<EditComp | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const uname = p.username;

  const fetchPage = useCallback((quiet = false) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    if (!quiet) setLoad({ kind: 'loading' });
    socialApi.user(uname, c.signal).then(
      (d) => { if (!c.signal.aborted) { setPage(d); setLoad({ kind: 'ok' }); } },
      (e) => {
        if (c.signal.aborted || isAbort(e)) return;
        if (isApiError(e, 'not_found')) { setPage(null); setLoad({ kind: 'gone' }); }
        else if (!quiet) setLoad({ kind: 'error', text: failText(e) });
      },
    );
  }, [uname]);

  useEffect(() => { fetchPage(); return () => ctrl.current?.abort(); }, [fetchPage]);

  // Не загрузилось из-за сети — пробуем снова, как только она вернулась.
  const online = s.online;
  const failed = load.kind === 'error';
  useEffect(() => { if (online && failed) fetchPage(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const user = page?.user || null;
  const self = user?.relation === 'self';

  const setUser = (fn: (u: UserProfile) => UserProfile) => setPage((pg) => (pg ? { ...pg, user: fn(pg.user) } : pg));
  const setPosts = (fn: (list: Post[]) => Post[]) => setPage((pg) => (pg ? { ...pg, posts: fn(pg.posts) } : pg));

  useSocialEvents((e) => {
    if (!user) return;
    switch (e.type) {
      case 'block': case 'unblock':
        if (e.userId === user.id) fetchPage(true);
        else if (e.type === 'block') setPosts((l) => l.filter((x) => x.author?.id !== e.userId));
        break;
      case 'relation':
        if (e.userId === user.id && e.relation !== user.relation) fetchPage(true);
        break;
      case 'moderated':
        fetchPage(true);
        break;
      case 'me-changed':
        if (self) fetchPage(true);
        break;
      case 'post-deleted':
        setPosts((l) => l.filter((x) => x.id !== e.id));
        break;
      case 'like':
        setPosts((l) => l.map((x) => (x.id === e.id ? { ...x, likes: e.likes, liked: e.liked } : x)));
        break;
      case 'post-created':
        if (self && e.post.rootId === null) setPosts((l) => [e.post, ...l.filter((x) => x.id !== e.post.id)]);
        break;
      default:
    }
  });

  const loadMore = async () => {
    const pg = page;
    if (!pg || !pg.next) return;
    const more = await socialApi.userPosts(uname, pg.next);
    setPage((cur) => (cur ? {
      ...cur, next: more.next, posts: [...cur.posts, ...more.items.filter((x) => !cur.posts.some((y) => y.id === x.id))],
    } : cur));
  };

  const back = currentReturnTo({ user: uname });

  const friend = async (action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove') => {
    if (!user || busy) return;
    if ((action === 'request' || action === 'accept') && !(await s.ensure('friend', back))) return;
    if (action === 'cancel') {
      const a = await chooseAction({ actions: [{ id: 'cancel', label: 'Отменить заявку', role: 'destructive' }] });
      if (a !== 'cancel') return;
    }
    if (action === 'remove') {
      const a = await chooseAction({ actions: [{ id: 'remove', label: 'Удалить из друзей', role: 'destructive' }] });
      if (a !== 'remove') return;
      const ok = await confirmDialog({ title: `Удалить @${user.username} из друзей?`, confirm: 'Удалить', destructive: true });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r: Relation = await socialApi.friend(user.id, action);
      const was = user.relation;
      setUser((u) => ({
        ...u, relation: r,
        counts: { ...u.counts, friends: u.counts.friends + (r === 'friends' && was !== 'friends' ? 1 : was === 'friends' && r !== 'friends' ? -1 : 0) },
      }));
      emit({ type: 'relation', userId: user.id, relation: r });
      if (r === 'friends' && was !== 'friends') toast('Теперь вы друзья');
      else if (r === 'outgoing') toast('Заявка отправлена');
    } catch (e) {
      toastFail(e);
      if (isApiError(e, 'blocked') || isApiError(e, 'not_found')) fetchPage(true);
    } finally {
      setBusy(false);
    }
  };

  const unban = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const target = { type: 'user' as const, id: user.id };
      await socialApi.adminAction({ action: 'unban', target });
      toast('Ограничение снято');
      emit({ type: 'moderated', target, action: 'unban' });
      setUser((u) => ({ ...u, banned: null }));
    } catch (e) {
      toastFail(e);
    } finally {
      setBusy(false);
    }
  };

  const menu = async () => {
    if (!user) return;
    const r = await actions.userMenu(user);
    if (r === 'blocked' || r === 'unblocked' || r === 'moderated') fetchPage(true);
  };

  const openEdit = async () => {
    try {
      const E = await loadEdit();
      setEdit(() => E);
      setEditOpen(true);
    } catch {
      toast(navigator.onLine ? OPEN_FAIL : 'Нет интернета', { kind: 'error' });
    }
  };

  const unblock = async () => {
    if (!user || busy) return;
    setBusy(true);
    if (await actions.unblock(user)) fetchPage(true);
    setBusy(false);
  };

  // ─── Кнопки под шапкой ───
  let buttons: JSX.Element | null = null;
  if (user) {
    const offline = !s.online;
    switch (user.relation) {
      case 'self':
        buttons = (
          <>
            <Button variant="tinted" size={44} full disabled={offline} onClick={() => void openEdit()}>Изменить профиль</Button>
            <Button variant="tinted" size={44} full onClick={() => void actions.share(userLink(user.username), user.name)}>Поделиться профилем</Button>
          </>
        );
        break;
      case 'none':
        buttons = user.canFriend
          ? <Button size={44} full busy={busy} onClick={() => void friend('request')}>Добавить в друзья</Button>
          : <p className="prof-hd__rel-note">Не принимает заявки в друзья</p>;
        break;
      case 'outgoing':
        buttons = <Button variant="tinted" size={44} full busy={busy} onClick={() => void friend('cancel')}>Заявка отправлена</Button>;
        break;
      case 'incoming':
        buttons = (
          <>
            <Button size={44} full busy={busy} onClick={() => void friend('accept')}>Принять заявку</Button>
            <Button variant="tinted" size={44} full disabled={busy} onClick={() => void friend('decline')}>Отклонить</Button>
          </>
        );
        break;
      case 'friends':
        buttons = (
          <Button variant="tinted" size={44} full busy={busy} onClick={() => void friend('remove')} ariaLabel="В друзьях, открыть действия">
            <span className="prof-btn-in"><Icon name="check" size={18} />В друзьях</span>
          </Button>
        );
        break;
      case 'blocked':
        buttons = null;
        break;
    }
  }

  // Рядом с главной кнопкой (кроме своего профиля и блокировки) — «Поделиться», две в ряд, как в Threads.
  if (buttons && user && user.relation !== 'self' && user.relation !== 'blocked' && user.relation !== 'incoming') {
    buttons = (
      <>
        {buttons}
        <Button variant="tinted" size={44} full onClick={() => void actions.share(userLink(user.username), user.name)}>Поделиться</Button>
      </>
    );
  }

  const banNote = user && user.banned && s.me?.isAdmin ? (
    <div className="prof-ban">
      <p className="prof-ban__t">{banText(user.banned)}</p>
      <Button variant="tinted" size={32} disabled={busy} onClick={() => void unban()}>Снять ограничение</Button>
    </div>
  ) : null;

  let body: JSX.Element;
  if (load.kind === 'gone') {
    body = (
      <EmptyState icon="person" title="Профиль недоступен" text="Возможно, аккаунт удалён или скрыт."
        action={{ label: 'Назад', onClick: p.onBack }} />
    );
  } else if (load.kind === 'error' && !page) {
    body = <LoadError text="Не удалось загрузить профиль" detail={load.text} onRetry={() => fetchPage()} />;
  } else if (!page || !user) {
    body = <><ProfileHeaderSkeleton user={null} /><ListSkeleton rows={2} /></>;
  } else if (user.relation === 'blocked') {
    body = (
      <ProfileHeader user={user} bare note={banNote}>
        <div className="prof-blocked">
          <p className="prof-blocked__t">Этот пользователь заблокирован</p>
          <Button variant="tinted" size={44} full busy={busy} onClick={() => void unblock()}>Разблокировать</Button>
        </div>
      </ProfileHeader>
    );
  } else {
    body = (
      <>
        <ProfileHeader user={user} note={banNote}>{buttons}</ProfileHeader>
        <div className="prof-tabs"><h2 className="prof-tab"><span>Ветки</span></h2></div>
        {page.posts.length ? (
          <PostList
            posts={page.posts} next={page.next} loadMore={loadMore}
            onOpenThread={p.onOpenThread} onOpenUser={p.onOpenUser}
            onChange={(id, np) => setPosts((l) => (np ? l.map((x) => (x.id === id ? np : x)) : l.filter((x) => x.id !== id)))}
          />
        ) : (
          <p className="prof-empty">{self ? 'Здесь появятся твои посты' : 'Постов пока нет'}</p>
        )}
      </>
    );
  }

  return (
    <div className="wrap wrap--prof prof-screen prof-user">
      <NavBar
        left={<BackButton onClick={p.onBack} />}
        title={'@' + (user?.username || uname)}
        right={user && !self ? (
          <NavButton label="Ещё" haspopup="menu" onClick={() => void menu()}><Icon name="ellipsis" size={20} /></NavButton>
        ) : undefined}
      />
      {body}
      {self && Edit && <Edit open={editOpen} onClose={() => setEditOpen(false)} />}
    </div>
  );
}
