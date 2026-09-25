// Вкладка «Профиль» (только на Para, после выбора вуза). Грузится лениво (AppShell) и после первого показа
// остаётся смонтированной (скрыта, когда неактивна). Корень — карточка гостя или шапка профиля, «Мои посты»
// и настройки; поверх корня — стек экранов (друзья, поиск, чужой профиль, ветка, жалобы…) на ui/layers.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { NavBar, LargeTitle } from '../../shell/NavBar';
import { RESELECT_EVENT } from '../../tabs';
import type { ProfileLink, ProfileTabProps } from '../../tabs';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Spinner } from '../../ui/Spinner';
import { toast } from '../../ui/Toast';
import { useSocialActions, userLink } from '../actions';
import { socialApi } from '../api';
import { useSocialEvents } from '../events';
import { banText } from '../format';
import { currentReturnTo, useSession } from '../session';
import { useStack } from '../stack';
import type { Post } from '../types';
import { ScreenVisible } from '../chat/PostCard';
import { ThreadView } from '../chat/ThreadView';
import { BlockedView } from './BlockedView';
import { DeleteAccountSheet } from './DeleteAccountSheet';
import { EditProfileSheet } from './EditProfileSheet';
import { FriendsView } from './FriendsView';
import { GuestCard, GuestCardSkeleton } from './GuestCard';
import { HiddenView } from './HiddenView';
import { PeopleSearch } from './PeopleSearch';
import { LoadError, ProfileHeader, ProfileHeaderSkeleton } from './ProfileHeader';
import { SettingsList } from './SettingsList';
import { PostList, UserProfileView } from './UserProfileView';
import { OPEN_FAIL, failText, isAbort } from './UsernameField';
import './profile.css';

type Screen =
  | { kind: 'friends' }
  | { kind: 'search' }
  | { kind: 'blocked' }
  | { kind: 'hidden' }
  | { kind: 'moderation' }
  | { kind: 'user'; username: string }
  | { kind: 'thread'; id: number };

type ModComp = typeof import('./ModerationView').ModerationView;
let modMod: Promise<ModComp> | null = null;
const loadModeration = () => {
  modMod ??= import('./ModerationView').then((m) => m.ModerationView, (e) => { modMod = null; throw e; });
  return modMod;
};

const MY_POSTS = 3;

export default function ProfileTab(p: ProfileTabProps): JSX.Element {
  const { active } = p;
  const s = useSession();
  const actions = useSocialActions();
  const stack = useStack<Screen>();
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [Mod, setMod] = useState<ModComp | null>(null);
  const [slow, setSlow] = useState(false);

  const loading = s.status === 'loading';
  const me = s.status === 'signed' ? s.me : null;
  const social = s.mode !== 'off';
  const onboarded = !!me && !me.needsProfile && !!me.username;
  // Сервер ни разу не ответил (нет сети): вошедший показан по me_cache, где верны только фото, имя и @имя.
  const stale = !!me && !s.config;

  // Без кэша и без ответа сервера — не больше 1,5 с скелета, потом карточка гостя.
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(t);
  }, [loading]);

  // ─── Навигация по стеку ───
  const openUser = useCallback(async (username: string) => {
    if (!(await s.ensure('profile', currentReturnTo({ user: username })))) return;
    stack.push({ kind: 'user', username });
  }, [s, stack]);

  const openModeration = useCallback(async () => {
    try {
      const M = await loadModeration();
      setMod(() => M);
      stack.push({ kind: 'moderation' });
    } catch {
      toast(navigator.onLine ? OPEN_FAIL : 'Нет интернета', { kind: 'error' });
    }
  }, [stack]);

  const back = useCallback(() => { void stack.pop(); }, [stack]);

  // ─── Ссылки (?user=, ?delete=1, ?mod=1): только на активной вкладке и когда сессия известна ───
  const handled = useRef<ProfileLink | null>(null);
  const { link, onLinkHandled } = p;
  useEffect(() => {
    if (!active || !link || loading || handled.current === link) return;
    handled.current = link;
    // SOCIAL_MODE=off: профилей и модерации на сервере нет — такие ссылки оставляют на корне «Профиля» (D30).
    if (link.user) { if (social) void openUser(link.user); }
    else if (link.del) {
      if (s.status === 'signed') setDelOpen(true);
      else s.requestSignIn('delete', currentReturnTo({ delete: 1 }));
    } else if (link.mod && social && s.me?.isAdmin) void openModeration();
    onLinkHandled();
  }, [active, link, loading, s, social, openUser, openModeration, onLinkHandled]);

  // ─── Повторное нажатие на вкладку: к корню и наверх ───
  const popToRoot = stack.popToRoot;
  useEffect(() => {
    const on = async (e: Event) => {
      if ((e as CustomEvent).detail !== 'profile') return;
      await popToRoot();
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    };
    window.addEventListener(RESELECT_EVENT, on);
    return () => window.removeEventListener(RESELECT_EVENT, on);
  }, [popToRoot]);

  // Вышли из аккаунта (или удалили его) — закрываем экраны, которым нужен вход.
  useEffect(() => {
    if (s.status === 'guest' && stack.stack.some((x) => x.kind !== 'hidden' && x.kind !== 'thread')) void popToRoot();
  }, [s.status, stack.stack, popToRoot]);

  // ─── Мои посты: первые три публикации ───
  const [posts, setPosts] = useState<{ items: Post[]; error: string; loading: boolean } | null>(null);
  const postsCtrl = useRef<AbortController | null>(null);
  const username = onboarded && social ? me!.username! : null;
  const loadPosts = useCallback(() => {
    postsCtrl.current?.abort();
    if (!username) { setPosts(null); return; }
    const c = new AbortController();
    postsCtrl.current = c;
    setPosts((x) => ({ items: x?.items || [], error: '', loading: true }));
    socialApi.user(username, c.signal).then(
      (pg) => { if (!c.signal.aborted) setPosts({ items: pg.posts.slice(0, MY_POSTS), error: '', loading: false }); },
      (e) => { if (!c.signal.aborted && !isAbort(e)) setPosts((x) => ({ items: x?.items || [], error: failText(e), loading: false })); },
    );
  }, [username]);

  const seenPosts = useRef(false);
  const online = s.online;
  useEffect(() => {
    if (!username) { setPosts(null); seenPosts.current = false; return; }
    if (!active) return;
    // Первый показ — загружаем; дальше — по событиям (и снова, если была ошибка: вернулись на вкладку или появилась сеть).
    if (!seenPosts.current || (posts?.error && online)) { seenPosts.current = true; loadPosts(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, active, online, loadPosts]);
  useEffect(() => () => postsCtrl.current?.abort(), []);

  useSocialEvents((e) => {
    if (!username) return;
    if (e.type === 'post-created' && e.post.rootId === null && e.post.author?.id === me?.id) {
      setPosts((x) => ({ items: [e.post, ...(x?.items || []).filter((y) => y.id !== e.post.id)].slice(0, MY_POSTS), error: '', loading: false }));
    } else if (e.type === 'post-deleted' && posts?.items.some((y) => y.id === e.id)) {
      loadPosts();
    } else if (e.type === 'like') {
      setPosts((x) => x && { ...x, items: x.items.map((y) => (y.id === e.id ? { ...y, likes: e.likes, liked: e.liked } : y)) });
    } else if (e.type === 'me-changed' && e.me && e.me.username) {
      // Новые фото, имя или @имя — сразу и в карточках своих постов.
      const m = e.me;
      setPosts((x) => x && {
        ...x,
        items: x.items.map((y) => (y.author && y.author.id === m.id
          ? { ...y, author: { ...y.author, name: m.name, username: m.username!, avatar: m.avatar } } : y)),
      });
    }
  });

  // ─── Экраны стека ───
  const renderScreen = (sc: Screen, on: boolean): JSX.Element => {
    switch (sc.kind) {
      case 'friends':
        return <FriendsView active={on} onBack={back} onOpenUser={(u) => void openUser(u)} onSearch={() => stack.push({ kind: 'search' })} />;
      case 'search':
        return <PeopleSearch active={on} onBack={back} onOpenUser={(u) => void openUser(u)} />;
      case 'blocked':
        return <BlockedView active={on} onBack={back} onOpenUser={(u) => void openUser(u)} />;
      case 'hidden':
        return <HiddenView active={on} onBack={back} />;
      case 'moderation':
        return Mod
          ? <Mod active={on} onBack={back} onOpenUser={(u) => void openUser(u)} onOpenThread={(id) => stack.push({ kind: 'thread', id })} />
          : <div className="wrap wrap--prof prof-screen prof-center"><Spinner size={24} /></div>;
      case 'user':
        return (
          <UserProfileView username={sc.username} onBack={back}
            onOpenThread={(id) => stack.push({ kind: 'thread', id })} onOpenUser={(u) => void openUser(u)} />
        );
      case 'thread':
        return <ThreadView postId={sc.id} onBack={back} onOpenUser={(u) => void openUser(u)} />;
    }
  };

  // ─── Верх корня: гость, «Заверши профиль», шапка ───
  let head: JSX.Element;
  if (loading) {
    head = s.me ? <ProfileHeaderSkeleton user={s.me} /> : slow ? <GuestCard /> : <GuestCardSkeleton />;
  } else if (!me) {
    head = <GuestCard />;
  } else if (stale && onboarded) {
    head = <ProfileHeaderSkeleton user={me} still />;
  } else if (!onboarded) {
    const can = s.mode === 'on' && !me.banned;
    head = (
      <section className="panel prof-finish" aria-labelledby="prof-finish-t">
        <h2 className="prof-finish__t" id="prof-finish-t">{me.name}</h2>
        {can ? (
          <>
            <p className="prof-finish__p">Заверши профиль, чтобы писать в обсуждениях и добавлять друзей.</p>
            <Button full size={44} onClick={() => void s.ensure('post', currentReturnTo())}>Заверши профиль</Button>
          </>
        ) : (
          <p className="prof-finish__p">Профиль не заполнен.</p>
        )}
      </section>
    );
  } else {
    head = (
      <ProfileHeader
        user={me}
        onFriends={social ? () => stack.push({ kind: 'friends' }) : undefined}
        note={me.banned ? (
          <p className="prof-ban prof-ban--me">{banText(me.banned)} Читать можно. Если это ошибка — напиши @skycoax.</p>
        ) : undefined}
      >
        {social && (
          <>
            <Button variant="tinted" size={44} full disabled={!s.online} onClick={() => setEditOpen(true)}>Изменить профиль</Button>
            <Button variant="tinted" size={44} full onClick={() => void actions.share(userLink(me.username!), me.name)}>Поделиться</Button>
          </>
        )}
      </ProfileHeader>
    );
  }

  const top = stack.stack.length - 1;

  return (
    <>
      <div className="wrap wrap--prof" hidden={top >= 0}>
        {active && top < 0 && <NavBar />}
        <LargeTitle title="Профиль" />
        {!s.online && (
          <div className="offline prof-offline" role="status">
            <Icon name="wifiOff" size={20} />
            <span><b>Без интернета.</b> Профиль обновится, когда появится связь.</span>
          </div>
        )}
        {head}

        {username && (
          <section className="prof-mine" aria-labelledby="prof-mine-t">
            <div className="sec__h">
              <h2 className="sec__t" id="prof-mine-t">Мои посты</h2>
              {!!posts?.items.length && (
                <button type="button" className="sec__a prof-all" onClick={() => stack.push({ kind: 'user', username })}>Все посты</button>
              )}
            </div>
            {!posts || (posts.loading && !posts.items.length) ? (
              <div className="skel prof-skel-post" aria-busy="true" aria-label="Загрузка постов" />
            ) : posts.error && !posts.items.length ? (
              // Без сети об этом уже говорит строка вверху — здесь хватит тихой подписи.
              s.online
                ? <LoadError text="Не удалось загрузить посты" detail={posts.error} onRetry={loadPosts} />
                : <p className="prof-empty">Посты загрузятся, когда появится интернет</p>
            ) : posts.items.length ? (
              <PostList
                posts={posts.items} next={null} loadMore={async () => {}}
                onOpenThread={(id) => stack.push({ kind: 'thread', id })}
                onOpenUser={(u) => void openUser(u)}
                onChange={(id, np) => setPosts((x) => x && {
                  ...x, items: np ? x.items.map((y) => (y.id === id ? np : y)) : x.items.filter((y) => y.id !== id),
                })}
              />
            ) : (
              <p className="prof-empty">Здесь появятся твои посты</p>
            )}
          </section>
        )}

        <SettingsList
          theme={p.theme} role={p.role} setRole={p.setRole} schedule={p.schedule} openPicker={p.openPicker} stale={stale}
          nav={{
            friends: () => stack.push({ kind: 'friends' }),
            search: () => stack.push({ kind: 'search' }),
            blocked: () => stack.push({ kind: 'blocked' }),
            hidden: () => stack.push({ kind: 'hidden' }),
            moderation: () => void openModeration(),
            deleteAccount: () => setDelOpen(true),
          }}
        />
      </div>

      {stack.stack.map((sc, i) => (
        <div key={i + ':' + JSON.stringify(sc)} className="prof-layer" hidden={i !== top}>
          {/* Ветка прячет панель вкладок, только пока она сверху и вкладка открыта. */}
          <ScreenVisible.Provider value={active && i === top}>
            {renderScreen(sc, active && i === top)}
          </ScreenVisible.Provider>
        </div>
      ))}

      {onboarded && <EditProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />}
      <DeleteAccountSheet open={delOpen && s.status === 'signed'} onClose={() => setDelOpen(false)} />
    </>
  );
}
