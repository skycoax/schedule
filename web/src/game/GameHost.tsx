// Игра «Код» — оверлей поверх расписания (отдельный файл, его грузит AppShell). Тёмный, как экраны моментов:
// первый экран «вырастает» из часов героя и при закрытии уходит обратно в них (motion.ts), вложенные въезжают
// справа, «Твой код» и «Код дня» — снизу. Экраны лежат стеком: нижние остаются смонтированными (данные и прокрутка
// не теряются), видны только верхний и — пока тот въезжает или уезжает — следующий под ним.
// Слои истории: весь оверлей — 'game' (первым, до экранов), каждый вложенный экран — 'game-screen'; ✕ закрывает всё.
// Здесь же данные (лобби, игры, код дня) и поток событий (stream.ts): всё решает сервер, поток только подсказывает.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { brand } from '../brand';
import { store } from '../lib/store';
import { useHideTabBar } from '../ui/bar';
import { useLayer } from '../ui/layers';
import { toast } from '../ui/Toast';
import { isApiError } from '../social/api';
import { currentReturnTo, useSession } from '../social/session';
import { ixMotion, reducedMotion, setIxOrigin } from '../social/instants/motion';
import { lockScroll, unlockScroll } from '../ui/Sheet';
import type { DailyView, DuelView, GameLobby, GameReaction } from '../social/types';
import { gameClosing } from './entry';
import type { GameReq } from './entry';
import { gameApi, streamUrl } from './api';
import { useGameStream } from './stream';
import { GxCtx } from './ctx';
import type { Access, Gx, GxAnim, LoadState, Screen } from './ctx';
import { ScreenCtx, errText, handledBySession } from './parts';
import { Lobby } from './Lobby';
import { CodePad } from './CodePad';
import { InviteScreen } from './InviteScreen';
import { JoinScreen } from './JoinScreen';
import { SearchScreen } from './SearchScreen';
import { DuelScreen } from './DuelScreen';
import { BoardScreen, DailyScreen } from './DailyScreen';
import { Practice } from './Practice';
import { HowToSheet } from './HowToSheet';
import { FriendPickSheet } from './FriendPickSheet';
import '../social/instants/instants.css';
import './game.css';

export interface GameHostProps { req: GameReq | null; onClose: () => void }

const LEAVE_MS = 230;
const ENTER_MS = 380;

interface Entry { key: number; s: Screen; enter: GxAnim; anim: GxAnim }

export default function GameHost(p: GameHostProps): JSX.Element | null {
  if (!p.req) return null;
  return <GameRoot key={p.req.n} req={p.req} onClose={p.onClose} />;
}

function firstStack(req: GameReq): Entry[] {
  const st: Entry[] = [{ key: 1, s: { t: 'lobby' }, enter: 'zoom', anim: 'zoom' }];
  const top = (s: Screen): Entry => ({ key: 2, s, enter: 'zoom', anim: 'zoom' });
  if (req.duel) st.push(top({ t: 'join', token: req.duel }));
  else if (req.screen === 'join') st.push(top({ t: 'join' }));
  else if (req.screen === 'daily') st.push(top({ t: 'daily' }));
  else if (req.screen === 'practice') st.push(top({ t: 'pad', purpose: { kind: 'practice' } }));
  return st;
}

const LABEL: Record<Screen['t'], string> = {
  lobby: 'Игра «Код»', pad: 'Твой код', invite: 'Вызов готов', join: 'Код вызова', search: 'Поиск соперника',
  duel: 'Игра', daily: 'Код дня', board: 'Таблица кода дня', practice: 'Тренировка с ботом',
};

function GameRoot({ req, onClose }: { req: GameReq; onClose: () => void }): JSX.Element {
  const s = useSession();
  const sRef = useRef(s);
  sRef.current = s;

  // ─── Стек экранов ───
  const [stack, setStack] = useState<Entry[]>(() => firstStack(req));
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const [leaving, setLeaving] = useState<number | null>(null);
  const leavingRef = useRef<number | null>(null);
  leavingRef.current = leaving;
  const [entering, setEntering] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const seq = useRef(10);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, reducedMotion() ? 0 : ms)); };

  const enterNow = (key: number) => {
    setEntering(key);
    later(() => setEntering((k) => (k === key ? null : k)), ENTER_MS);
  };

  const push = useCallback((scr: Screen, anim: GxAnim = 'push') => {
    if (closingRef.current) return;
    const key = ++seq.current;
    setStack((st) => [...st, { key, s: scr, enter: anim, anim }]);
    enterNow(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replace = useCallback((scr: Screen, anim: GxAnim = 'push', drop = 1) => {
    if (closingRef.current) return;
    const key = ++seq.current;
    setStack((st) => {
      const keep = st.slice(0, Math.max(1, st.length - drop));
      // Экран под новым был скрыт — показываем его без анимации, пока новый въезжает.
      keep[keep.length - 1] = { ...keep[keep.length - 1], anim: 'still' };
      return [...keep, { key, s: scr, enter: anim, anim }];
    });
    setLeaving(null);
    enterNow(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeAll = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Сжиматься — в часы там, где они сейчас (страница под игрой не прокручивается, но экран мог повернуться).
    setIxOrigin(document.querySelector('.hero .clk') ?? document.querySelector('.hero'));
    setClosing(true);
    gameClosing();
    later(onClose, LEAVE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const back = useCallback(() => {
    if (closingRef.current) return;
    const st = stackRef.current;
    if (st.length <= 1) { closeAll(); return; }
    const top = st[st.length - 1];
    if (leavingRef.current === top.key) return;   // уже уезжает
    leavingRef.current = top.key;
    setStack((cur) => cur.map((e, i) => (i === cur.length - 2 && cur[cur.length - 1].key === top.key
      ? { ...e, anim: top.enter === 'up' ? 'still' : 'back' } : e)));
    setLeaving(top.key);
    setEntering(null);
    later(() => {
      setStack((cur) => (cur.length > 1 ? cur.filter((e) => e.key !== top.key) : cur));
      setLeaving((k) => (k === top.key ? null : k));
    }, LEAVE_MS);
  }, [closeAll]);

  /** «Назад» системы снял слой экрана key: если он сверху — уходим с анимацией, иначе убираем сразу. */
  const popKey = useCallback((key: number) => {
    const st = stackRef.current;
    if (!st.length || st[st.length - 1].key === key) { back(); return; }
    setStack((cur) => cur.filter((e) => e.key !== key));
  }, [back]);

  const home = useCallback(() => {
    const st = stackRef.current;
    if (st.length <= 1) return;
    if (st.length === 2) { back(); return; }
    // Снимаем всё над лобби: верхний уезжает, остальные — сразу.
    const top = st[st.length - 1];
    setStack((cur) => [{ ...cur[0], anim: 'back' }, top]);
    setLeaving(top.key);
    later(() => {
      setStack((cur) => cur.filter((e) => e.key !== top.key));
      setLeaving((k) => (k === top.key ? null : k));
    }, LEAVE_MS);
  }, [back]);

  // ─── Доступ ───
  const [serverOff, setServerOff] = useState(false);
  const [lobby, setLobby] = useState<GameLobby | null>(null);
  const signedMe = s.status === 'signed' ? s.me : null;
  const cfgGame = s.config?.game;
  const mode: Gx['mode'] = s.mode === 'off' || serverOff || cfgGame === 'off' ? 'off' : (lobby?.cfg.game ?? cfgGame ?? 'on');
  const access: Access = mode === 'off' ? 'off'
    : !s.online ? 'offline'
      : s.status === 'loading' ? 'loading'
        : !signedMe ? 'guest'
          : signedMe.banned ? 'banned'
            : s.mode === 'readonly' ? 'readonly' : 'ok';
  const canRead = !!signedMe && mode !== 'off' && s.online;
  const canReadRef = useRef(canRead);
  canReadRef.current = canRead;

  // Нашёл игру — точка на герое теперь может появляться.
  useEffect(() => { if (store('game_found') !== '1') store('game_found', '1'); }, []);

  // ─── Данные ───
  const [lobbyState, setLobbyState] = useState<LoadState>('idle');
  const lobbySeq = useRef(0);
  const loadLobby = useCallback(async (quiet?: boolean): Promise<boolean> => {
    if (!canReadRef.current) return true;
    const n = ++lobbySeq.current;
    setLobbyState((st) => (st === 'ready' ? st : 'loading'));
    try {
      const l = await gameApi.lobby();
      if (n === lobbySeq.current) {
        setLobby(l);
        setLobbyState('ready');
      }
      return true;
    } catch (e) {
      if (n === lobbySeq.current) {
        if (isApiError(e, 'not_found')) setServerOff(true);
        else if (!quiet && !handledBySession(e)) toast(errText(e), { kind: 'error' });
        setLobbyState((st) => (st === 'ready' ? st : 'error'));
      }
      return !isApiError(e, 'network') && !isApiError(e, 'server');
    }
  }, []);

  const [duels, setDuels] = useState<Record<number, DuelView>>({});
  const duelsRef = useRef(duels);
  duelsRef.current = duels;
  // Игру применяем, только если она не старее нашей (v); при равном v могли измениться реванш и «в игре».
  const applyDuel = useCallback((d: DuelView) => {
    setDuels((m) => {
      const cur = m[d.id];
      if (cur && cur.v > d.v) return m;
      return { ...m, [d.id]: d };
    });
  }, []);
  const loadDuel = useCallback(async (id: number, quiet?: boolean): Promise<DuelView | null | undefined> => {
    try {
      const d = await gameApi.duel(id);
      applyDuel(d);
      return d;
    } catch (e) {
      if (isApiError(e, 'not_found')) return null;
      if (!quiet && !handledBySession(e)) toast(errText(e), { kind: 'error' });
      return undefined;
    }
  }, [applyDuel]);

  const seen = useRef(new Set<number>());
  const markSeen = useCallback((id: number) => {
    if (seen.current.has(id) || !canReadRef.current) return;
    seen.current.add(id);
    gameApi.seen([id]).then(() => {
      setLobby((l) => l && { ...l, duels: l.duels.map((r) => (r.id === id ? { ...r, unseen: false } : r)) });
    }, () => { seen.current.delete(id); });
  }, []);

  const [daily, setDaily] = useState<DailyView | null>(null);
  const loadDaily = useCallback(async (quiet?: boolean): Promise<boolean> => {
    if (!canReadRef.current) return true;
    try {
      setDaily(await gameApi.daily());
      return true;
    } catch (e) {
      if (!quiet && !handledBySession(e)) toast(errText(e), { kind: 'error' });
      return !isApiError(e, 'network') && !isApiError(e, 'server');
    }
  }, []);

  // ─── Поток событий ───
  const reactSubs = useRef(new Set<(duel: number, r: GameReaction) => void>());
  const lobbyTimer = useRef(0);
  useEffect(() => () => clearTimeout(lobbyTimer.current), []);
  const topScreen = () => { const st = stackRef.current; return st[st.length - 1].s; };
  const lobbySoon = () => {
    clearTimeout(lobbyTimer.current);
    lobbyTimer.current = window.setTimeout(() => { if (topScreen().t === 'lobby') void loadLobby(true); }, 300);
  };
  /** Запросить текущий экран заново (hello, возвращение на страницу, опрос). false — сервер не ответил. */
  const refreshTop = async (): Promise<boolean> => {
    const top = topScreen();
    if (top.t === 'lobby') return loadLobby(true);
    if (top.t === 'duel' || top.t === 'search' || top.t === 'invite') {
      const id = top.id;
      const d = await loadDuel(id, true);
      const now = topScreen();
      if (d === null && now.t === top.t && 'id' in now && now.id === id) { toast('Игра не найдена'); home(); }
      return d !== undefined;
    }
    if (top.t === 'daily') return loadDaily(true);
    return true;
  };
  // Без сети поток не открываем: тренировка с ботом без «Переподключаемся…»; сеть вернулась — поток и hello.
  const streamOn = !!signedMe && !signedMe.banned && mode !== 'off' && s.online && !closing;
  const stream = useGameStream(streamUrl(brand.id), streamOn, {
    resync: () => { void refreshTop(); },
    poll: refreshTop,
    duel: (d) => { applyDuel(d); lobbySoon(); },
    lobby: (waiting) => {
      const me = sRef.current.me;
      if (sRef.current.status === 'signed' && me && me.game?.waiting !== waiting) sRef.current.setMe({ ...me, game: { waiting } });
      lobbySoon();
      // Открыт чужой вызов (или свой непринятый): его могли отменить или он истёк — адресат узнаёт об этом
      // только по lobby. Перечитываем: 404 → «Игра не найдена» и в лобби.
      const top = topScreen();
      if (top.t === 'duel' && duelsRef.current[top.id]?.status === 'open') void refreshTop();
    },
    react: (duel, r) => reactSubs.current.forEach((f) => f(duel, r)),
    presence: (duel, live) => setDuels((m) => (m[duel] ? { ...m, [duel]: { ...m[duel], opp: { ...m[duel].opp, live } } } : m)),
    ended: () => { void sRef.current.refresh(); },
  });

  // Закрыли игру — обновляем сессию: счётчик «ждёт» (точка на герое) мог измениться.
  useEffect(() => () => { if (sRef.current.status === 'signed') void sRef.current.refresh(); }, []);

  // ─── Листы ───
  const [howOpen, setHowOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [noReact, setNoReactState] = useState(() => store('game_noreact') === '1');

  const gx = useMemo<Gx>(() => ({
    push, replace, back, closeAll, home,
    access, mode, signed: !!signedMe,
    ensure: (returnTo?: string) => sRef.current.ensure('game',
      returnTo ?? (sRef.current.status === 'signed' ? undefined : currentReturnTo({ game: 1 }))),
    lobby, lobbyState, loadLobby,
    duels, applyDuel, loadDuel, markSeen,
    daily, setDaily, loadDaily,
    now: () => Date.now() + stream.offset(),
    stream: stream.status,
    onReact: (fn) => { reactSubs.current.add(fn); return () => { reactSubs.current.delete(fn); }; },
    noReact,
    setNoReact: (v: boolean) => { setNoReactState(v); store('game_noreact', v ? '1' : ''); },
    howTo: () => setHowOpen(true),
    pickFriend: () => setFriendsOpen(true),
    // stream — объект с функциями; меняется только status
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [push, replace, back, closeAll, home, access, mode, signedMe, lobby, lobbyState, loadLobby, duels, applyDuel, loadDuel,
    markSeen, daily, loadDaily, stream.status, noReact]);

  const topKey = stack[stack.length - 1].key;
  const topEntry = stack[stack.length - 1];
  const showUnder = leaving === topKey || (entering === topKey && topEntry.enter !== 'zoom');

  return (
    <GxCtx.Provider value={gx}>
      {createPortal(
        <>
          <Root closing={closing} onClose={closeAll} />
          {stack.map((e, i) => {
            const top = i === stack.length - 1;
            const visible = top || (!closing && i === stack.length - 2 && showUnder);
            return (
              <Frame key={e.key} e={e} index={i} top={top} visible={visible}
                leaving={closing ? top : leaving === e.key} closing={closing && top}
                onPop={() => popKey(e.key)} onEsc={i === 0 ? closeAll : back}>
                {renderScreen(e.s)}
              </Frame>
            );
          })}
          {stream.status === 'reconnecting' && !closing && (
            <div className="gx-status" role="status">Переподключаемся…</div>
          )}
          {stream.status === 'replaced' && !closing && (
            <div className="gx-banner" role="status">
              <span>Игра открыта в другом окне</span>
              <button type="button" onClick={stream.resume}>Играть здесь</button>
            </div>
          )}
        </>,
        document.body,
      )}
      <HowToSheet open={howOpen} onClose={() => setHowOpen(false)} />
      <FriendPickSheet open={friendsOpen} onClose={() => setFriendsOpen(false)} />
    </GxCtx.Provider>
  );
}

function renderScreen(s: Screen): ReactNode {
  switch (s.t) {
    case 'lobby': return <Lobby />;
    case 'pad': return <CodePad purpose={s.purpose} />;
    case 'invite': return <InviteScreen id={s.id} />;
    case 'join': return <JoinScreen token={s.token} />;
    case 'search': return <SearchScreen id={s.id} />;
    case 'duel': return <DuelScreen id={s.id} />;
    case 'daily': return <DailyScreen />;
    case 'board': return <BoardScreen />;
    case 'practice': return <Practice code={s.code} />;
  }
}

let gameRoots = 0;

/**
 * Подложка и слой всего оверлея. Рисуется первым: её слой истории должен лечь раньше слоёв экранов.
 * Пока игра открыта: страница под ней не прокручивается (иначе при закрытии оверлей сжимался бы в пустое место,
 * а не в часы), а html.has-game поднимает тосты наверх (внизу — клавиатура игры) и прячет плашку отзыва.
 */
function Root({ closing, onClose }: { closing: boolean; onClose: () => void }): JSX.Element {
  useLayer(true, onClose, 'game');
  useHideTabBar(true, 'game');
  useEffect(() => {
    lockScroll();
    if (gameRoots++ === 0) document.documentElement.classList.add('has-game');
    return () => {
      unlockScroll();
      if (--gameRoots === 0) document.documentElement.classList.remove('has-game');
    };
  }, []);
  return <div className={'ix-shade' + (closing ? ' is-leaving' : '')} aria-hidden="true" />;
}

/** Экран в стеке: свой слой истории (кроме лобби), анимация появления и ухода, фокус, Esc. */
function Frame(p: {
  e: Entry; index: number; top: boolean; visible: boolean; leaving: boolean; closing: boolean;
  onPop: () => void; onEsc: () => void; children: ReactNode;
}): JSX.Element {
  useLayer(p.index > 0, p.onPop, 'game-screen');
  const ref = useRef<HTMLDivElement>(null);
  const live = p.top && !p.leaving;
  useEffect(() => {
    const el = ref.current;
    if (live && el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [live]);
  const motion = p.closing ? ixMotion('zoom', true)
    : p.leaving ? ixMotion(p.e.enter === 'still' ? 'push' : p.e.enter, true)
      : 'ix--' + p.e.anim;
  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== 'Escape' || !live) return;
    ev.stopPropagation();
    p.onEsc();
  };
  const info = useMemo(() => ({ top: live, index: p.index }), [live, p.index]);
  return (
    <div ref={ref} className={'ix gx ' + motion + (p.visible ? '' : ' is-under')} role="dialog" aria-modal="true"
      aria-label={LABEL[p.e.s.t]} tabIndex={-1} data-no-ptr="" inert={!live || undefined} onKeyDown={onKeyDown}>
      <ScreenCtx.Provider value={info}>{p.children}</ScreenCtx.Provider>
    </div>
  );
}
