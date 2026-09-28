// Покер — оверлей поверх расписания (отдельный файл, его грузит AppShell). Тёмный, как экраны моментов: вырастает
// из часов героя и при закрытии уходит обратно в них (motion.ts). Один экран — стол (Table.tsx); листы «Как играть»
// и меню места — поверх. Данные: стол целиком приходит от сервера (GET /api/social/games и событие table в потоке),
// приложение только рисует и оживляет разницу. Гость смотрит, сесть может вошедший.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { brand } from '../brand';
import { ls, store } from '../lib/store';
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
import type { PokerAction, PokerChatItem, PokerSeat, PokerSticker, PokerView } from '../social/types';
import { gameClosing } from './entry';
import type { GameReq } from './entry';
import { gameApi, streamUrl } from './api';
import { useGameStream } from './stream';
import { Actions } from './Actions';
import { BOT_NAME } from './BotOrb';
import { HowToSheet } from './HowToSheet';
import { InviteSheet } from './InviteSheet';
import { BonusCard, untilReset } from './BonusCard';
import { TopSheet } from './TopSheet';
import { chips as fmtChips } from './logic';
import { Table } from './Table';
import { BURST_MS, ChatButtons, ChatLayer, ChatPanel } from './Chat';
import type { Burst } from './Chat';
import type { Float } from './Table';
import { buzz } from './fx';
import '../social/instants/instants.css';
import './game.css';

export interface GameHostProps { req: GameReq | null; onClose: () => void }

const LEAVE_MS = 230;

export default function GameHost(p: GameHostProps): JSX.Element | null {
  if (!p.req) return null;
  return <GameRoot key={p.req.n} onClose={p.onClose} sit={!!p.req.sit} />;
}

/** Эти ошибки показывает сама сессия (вход, профиль, правила, ограничение). */
function handledBySession(e: unknown): boolean {
  return isApiError(e) && (e.code === 'auth' || e.code === 'profile' || e.code === 'rules' || e.code === 'banned');
}
const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Не получилось — попробуй ещё раз');

type Access = 'ok' | 'guest' | 'offline' | 'readonly' | 'banned' | 'off' | 'loading';

function GameRoot({ onClose, sit: sitOnOpen }: { onClose: () => void; sit: boolean }): JSX.Element {
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

  // ─── Чат стола и стикеры (Chat.tsx) ───
  const [chat, setChat] = useState<PokerChatItem[]>([]);
  const known = useRef(new Set<number>());
  const [chatOpen, setChatOpen] = useState(false);
  const chatOpenRef = useRef(false);
  chatOpenRef.current = chatOpen;
  const [tray, setTray] = useState(false);
  const [unread, setUnread] = useState(0);
  const [chatOff, setChatOff] = useState(() => ls('pk_chat') === 'off');
  const chatOffRef = useRef(chatOff);
  chatOffRef.current = chatOff;
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstK = useRef(0);
  const addBurst = useCallback((item: PokerChatItem) => {
    const k = ++burstK.current;
    setBursts((b) => [...b.slice(-5), { k, item }]);
    timers.current.push(window.setTimeout(() => setBursts((b) => b.filter((x) => x.k !== k)), item.sticker ? BURST_MS.sticker : BURST_MS.text));
  }, []);
  const addItems = useCallback((items: PokerChatItem[], replace: boolean) => {
    if (replace) known.current = new Set(items.map((x) => x.id));
    else for (const x of items) known.current.add(x.id);
    setChat((cur) => {
      const byId = new Map((replace ? [] : cur).map((x) => [x.id, x]));
      for (const x of items) byId.set(x.id, x);
      return [...byId.values()].sort((a, b) => a.id - b.id).slice(-60);
    });
  }, []);
  const loadChat = useCallback(async () => {
    if (!sRef.current.online) return;
    try { addItems(await gameApi.chat(), true); } catch { /* чат подождёт следующего раза */ }
  }, [addItems]);
  useEffect(() => { if (!off) void loadChat(); }, [loadChat, off]);
  const myIdRef = useRef<number | null>(null);
  myIdRef.current = signedMe ? signedMe.id : null;
  /** Строка из потока: новая — в список; чужая — пузырь или стикер у места и «непрочитано», если чат закрыт. */
  const onChatItem = (item: PokerChatItem) => {
    if (known.current.has(item.id)) return;
    addItems([item], false);
    const mine = !!item.user && item.user.id === myIdRef.current;
    if (mine || chatOffRef.current) return;       // свой стикер уже показан при отправке
    addBurst(item);
    if (!chatOpenRef.current) setUnread((n) => Math.min(99, n + 1));
  };

  // ─── Поток ───
  const [floats, setFloats] = useState<Record<number, Float>>({});
  const floatK = useRef(0);
  const streamOn = !off && s.online && !closing;
  const stream = useGameStream(streamUrl(brand.id), streamOn, {
    resync: () => { void load(true); void loadChat(); },
    poll: () => load(true),
    table: apply,
    react: (seat, r) => setFloats((f) => ({ ...f, [seat]: { r, k: ++floatK.current } })),
    chat: (item) => onChatItem(item),
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
    if (me?.kicked === 'idle' && !kickedShown.current) { kickedShown.current = true; toast('Тебя вывели из игры — не было ходов'); }
    if (me?.kicked === 'broke' && !kickedShown.current) { kickedShown.current = true; toast('Фишки кончились — завтра будет бонус'); }
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
      const ok = await confirmDialog({ title: 'Выйти из игры?', message: 'Раздача идёт — карты будут сброшены.', confirm: 'Выйти', destructive: true });
      if (!ok) return;
    }
    await run(() => gameApi.stand());
  };
  const act = (action: PokerAction, amount?: number) => {
    if (!view?.hand) return;
    void run(() => gameApi.act(view.hand!.id, action, amount));
  };
  // Писать в чат могут сидящие (и ждущие раздачи); остальным — почему нельзя.
  const canWrite = access === 'ok' && !!me && me.state !== 'none';
  const chatNote = access === 'guest' ? 'Войди и присоединись к игре, чтобы писать'
    : access === 'banned' ? 'Пока действует ограничение, писать нельзя'
      : access === 'readonly' ? 'Сейчас писать нельзя'
        : access === 'offline' ? 'Нет интернета' : 'Присоединись к игре, чтобы писать';
  const openChat = (withTray: boolean) => {
    setTray(withTray && canWrite);
    setChatOpen(true);
    setUnread(0);
  };
  const closeChat = () => { setChatOpen(false); setTray(false); };
  const [chatBusy, setChatBusy] = useState(false);
  const sendText = async (text: string): Promise<boolean> => {
    if (chatBusy) return false;
    setChatBusy(true);
    try {
      addItems([await gameApi.say({ text })], false);
      return true;
    } catch (e) {
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
      return false;
    } finally {
      setChatBusy(false);
    }
  };
  const sendSticker = async (id: PokerSticker) => {
    // Стикер — сразу на столе (панель уходит, чтобы его было видно), не дожидаясь ответа сервера.
    closeChat();
    const seat = viewRef.current?.me?.seat;
    if (seat !== null && seat !== undefined) addBurst({ id: 0, at: Date.now(), seat, bot: false, user: null, text: null, sticker: id });
    try {
      addItems([await gameApi.say({ sticker: id })], false);
    } catch (e) {
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    }
  };
  // Твой ход — чат уступает место кнопкам хода; открыл его во время хода — сам закроется за 5 с до конца.
  const turnDeadline = myTurn && view?.hand?.turn ? view.hand.turn.deadline : 0;
  const closeForTurn = useCallback(() => {
    setChatOpen(false);
    setTray(false);
    const el = document.activeElement as HTMLElement | null;
    if (el && el.closest('.pk-chat')) el.blur();
  }, []);
  useEffect(() => { if (myTurn) closeForTurn(); }, [myTurn, closeForTurn]);
  useEffect(() => {
    if (!chatOpen || !turnDeadline) return;
    const t = window.setTimeout(closeForTurn, Math.max(0, turnDeadline - now() - 5000));
    return () => clearTimeout(t);
  }, [chatOpen, turnDeadline, now, closeForTurn]);
  const toggleChatOff = () => {
    const next = !chatOff;
    ls('pk_chat', next ? 'off' : 'on');
    setChatOff(next);
    if (next) { closeChat(); setBursts([]); setUnread(0); }
  };

  const seatMenu = async (seat: PokerSeat) => {
    const u = seat.user;
    if (!u) return;
    const list: { id: string; label: string; role?: 'destructive' }[] = [
      { id: 'report', label: 'Пожаловаться' }, { id: 'block', label: 'Заблокировать @' + u.username, role: 'destructive' },
    ];
    if (signedMe?.isAdmin) list.push({ id: 'chips', label: 'Фишки…' });
    const pick = await chooseAction({ title: u.name + ' · @' + u.username, actions: list });
    if (pick === 'report') await actions.report({ type: 'user', id: u.id }, { username: u.username, kind: 'user' });
    else if (pick === 'block') { if (await actions.block(u)) { void load(true); void loadChat(); } }
    else if (pick === 'chips') await actions.chips(u);
  };

  // Приняли приглашение друга («Играть» на плашке) — садимся, как только стол загрузился.
  const autoSat = useRef(false);
  useEffect(() => {
    if (!sitOnOpen || autoSat.current || !view || access !== 'ok') return;
    autoSat.current = true;
    if (!me || me.state === 'none') void sit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitOnOpen, view, access]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const canInvite = access === 'ok';
  const invite = () => { if (canInvite) setInviteOpen(true); };

  // ─── Ежедневный бонус и рейтинг ───
  const bonus = me?.bonus || null;
  const [bonusOpen, setBonusOpen] = useState(false);
  const bonusShown = useRef(false);
  // Бонус ждёт — показываем «момент награды», как только стол загрузился (один раз за открытие).
  useEffect(() => {
    if (bonusShown.current || !bonus?.available || access !== 'ok') return;
    bonusShown.current = true;
    const t = window.setTimeout(() => setBonusOpen(true), 650);
    return () => clearTimeout(t);
  }, [bonus?.available, access]);
  const [bonusBusy, setBonusBusy] = useState(false);
  const claimBonus = async (): Promise<number | null> => {
    if (bonusBusy) return null;
    setBonusBusy(true);
    try {
      const r = await gameApi.bonus();
      apply(r.table);
      void sRef.current.refresh();
      return r.got;
    } catch (e) {
      if (isApiError(e, 'conflict')) void load(true);
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
      return null;
    } finally {
      setBonusBusy(false);
    }
  };
  const [topOpen, setTopOpen] = useState(false);
  // Счёт на экране: крутится вместе со временем (обратный отсчёт до бонуса).
  const [, setTick] = useState(0);
  const broke = !!me && me.state === 'none' && !!me.broke;
  useEffect(() => {
    if (!broke) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [broke]);

  const [howOpen, setHowOpen] = useState(false);
  const menu = async () => {
    const seated = !!me && me.state !== 'none';
    const list: { id: string; label: string; role?: 'destructive' }[] = [];
    if (bonus?.available && access === 'ok') list.push({ id: 'bonus', label: 'Ежедневный бонус +' + fmtChips(bonus.amount) });
    if (canInvite) list.push({ id: 'invite', label: 'Позвать друзей' });
    // Рейтинг — только когда сервер уже знает про экономику фишек (в me есть bonus).
    if (me?.bonus && (access === 'ok' || access === 'banned' || access === 'readonly')) list.push({ id: 'top', label: 'Рейтинг' });
    list.push({ id: 'how', label: 'Как играть' });
    list.push({ id: 'chat', label: chatOff ? 'Показать чат' : 'Скрыть чат' });
    if (seated) list.push({ id: 'stand', label: me!.state === 'leaving' ? 'Выйдешь после раздачи' : 'Выйти из игры', role: 'destructive' });
    const pick = await chooseAction({ actions: list });
    if (pick === 'invite') invite();
    else if (pick === 'bonus') setBonusOpen(true);
    else if (pick === 'top') setTopOpen(true);
    else if (pick === 'how') setHowOpen(true);
    else if (pick === 'chat') toggleChatOff();
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
      const who = turnSeat ? (turnSeat.bot ? BOT_NAME : turnSeat.masked || !turnSeat.user ? 'Игрок' : turnSeat.user.name) : '';
      const botSeated = view.seats.some((x) => x && x.bot);
      const text = me.state === 'reserved' ? 'Ты в игре со следующей раздачи'
        : me.state === 'leaving' ? 'Выйдешь после раздачи'
          : view.hand ? (!view.hand.result && who ? 'Ход: ' + who : '')
            : view.countdown ? '' : humans < 2 && !botSeated ? 'Сейчас подключится Para' : humans >= 2 ? 'Ждём игроков…' : '';
      // Сидишь один (с Para) или ждёшь — «Позвать друзей» прямо под рукой.
      const alone = humans < 2 && canInvite && (!view.hand || !!view.hand.result || me.state === 'reserved' || !view.seats[me.seat ?? -1]?.inHand
        || !!view.seats[me.seat ?? -1]?.folded || !(view.hand.turn && view.hand.turn.seat === me.seat));
      bottom = (
        <div className="pk-status">
          {text && <span>{text}</span>}
          {alone && <button type="button" className="pk-pill" onClick={invite}>Позвать друзей</button>}
        </div>
      );
    } else if (broke && access === 'ok') {
      // Фишки кончились: до полуночи — только смотреть; бонус ещё не забирал сегодня — забрать и играть.
      bottom = (
        <div className="pk-status pk-broke">
          <b className="pk-broke__t">Фишки кончились</b>
          {bonus?.available ? (
            <button type="button" className="pk-btn pk-btn--main pk-btn--sit" onClick={() => setBonusOpen(true)}>
              Забрать бонус +{fmtChips(bonus.amount)}
            </button>
          ) : (
            <span>Новый бонус {bonus ? untilReset(bonus.resetAt, now()) : 'завтра'}{bonus ? ' — +' + fmtChips(bonus.tomorrow) : ''}</span>
          )}
          {canInvite && <button type="button" className="pk-pill" onClick={invite}>Позвать друзей посмотреть</button>}
        </div>
      );
    } else {
      const note = access === 'offline' ? 'Без интернета можно только смотреть'
        : access === 'readonly' ? 'Сейчас можно только смотреть'
          : access === 'banned' ? 'Пока действует ограничение, можно только смотреть'
            : full ? 'Все места заняты — подожди, кто-нибудь выйдет'
              : view.hand && !view.hand.result ? 'Идёт раздача — присоединишься со следующей' : '';
      bottom = (
        <div className="pk-status">
          {me && access === 'ok' && (
            <span className="pk-bal"><i className="pk-chip" />Твои фишки: <b>{fmtChips(me.chips)}</b>
              {bonus?.available && <button type="button" className="pk-bal__bonus" onClick={() => setBonusOpen(true)}>Бонус +{fmtChips(bonus.amount)}</button>}
            </span>
          )}
          {note && <span>{note}</span>}
          {canSit && !full && (
            <button type="button" className="pk-btn pk-btn--main pk-btn--sit" disabled={busy} onClick={() => void sit()}>
              {access === 'guest' ? 'Войти и присоединиться' : 'Присоединиться'}
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
              <Table view={view} now={now} floats={floats}
                onSeatMenu={(x) => void seatMenu(x)} onMyAvatar={() => { if (canWrite && !chatOff) openChat(true); }}
                overlay={chatOff ? null : (
                  <>
                    <ChatLayer bursts={bursts} />
                    <ChatButtons unread={unread} onChat={() => openChat(false)} onStickers={() => openChat(true)} />
                  </>
                )}>
                {bottom}
              </Table>
            ) : (
              <div className="pk-load">
                {access === 'off' ? <p>Игра сейчас недоступна</p>
                  : loadErr ? <><p>{loadErr}</p><button type="button" className="pk-btn pk-btn--main" onClick={() => void load()}>Повторить</button></>
                    : <p className="pk-load__dots"><i /><i /><i /></p>}
              </div>
            )}
            {view && !chatOff && (
              <ChatPanel open={chatOpen} tray={tray} items={chat} myId={signedMe ? signedMe.id : null}
                turn={turnDeadline ? { deadline: turnDeadline, now } : null}
                canWrite={canWrite} note={chatNote} busy={chatBusy}
                onClose={closeChat} onTray={setTray} onSend={sendText} onSticker={(id) => void sendSticker(id)} />
            )}
            {stream.status === 'reconnecting' && !closing && <div className="gx-status" role="status">Переподключаемся…</div>}
            {stream.status === 'replaced' && !closing && (
              <div className="gx-banner" role="status">
                <span>Стол открыт в другом окне</span>
                <button type="button" onClick={stream.resume}>Играть здесь</button>
              </div>
            )}
            {bonusOpen && bonus && (
              <BonusCard bonus={bonus} busy={bonusBusy} onClaim={claimBonus} onClose={() => setBonusOpen(false)}
                target={() => document.querySelector('.pk-me__av') || document.querySelector('.pk-bal')} />
            )}
          </div>
        </>,
        document.body,
      )}
      <HowToSheet open={howOpen} onClose={() => setHowOpen(false)} />
      <TopSheet open={topOpen} onClose={() => setTopOpen(false)} />
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)}
        seated={new Set((view?.seats || []).filter((x) => x && !x.bot && x.user).map((x) => x!.user!.id))} />
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
