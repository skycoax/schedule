// Шахматы — оверлей поверх расписания (отдельный файл, его грузит AppShell). Тёмный, как экраны моментов: вырастает
// из часов героя и при закрытии уходит обратно в них (motion.ts). Три экрана: начало (с ботом, с друзьями, счёт),
// партия с ботом (целиком в приложении, сохраняется в localStorage) и партия с другом (сервер, CONTRACT.md §I).
// Партия с другом: ход сразу виден на доске, сервер проверяет его и рассылает обоим (событие chess в живом потоке).
// Часов нет — ходят в своём темпе. Ставок и выигрышей нет: только партии и счёт побед.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { ls, store } from '../lib/store';
import { useHideTabBar } from '../ui/bar';
import { useLayer } from '../ui/layers';
import { confirmDialog } from '../ui/ActionSheet';
import { Icon } from '../ui/icons';
import { toast } from '../ui/Toast';
import { lockScroll, unlockScroll } from '../ui/Sheet';
import { isApiError } from '../social/api';
import { dropInvite, onChess, useInvite } from '../social/live';
import { currentReturnTo, useSession } from '../social/session';
import type { Session } from '../social/session';
import { ixMotion, setIxOrigin } from '../social/instants/motion';
import { Avatar } from '../social/ui/Avatar';
import type { ChessColor, ChessGame, ChessList, ChessReason, ChessResult, GameInvite, UserCard } from '../social/types';
import { gameClosing } from './entry';
import type { GameReq } from './entry';
import { chessApi } from './api';
import { BOT_LEVELS, botMove, botName, stopBot } from './bot';
import type { BotLevel } from './bot';
import { Board, Piece } from './Board';
import type { Promo } from './Board';
import { InviteSheet } from './InviteSheet';
import '../social/instants/instants.css';
import './chess.css';

export interface GameHostProps { req: GameReq | null; onClose: () => void }

const LEAVE_MS = 230;
const BOT_KEY = 'chess_bot';
const BOT_PAUSE_MS = 380;     // бот «думает» хотя бы столько — иначе ответ мелькает

export default function ChessHost(p: GameHostProps): JSX.Element | null {
  if (!p.req) return null;
  return <ChessRoot key={p.req.n} req={p.req} onClose={p.onClose} />;
}

// ─── Общее ───

/** Эти ошибки показывает сама сессия (вход, профиль, правила, ограничение). */
function handledBySession(e: unknown): boolean {
  return isApiError(e) && (e.code === 'auth' || e.code === 'profile' || e.code === 'rules' || e.code === 'banned');
}
const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Не получилось — попробуй ещё раз');

const RU: Record<string, string> = { K: 'Кр', Q: 'Ф', R: 'Л', B: 'С', N: 'К' };
/** Ход по-русски: Кf3, Фxd8+, 0-0, e8=Ф. */
const ruSan = (san: string): string => san.replace(/^O-O-O/, '0-0-0').replace(/^O-O/, '0-0').replace(/[KQRBN]/g, (x) => RU[x]);

interface Position { chess: Chess; san: string[]; last: [string, string] | null; ok: boolean }

/** Позиция после ходов в UCI. ok — все ходы по правилам. */
function replay(moves: string[]): Position {
  const chess = new Chess();
  const san: string[] = [];
  let ok = true;
  for (const m of moves) {
    try {
      san.push(chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined }).san);
    } catch { ok = false; break; }
  }
  const lm = ok && moves.length ? moves[moves.length - 1] : null;
  return { chess, san, last: lm ? [lm.slice(0, 2), lm.slice(2, 4)] : null, ok };
}

/** Итог позиции (как на сервере): null — партия идёт. */
function endOf(c: Chess): { result: ChessResult; reason: ChessReason } | null {
  if (c.isCheckmate()) return { result: c.turn() === 'w' ? '0-1' : '1-0', reason: 'mate' };
  if (c.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (c.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'material' };
  if (c.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'repetition' };
  if (c.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'fifty' };
  return null;
}

type Outcome = 'win' | 'loss' | 'draw';
const outcomeOf = (result: ChessResult, me: ChessColor): Outcome =>
  result === '1/2-1/2' ? 'draw' : (result === '1-0') === (me === 'w') ? 'win' : 'loss';

/** «Победа · мат», «Ничья · пат»… */
function resultText(result: ChessResult, reason: ChessReason | null, me: ChessColor, vsBot: boolean): string {
  const o = outcomeOf(result, me);
  const head = o === 'win' ? 'Победа' : o === 'loss' ? 'Поражение' : 'Ничья';
  const tail: Record<ChessReason, string> = {
    mate: 'мат',
    resign: o === 'win' ? (vsBot ? 'бот сдался' : 'соперник сдался') : 'партия сдана',
    stalemate: 'пат',
    material: 'мало фигур для мата',
    repetition: 'троекратное повторение',
    fifty: '50 ходов без взятий',
    agreement: 'по согласию',
    left: 'соперник удалил аккаунт',
  };
  return reason ? head + ' · ' + tail[reason] : head;
}

type Access = 'ok' | 'guest' | 'offline' | 'readonly' | 'banned' | 'off' | 'loading';
function accessOf(s: Session, serverOff: boolean): Access {
  const me = s.status === 'signed' ? s.me : null;
  return s.mode === 'off' || serverOff || s.config?.game === 'off' ? 'off'
    : !s.online ? 'offline'
      : s.status === 'loading' ? 'loading'
        : !me ? 'guest'
          : me.banned ? 'banned'
            : s.mode === 'readonly' ? 'readonly' : 'ok';
}
const accessNote = (a: Access): string => a === 'off' ? 'Игра с друзьями сейчас недоступна'
  : a === 'offline' ? 'Без интернета — только с ботом'
    : a === 'readonly' ? 'Сейчас партии с друзьями можно только смотреть'
      : a === 'banned' ? 'Пока действует ограничение, с друзьями играть нельзя' : '';

type Screen = { kind: 'lobby' } | { kind: 'bot' } | { kind: 'game'; id: number; game?: ChessGame };

// ─── Корень ───

function ChessRoot({ req, onClose }: { req: GameReq; onClose: () => void }): JSX.Element {
  const s = useSession();
  const sRef = useRef(s);
  sRef.current = s;
  const [serverOff, setServerOff] = useState(false);
  const access = accessOf(s, serverOff);

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); stopBot(); }, []);
  const closeAll = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIxOrigin(document.querySelector('.hero .clk') ?? document.querySelector('.hero'));
    setClosing(true);
    gameClosing();
    timers.current.push(window.setTimeout(onClose, LEAVE_MS));
  }, [onClose]);
  useEffect(() => { if (store('game_found') !== '1') store('game_found', '1'); }, []);

  const [screen, setScreen] = useState<Screen>(() => (req.gameId ? { kind: 'game', id: req.gameId } : { kind: 'lobby' }));
  const [inviteOpen, setInviteOpen] = useState(false);

  // Приняли приглашение с плашки: войти (если гость), принять, открыть партию.
  const accepting = useRef(false);
  const accept = useCallback(async (from: number) => {
    if (accepting.current) return;
    accepting.current = true;
    try {
      if (!(await sRef.current.ensure('game', currentReturnTo({ game: 1 })))) return;
      const g = await chessApi.accept(from);
      dropInvite();
      void sRef.current.refresh();
      setScreen({ kind: 'game', id: g.id, game: g });
    } catch (e) {
      if (isApiError(e, 'conflict')) dropInvite();
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    } finally {
      accepting.current = false;
    }
  }, []);
  useEffect(() => { if (req.accept) void accept(req.accept); }, [req.accept, accept]);

  const invite = useCallback(async () => {
    if (!(await sRef.current.ensure('game', currentReturnTo({ game: 1 })))) return;
    setInviteOpen(true);
  }, []);

  const back = () => setScreen({ kind: 'lobby' });
  const motion = ixMotion('zoom', closing);
  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    if (screen.kind === 'lobby') closeAll(); else back();
  };

  return (
    <>
      {createPortal(
        <>
          <Root closing={closing} onClose={closeAll} />
          <div className={'ix gx ch-root ' + motion} role="dialog" aria-modal="true" aria-label="Шахматы" tabIndex={-1} onKeyDown={onKeyDown}>
            {screen.kind === 'lobby' && (
              <Lobby access={access} onClose={closeAll} onBot={() => setScreen({ kind: 'bot' })}
                onGame={(g) => setScreen({ kind: 'game', id: g.id, game: g })} onInvite={() => void invite()}
                onAccept={(from) => void accept(from)} onServerOff={() => setServerOff(true)} />
            )}
            {screen.kind === 'bot' && <BotGame onBack={back} onClose={closeAll} />}
            {screen.kind === 'game' && (
              <FriendGame key={screen.id} id={screen.id} initial={screen.game} access={access} onBack={back} onClose={closeAll} />
            )}
          </div>
        </>,
        document.body,
      )}
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}

function Bar(p: { title: string; sub?: string; onBack?: () => void; onClose: () => void }): JSX.Element {
  return (
    <div className="ix__bar ch-bar">
      {p.onBack
        ? <button type="button" className="ix__icon" aria-label="Назад" onClick={p.onBack}><Icon name="back" size={24} /></button>
        : <button type="button" className="ix__icon" aria-label="Закрыть" onClick={p.onClose}><Icon name="close" size={24} /></button>}
      <div className="ch-bar__mid"><h2 className="ch-bar__t">{p.title}</h2>{p.sub && <span className="ch-bar__s">{p.sub}</span>}</div>
      {p.onBack
        ? <button type="button" className="ix__icon" aria-label="Закрыть" onClick={p.onClose}><Icon name="close" size={24} /></button>
        : <span aria-hidden="true" />}
    </div>
  );
}

// ─── Начало: с ботом, с друзьями, счёт ───

interface SavedBot { moves: string[]; color: ChessColor; level: BotLevel; over: { result: ChessResult; reason: ChessReason } | null }

function loadBot(): SavedBot | null {
  try {
    const raw = ls(BOT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedBot;
    if (!v || !Array.isArray(v.moves) || (v.color !== 'w' && v.color !== 'b') || ![1, 2, 3].includes(v.level)) return null;
    if (!replay(v.moves).ok) return null;
    return { moves: v.moves, color: v.color, level: v.level, over: v.over || null };
  } catch { return null; }
}
const saveBot = (v: SavedBot | null) => { ls(BOT_KEY, v ? JSON.stringify(v) : ''); };

function Lobby(p: {
  access: Access; onClose: () => void; onBot: () => void; onGame: (g: ChessGame) => void; onInvite: () => void;
  onAccept: (from: number) => void; onServerOff: () => void;
}): JSX.Element {
  const s = useSession();
  const signed = s.status === 'signed' && !!s.me;
  const canList = signed && s.online && p.access !== 'off';

  // Приглашение: из потока или из Me (сервер помнит 10 минут).
  const live = useInvite();
  const fromMe = s.status === 'signed' ? s.me?.game?.invite ?? null : null;
  const [hidden, setHidden] = useState<string | null>(null);
  const inv: GameInvite | null = live || fromMe;
  const invKey = inv ? inv.from.id + ':' + String(inv.at) : '';
  const showInv = !!inv && invKey !== hidden && p.access === 'ok';

  const [list, setList] = useState<ChessList | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async (quiet?: boolean) => {
    try {
      const l = await chessApi.list();
      setList(l);
      setErr('');
    } catch (e) {
      if (isApiError(e, 'not_found')) { p.onServerOff(); return; }
      if (!quiet && !handledBySession(e)) setErr(errText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (canList) void load(); }, [canList, load]);
  useEffect(() => {
    if (!canList) return;
    const off = onChess(() => void load(true));
    const vis = () => { if (document.visibilityState === 'visible') void load(true); };
    document.addEventListener('visibilitychange', vis);
    return () => { off(); document.removeEventListener('visibilitychange', vis); };
  }, [canList, load]);

  // С ботом: сохранённая партия, уровень и цвет.
  const [saved, setSaved] = useState<SavedBot | null>(() => loadBot());
  const [level, setLevel] = useState<BotLevel>(() => {
    const n = Number(ls('chess_level'));
    return n === 1 || n === 2 || n === 3 ? n : 2;
  });
  const [side, setSide] = useState<'w' | 'r' | 'b'>(() => {
    const v = ls('chess_side');
    return v === 'w' || v === 'b' ? v : 'r';
  });
  const startBot = async () => {
    if (saved && !saved.over && saved.moves.length > 1) {
      const ok = await confirmDialog({ title: 'Начать новую партию?', message: 'Начатая партия с ботом закончится.', confirm: 'Начать', destructive: true });
      if (!ok) return;
    }
    ls('chess_level', String(level));
    ls('chess_side', side);
    const color: ChessColor = side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
    const v: SavedBot = { moves: [], color, level, over: null };
    saveBot(v);
    setSaved(v);
    p.onBot();
  };

  const games = list?.games || [];
  const active = games.filter((g) => g.status === 'active').sort((a, b) => Number(b.turn === b.me) - Number(a.turn === a.me));
  const over = games.filter((g) => g.status === 'over');
  const st = list?.stats;
  const note = accessNote(p.access);

  return (
    <>
      <Bar title="Шахматы" onClose={p.onClose} />
      <div className="ch-lobby">
        {showInv && inv && (
          <div className="ch-invite" role="status">
            <Avatar user={inv.from} size={40} />
            <div className="ch-invite__t"><b>{inv.from.name}</b><span>зовёт тебя сыграть</span></div>
            <button type="button" className="ch-pill ch-pill--main" onClick={() => p.onAccept(inv.from.id)}>Принять</button>
            <button type="button" className="ch-invite__x" aria-label="Не сейчас"
              onClick={() => { setHidden(invKey); dropInvite(); void chessApi.dismiss().catch(() => {}); }}>
              <Icon name="close" size={18} />
            </button>
          </div>
        )}

        <section className="ch-sec">
          <h3 className="ch-sec__h">С ботом</h3>
          {saved && !saved.over && saved.moves.length > 0 && (
            <button type="button" className="ch-row" onClick={p.onBot}>
              <span className="ch-row__ico ch-botico" aria-hidden="true"><Piece color="b" type="n" /></span>
              <span className="ch-row__main">
                <b>Продолжить партию</b>
                <span>{botName(saved.level)} · {saved.color === 'w' ? 'ты белыми' : 'ты чёрными'} · {Math.ceil(saved.moves.length / 2)}-й ход</span>
              </span>
              <Icon name="chevronRight" size={18} className="ch-row__chev" />
            </button>
          )}
          <div className="ch-seg" role="radiogroup" aria-label="Уровень бота">
            {BOT_LEVELS.map((x) => (
              <button key={x.level} type="button" role="radio" aria-checked={level === x.level}
                className={level === x.level ? 'is-on' : ''} onClick={() => setLevel(x.level)}>{x.name}</button>
            ))}
          </div>
          <div className="ch-seg" role="radiogroup" aria-label="Цвет фигур">
            {([['w', 'Белыми'], ['r', 'Любыми'], ['b', 'Чёрными']] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={side === k}
                className={side === k ? 'is-on' : ''} onClick={() => setSide(k)}>{label}</button>
            ))}
          </div>
          <button type="button" className="ch-btn ch-btn--main" onClick={() => void startBot()}>Играть с ботом</button>
        </section>

        <section className="ch-sec">
          <h3 className="ch-sec__h">С друзьями</h3>
          {note && <p className="ch-note">{note}</p>}
          {p.access === 'guest' && <p className="ch-note">Войди, чтобы играть с друзьями из Para — партии сохранятся.</p>}
          {(p.access === 'ok' || p.access === 'guest' || p.access === 'loading') && (
            <button type="button" className="ch-btn" onClick={p.onInvite}>
              {p.access === 'guest' ? 'Войти и позвать друга' : 'Позвать друга'}
            </button>
          )}
          {err && <p className="ch-note">{err} <button type="button" className="ch-link" onClick={() => void load()}>Повторить</button></p>}
          {canList && !list && !err && <p className="ch-dots" aria-label="Загружаем"><i /><i /><i /></p>}
          {active.length > 0 && (
            <ul className="ch-list">{active.map((g) => <GameRow key={g.id} g={g} onOpen={() => p.onGame(g)} />)}</ul>
          )}
          {list && !games.length && p.access === 'ok' && (
            <p className="ch-note">Партий пока нет. Позови друга — у него появится приглашение.</p>
          )}
          {over.length > 0 && (
            <>
              <h4 className="ch-sec__sub">Сыгранные</h4>
              <ul className="ch-list">{over.map((g) => <GameRow key={g.id} g={g} onOpen={() => p.onGame(g)} />)}</ul>
            </>
          )}
          {st && (st.wins + st.losses + st.draws > 0) && (
            <p className="ch-stats">
              <span><b>{st.wins}</b> побед</span><span><b>{st.draws}</b> ничьих</span><span><b>{st.losses}</b> поражений</span>
            </p>
          )}
        </section>
      </div>
    </>
  );
}

const opponentOf = (g: ChessGame): UserCard | null => (g.me === 'w' ? g.black : g.white);

function GameRow({ g, onOpen }: { g: ChessGame; onOpen: () => void }): JSX.Element {
  const op = opponentOf(g);
  const mine = g.status === 'active' && g.turn === g.me;
  const sub = g.status === 'active'
    ? (mine ? 'Твой ход' : 'Ход соперника') + (g.drawOffer && g.drawOffer !== g.me ? ' · предлагает ничью' : '')
    : g.result ? resultText(g.result, g.reason, g.me, false) : 'Партия окончена';
  return (
    <li>
      <button type="button" className="ch-row" onClick={onOpen}>
        <Avatar user={op} size={40} />
        <span className="ch-row__main">
          <b>{op ? op.name : 'Аккаунт удалён'}</b>
          <span className={mine ? 'is-turn' : ''}>{sub}</span>
        </span>
        {mine && <i className="ch-row__dot" aria-hidden="true" />}
        <Icon name="chevronRight" size={18} className="ch-row__chev" />
      </button>
    </li>
  );
}

// ─── Доска с игроками и ходами ───

function Player(p: { name: string; user?: { id: number; name: string; avatar: string | null } | null; bot?: boolean; turn: boolean; note?: string }): JSX.Element {
  return (
    <div className={'ch-player' + (p.turn ? ' is-turn' : '')}>
      {p.bot
        ? <span className="ch-botico ch-botico--sm" aria-hidden="true"><Piece color="b" type="n" /></span>
        : <Avatar user={p.user ?? null} size={32} />}
      <span className="ch-player__n">{p.name}</span>
      {p.note && <span className="ch-player__s">{p.note}</span>}
    </div>
  );
}

function Moves({ san }: { san: string[] }): JSX.Element | null {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollLeft = el.scrollWidth; }, [san.length]);
  if (!san.length) return <p className="ch-moves ch-moves--empty">Ходов пока нет</p>;
  const pairs: [string, string | undefined][] = [];
  for (let i = 0; i < san.length; i += 2) pairs.push([san[i], san[i + 1]]);
  return (
    <ol className="ch-moves" ref={ref} aria-label="Ходы партии">
      {pairs.map(([w, b], i) => (
        <li key={i}><span className="ch-moves__n">{i + 1}.</span>{ruSan(w)}{b && <> {ruSan(b)}</>}</li>
      ))}
    </ol>
  );
}

const uciOf = (from: Square, to: Square, promotion?: Promo) => from + to + (promotion || '');

// ─── Партия с ботом ───

function BotGame({ onBack, onClose }: { onBack: () => void; onClose: () => void }): JSX.Element {
  const s = useSession();
  const myName = s.status === 'signed' && s.me ? s.me.name : 'Ты';
  const [g, setG] = useState<SavedBot>(() => loadBot() || { moves: [], color: 'w', level: 2, over: null });
  const pos = useMemo(() => replay(g.moves), [g.moves]);
  const [thinking, setThinking] = useState(false);
  const token = useRef(0);

  const update = useCallback((next: SavedBot) => { saveBot(next); setG(next); }, []);
  const withMove = (cur: SavedBot, m: string): SavedBot => {
    const moves = [...cur.moves, m];
    return { ...cur, moves, over: endOf(replay(moves).chess) };
  };

  // Ход бота, когда его очередь.
  const botTurn = !g.over && pos.chess.turn() !== g.color;
  useEffect(() => {
    if (!botTurn) return;
    const t = ++token.current;
    setThinking(true);
    const fen = pos.chess.fen();
    const started = performance.now();
    void botMove(fen, g.level).then((m) => {
      const wait = Math.max(0, BOT_PAUSE_MS - (performance.now() - started));
      window.setTimeout(() => {
        if (t !== token.current) return;
        setThinking(false);
        if (!m) { toast('Бот не смог сходить — попробуй ещё раз', { kind: 'error' }); return; }
        setG((cur) => { const next = withMove(cur, m); saveBot(next); return next; });
      }, wait);
    });
    return () => { token.current++; setThinking(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botTurn, g.moves.length]);

  const onMove = (from: Square, to: Square, promotion?: Promo) => {
    if (botTurn || g.over) return;
    try { new Chess(pos.chess.fen()).move({ from, to, promotion }); } catch { return; }
    navigator.vibrate?.(6);
    update(withMove(g, uciOf(from, to, promotion)));
  };

  const undo = () => {
    if (thinking || !g.moves.length) return;
    // Назад до своего хода: свой и ответ бота.
    let moves = g.moves.slice(0, -1);
    if (moves.length && replay(moves).chess.turn() !== g.color) moves = moves.slice(0, -1);
    if (replay(moves).chess.turn() !== g.color) return;
    token.current++;
    update({ ...g, moves, over: null });
  };
  const resign = async () => {
    if (g.over) return;
    if (!(await confirmDialog({ title: 'Сдаться?', message: 'Партия с ботом закончится.', confirm: 'Сдаться', destructive: true }))) return;
    token.current++;
    setThinking(false);
    update({ ...g, over: { result: g.color === 'w' ? '0-1' : '1-0', reason: 'resign' } });
  };
  const again = () => {
    token.current++;
    setThinking(false);
    update({ moves: [], color: g.color === 'w' ? 'b' : 'w', level: g.level, over: null });
  };

  const status = g.over ? resultText(g.over.result, g.over.reason, g.color, true)
    : thinking ? 'Бот думает…' : pos.chess.inCheck() ? 'Шах — твой ход' : 'Твой ход';
  const canUndo = !g.over && !thinking && g.moves.length >= (g.color === 'w' ? 1 : 2);

  return (
    <>
      <Bar title="Шахматы" sub={botName(g.level)} onBack={onBack} onClose={onClose} />
      <div className="ch-play">
        <Player name={botName(g.level)} bot turn={!g.over && botTurn} note={thinking ? 'думает…' : ''} />
        <Board chess={pos.chess} orientation={g.color} movable={g.over || botTurn ? null : g.color} lastMove={pos.last} onMove={onMove} />
        <Player name={myName} user={s.status === 'signed' ? s.me : null} turn={!g.over && !botTurn} />
        <p className={'ch-status' + (g.over ? ' is-over' : '')} role="status">{status}</p>
        <Moves san={pos.san} />
        <div className="ch-acts">
          {g.over ? (
            <button type="button" className="ch-btn ch-btn--main" onClick={again}>Новая партия</button>
          ) : (
            <>
              <button type="button" className="ch-btn" disabled={!canUndo} onClick={undo}>Вернуть ход</button>
              <button type="button" className="ch-btn" onClick={() => void resign()}>Сдаться</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Партия с другом ───

function FriendGame(p: { id: number; initial?: ChessGame; access: Access; onBack: () => void; onClose: () => void }): JSX.Element {
  const s = useSession();
  const [g, setG] = useState<ChessGame | null>(p.initial || null);
  const gRef = useRef(g);
  gRef.current = g;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const apply = useCallback((next: ChessGame) => {
    const cur = gRef.current;
    // Не откатываемся назад: событие может прийти раньше ответа на свой ход или позже нового.
    if (cur && next.moves.length < cur.moves.length && cur.status === 'active') return;
    gRef.current = next;
    setG(next);
  }, []);
  const load = useCallback(async (quiet?: boolean) => {
    try {
      const next = await chessApi.game(p.id);
      gRef.current = next;
      setG(next);
      setErr('');
    } catch (e) {
      if (!quiet || !gRef.current) setErr(errText(e));
    }
  }, [p.id]);
  useEffect(() => {
    const off = onChess((x) => { if (x.id === p.id && !pending.current) apply(x); });
    const vis = () => { if (document.visibilityState === 'visible') void load(true); };
    document.addEventListener('visibilitychange', vis);
    return () => { off(); document.removeEventListener('visibilitychange', vis); };
  }, [p.id, apply, load]);
  // При открытии и когда вернулась сеть — свежая партия (пропущенные ходы).
  const signed = s.status === 'signed';
  useEffect(() => { if (signed) void load(!!gRef.current); }, [s.online, signed, load]);

  const pos = useMemo(() => replay(g?.moves || []), [g?.moves]);
  const canPlay = p.access === 'ok' && !!g && g.status === 'active';
  const myTurn = canPlay && !!g && g.turn === g.me && !busy;

  const onMove = async (from: Square, to: Square, promotion?: Promo) => {
    const cur = gRef.current;
    if (!cur || !myTurn) return;
    const m = uciOf(from, to, promotion);
    const c = new Chess(pos.chess.fen());
    try { c.move({ from, to, promotion }); } catch { return; }
    navigator.vibrate?.(6);
    // Сразу на доске; сервер подтвердит (или вернёт как было).
    const optimistic: ChessGame = { ...cur, moves: [...cur.moves, m], fen: c.fen(), turn: c.turn(), drawOffer: null };
    gRef.current = optimistic;
    setG(optimistic);
    setBusy(true);
    pending.current = true;
    try {
      const next = await chessApi.move(cur.id, m, cur.moves.length);
      gRef.current = next;
      setG(next);
    } catch (e) {
      gRef.current = cur;
      setG(cur);
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
      void load(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const act = async (f: () => Promise<ChessGame>) => {
    if (busy) return;
    setBusy(true);
    try { apply(await f()); } catch (e) {
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
      void load(true);
    } finally { setBusy(false); }
  };
  const resign = async () => {
    if (!g || !(await confirmDialog({ title: 'Сдаться?', message: 'Партия закончится, победа достанется сопернику.', confirm: 'Сдаться', destructive: true }))) return;
    await act(() => chessApi.resign(g.id));
  };
  const again = async () => {
    const op = g ? opponentOf(g) : null;
    if (!op || busy) return;
    setBusy(true);
    try {
      await chessApi.invite(op.id);
      toast('Позвали — партия начнётся, когда ' + op.name + ' примет');
    } catch (e) {
      if (!handledBySession(e)) toast(errText(e), { kind: isApiError(e, 'rate') ? 'default' : 'error' });
    } finally { setBusy(false); }
  };

  if (!g) {
    const guest = p.access === 'guest';
    return (
      <>
        <Bar title="Шахматы" onBack={p.onBack} onClose={p.onClose} />
        <div className="ch-load">
          {guest ? (
            <>
              <p>Войди, чтобы открыть партию</p>
              <button type="button" className="ch-btn ch-btn--main"
                onClick={() => void s.ensure('game', currentReturnTo({ game: 1, chess: p.id }))}>Войти</button>
            </>
          ) : err ? <><p>{err}</p><button type="button" className="ch-btn ch-btn--main" onClick={() => void load()}>Повторить</button></>
            : <p className="ch-dots" aria-label="Загружаем"><i /><i /><i /></p>}
        </div>
      </>
    );
  }

  const op = opponentOf(g);
  const opName = op ? op.name : 'Аккаунт удалён';
  const me = s.status === 'signed' ? s.me : null;
  const theirOffer = g.status === 'active' && !!g.drawOffer && g.drawOffer !== g.me;
  const myOffer = g.status === 'active' && g.drawOffer === g.me;
  const note = accessNote(p.access);
  const status = g.status === 'over' && g.result ? resultText(g.result, g.reason, g.me, false)
    : g.turn === g.me ? (pos.chess.inCheck() ? 'Шах — твой ход' : 'Твой ход') : 'Ход соперника';

  return (
    <>
      <Bar title="Шахматы" sub={opName} onBack={p.onBack} onClose={p.onClose} />
      <div className="ch-play">
        <Player name={opName} user={op} turn={g.status === 'active' && g.turn !== g.me} note={g.status === 'active' && g.turn !== g.me ? 'ходит' : ''} />
        <Board chess={pos.chess} orientation={g.me} movable={myTurn ? g.me : null} lastMove={pos.last} onMove={(a, b, c) => void onMove(a, b, c)} />
        <Player name={me ? me.name : 'Ты'} user={me} turn={g.status === 'active' && g.turn === g.me} />
        <p className={'ch-status' + (g.status === 'over' ? ' is-over' : '')} role="status">{status}</p>
        {note && g.status === 'active' && <p className="ch-note ch-note--c">{note}</p>}
        <Moves san={pos.san} />
        {theirOffer && canPlay && (
          <div className="ch-offer" role="status">
            <span>{opName} предлагает ничью</span>
            <button type="button" className="ch-pill" disabled={busy} onClick={() => void act(() => chessApi.draw(g.id, 'decline'))}>Отказаться</button>
            <button type="button" className="ch-pill ch-pill--main" disabled={busy} onClick={() => void act(() => chessApi.draw(g.id, 'accept'))}>Согласиться</button>
          </div>
        )}
        <div className="ch-acts">
          {g.status === 'over' ? (
            op && p.access === 'ok' && <button type="button" className="ch-btn ch-btn--main" disabled={busy} onClick={() => void again()}>Позвать ещё раз</button>
          ) : canPlay && (
            <>
              <button type="button" className="ch-btn" disabled={busy || myOffer || theirOffer}
                onClick={() => void act(() => chessApi.draw(g.id, 'offer'))}>{myOffer ? 'Ничья предложена' : 'Предложить ничью'}</button>
              <button type="button" className="ch-btn" disabled={busy} onClick={() => void resign()}>Сдаться</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Подложка и слой ───

let gameRoots = 0;

/**
 * Подложка и слой всего оверлея. Пока шахматы открыты: страница под ними не прокручивается (иначе при закрытии оверлей
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
