// Чат стола (CONTRACT.md §I.11): сообщения и стикеры тех, кто за столом. Игре не мешает: чужие сообщения — короткими
// пузырями у мест (4 с), стикеры — крупно над местом (2,6 с), сама панель — снизу и закрывается, когда твой ход
// (GameHost). Пишут сидящие; остальные читают. Быстрые фразы — одним касанием; набор стикеров — вместо клавиатуры.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, JSX } from 'react';
import { Avatar } from '../social/ui/Avatar';
import { Icon } from '../ui/icons';
import type { PokerChatItem, PokerSticker } from '../social/types';
import { BOT_NAME, BotOrb } from './BotOrb';
import { STICKER_LIST, Sticker } from './stickers';

export const CHAT_MAX = 120;
export const PHRASES = ['GG', 'Удачи!', 'Ну ты даёшь', 'Блефуешь?', 'Ещё раздачу?', 'Хорошо сыграл', 'Ха-ха', 'Спасибо'];
const SEAT_COLOR = ['#64D2FF', '#FFD60A', '#30D158', '#FF9F0A'];

/** Всплывшее у места: пузырь с текстом или стикер. */
export interface Burst { k: number; item: PokerChatItem }
export const BURST_MS = { text: 4200, sticker: 2600 };

const nameOf = (m: PokerChatItem): string => (m.bot ? BOT_NAME : m.user ? m.user.name : 'Игрок');

// ─── Кнопки на столе ───

export function ChatButtons(p: { unread: number; onChat: () => void; onStickers: () => void }): JSX.Element {
  return (
    <div className="pk-cb">
      <button type="button" className="pk-cb__b" aria-label="Стикеры" onClick={p.onStickers}>
        <span className="pk-cb__smile" aria-hidden="true">😎</span>
      </button>
      <button type="button" className="pk-cb__b" aria-label={p.unread ? `Чат, новых: ${p.unread}` : 'Чат'} onClick={p.onChat}>
        <Icon name="comment" size={22} />
        {p.unread > 0 && <span className="pk-cb__n" aria-hidden="true">{p.unread > 9 ? '9+' : p.unread}</span>}
      </button>
    </div>
  );
}

// ─── Пузыри и стикеры над местами ───

type Pos = 'top' | 'left' | 'right' | 'bottom' | 'me';
interface Anchor { x: number; y: number; pos: Pos; cx: number; cy: number; w: number }

function anchorOf(root: HTMLElement, seat: number): Anchor | null {
  const el = root.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
  if (!el) return null;
  const av = el.querySelector('.pk-seat__av, .pk-me__av') || el;
  const r = av.getBoundingClientRect();
  const R = root.getBoundingClientRect();
  const pos: Pos = el.classList.contains('pk-me') ? 'me' : el.classList.contains('pk-seat--left') ? 'left'
    : el.classList.contains('pk-seat--right') ? 'right' : el.classList.contains('pk-seat--top') ? 'top' : 'bottom';
  return { x: r.left + r.width / 2 - R.left, y: r.top + r.height / 2 - R.top, pos, cx: R.width / 2, cy: R.height * 0.36, w: R.width };
}

function BurstView({ b, root }: { b: Burst; root: HTMLElement | null }): JSX.Element | null {
  const [a, setA] = useState<Anchor | null>(null);
  useLayoutEffect(() => { if (root) setA(anchorOf(root, b.item.seat)); }, [root, b.item.seat]);
  if (!a) return null;
  if (b.item.sticker) {
    // Стикер выпрыгивает из фото к центру стола, живёт и улетает вверх; свой — справа от своих карт.
    const me = a.pos === 'me';
    const tx = me ? a.w - 56 - a.x : (a.cx - a.x) * (a.pos === 'bottom' ? 0.22 : 0.34);
    const ty = me ? -92 : a.pos === 'bottom' ? -96 : (a.cy - a.y) * 0.34;
    return (
      <div className="pk-fly" style={{ left: a.x, top: a.y, '--tx': tx + 'px', '--ty': ty + 'px' } as CSSProperties}>
        <Sticker id={b.item.sticker} size={me ? 92 : 108} />
      </div>
    );
  }
  // Пузырь — сбоку от фото, к середине стола (стикер того же места уходит вверх и его не закрывает); ширина — сколько влезает.
  const right = a.pos === 'right';
  const room = Math.max(96, Math.min(220, right ? a.x - 36 : a.w - a.x - 36));
  return (
    <div className={'pk-bub pk-bub--' + (right ? 'r' : a.pos === 'top' ? 't' : 'l')}
      style={{ left: a.x, top: a.y, maxWidth: room, '--sc': SEAT_COLOR[b.item.seat % 4] } as CSSProperties}>
      {b.item.text}
    </div>
  );
}

/** Слой поверх стола (внутри .pk): всплывающие пузыри и стикеры. */
export function ChatLayer({ bursts }: { bursts: Burst[] }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => { setRoot(ref.current?.parentElement ?? null); }, []);
  return (
    <div ref={ref} className="pk-fx" aria-hidden="true">
      {bursts.map((b) => <BurstView key={b.k} b={b} root={root} />)}
    </div>
  );
}

// ─── Панель чата ───

/** Пока открыт чат и идёт твой ход: сколько секунд осталось; нажатие — к кнопкам хода. */
function TurnPill({ deadline, now, onGo }: { deadline: number; now: () => number; onGo: () => void }): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  const sec = Math.max(0, Math.ceil((deadline - now()) / 1000));
  return <button type="button" className="pk-chat__turn" onClick={onGo}>Твой ход · {sec} с</button>;
}

export function ChatPanel(p: {
  open: boolean; tray: boolean; items: PokerChatItem[]; myId: number | null;
  turn: { deadline: number; now: () => number } | null;
  canWrite: boolean; note: string; busy: boolean;
  onClose: () => void; onTray: (open: boolean) => void;
  onSend: (text: string) => Promise<boolean>; onSticker: (id: PokerSticker) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seen = useRef(new Set<number>());       // строки, которые уже были на экране: их стикеры не играют заново
  const [shown, setShown] = useState(false);

  // Новые строки — вниз списка (если человек не листает историю).
  const last = p.items.length ? p.items[p.items.length - 1].id : 0;
  useEffect(() => {
    const el = list.current;
    if (!el || !p.open) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (near || !shown) el.scrollTop = el.scrollHeight;
    if (!shown) setShown(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, p.open, p.tray]);
  useEffect(() => { if (!p.open) setShown(false); }, [p.open]);
  useEffect(() => {
    if (!p.open) return undefined;
    const t = window.setTimeout(() => { for (const m of p.items) seen.current.add(m.id); }, 2600);
    return () => clearTimeout(t);
  }, [p.open, p.items]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || p.busy) return;
    if (await p.onSend(t)) setText('');
  };
  const left = CHAT_MAX - [...text].length;

  return (
    <section className={'pk-chat' + (p.open ? ' is-open' : '') + (p.tray ? ' has-tray' : '')} aria-label="Чат стола" aria-hidden={!p.open}
      inert={!p.open || undefined}>
      <header className="pk-chat__h">
        <span className="pk-chat__grab" aria-hidden="true" />
        {p.turn ? <TurnPill deadline={p.turn.deadline} now={p.turn.now} onGo={p.onClose} /> : <h3 className="pk-chat__t">Чат стола</h3>}
        <button type="button" className="pk-chat__x" aria-label="Закрыть чат" onClick={p.onClose}><Icon name="close" size={18} /></button>
      </header>
      <div ref={list} className="pk-chat__list" role="log" aria-live="polite">
        {!p.items.length && <p className="pk-chat__empty">Пока тихо. Поздоровайся или брось стикер.</p>}
        {p.items.map((m, i) => {
          const mine = !!p.myId && !!m.user && m.user.id === p.myId;
          const prev = p.items[i - 1];
          const same = !!prev && prev.seat === m.seat && prev.bot === m.bot && (prev.user?.id ?? 0) === (m.user?.id ?? 0) && m.at - prev.at < 60_000;
          return (
            <div key={m.id} className={'pk-msg' + (mine ? ' is-mine' : '') + (same ? ' is-cont' : '')}>
              {!mine && (
                <span className="pk-msg__av" aria-hidden="true">
                  {!same && (m.bot ? <BotOrb size={32} /> : <Avatar user={m.user} size={32} />)}
                </span>
              )}
              <div className="pk-msg__body">
                {!mine && !same && <span className="pk-msg__n" style={{ color: SEAT_COLOR[m.seat % 4] }}>{nameOf(m)}</span>}
                {m.sticker
                  ? <span className="pk-msg__stk"><Sticker id={m.sticker} size={76} play={p.open && !seen.current.has(m.id)} /></span>
                  : <span className="pk-msg__t">{m.text}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {p.canWrite ? (
        <>
          <div className="pk-chat__quick" role="group" aria-label="Быстрые фразы">
            {PHRASES.map((q) => (
              <button key={q} type="button" className="pk-chip-btn" disabled={p.busy} onClick={() => void p.onSend(q)}>{q}</button>
            ))}
          </div>
          <form className="pk-chat__bar" onSubmit={(e) => void submit(e)}>
            <button type="button" className={'pk-chat__tog' + (p.tray ? ' is-on' : '')} aria-label={p.tray ? 'Клавиатура' : 'Стикеры'}
              aria-pressed={p.tray} onClick={() => {
                if (p.tray) { p.onTray(false); input.current?.focus(); } else { input.current?.blur(); p.onTray(true); }
              }}>
              {p.tray ? <Icon name="compose" size={20} /> : <span aria-hidden="true">😎</span>}
            </button>
            <input ref={input} className="pk-chat__in" value={text} placeholder="Сообщение" aria-label="Сообщение"
              maxLength={CHAT_MAX * 2} enterKeyHint="send" autoComplete="off"
              onFocus={() => p.onTray(false)} onChange={(e) => setText(e.currentTarget.value)} />
            {left < 20 && <span className={'pk-chat__left' + (left < 0 ? ' is-over' : '')} aria-live="polite">{left}</span>}
            <button type="submit" className="pk-chat__send" aria-label="Отправить" disabled={!text.trim() || left < 0 || p.busy}>
              <Icon name="send" size={18} />
            </button>
          </form>
          {p.tray && (
            <div className="pk-tray" role="group" aria-label="Стикеры">
              {STICKER_LIST.map((s) => (
                <button key={s.id} type="button" className="pk-tray__b" aria-label={s.label} onClick={() => p.onSticker(s.id)}>
                  <Sticker id={s.id} size={56} play={false} />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="pk-chat__note">{p.note}</p>
      )}
    </section>
  );
}
