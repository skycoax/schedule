// Вкладка «Обсуждения»: лента вуза (корень) и стек экранов поверх неё — ветка и чужой профиль.
// Лента остаётся смонтированной и только прячется, пока открыт экран стека (список и прокрутка целы).
// Ссылки (?post=, ?compose=1, ?tab=chat&user=) обрабатываем, когда вкладка видна и сессия известна.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { PullRefresh } from '../../components/PullRefresh';
import { LargeTitle, NavBar, NavButton } from '../../shell/NavBar';
import { RESELECT_EVENT } from '../../tabs';
import type { ChatLink, ChatTabProps, TabId } from '../../tabs';
import { Icon } from '../../ui/icons';
import { StackScreen } from '../../ui/StackScreen';
import { useScreenAnim } from '../../ui/screen-anim';
import { banText } from '../format';
import { currentReturnTo, useSession } from '../session';
import { useStack } from '../stack';
import type { Post } from '../types';
import { EmptyState } from '../ui/EmptyState';
import { UserProfileView } from '../profile/UserProfileView';
import { Composer } from './Composer';
import { Feed } from './Feed';
import type { FeedHandle } from './Feed';
import { ScreenVisible, reducedMotion } from './PostCard';
import { ThreadView } from './ThreadView';
import { WhatsNew } from './WhatsNew';
import './chat.css';

type ChatScreen = { kind: 'thread'; id: number; focus?: boolean } | { kind: 'user'; username: string };

export default function ChatTab(p: ChatTabProps): JSX.Element {
  const { active, link, onLinkHandled } = p;
  const session = useSession();
  const { ensure, mode, status } = session;
  const nav = useStack<ChatScreen>();
  const { push, pop, popToRoot } = nav;
  const feed = useRef<FeedHandle>(null);
  const [composer, setComposer] = useState(false);
  const top = nav.top;
  const rootAnim = useScreenAnim(!!top, false);

  const openThread = useCallback((id: number, focus?: boolean) => {
    push(focus ? { kind: 'thread', id, focus: true } : { kind: 'thread', id });
  }, [push]);

  // Профили — только после входа; гость после входа вернётся сюда же, в «Обсуждения».
  const openUser = useCallback(async (username: string) => {
    if (!(await ensure('profile', currentReturnTo({ user: username })))) return;
    push({ kind: 'user', username });
  }, [ensure, push]);

  const compose = useCallback(async () => {
    if (!(await ensure('post', currentReturnTo({ compose: 1 })))) return;
    setComposer(true);
  }, [ensure]);

  const onPublished = useCallback((_post: Post) => {
    setComposer(false);
    window.scrollTo({ top: 0 });
  }, []);

  // Ссылка из адреса: один раз, когда вкладка видна и ясно, вошёл ли человек.
  const handled = useRef<ChatLink | null>(null);
  useEffect(() => {
    if (!active || !link || status === 'loading' || handled.current === link) return;
    handled.current = link;
    onLinkHandled();
    if (mode === 'off') return;
    if (link.post) openThread(link.post);
    else if (link.compose) void compose();
    else if (link.user) void openUser(link.user);
  }, [active, link, status, mode, onLinkHandled, openThread, compose, openUser]);

  // Повторное нажатие на вкладку: к корню, наверх, свежая лента.
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<TabId>).detail !== 'chat') return;
      void (async () => {
        await popToRoot();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        }));
        await feed.current?.reload();
      })();
    };
    window.addEventListener(RESELECT_EVENT, on);
    return () => window.removeEventListener(RESELECT_EVENT, on);
  }, [popToRoot]);

  const refresh = useCallback(async () => {
    await Promise.all([feed.current?.reload(), session.refresh()]);
  }, [session]);

  const off = mode === 'off';
  const me = status === 'signed' ? session.me : null;
  const guest = status === 'guest';

  return (
    <>
      {/* Строка навигации — вне .chat-root: «потянуть, чтобы обновить» сдвигает .chat-root, а строка
          fixed и должна оставаться на месте (внутри сдвинутого блока она поехала бы вместе с лентой). */}
      {active && !top && <NavBar title="Обсуждения" />}
      <div className={'wrap wrap--chat chat-root' + rootAnim.className} hidden={!!top} onAnimationEnd={rootAnim.onAnimationEnd}>
        {/* Заголовок и «Новый пост» в одной строке; строка навигации сверху пустая — в ней только
            короткий заголовок, когда лента прокручена. */}
        <div className="chat-head">
          <LargeTitle title="Обсуждения" />
          {!off && (
            <NavButton label="Новый пост" haspopup="dialog" disabled={mode !== 'on'} onClick={() => void compose()}>
              <Icon name="compose" />
            </NavButton>
          )}
        </div>
        {off ? (
          <EmptyState icon="bubbles" title="Обсуждения скоро откроются" text="Мы готовим место для общения внутри вуза. Загляни чуть позже." />
        ) : (
          <>
            {mode === 'readonly' && <p className="chat-row">Сейчас обсуждения доступны только для чтения.</p>}
            {me?.banned && (
              <p className="chat-row">
                {banText(me.banned)} Читать можно. Если это ошибка — напиши{' '}
                <a href="https://t.me/skycoax" target="_blank" rel="noopener noreferrer">@skycoax</a>.
              </p>
            )}
            {/* Как в Threads: «Что нового?» над лентой. Гостю — вход; в readonly писать нельзя никому. */}
            {mode === 'on' && !me?.banned && (
              <WhatsNew me={me} guest={guest} onCompose={() => void compose()} onSignIn={() => session.requestSignIn('account')} />
            )}
            <Feed
              ref={feed} active={active && !top} cat="" canCompose={mode === 'on'} onCompose={() => void compose()}
              onOpenThread={openThread} onOpenUser={(u) => void openUser(u)}
            />
          </>
        )}
      </div>

      {nav.stack.map((s, i) => {
        const shown = active && i === nav.stack.length - 1;
        return (
          <StackScreen key={i + (s.kind === 'thread' ? ':t' + s.id : ':u' + s.username)} className="chat-screen" hidden={i !== nav.stack.length - 1}>
            <ScreenVisible.Provider value={shown}>
              {s.kind === 'thread'
                ? <ThreadView postId={s.id} focusComposer={s.focus} onBack={() => void pop()} onOpenUser={(u) => push({ kind: 'user', username: u })} />
                : (
                  <UserProfileView
                    username={s.username} onBack={() => void pop()}
                    onOpenThread={(id) => openThread(id)} onOpenUser={(u) => void openUser(u)}
                  />
                )}
            </ScreenVisible.Provider>
          </StackScreen>
        );
      })}

      {composer && <Composer onClose={() => setComposer(false)} onPublished={onPublished} />}
      <PullRefresh onRefresh={refresh} enabled={active && !top && !off} target=".chat-root" />
    </>
  );
}
