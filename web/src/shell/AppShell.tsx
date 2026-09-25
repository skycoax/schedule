// Оболочка приложения (CONTRACT.md §E.3).
// На адресе Para (вуз выбран) и на адресах вузов (kfu.skycoax.uz…) — три вкладки: «Расписание»,
// «Обсуждения», «Профиль» с одной общей историей «Назад» (D29). Без Para на сервере (brand.social нет) —
// только расписание: ни вкладок, ни SessionProvider, ни social-кода, ни запросов к /api/auth, /api/social и /api/media.
//
// История: запись 'tab' лежит в истории ровно тогда, когда открыта не «Расписание». Уход с вкладки
// сначала закрывает её вложенные экраны и листы (unwind), потом переключает. «Назад» с корня
// «Обсуждений» или «Профиля» ведёт на «Расписание», а с «Расписания» — из приложения.
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, JSX, LazyExoticComponent, ReactNode } from 'react';
import { brand, hasSocial } from '../brand';
import { ls, store } from '../lib/store';
import {
  RESELECT_EVENT,
  type ChatLink, type ChatTabProps, type ProfileLink, type ProfileTabProps, type Role,
  type ScheduleCommand, type ScheduleContext, type ScheduleSlotProps, type TabId, type ThemeApi,
} from '../tabs';
import { SessionProvider, useSession } from '../social/session';
import { ToastHost, toast } from '../ui/Toast';
import { DialogHost } from '../ui/ActionSheet';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Icon } from '../ui/icons';
import { depth, openLayerCount, pushLayer, unwind } from '../ui/layers';
import { useTabBarHidden } from '../ui/bar';
import { useKeyboardWatcher } from '../ui/keyboard';
import { useOnline } from '../ui/online';
import { hideBoot } from '../lib/boot';
import { TabBar } from './TabBar';
import { LargeTitle, NavBar } from './NavBar';
import { readDeepLink, type DeepLink } from './deeplink';
import './shell.css';

export interface AppShellProps {
  theme: ThemeApi;
  role: Role | null;                          // null = not chosen yet (StudentApp shows RolePick)
  setRole: (r: Role) => void;
  renderSchedule: (p: ScheduleSlotProps) => ReactNode;
}

/** Аварийный выключатель вкладок на фронте: false — Para снова только расписание. */
const SOCIAL_TABS = true;
/** Последняя вкладка восстанавливается, только если ей пользовались меньше 30 минут назад (D26). */
const TAB_TTL = 30 * 60e3;
const COACH_DELAY = 2000;
const OFFLINE_TEXT = 'Нет интернета';
const CHUNK_TEXT = 'Раздел загрузится, когда появится интернет';

const noop = () => {};

// ─── Ленивые разделы ───────────────────────────────────────────────────────

/** Раздел, который грузится отдельным файлом. load — предзагрузка (ошибки молча), reset — попробовать заново. */
export interface LazyPanel<P> {
  load: () => Promise<void>;
  readonly Comp: LazyExoticComponent<ComponentType<P>>;
  reset: () => void;
}

const RELOAD_KEY = 'chunkReload';
function reloadedThisSession(): boolean {
  try { return sessionStorage.getItem(RELOAD_KEY) === '1'; } catch { return true; }
}
function markReloaded() {
  try { sessionStorage.setItem(RELOAD_KEY, '1'); } catch { /* приватный режим */ }
}

/**
 * lazy() с одной перезагрузкой за сеанс: если файл раздела не загрузился при живой сети, скорее
 * всего вышла новая версия и старых файлов на сервере уже нет — перезагрузка страницы это чинит.
 * Без сети — ошибка уходит в ErrorBoundary («Раздел загрузится, когда появится интернет»).
 */
export function lazyWithReload<P>(importer: () => Promise<{ default: ComponentType<P> }>): LazyPanel<P> {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const load = () => (pending ??= importer().catch((e: unknown) => { pending = null; throw e; }));
  const make = () => lazy(() => load().catch((e: unknown) => {
    if (navigator.onLine !== false && !reloadedThisSession()) {
      markReloaded();
      location.reload();
      return new Promise<never>(() => {});
    }
    throw e;
  }));
  let comp = make();
  return {
    load: () => load().then(noop, noop),
    get Comp() { return comp; },
    reset() { comp = make(); },
  };
}

const chatPanel = lazyWithReload<ChatTabProps>(() => import('../social/chat/ChatTab'));
const profilePanel = lazyWithReload<ProfileTabProps>(() => import('../social/profile/ProfileTab'));
const authPanel = lazyWithReload<Record<string, never>>(() => import('../social/profile/AuthHost'));

// ─── Оболочка ──────────────────────────────────────────────────────────────

/** Есть ли нижние вкладки: вуз выбран (Para) или задан адресом, на сервере есть «Обсуждения», включён
 *  SOCIAL_TABS. Без них тема выбирается внизу расписания (ThemeSection), а не в «Профиле». */
export function hasTabBar(): boolean {
  return !!brand.id && hasSocial && SOCIAL_TABS;
}

export function AppShell(p: AppShellProps): JSX.Element {
  return hasTabBar() ? <HubRoot {...p} /> : <SingleShell {...p} />;
}

/** Сервер без Para (или выключенные вкладки): одно расписание. */
function SingleShell({ theme, renderSchedule }: AppShellProps): JSX.Element {
  return (
    <>
      {renderSchedule({ active: true, command: null, onContext: noop, theme })}
      <ToastHost />
      <DialogHost />
    </>
  );
}

// Ссылка внутрь читается один раз за жизнь страницы (и убирается из адреса).
let firstLink: DeepLink | null = null;

function HubRoot(p: AppShellProps): JSX.Element {
  const [dl] = useState<DeepLink>(() => (firstLink ??= readDeepLink()));
  return (
    <SessionProvider eager={!!dl.auth}>
      <HubShell {...p} dl={dl} />
    </SessionProvider>
  );
}

interface Routed { tab: TabId | null; chat: ChatLink | null; profile: ProfileLink | null }

/** Куда ведёт ссылка: post/compose → «Обсуждения»; user → «Профиль» (с tab=chat — «Обсуждения»);
 *  delete/mod → «Профиль»; tab — только если ничего из этого нет. При SOCIAL_MODE=off ссылки в чат не ведут. */
function route(dl: DeepLink, off: boolean): Routed {
  let tab: TabId | null = null;
  let chat: ChatLink | null = null;
  let profile: ProfileLink | null = null;
  const userInChat = !!dl.user && dl.tab === 'chat';
  if (dl.post || dl.compose || userInChat) {
    chat = {};
    if (dl.post) chat.post = dl.post;
    if (dl.compose) chat.compose = true;
    if (userInChat) chat.user = dl.user;
    tab = 'chat';
  } else if (dl.user || dl.del || dl.mod) {
    profile = {};
    if (dl.user) profile.user = dl.user;
    if (dl.del) profile.del = true;
    if (dl.mod) profile.mod = true;
    tab = 'profile';
  } else if (dl.tab) {
    tab = dl.tab;
  }
  if (off && tab === 'chat') { tab = 'schedule'; chat = null; }
  return { tab, chat, profile };
}

function sameCtx(a: ScheduleContext, b: ScheduleContext): boolean {
  return a.kind === b.kind && a.title === b.title && a.subtitle === b.subtitle
    && a.unseenChanges === b.unseenChanges && a.installUrl === b.installUrl;
}

function idle(fn: () => void, timeout: number) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout });
  else window.setTimeout(fn, 1200);
}

function HubShell({ theme, role, setRole, renderSchedule, dl }: AppShellProps & { dl: DeepLink }): JSX.Element {
  const session = useSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const off = session.mode === 'off';

  // До согласия ссылку держим и применяем после онбординга (первый onContext).
  const [boot] = useState(() => {
    const agreed = !!store('agreed');
    const routed = route(dl, session.mode === 'off');
    let tab: TabId = 'schedule';
    if (agreed) {
      if (routed.tab) tab = routed.tab;
      else {
        const saved = ls('tab');
        const at = Number(ls('tabAt')) || 0;
        if ((saved === 'chat' || saved === 'profile') && Date.now() - at < TAB_TTL
          && !(saved === 'chat' && session.mode === 'off')) tab = saved;
      }
    }
    return { agreed, routed, tab };
  });

  const [tab, setTab] = useState<TabId>(boot.tab);
  const tabRef = useRef<TabId>(boot.tab);
  const [mounted, setMounted] = useState(() => ({ chat: boot.tab === 'chat', profile: boot.tab === 'profile' }));
  const [chatLink, setChatLink] = useState<ChatLink | null>(null);
  const [profileLink, setProfileLink] = useState<ProfileLink | null>(null);
  const [command, setCommand] = useState<ScheduleCommand | null>(null);
  const [ctx, setCtx] = useState<ScheduleContext | null>(null);
  const [coach, setCoach] = useState(false);
  const ctxRef = useRef<ScheduleContext | null>(null);
  const held = useRef<Routed | null>(!boot.agreed && boot.routed.tab ? boot.routed : null);
  const started = useRef(false);
  const scrolls = useRef<Record<TabId, number>>({ schedule: 0, chat: 0, profile: 0 });
  const tabLayer = useRef<(() => Promise<void>) | null>(null);
  const selecting = useRef<Promise<void>>(Promise.resolve());

  const barHidden = useTabBarHidden();
  const barHiddenRef = useRef(barHidden);
  barHiddenRef.current = barHidden;
  useKeyboardWatcher();

  // Сменили режим (студент ↔ преподаватель) — прежний контекст больше не про этот режим.
  const [ctxRole, setCtxRole] = useState(role);
  if (ctxRole !== role) {
    setCtxRole(role);
    setCtx(null);
    ctxRef.current = null;
  }

  const switchTo = useCallback((t: TabId) => {
    const cur = tabRef.current;
    if (cur === t) return;
    scrolls.current[cur] = window.scrollY;
    tabRef.current = t;
    setTab(t);
    setCoach(false);
    // Сам нашёл «Обсуждения» — подсказка больше не нужна.
    if (t === 'chat') ls('coach_chat', '1');
    if (t !== 'schedule') setMounted((m) => (m[t] ? m : { ...m, [t]: true }));
  }, []);

  const pushTabLayer = useCallback(() => {
    if (tabLayer.current) return;
    tabLayer.current = pushLayer('tab', () => {
      // «Назад» с корня вкладки (или unwind(0)) — на «Расписание».
      tabLayer.current = null;
      switchTo('schedule');
    });
  }, [switchTo]);

  /** Выбор вкладки. Вызовы идут строго по очереди: следующий ждёт, пока история успокоится. */
  const select = useCallback((t: TabId): Promise<void> => {
    const run = async () => {
      const cur = tabRef.current;
      if (t === cur) {
        window.dispatchEvent(new CustomEvent<TabId>(RESELECT_EVENT, { detail: t }));
        return;
      }
      // Закрываем вложенные экраны и листы вкладки, с которой уходим; запись 'tab' остаётся.
      await unwind(cur === 'schedule' ? 0 : 1);
      if (t === 'schedule') {
        await unwind(0);
        tabLayer.current = null;
        switchTo('schedule');
      } else {
        pushTabLayer();
        switchTo(t);
      }
    };
    const next = selecting.current.then(run, run);
    selecting.current = next.catch(noop);
    return next;
  }, [pushTabLayer, switchTo]);

  // Первый показ: холодный старт не на «Расписании» — сначала запись 'tab', потом ссылки панелям.
  const mountedOnce = useRef(false);
  useEffect(() => {
    if (tabRef.current !== 'schedule') pushTabLayer();
    if (!mountedOnce.current) {
      mountedOnce.current = true;
      if (!held.current) {
        if (boot.routed.chat) setChatLink(boot.routed.chat);
        if (boot.routed.profile) setProfileLink(boot.routed.profile);
      }
      if (dl.auth) sessionRef.current.handleAuthOutcome(dl.auth);
    }
    return () => {
      const close = tabLayer.current;
      tabLayer.current = null;
      if (close) void close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Флаги страницы: вкладки есть (отступ снизу), какая вкладка открыта (свечение правок — только
  // на «Расписании»). Прокрутку каждой вкладки возвращаем до отрисовки.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('has-tabbar');
    return () => {
      root.classList.remove('has-tabbar');
      delete root.dataset.tab;
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.tab = tab;
    window.scrollTo(0, scrolls.current[tab] || 0);
  }, [tab]);

  // Последняя вкладка — для восстановления после перезапуска (TWA может выгрузить страницу).
  useEffect(() => {
    ls('tab', tab);
    ls('tabAt', String(Date.now()));
  }, [tab]);
  useEffect(() => {
    const save = () => {
      if (document.visibilityState !== 'hidden') return;
      ls('tab', tabRef.current);
      ls('tabAt', String(Date.now()));
    };
    document.addEventListener('visibilitychange', save);
    return () => document.removeEventListener('visibilitychange', save);
  }, []);

  // «Обсуждения» выключили (SOCIAL_MODE=off) — с них уходим на «Расписание».
  useEffect(() => {
    if (off && tabRef.current === 'chat') void select('schedule');
    if (off) setCoach(false);
  }, [off, select]);

  // Подсказку показываем на «Расписании», когда поверх ничего нет (согласие, выбор группы,
  // «На главный экран», отзыв, лист, меню вузов). Мешает что-то — пробуем снова через 2 с,
  // но не дольше минуты: не вышло — покажем при следующем запуске.
  const coachTimer = useRef(0);
  const coachLater = useCallback(() => {
    window.clearTimeout(coachTimer.current);
    let tries = 30;
    coachTimer.current = window.setTimeout(function check() {
      if (ls('coach_chat') || sessionRef.current.mode === 'off') return;
      const busy = tabRef.current !== 'schedule' || barHiddenRef.current || openLayerCount(['tab']) > 0
        || !!document.querySelector('.modal.open, .sheet.open, .nudge, .umenu');
      if (busy) {
        if (--tries > 0) coachTimer.current = window.setTimeout(check, COACH_DELAY);
        return;
      }
      setCoach(true);
    }, COACH_DELAY);
  }, []);
  useEffect(() => () => window.clearTimeout(coachTimer.current), []);

  const onContext = useCallback((c: ScheduleContext) => {
    const prev = ctxRef.current;
    if (prev && sameCtx(prev, c)) return;
    ctxRef.current = c;
    setCtx(c);
    if (started.current) return;
    started.current = true;

    // Первый контекст = онбординг пройден: теперь можно в сеть (D31).
    const s = sessionRef.current;
    if (s.status === 'loading') void s.refresh();

    const h = held.current;
    held.current = null;
    if (h && h.tab && h.tab !== 'schedule' && !(h.tab === 'chat' && s.mode === 'off')) {
      void select(h.tab).then(() => {
        if (h.chat) setChatLink(h.chat);
        if (h.profile) setProfileLink(h.profile);
      });
    }

    if (navigator.onLine !== false) {
      idle(() => {
        const mode = sessionRef.current.mode;
        if (mode !== 'off') void chatPanel.load();
        void profilePanel.load();
        void authPanel.load();
      }, 4000);
    }

    // Подсказка про «Обсуждения» — один раз, через 2 с после расписания.
    if (!ls('coach_chat') && s.mode !== 'off') coachLater();
  }, [select, coachLater]);

  const closeCoach = useCallback(() => {
    ls('coach_chat', '1');
    setCoach(false);
  }, []);
  useEffect(() => {
    // Подсказка видна — считаем её показанной, как только ею воспользовались или ушли с вкладки.
    if (!coach) return;
    return () => { ls('coach_chat', '1'); };
  }, [coach]);

  // Для разработчика (как __paraDebug в social/session): localStorage.paraDebug = '1' → window.__paraShell.
  useEffect(() => {
    if (ls('paraDebug') !== '1') return;
    (window as Window & { __paraShell?: unknown }).__paraShell = { select, depth, unwind, pushLayer, openLayerCount };
  }, [select]);
  useEffect(() => {
    if (ls('paraDebug') !== '1' || (!chatLink && !profileLink)) return;
    const w = window as Window & { __paraShellLinks?: unknown[] };
    (w.__paraShellLinks ??= []).push({ tab: tabRef.current, chat: chatLink, profile: profileLink });
  }, [chatLink, profileLink]);

  const clearChatLink = useCallback(() => setChatLink(null), []);
  const clearProfileLink = useCallback(() => setProfileLink(null), []);
  const setRoleAndShow = useCallback((r: Role) => { setRole(r); void select('schedule'); }, [setRole, select]);
  const openPicker = useCallback(() => {
    void select('schedule').then(() => setCommand({ kind: 'picker', n: Date.now() }));
  }, [select]);

  const slot = useMemo<ScheduleSlotProps>(
    () => ({ active: tab === 'schedule', command, onContext, theme }),
    [tab, command, onContext, theme],
  );

  const items: TabId[] = off ? ['schedule', 'profile'] : ['schedule', 'chat', 'profile'];
  const me = session.status === 'guest' ? null : session.me;
  const signedMe = session.status === 'signed' ? session.me : null;
  const badges = {
    schedule: !!ctx?.unseenChanges,
    profile: !!signedMe && (signedMe.requestsIn > 0 || (signedMe.isAdmin && signedMe.modQueue > 0)),
  };
  const Auth = authPanel.Comp;

  return (
    <>
      <div role="tabpanel" id="panel-schedule" aria-labelledby="tab-schedule" hidden={tab !== 'schedule'}>
        {renderSchedule(slot)}
      </div>
      {(!off || mounted.chat) && (
        <div role="tabpanel" id="panel-chat" aria-labelledby="tab-chat" hidden={tab !== 'chat'}>
          {mounted.chat && (
            <Panel panel={chatPanel} title="Обсуждения" active={tab === 'chat'}
              props={{ active: tab === 'chat', link: chatLink, onLinkHandled: clearChatLink }} />
          )}
        </div>
      )}
      <div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile" hidden={tab !== 'profile'}>
        {mounted.profile && (
          <Panel panel={profilePanel} title="Профиль" active={tab === 'profile'}
            props={{
              active: tab === 'profile', theme, role: role ?? 'student', setRole: setRoleAndShow,
              schedule: ctx, openPicker, link: profileLink, onLinkHandled: clearProfileLink,
            }} />
        )}
      </div>

      <div className={'tabfade' + (barHidden ? ' is-hidden' : '')} aria-hidden="true" />
      <TabBar tab={tab} onSelect={(t) => { void select(t); }} hidden={barHidden} items={items} badges={badges} me={me} />
      {coach && !barHidden && tab === 'schedule' && !off && (
        <Coach onOpen={() => { closeCoach(); void select('chat'); }} onClose={closeCoach} />
      )}

      {session.prompt && (
        <ErrorBoundary fallback={() => <AuthHostFailed />}>
          <Suspense fallback={null}><Auth /></Suspense>
        </ErrorBoundary>
      )}
      <ToastHost />
      <DialogHost />
    </>
  );
}

// ─── Раздел: загрузка, ошибка, повтор ─────────────────────────────────────

/**
 * Повтор после неудачной загрузки раздела. Браузер запоминает неудачную загрузку файла
 * модуля до перезагрузки страницы, поэтому при живой сети повторить можно только
 * перезагрузкой (открытая вкладка восстановится). Без сети — просто говорим почему.
 */
function retryChunk() {
  if (navigator.onLine === false) toast(OFFLINE_TEXT);
  else location.reload();
}

/** Ленивый раздел: заглушка «загрузка», при ошибке — «Раздел загрузится, когда появится интернет» + «Повторить». */
export function Panel<P extends object>({ panel, title, active, props }: {
  panel: LazyPanel<P>; title: string; active: boolean; props: P;
}): JSX.Element {
  const Comp = panel.Comp as unknown as ComponentType<P>;
  return (
    <ErrorBoundary fallback={() => (
      <ChunkError title={title} active={active} onRetry={retryChunk} />
    )}>
      <Suspense fallback={<PanelLoading title={title} active={active} />}>
        <Comp {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * Редкое окно отдельным файлом: грузится при первом открытии и дальше остаётся на месте.
 * Файл не загрузился (нет сети) — окно не открывается, показываем причину; следующее
 * открытие пробует снова.
 */
export function LazyModal<P extends object>({ panel, open, props, onFail }: {
  panel: LazyPanel<P>; open: boolean; props: P; onFail: () => void;
}): JSX.Element | null {
  const [used, setUsed] = useState(open);
  if (open && !used) setUsed(true);
  if (!used) return null;
  const Comp = panel.Comp as unknown as ComponentType<P>;
  const fail = () => { panel.reset(); setUsed(false); onFail(); };
  return (
    <ErrorBoundary fallback={() => <LoadFailed onFail={fail} />}>
      <Suspense fallback={null}><Comp {...props} /></Suspense>
    </ErrorBoundary>
  );
}

function LoadFailed({ onFail }: { onFail: () => void }): null {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    toast(navigator.onLine === false ? OFFLINE_TEXT : CHUNK_TEXT);
    onFail();
  }, [onFail]);
  return null;
}

function PanelLoading({ title, active }: { title: string; active: boolean }): JSX.Element {
  return (
    <>
      {active && <NavBar />}
      <div className="wrap" aria-busy="true">
        <LargeTitle title={title} />
        <div className="skel" />
        <div className="skel" />
      </div>
    </>
  );
}

function ChunkError({ title, active, onRetry }: { title: string; active: boolean; onRetry: () => void }): JSX.Element {
  const online = useOnline();
  const wasOnline = useRef(online);
  // Раздел — первое, что видно (режим преподавателя), а файл не загрузился: экран запуска больше не нужен.
  useEffect(() => { hideBoot(); }, []);
  // Связь вернулась, пока этот экран перед глазами, — пробуем сами, без нажатия.
  // (Повтор — перезагрузка страницы, поэтому со скрытой вкладки его не делаем.)
  useEffect(() => {
    if (online && !wasOnline.current && active) onRetry();
    wasOnline.current = online;
  }, [online, active, onRetry]);
  return (
    <>
      {active && <NavBar />}
      <div className="wrap">
        <LargeTitle title={title} />
        <div className="chunk-err" role="alert">
          <span className="chunk-err__ico"><Icon name="wifiOff" size={26} /></span>
          <p className="chunk-err__t">{CHUNK_TEXT}</p>
          <button type="button" className="chunk-err__btn" onClick={onRetry}>Повторить</button>
        </div>
      </div>
    </>
  );
}

/** AuthHost не загрузился: закрываем окно входа и объясняем почему. */
function AuthHostFailed(): null {
  const session = useSession();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    authPanel.reset();
    session.resolvePrompt(false);
    toast(navigator.onLine === false ? OFFLINE_TEXT : CHUNK_TEXT);
  }, [session]);
  return null;
}

/** Подсказка над вкладкой «Обсуждения» для тех, кто пользовался расписанием до обновления (ux.md §3.9). */
function Coach({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }): JSX.Element {
  return (
    <div className="coach" role="status">
      <button type="button" className="coach__main" onClick={onOpen}>Новое: обсуждения твоего вуза</button>
      <button type="button" className="coach__x" aria-label="Закрыть подсказку" onClick={onClose}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
