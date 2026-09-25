// Вкладка «Обсуждения»: лента вуза (корень) и стек экранов поверх неё — ветка и чужой профиль.
// Лента остаётся смонтированной и только прячется, пока открыт экран стека (список и прокрутка целы).
// Ссылки (?post=, ?compose=1, ?tab=chat&user=) обрабатываем, когда вкладка видна и сессия известна.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { PullRefresh } from '../../components/PullRefresh';
import { LargeTitle, NavBar, NavButton, NavPlaceholder, UniLogoButton } from '../../shell/NavBar';
import { useUniversityMenu } from '../../shell/useUniversityMenu';
import { RESELECT_EVENT } from '../../tabs';
import type { ChatLink, ChatTabProps, TabId } from '../../tabs';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { banText } from '../format';
import { currentReturnTo, useSession } from '../session';
import { useStack } from '../stack';
import { categoryOf } from '../types';
import type { CategoryId, Post } from '../types';
import { EmptyState } from '../ui/EmptyState';
import { UserProfileView } from '../profile/UserProfileView';
import { CategoryChips } from './CategoryChips';
import { Composer } from './Composer';
import { Feed } from './Feed';
import type { FeedHandle } from './Feed';
import { ScreenVisible, reducedMotion, uniShort } from './PostCard';
import { ThreadView } from './ThreadView';
import './chat.css';

type ChatScreen = { kind: 'thread'; id: number; focus?: boolean } | { kind: 'user'; username: string };

const CAT_KEY = 'chatCat';

function readCat(): CategoryId | '' {
  try { return categoryOf(sessionStorage.getItem(CAT_KEY))?.id ?? ''; } catch { return ''; }
}
function writeCat(v: CategoryId | '') {
  try { sessionStorage.setItem(CAT_KEY, v); } catch { /* приватный режим */ }
}

export default function ChatTab(p: ChatTabProps): JSX.Element {
  const { active, link, onLinkHandled } = p;
  const session = useSession();
  const { ensure, mode, status } = session;
  const nav = useStack<ChatScreen>();
  const { push, pop, popToRoot } = nav;
  const umenu = useUniversityMenu();
  const feed = useRef<FeedHandle>(null);
  const [cat, setCatState] = useState<CategoryId | ''>(readCat);
  const [composer, setComposer] = useState(false);
  const top = nav.top;
  const short = uniShort();

  const setCat = useCallback((v: CategoryId | '') => {
    setCatState(v);
    writeCat(v);
    window.scrollTo(0, 0);
  }, []);

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

  const onPublished = useCallback((post: Post) => {
    setComposer(false);
    if (cat && cat !== post.category) { setCatState(''); writeCat(''); }
    window.scrollTo({ top: 0 });
  }, [cat]);

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
      {active && !top && (
        <NavBar
          left={<UniLogoButton onOpen={umenu.open} />}
          title="Обсуждения"
          right={off
            ? <NavPlaceholder />
            : (
              <NavButton label="Новый пост" haspopup="dialog" disabled={mode !== 'on'} onClick={() => void compose()}>
                <Icon name="compose" />
              </NavButton>
            )}
        />
      )}
      <div className="wrap wrap--chat chat-root" hidden={!!top}>
        <LargeTitle title="Обсуждения" subtitle={`Неофициальное сообщество · ${short}`} />
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
            {/* В readonly писать нельзя никому — строка «после входа» противоречила бы строке выше. */}
            {guest && mode === 'on' && (
              <div className="chat-guest">
                <p>Читать можно без аккаунта. Писать, отвечать и ставить отметки — после входа.</p>
                <Button size={32} variant="tinted" onClick={() => session.requestSignIn('account')}>Войти</Button>
              </div>
            )}
            <CategoryChips value={cat} onChange={setCat} all label="Темы обсуждений" />
            <Feed
              ref={feed} active={active && !top} cat={cat} canCompose={mode === 'on'} onCompose={() => void compose()}
              onOpenThread={openThread} onOpenUser={(u) => void openUser(u)}
            />
          </>
        )}
      </div>

      {nav.stack.map((s, i) => {
        const shown = active && i === nav.stack.length - 1;
        return (
          <div key={i + (s.kind === 'thread' ? ':t' + s.id : ':u' + s.username)} className="chat-screen" hidden={i !== nav.stack.length - 1}>
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
          </div>
        );
      })}

      {umenu.element}
      {composer && <Composer initialCategory={cat || null} onClose={() => setComposer(false)} onPublished={onPublished} />}
      <PullRefresh onRefresh={refresh} enabled={active && !top && !off} target=".chat-root" />
    </>
  );
}
