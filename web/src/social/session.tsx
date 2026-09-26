// Сессия «Обсуждений»: кто вошёл, режим (on / readonly / off), настройки сервера и окна входа.
// Правила — CONTRACT.md §E.2 «Session algorithm». До согласия с условиями (store('agreed'))
// в сеть не ходим: первый запрос делает AppShell через refresh() после онбординга (D31).
// Здесь же живёт лист «Пожаловаться» (ReportSheet): грузится лениво при первой жалобе.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, JSX, ReactNode } from 'react';
import { brand } from '../brand';
import { ls, store } from '../lib/store';
import { toast } from '../ui/Toast';
import { useOnline } from '../ui/online';
import { leaveLayers, whenIdle } from '../ui/layers';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import type * as Api from './api';
import { emit, useSocialEvents } from './events';
import { clearSocialLocal, readMeCache, writeMeCache } from './local';
import type {
  AgeGroup, AuthIntent, AuthOutcome, AuthReason, AuthState, Ban, Me, ReportResult, ReportTarget, SocialConfig, SocialMode,
} from './types';

export type SessionStatus = 'loading' | 'guest' | 'signed';
export type AuthPrompt =
  | { kind: 'signin'; reason: AuthReason; returnTo: string }
  | { kind: 'setup' }
  | { kind: 'rules' }
  | { kind: 'banned'; ban: Ban };

export interface Session {
  status: SessionStatus;            // 'loading' до первого ответа me() (и пока нет согласия)
  /** Пока 'loading' — объект из me_cache (надёжны только id, имя, @имя, фото). */
  me: Me | null;
  mode: SocialMode;                 // brand.social ?? 'on' до ответа /api/auth/me; 'off' при 404 или mode:'off'
  google: boolean | null;           // null — неизвестно (запрос не удался): кнопка входа остаётся доступной
  dev: boolean;
  config: SocialConfig | null;
  online: boolean;
  prompt: AuthPrompt | null;        // AuthHost рисует лист для него
  /** Выполняется, когда закончился ПЕРВЫЙ me() (успех, 404, 5xx или сеть). Никогда не отклоняется. */
  ready: Promise<void>;
  ensure(reason: AuthReason, returnTo?: string): Promise<boolean>;
  requestSignIn(reason: AuthReason, returnTo?: string): void;
  resolvePrompt(ok: boolean): void;
  /** Сохраняет черновики и уходит на location.replace(socialApi.signInUrl(o)). */
  signIn(o: { returnTo: string; intent: AuthIntent; age?: AgeGroup; accept: boolean }): void;
  /** Только разработка: POST /api/auth/dev, затем returnTo + '#auth=ok' (для 'delete' без аккаунта — '#auth=none'). */
  devSignIn(name: string, age?: AgeGroup, intent?: AuthIntent): Promise<void>;
  signOut(all?: boolean): Promise<void>;
  refresh(): Promise<void>;
  setMe(me: Me): void;
  handleAuthOutcome(o: AuthOutcome): void;
}

const OUTCOME_OK = new Set<AuthOutcome>(['ok', 'cancelled', 'none']);

/** Действия, которым нужны профиль, правила и отсутствие ограничения (охрана P/N на сервере).
 *  'game' — игра «Код» с людьми; в режиме «только чтение» её нет (в READONLY_OK не входит). */
const WRITES = new Set<AuthReason>(['post', 'reply', 'like', 'friend', 'game']);
/** Что можно в режиме «только чтение». */
const READONLY_OK = new Set<AuthReason>(['profile', 'search', 'account', 'delete', 'expired', 'report', 'block']);

const OFF_TEXT = 'Обсуждения временно недоступны';
const READONLY_TEXT = 'Обсуждения временно доступны только для чтения';
const REFETCH_MS = 5 * 60e3;
const REPORT_LEAVE_MS = 280;

/** '/?uni=<brand.id>&tab=<вкладка>' + дополнительные параметры. */
export function currentReturnTo(extra?: Record<string, string | number>): string {
  const q = new URLSearchParams();
  if (brand.id) q.set('uni', brand.id);
  const tab = typeof document !== 'undefined' ? document.documentElement.dataset.tab : '';
  q.set('tab', tab === 'chat' || tab === 'profile' ? tab : 'schedule');
  if (extra) for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  return '/?' + q.toString();
}

/** Из me_cache — только id, имя, @имя и фото; остальное — безопасные значения до ответа сервера. */
function meFromCache(c: Pick<Me, 'id' | 'name' | 'username' | 'avatar'>): Me {
  return {
    id: c.id, username: c.username, name: c.name, avatar: c.avatar, avatarFull: null, bio: '',
    links: { tg: '', ig: '' }, uni: null, uniShort: null, team: false, isAdmin: false, email: '', age: 'minor',
    privacy: { links: 'friends', searchable: false, friendRequests: 'none' },
    needsProfile: c.username === null, suggestedUsername: null, rulesAccepted: true, banned: null,
    requestsIn: 0, modQueue: 0, counts: { friends: 0, posts: 0 }, usernameNextChange: null, createdAt: '', game: null,
  };
}

// ─── Лист «Пожаловаться»: actions.tsx просит, SessionProvider показывает ───

/** Что вернул лист жалобы: результат (null — не отправили) и просьбу сразу заблокировать автора. */
export interface ReportOutcome { result: ReportResult | null; block: boolean }
interface ReportReq {
  id: number;
  target: ReportTarget;
  kind: 'post' | 'reply' | 'user' | 'instant';
  username: string;
  resolve: (r: ReportOutcome) => void;
}
export interface ReportSheetProps {
  open: boolean;
  target: ReportTarget;
  kind: 'post' | 'reply' | 'user' | 'instant';
  username: string;
  onDone: (result: ReportResult | null, block: boolean) => void;
}

let reportSeq = 0;
let reportHost: ((r: ReportReq) => void) | null = null;

/** Внутреннее (для actions.tsx): открыть лист жалобы. Без SessionProvider — сразу null. */
export function openReportSheet(o: { target: ReportTarget; kind: 'post' | 'reply' | 'user' | 'instant'; username: string }): Promise<ReportOutcome> {
  return new Promise<ReportOutcome>((resolve) => {
    if (!reportHost) { resolve({ result: null, block: false }); return; }
    reportHost({ id: ++reportSeq, ...o, resolve });
  });
}

const loadReportSheet = () => import('./ui/ReportSheet') as Promise<{ default: ComponentType<ReportSheetProps> }>;
let ReportSheetLazy = lazy(loadReportSheet);

/** Файл раздела не загрузился: без сети — «Нет интернета»; при живой сети это почти всегда
 *  старая вкладка после выкладки новой версии (старых файлов на сервере уже нет). */
const chunkFailText = () => (navigator.onLine === false ? 'Нет интернета' : 'Не получилось открыть — обнови страницу');

/** Чанк листа не загрузился: сообщаем и закрываем запрос. */
function ReportFailed({ onFail }: { onFail: () => void }) {
  useEffect(() => {
    // Следующая попытка загрузит чанк заново.
    ReportSheetLazy = lazy(loadReportSheet);
    toast(chunkFailText(), { kind: 'error' });
    onFail();
  }, [onFail]);
  return null;
}

function ReportHost(): JSX.Element | null {
  const [req, setReq] = useState<ReportReq | null>(null);
  const [open, setOpen] = useState(false);
  const done = useRef<ReportOutcome | null>(null);
  const reqRef = useRef<ReportReq | null>(null);

  useEffect(() => {
    reportHost = (r) => {
      // Новый запрос, пока открыт старый: старый считаем отменённым.
      reqRef.current?.resolve({ result: null, block: false });
      done.current = null;
      reqRef.current = r;
      setReq(r);
      setOpen(true);
    };
    return () => {
      reportHost = null;
      reqRef.current?.resolve({ result: null, block: false });
      reqRef.current = null;
    };
  }, []);

  // Лист закрыт: ждём, пока его запись уйдёт из истории, и только тогда отвечаем
  // (следующее окно — «Заблокировать @u?» — не должно потеряться). Потом убираем лист.
  useEffect(() => {
    if (open || !req) return;
    let alive = true;
    const r = req;
    const out = done.current || { result: null, block: false };
    void whenIdle().then(() => {
      if (reqRef.current === r) reqRef.current = null;
      r.resolve(out);
    });
    const t = window.setTimeout(() => { if (alive) setReq((cur) => (cur === r ? null : cur)); }, REPORT_LEAVE_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [open, req]);

  const onDone = useCallback((result: ReportResult | null, block: boolean) => {
    done.current = { result, block };
    setOpen(false);
  }, []);
  const onFail = useCallback(() => onDone(null, false), [onDone]);

  if (!req) return null;
  const Lazy = ReportSheetLazy;
  return (
    <ErrorBoundary key={req.id} fallback={() => <ReportFailed onFail={onFail} />}>
      <Suspense fallback={null}>
        <Lazy open={open} target={req.target} kind={req.kind} username={req.username} onDone={onDone} />
      </Suspense>
    </ErrorBoundary>
  );
}

// ─── Провайдер ───

interface State {
  status: SessionStatus;
  me: Me | null;
  mode: SocialMode;
  google: boolean | null;
  dev: boolean;
  config: SocialConfig | null;
  prompt: AuthPrompt | null;
}

const Ctx = createContext<Session | null>(null);

/** Сессия вне провайдера (адрес вуза, не Para): гость, ничего не делает. */
const NOOP: Session = {
  status: 'guest', me: null, mode: 'off', google: null, dev: false, config: null, online: true, prompt: null,
  ready: Promise.resolve(),
  ensure: () => Promise.resolve(false),
  requestSignIn: () => {},
  resolvePrompt: () => {},
  signIn: () => {},
  devSignIn: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
  refresh: () => Promise.resolve(),
  setMe: () => {},
  handleAuthOutcome: () => {},
};

/** Переход с фрагментом (#auth=…). Тот же адрес — replace сменил бы только #, без загрузки страницы.
 *  Сначала убираем свои записи истории (вкладка, окно входа): replace заменит запись самой страницы, и после
 *  входа «Назад» не проведёт через записи «до входа» с перезагрузкой. */
async function goTo(target: string) {
  await leaveLayers();
  const u = new URL(target, location.href);
  if (u.pathname + u.search === location.pathname + location.search) {
    history.replaceState(history.state, '', u.href);
    location.reload();
  } else {
    location.replace(u.href);
  }
}

/** Перед уходом на вход: поле ввода теряет фокус (черновик сохраняется по blur), чат дописывает
 *  отложенное сохранение на pagehide, который браузер пошлёт при location.replace. */
function flushDrafts() {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el !== document.body) {
    try { el.blur(); } catch { /* не страшно */ }
  }
}

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Не получилось — попробуй ещё раз');

// Клиент API грузим отдельным чанком: в основном бандле (расписание) его код не нужен — первый запрос
// сессия делает, когда браузер освободится, а чат и профиль импортируют api.ts сами.
let apiP: Promise<typeof Api> | null = null;
type AuthHandler = (code: 'auth' | 'profile' | 'rules' | 'banned') => void;
let authHandler: AuthHandler | null = null;
function api(): Promise<typeof Api> {
  if (!apiP) {
    apiP = import('./api').then(
      (m) => { m.setAuthErrorHandler(authHandler); return m; },
      (e) => { apiP = null; throw e; },
    );
  }
  return apiP;
}
/** Код ошибки ApiError без импорта класса (модуль API может быть ещё не загружен). */
const codeOf = (e: unknown): string => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '');

/** eager: в адресе был '#auth=' — запрашиваем /api/auth/me сразу, а не когда браузер освободится. */
export function SessionProvider(p: { children: ReactNode; eager?: boolean }): JSX.Element {
  const online = useOnline();
  const [st, setSt] = useState<State>(() => {
    const cache = readMeCache();
    return {
      status: 'loading', me: cache ? meFromCache(cache) : null, mode: brand.social ?? 'on',
      google: null, dev: false, config: null, prompt: null,
    };
  });
  const stRef = useRef(st);
  const patch = useCallback((next: Partial<State>) => {
    stRef.current = { ...stRef.current, ...next };
    setSt(stRef.current);
  }, []);

  // ready: выполняется, когда первый me() закончился. Никогда не отклоняется.
  const readyRef = useRef<{ promise: Promise<void>; resolve: () => void; done: boolean } | null>(null);
  if (!readyRef.current) {
    let resolve = () => {};
    const promise = new Promise<void>((r) => { resolve = r; });
    readyRef.current = { promise, resolve, done: false };
  }
  const settleReady = useCallback(() => {
    const r = readyRef.current!;
    if (!r.done) { r.done = true; r.resolve(); }
  }, []);

  const inflight = useRef<Promise<void> | null>(null);
  const started = useRef(false);
  const lastFetch = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    started.current = true;
    const run = (async () => {
      try {
        const a: AuthState = await (await api()).socialApi.me();
        const me = a.user;
        writeMeCache(me);
        patch({
          status: me ? 'signed' : 'guest', me, mode: a.mode, google: a.google, dev: a.dev, config: a.config,
        });
      } catch (e) {
        if (codeOf(e) === 'not_found') {
          // Обсуждения выключены (маршрута нет) — как mode:'off' без аккаунта.
          patch({ status: 'guest', me: null, mode: 'off' });
        } else {
          // Сеть, 5xx, не JSON или не загрузился чанк: оставляем, что знали.
          const cur = stRef.current;
          patch({ google: null, status: cur.me ? 'signed' : 'guest' });
        }
      } finally {
        lastFetch.current = Date.now();
        inflight.current = null;
        settleReady();
      }
    })();
    inflight.current = run;
    return run;
  }, [patch, settleReady]);

  // Первый запрос: сразу (eager) или когда браузер освободится. До согласия — ничего.
  useEffect(() => {
    if (!store('agreed')) return;
    if (p.eager) { void refresh(); return; }
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const go = () => { if (!started.current) void refresh(); };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(go, { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(go, 300);
    return () => clearTimeout(t);
  }, []); // только при монтировании

  // Вернулись в приложение через 5+ минут или появилась сеть — обновляем (только после согласия).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && started.current && store('agreed')
        && Date.now() - lastFetch.current > REFETCH_MS) void refresh();
    };
    const onOnline = () => { if (started.current && store('agreed')) void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  // Заявки в друзья и решения по жалобам меняют счётчики — обновляем через секунду.
  const debounce = useRef(0);
  useSocialEvents((e) => {
    if (e.type !== 'relation' && e.type !== 'moderated') return;
    if (!started.current) return;
    clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => { void refresh(); }, 1000);
  });
  useEffect(() => () => clearTimeout(debounce.current), []);

  // ─── Окна входа (AuthHost рисует их по prompt) ───
  const promptWait = useRef<{ resolve: (ok: boolean) => void; promise: Promise<boolean> } | null>(null);

  const openPrompt = useCallback((pr: AuthPrompt): Promise<boolean> => {
    if (promptWait.current) return promptWait.current.promise.then(() => false);
    let resolve: (ok: boolean) => void = () => {};
    const promise = new Promise<boolean>((r) => { resolve = r; });
    promptWait.current = { resolve, promise };
    patch({ prompt: pr });
    return promise;
  }, [patch]);

  const resolvePrompt = useCallback((ok: boolean) => {
    const w = promptWait.current;
    promptWait.current = null;
    if (stRef.current.prompt) patch({ prompt: null });
    w?.resolve(ok);
  }, [patch]);

  const ensure = useCallback(async (reason: AuthReason, returnTo?: string): Promise<boolean> => {
    const back = returnTo ?? currentReturnTo();
    await readyRef.current!.promise;
    // Уже открыто окно — ждём его; закрыли без результата → false, иначе проверяем заново.
    while (promptWait.current) {
      const ok = await promptWait.current.promise;
      if (!ok) return false;
    }
    for (let step = 0; step < 4; step++) {
      const s = stRef.current;
      if (s.mode === 'off' && reason !== 'delete') { toast(OFF_TEXT); return false; }
      if (s.mode === 'readonly' && !READONLY_OK.has(reason)) { toast(READONLY_TEXT); return false; }
      const me = s.status === 'signed' ? s.me : null;
      if (!me) {
        const ok = await openPrompt({ kind: 'signin', reason, returnTo: back });
        // Вход уводит со страницы — тогда промис так и не выполнится.
        if (ok) return new Promise<boolean>(() => {});
        return false;
      }
      if (me.banned && WRITES.has(reason)) {
        void openPrompt({ kind: 'banned', ban: me.banned });
        return false;
      }
      if (me.needsProfile && WRITES.has(reason)) {
        if (s.mode === 'on' && !me.banned) {
          if (!(await openPrompt({ kind: 'setup' }))) return false;
          continue;
        }
        toast('Сначала заполни профиль');
        return false;
      }
      if (!me.rulesAccepted && WRITES.has(reason)) {
        if (!(await openPrompt({ kind: 'rules' }))) return false;
        continue;
      }
      return true;
    }
    return false;
  }, [openPrompt]);

  const requestSignIn = useCallback((reason: AuthReason, returnTo?: string) => {
    const back = returnTo ?? currentReturnTo();
    void (async () => {
      await readyRef.current!.promise;
      const s = stRef.current;
      if (s.status === 'signed' && s.me) return;
      if (s.mode === 'off' && reason !== 'delete') { toast(OFF_TEXT); return; }
      if (promptWait.current) return;
      void openPrompt({ kind: 'signin', reason, returnTo: back });
    })();
  }, [openPrompt]);

  const signIn = useCallback((o: { returnTo: string; intent: AuthIntent; age?: AgeGroup; accept: boolean }) => {
    flushDrafts();
    // Свои записи истории убираем, а replace заменяет запись страницы: в истории не остаётся «до входа».
    api().then(
      async (m) => {
        const url = m.socialApi.signInUrl(o);
        await leaveLayers();
        location.replace(url);
      },
      () => toast(chunkFailText(), { kind: 'error' }),
    );
  }, []);

  const devSignIn = useCallback(async (name: string, age?: AgeGroup, intent?: AuthIntent) => {
    const pr = stRef.current.prompt;
    const back = pr && pr.kind === 'signin' ? pr.returnTo : currentReturnTo();
    try {
      await (await api()).socialApi.devLogin(name, age, intent);
    } catch (e) {
      if (intent === 'delete' && codeOf(e) === 'not_found') { flushDrafts(); await goTo(back + '#auth=none'); return; }
      toast(errText(e), { kind: 'error' });
      return;
    }
    flushDrafts();
    await goTo(back + '#auth=ok');
  }, []);

  const clearLocal = useCallback(() => {
    clearSocialLocal();
    patch({ status: 'guest', me: null });
    emit({ type: 'me-changed', me: null });
  }, [patch]);

  const signOut = useCallback(async (all?: boolean) => {
    try {
      await (await api()).socialApi.logout(all);
    } catch (e) {
      if (codeOf(e) !== 'auth') {
        toast(errText(e), { kind: 'error' });
        return;
      }
    }
    clearLocal();
    toast('Выход выполнен');
  }, [clearLocal]);

  const setMe = useCallback((me: Me) => {
    writeMeCache(me);
    patch({ status: 'signed', me });
    emit({ type: 'me-changed', me });
  }, [patch]);

  const handleAuthOutcome = useCallback((o: AuthOutcome) => {
    // Тексты итогов входа (§B.5) живут в чанке API — он в этот момент всё равно грузится.
    if (o === 'consent') requestSignIn('account');
    else api().then((m) => {
      const text = m.AUTH_OUTCOME_TEXT[o];
      // Длинные объяснения («браузер не сохранил данные входа…») держим дольше, чтобы успели прочитать.
      if (text) toast(text, { kind: OUTCOME_OK.has(o) ? 'default' : 'error', ms: Math.max(2600, text.length * 55) });
    }, () => {});
    void (async () => {
      // Тот же запрос, что уже летит (или первый, которого ждёт ready), — второй не шлём.
      const r = readyRef.current!;
      if (inflight.current) await inflight.current;
      else if (!r.done) await r.promise;
      else await refresh();
      const s = stRef.current;
      if (o === 'ok' && s.status === 'signed' && s.me && s.me.needsProfile && s.mode === 'on' && !s.me.banned
        && !promptWait.current) {
        void openPrompt({ kind: 'setup' });
      }
    })();
  }, [refresh, requestSignIn, openPrompt]);

  // Ошибки входа из любого запроса (api.ts вызывает обработчик уже после отказа промиса).
  useEffect(() => {
    const handler: AuthHandler = (code) => {
      if (code === 'auth') {
        const wasSigned = stRef.current.status === 'signed' || !!stRef.current.me;
        clearLocal();
        toast(wasSigned ? 'Сессия истекла — войди снова' : 'Войди через Google, чтобы продолжить');
        return;
      }
      void refresh().then(() => {
        const s = stRef.current;
        if (!s.me || promptWait.current) return;
        if (code === 'profile') {
          if (s.mode === 'on' && !s.me.banned) void openPrompt({ kind: 'setup' });
          else toast('Сначала заполни профиль');
        } else if (code === 'rules') {
          void openPrompt({ kind: 'rules' });
        } else if (code === 'banned' && s.me.banned) {
          void openPrompt({ kind: 'banned', ban: s.me.banned });
        }
      });
    };
    // Регистрируем, как только модуль API загрузится (если сейчас нет сети — при следующей загрузке).
    authHandler = handler;
    api().then((m) => m.setAuthErrorHandler(authHandler), () => {});
    return () => {
      if (authHandler === handler) authHandler = null;
      if (apiP) apiP.then((m) => m.setAuthErrorHandler(authHandler), () => {});
    };
  }, [clearLocal, refresh, openPrompt]);

  const session = useMemo<Session>(() => ({
    status: st.status, me: st.me, mode: st.mode, google: st.google, dev: st.dev, config: st.config,
    online, prompt: st.prompt, ready: readyRef.current!.promise,
    ensure, requestSignIn, resolvePrompt, signIn, devSignIn, signOut, refresh, setMe, handleAuthOutcome,
  }), [st, online, ensure, requestSignIn, resolvePrompt, signIn, devSignIn, signOut, refresh, setMe, handleAuthOutcome]);

  // Для разработчика: localStorage.paraDebug = '1' → window.__paraDebug.
  useEffect(() => {
    if (ls('paraDebug') !== '1') return;
    let alive = true;
    void api().then((m) => {
      if (!alive) return;
      (window as Window & { __paraDebug?: unknown }).__paraDebug = {
        socialApi: m.socialApi,
        session,
        prepareImage: (...args: Parameters<typeof import('../lib/image').prepareImage>) =>
          import('../lib/image').then((i) => i.prepareImage(...args)),
      };
    }, () => {});
    return () => { alive = false; };
  }, [session]);

  return (
    <Ctx.Provider value={session}>
      {p.children}
      <ReportHost />
    </Ctx.Provider>
  );
}

export function useSession(): Session {
  return useContext(Ctx) ?? NOOP;
}

/** То же, что useSession().me: пока 'loading' — объект из me_cache (надёжны только id, имя, @имя, фото). */
export function useMe(): Me | null {
  return useContext(Ctx)?.me ?? null;
}
