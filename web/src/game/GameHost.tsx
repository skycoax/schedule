// Покер — оверлей поверх расписания (отдельный файл, его грузит AppShell). Тёмный, как экраны моментов: вырастает
// из часов героя и при закрытии уходит обратно в них (motion.ts). Один экран — стол (Table.tsx); листы «Как играть»
// и меню места — поверх. Данные: стол целиком приходит от сервера (GET /api/social/games и событие table в потоке),
// приложение только рисует и оживляет разницу. Гость смотрит, сесть может вошедший.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { brand } from '../brand';
import { store } from '../lib/store';
import { useHideTabBar } from '../ui/bar';
import { useLayer } from '../ui/layers';
import { chooseAction, confirmDialog } from '../ui/ActionSheet';
import { Icon } from '../ui/icons';
import { toast } from '../ui/Toast';
import { lockScroll, unlockScroll } from '../ui/Sheet';
import { isApiError } from '../social/api';
import { useSocialActions } from '../social/actions';
import { currentReturnTo, useSession } from '../social/session';
import { ixMotion, setIxOrigin } from '../social/instants/motion';
import type { GameReaction, PokerAction, PokerSeat, PokerView } from '../social/types';
import { gameClosing } from './entry';
import type { GameReq } from './entry';
import { gameApi, streamUrl } from './api';
import { useGameStream } from './stream';
import { Actions } from './Actions';
import { HowToSheet } from './HowToSheet';
import { ReactRow, Table } from './Table';
import type { Float } from './Table';
import { buzz } from './fx';
import '../social/instants/instants.css';
import './game.css';

export interface GameHostProps { req: GameReq | null; onClose: () => void }

const LEAVE_MS = 230;

export default function GameHost(p: GameHostProps): JSX.Element | null {
  if (!p.req) return null;
  return <GameRoot key={p.req.n} onClose={p.onClose} />;
}

/** Эти ошибки показывает сама сессия (вход, профиль, правила, ограничение). */
function handledBySession(e: unknown): boolean {
  return isApiError(e) && (e.code === 'auth' || e.code === 'profile' || e.code === 'rules' || e.code === 'banned');
}
const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Не получилось — попробуй ещё раз');

type Access = 'ok' | 'guest' | 'offline' | 'readonly' | 'banned' | 'off' | 'loading';

function GameRoot({ onClose }: { onClose: () => void }): JSX.Element {
  const s = useSession();
  const sRef = useRef(s);
  sRef.current = s;
  const actions = useSocialActions();

  // ─── Закрытие ───
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const closeAll = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIxOrigin(document.querySelector('.hero .clk') ?? document.querySelector('.hero'));
    setClosing(true);
    gameClosing();
    timers.current.push(window.setTimeout(onClose, LEAVE_MS));
  }, [onClose]);

  // ─── Доступ ───
  const [serverOff, setServerOff] = useState(false);
  const signedMe = s.status === 'signed' ? s.me : null;
  const off = s.mode === 'off' || serverOff || s.config?.game === 'off';
  const access: Access = off ? 'off'
    : !s.online ? 'offline'
      : s.status === 'loading' ? 'loading'
        : !signedMe ? 'guest'
          : signedMe.banned ? 'banned'
            : s.mode === 'readonly' ? 'readonly' : 'ok';
  useEffect(() => { if (store('game_found') !== '1') store('game_found', '1'); }, []);

  // ─── Стол ───
  const [view, setView] = useState<PokerView | null>(null);
  const viewRef = useRef<PokerView | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const apply = useCallback((v: PokerView) => {
    const cur = viewRef.current;
    if (cur && cur.seq > v.seq) return;
    viewRef.current = v;
    setView(v);
    setLoadErr('');
  }, []);
  const load = useCallback(async (quiet?: boolean): Promise<boolean> => {
    if (!sRef.current.online || off) return true;
    try {
      apply(await gameApi.table());
      return true;
    } catch (e) {
      if (isApiError(e, 'not_found')) { setServerOff(true); return true; }
      if (!quiet) setLoadErr(errText(e));
      return !isApiError(e, 'network') && !isApiError(e, 'server');
    }
  }, [apply, off]);
  useEffect(() => { void load(); }, [load]);

  // ─── Поток ───
  const [floats, setFloats] = useState<Record<number, Float>>({});
  const floatK = useRef(0);
  const streamOn = !off && s.online && !closing;
  const stream = useGameStream(streamUrl(brand.id), streamOn, {
    resync: () => { void load(true); },
    poll: () => load(true),
    table: apply,
    react: (seat, r) => setFloats((f) => ({ ...f, [seat]: { r, k: ++floatK.current } })),
    ended: () => { void sRef.current.refresh(); },
  });
  const streamRef = useRef(stream);
  streamRef.current = stream;
  useEffect(() => { if (view) streamRef.current.clock(view.now); }, [view]);
  const now = useCallback(() => Date.now() + streamRef.current.offset(), []);

  // Закрыли стол — обновляем сессию: «за столом играют» (точка на герое) могло измениться.
  useEffect(() => () => { if (sRef.current.status === 'signed') void sRef.current.refresh(); }, []);

  // ─── Мой ход: вибрация; выгнали — тост ───
  const me = view?.me || null;
  const myTurn = !!me && me.state === 'seated' && !!me.actions && !!view?.hand?.turn && view.hand.turn.seat === me.seat;
  const wasTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !wasTurn.current) buzz(18);
    wasTurn.current = myTurn;
  }, [myTurn]);
  const kickedShown = useRef(false);
  useEffect(() => {
    if (me?.kicked === 'idle' && !kickedShown.current) { kickedShown.current = true; toast('Тебя убрали из-за стола — не было ходов'); }
    if (me?.state === 'seated') kickedShown.current = false;
  }, [me?.kicked, me?.state]);

  // ─── Действия ───
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<PokerView>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      apply(await f());
      if (done) toast(done);
    } catch (e) {
      if (isApiError(e, 'conflict')) void load(true);      // стол уже изменился — берём свежий
      else if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const sit = async () => {
    if (access === 'guest') {
      if (!(await sRef.current.ensure('game', currentReturnTo({ game: 1 })))) return;
    } else if (access !== 'ok') return;
    await run(() => gameApi.sit());
  };
  const stand = async () => {
    const inHand = !!me && me.state === 'seated' && !!view?.hand && !view.hand.result && !!view.seats[me.seat ?? -1]?.inHand && !view.seats[me.seat ?? -1]?.folded;
    if (inHand) {
      const ok = await confirmDialog({ title: 'Встать из-за стола?', message: 'Раздача идёт — карты будут сброшены.', confirm: 'Встать', destructive: true });
      if (!ok) return;
    }
    await run(() => gameApi.stand());
  };
  const act = (action: PokerAction, amount?: number) => {
    if (!view?.hand) return;
    void run(() => gameApi.act(view.hand!.id, action, amount));
  };
  const [reactOpen, setReactOpen] = useState(false);
  const react = async (r: GameReaction) => {
    setReactOpen(false);
    // Свою реакцию сервер обратно не шлёт — показываем сразу у себя.
    const seat = viewRef.current?.me?.seat;
    if (seat !== null && seat !== undefined) setFloats((f) => ({ ...f, [seat]: { r, k: ++floatK.current } }));
    try { await gameApi.react(r); } catch (e) { if (!handledBySession(e)) toast(errText(e), { kind: 'error' }); }
  };

  const seatMenu = async (seat: PokerSeat) => {
    const u = seat.user;
    if (!u) return;
    const pick = await chooseAction({
      title: u.name + ' · @' + u.username,
      actions: [{ id: 'report', label: 'Пожаловаться' }, { id: 'block', label: 'Заблокировать @' + u.username, role: 'destructive' }],
    });
    if (pick === 'report') await actions.report({ type: 'user', id: u.id }, { username: u.username, kind: 'user' });
    else if (pick === 'block') { if (await actions.block(u)) void load(true); }
  };

  const [howOpen, setHowOpen] = useState(false);
  const menu = async () => {
    const seated = !!me && me.state !== 'none';
    const list = [{ id: 'how', label: 'Как играть' }];
    if (seated) list.push({ id: 'stand', label: me!.state === 'leaving' ? 'Уже встаёшь…' : 'Встать из-за стола', role: 'destructive' } as { id: string; label: string });
    const pick = await chooseAction({ actions: list });
    if (pick === 'how') setHowOpen(true);
    else if (pick === 'stand') void stand();
  };

  // ─── Низ: действия или статус ───
  const humans = view ? view.seats.filter((x) => x && !x.bot).length : 0;
  const full = !!view && view.seats.every((x) => !!x && !x.bot);
  const canSit = access === 'ok' || access === 'guest';
  let bottom: JSX.Element | null = null;
  if (view) {
    if (me && me.state === 'seated' && myTurn && me.actions && view.hand) {
      bottom = <Actions a={me.actions} hand={view.hand} seats={view.seats} big={view.blinds.big} busy={busy} onAct={act} />;
    } else if (me && me.state !== 'none') {
      const turnSeat = view.hand?.turn ? view.seats[view.hand.turn.seat] : null;
      const who = turnSeat ? (turnSeat.bot ? 'Бот Para' : turnSeat.masked || !turnSeat.user ? 'Игрок' : turnSeat.user.name) : '';
      const botSeated = view.seats.some((x) => x && x.bot);
      const text = me.state === 'reserved' ? 'Ты сядешь со следующей раздачи'
        : me.state === 'leaving' ? 'Встанешь после раздачи'
          : view.hand ? (!view.hand.result && who ? 'Ход: ' + who : '')
            : view.countdown ? '' : humans < 2 && !botSeated ? 'Сейчас сядет бот' : humans >= 2 ? 'Ждём игроков…' : '';
      bottom = (
        <div className="pk-status">
          {reactOpen && <ReactRow onPick={(r) => void react(r)} />}
          {text && <span>{text}</span>}
        </div>
      );
    } else {
      const note = access === 'offline' ? 'Без интернета можно только смотреть'
        : access === 'readonly' ? 'Сейчас можно только смотреть'
          : access === 'banned' ? 'Пока действует ограничение, можно только смотреть'
            : full ? 'Все места заняты — подожди, кто-нибудь встанет'
              : view.hand && !view.hand.result ? 'Идёт раздача — сядешь со следующей' : '';
      bottom = (
        <div className="pk-status">
          {note && <span>{note}</span>}
          {canSit && !full && (
            <button type="button" className="pk-btn pk-btn--main pk-btn--sit" disabled={busy} onClick={() => void sit()}>
              {access === 'guest' ? 'Войти, чтобы сесть' : 'Сесть за стол'}
            </button>
          )}
        </div>
      );
    }
  }

  const sub = view ? (humans ? humans + ' за столом' + (view.watchers > humans ? ' · смотрят ' + (view.watchers - humans) : '') : 'Стол свободен') : '';
  const motion = ixMotion('zoom', closing);
  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => { if (ev.key === 'Escape') { ev.stopPropagation(); closeAll(); } };

  return (
    <>
      {createPortal(
        <>
          <Root closing={closing} onClose={closeAll} />
          <div className={'ix gx pk-root ' + motion} role="dialog" aria-modal="true" aria-label="Покер" tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="ix__bar pk-bar">
              <button type="button" className="ix__icon" aria-label="Закрыть" onClick={closeAll}><Icon name="close" size={24} /></button>
              <div className="pk-bar__mid"><h2 className="pk-bar__t">Покер</h2>{sub && <span className="pk-bar__s">{sub}</span>}</div>
              <button type="button" className="ix__icon" aria-label="Меню" aria-haspopup="menu" onClick={() => void menu()}><Icon name="ellipsis" size={24} /></button>
            </div>
            {view ? (
              <Table view={view} now={now} floats={floats} canSit={canSit && !full} sitLabel="Сесть" onSit={() => void sit()}
                onSeatMenu={(x) => void seatMenu(x)} onMyAvatar={() => setReactOpen((o) => !o)}>
                {bottom}
              </Table>
            ) : (
              <div className="pk-load">
                {access === 'off' ? <p>Игра сейчас недоступна</p>
                  : loadErr ? <><p>{loadErr}</p><button type="button" className="pk-btn pk-btn--main" onClick={() => void load()}>Повторить</button></>
                    : <p className="pk-load__dots"><i /><i /><i /></p>}
              </div>
            )}
            {stream.status === 'reconnecting' && !closing && <div className="gx-status" role="status">Переподключаемся…</div>}
            {stream.status === 'replaced' && !closing && (
              <div className="gx-banner" role="status">
                <span>Стол открыт в другом окне</span>
                <button type="button" onClick={stream.resume}>Играть здесь</button>
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
      <HowToSheet open={howOpen} onClose={() => setHowOpen(false)} />
    </>
  );
}

let gameRoots = 0;

/**
 * Подложка и слой всего оверлея. Пока стол открыт: страница под ним не прокручивается (иначе при закрытии оверлей
 * сжимался бы в пустое место, а не в часы), html.has-game поднимает тосты наверх и прячет плашку отзыва.
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
