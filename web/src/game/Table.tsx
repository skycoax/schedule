// Стол: сукно, четыре места вокруг (своё — внизу, крупно карты и строка «я»), колода и борд в центре, банк,
// отсчёт до раздачи и итог. Здесь же «режиссура» между двумя состояниями стола: ставка выросла — фишки летят от
// игрока к его ставке; ставки ушли в банк — летят в банк; появился итог — банк летит победителю.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { FlipDigit } from '../components/FlipClock';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import { reducedMotion } from '../social/instants/motion';
import type { GameReaction, PokerSeat, PokerView } from '../social/types';
import { PlayingCard } from './Card';
import { BOT_NAME, BotOrb } from './BotOrb';
import { Seat, TimerRing, emojiOf, lastText } from './Seat';
import type { SeatPos } from './Seat';
import { flyChips, useTween } from './fx';
import { boardOnly, chips as fmt, evaluate, heat, parseCard } from './logic';
import type { HandEval } from './logic';

/** Подпись под своими картами: без комбинации после флопа — «Пока ничего», а не «Старшая — туз» с борда. */
function handLabel(e: HandEval, mine: string[], board: string[]): string {
  if (board.length < 3) return e.name;
  if (e.cat === 0) {
    const top = Math.max(...board.map((c) => parseCard(c)?.r ?? -1));
    const my = Math.max(...mine.map((c) => parseCard(c)?.r ?? -1));
    return my > top ? e.name : 'Пока ничего';
  }
  // Комбинация целиком на столе (у всех такая же) — так и говорим.
  const b = boardOnly(board);
  return b && b.score === e.score ? 'На столе: ' + e.name.charAt(0).toLowerCase() + e.name.slice(1) : e.name;
}

export interface Float { r: GameReaction; k: number }
const POS: SeatPos[] = ['bottom', 'left', 'top', 'right'];

export function Table(p: {
  view: PokerView; now: () => number; floats: Record<number, Float>;
  onSeatMenu: (s: PokerSeat) => void; onMyAvatar: () => void;
  children?: ReactNode;      // строка действий / статуса под своими картами
}): JSX.Element {
  const v = p.view;
  const me = v.me;
  const mySeat = me && me.seat !== null && me.state !== 'none' ? me.seat : null;
  const root = useRef<HTMLDivElement>(null);
  const [deck, setDeck] = useState<Element | null>(null);
  const hand = v.hand;
  const result = hand?.result || null;

  // ─── Полёты фишек по разнице с прошлым столом ───
  const prev = useRef<PokerView | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = v;
    const el = root.current;
    if (!before || !el || reducedMotion()) return;
    const q = (sel: string) => el.querySelector(sel);
    const pot = q('.pk-pot');
    const sameHand = !!before.hand && !!v.hand && before.hand.id === v.hand.id;
    // Ставки выросли — от игрока к его ставке.
    for (const s of v.seats) {
      if (!s) continue;
      const b = before.seats[s.seat];
      const was = b && sameHand ? b.bet : 0;
      if (s.bet > was) void flyChips(el, q(`[data-seat="${s.seat}"] .pk-seat__av, [data-seat="${s.seat}"] .pk-me__av`), q(`[data-bet="${s.seat}"]`), s.bet - was);
    }
    // Ставки ушли в банк (улица сменилась или раздача закончилась) — от мест к банку.
    if (sameHand && v.hand && before.hand && (v.hand.pot > before.hand.pot || v.hand.result)) {
      let i = 0;
      for (const b of before.seats) {
        if (!b || b.bet <= 0) continue;
        const now = v.seats[b.seat];
        if (now && now.bet >= b.bet && !v.hand.result) continue;
        void flyChips(el, q(`[data-bet="${b.seat}"]`), pot, b.bet, i++ * 40);
      }
    }
    // Итог — банк летит победителям (после того, как долетели ставки).
    if (v.hand?.result && !(before.hand && before.hand.id === v.hand.id && before.hand.result)) {
      v.hand.result.winners.forEach((w, i) => {
        void flyChips(el, pot, q(`[data-seat="${w.seat}"] .pk-seat__av, [data-seat="${w.seat}"] .pk-me__av`), w.amount, 420 + i * 120);
      });
    }
  }, [v]);

  // ─── Центр: отсчёт, банк, итог ───
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!v.countdown) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [v.countdown]);
  void tick;
  const secs = v.countdown ? Math.max(0, Math.ceil((v.countdown - p.now()) / 1000)) : 0;
  const potTotal = hand ? hand.pot : 0;
  const potShown = useTween(result ? 0 : potTotal, 700);
  const humans = v.seats.filter((s) => s && !s.bot).length;

  const winnerText = useMemo(() => {
    if (!result || !hand) return null;
    const names = result.winners.map((w) => {
      const s = v.seats[w.seat];
      const who = s ? (s.bot ? BOT_NAME : s.masked || !s.user ? 'Игрок' : mySeat === w.seat ? 'Ты' : s.user.name) : 'Игрок';
      return { who, amount: w.amount, name: w.name };
    });
    if (!names.length) return null;
    if (names.length === 1) {
      const n = names[0];
      return { title: (n.who === 'Ты' ? 'Ты забираешь ' : n.who + ' забирает ') + fmt(n.amount), sub: n.name || (result.showdown ? '' : 'все сбросили') };
    }
    return { title: 'Банк делится', sub: names.map((n) => n.who + ' +' + fmt(n.amount)).join(' · ') };
  }, [result, hand, v.seats, mySeat]);

  // ─── Свои карты ───
  const myCards = me?.cards && me.cards.length === 2 ? me.cards : null;
  const myEval = myCards ? evaluate([...myCards, ...(hand?.board || [])]) : null;
  const myHeat = myCards && hand && !result ? heat(myCards, hand.board) : 0;
  const myWin = result && mySeat !== null ? result.winners.find((w) => w.seat === mySeat) || null : null;
  // Лучшая пятёрка победителей (кто бы ни выиграл): на борде и в руках светится, остальное на вскрытии гаснет.
  const winCards = useMemo(() => new Set(result ? result.winners.flatMap((w) => w.cards) : []), [result]);
  const iShowed = !!result?.showdown && mySeat !== null && !!result.reveal.find((r) => r.seat === mySeat);
  const myS = mySeat !== null ? v.seats[mySeat] : null;

  const posOf = (seat: number): SeatPos => POS[((seat - (mySeat ?? 0)) % 4 + 4) % 4];

  return (
    <div ref={root} className="pk">
      <div className="pk-felt" aria-hidden="true" />
      <div className="pk-ring-area">
        {v.seats.map((s, i) => {
          if (mySeat === i) return null;
          const pos = posOf(i);
          const tappable = !!s && !s.bot && !s.masked && !!s.user;
          return (
            <Seat key={i} s={s} pos={pos} isMe={false} hand={hand} now={p.now} deck={deck}
              float={p.floats[i] || null}
              onTap={s && tappable ? () => p.onSeatMenu(s) : undefined}
              tapLabel={s?.user ? s.user.name + ' — меню' : undefined} />
          );
        })}
      </div>

      <div className="pk-center">
        <div ref={(el) => setDeck(el)} className="pk-deck" aria-hidden="true"><i /><i /><i /></div>
        {hand && (
          <div className="pk-board" aria-label={'На столе: ' + hand.board.length + ' карт'}>
            {hand.board.map((c, i) => (
              <PlayingCard key={hand.id + ':' + i} card={c} size="md" up from={deck} delay={i < 3 ? i * 110 : 0} flipDelay={-160}
                win={winCards.has(c)} dim={!!result && result.showdown && winCards.size > 0 && !winCards.has(c)} />
            ))}
          </div>
        )}
        {hand && !result && potTotal > 0 && <div className="pk-pot" aria-live="polite"><i className="pk-chip" />Банк {fmt(potShown)}</div>}
        {hand && result && <div className="pk-pot is-out" aria-hidden="true"><i className="pk-chip" />Банк {fmt(potShown)}</div>}
        {winnerText && (
          <div className="pk-result" role="status">
            <b>{winnerText.title}</b>{winnerText.sub && <span>{winnerText.sub}</span>}
          </div>
        )}
        {!hand && v.countdown && (
          <div className="pk-count" role="status" aria-label={'Раздача через ' + secs}>
            <span>Раздача через</span>
            <span className="pk-count__d"><FlipDigit char={String(secs)} /></span>
          </div>
        )}
        {!hand && !v.countdown && (
          <p className="pk-hint">
            {humans === 0 ? 'Стол пуст. Присоединяйся — с тобой сыграет Para.'
              : mySeat !== null ? 'Ждём игроков…' : 'За столом ' + humans + '. Присоединяйся.'}
          </p>
        )}
      </div>

      <div className="pk-bottom">
        {myS && (
          <div className="pk-mine">
            <div className={'pk-mine__cards' + (myS.folded ? ' is-folded' : '')}>
              {myCards ? myCards.map((c, i) => (
                <PlayingCard key={(hand?.id ?? 0) + ':' + i} card={c} size="lg" up from={deck} delay={260 + i * 130} flipDelay={60 + i * 120}
                  heat={myHeat} win={winCards.has(c)} dim={!!result && result.showdown && iShowed && !myWin} />
              )) : null}
            </div>
            {myCards && myEval && !myS.folded && (
              <div key={hand?.id ?? 0} className={'pk-mine__hand' + (myHeat ? ' is-hot' : '')} aria-live="polite">{handLabel(myEval, myCards, hand?.board || [])}</div>
            )}
            {myS.folded && hand && !result && <div className="pk-mine__hand">Ты сбросил — ждём конца раздачи</div>}
          </div>
        )}
        {myS && <MeRow s={myS} hand={hand} now={p.now} float={p.floats[myS.seat] || null} onTap={p.onMyAvatar} />}
        {p.children}
      </div>
    </div>
  );
}

/** Своя строка внизу: фото с кольцом таймера, имя, стек, ставка, дилер, последнее действие. */
function MeRow(p: { s: PokerSeat; hand: PokerView['hand']; now: () => number; float: Float | null; onTap: () => void }): JSX.Element {
  const s = p.s;
  const chips = useTween(s.chips);
  const hand = p.hand;
  const isTurn = !!hand?.turn && hand.turn.seat === s.seat && !hand.result;
  const status = s.reserved ? 'в игре со следующей раздачи' : s.leaving ? 'выйдешь после раздачи' : s.allIn && s.inHand && !s.folded ? 'олл-ин' : '';
  return (
    <div className={'pk-me' + (isTurn ? ' is-turn' : '')} data-seat={s.seat} style={{ '--seat': s.seat } as CSSProperties}>
      <button type="button" className="pk-me__av" aria-label="Реакция" onClick={p.onTap}>
        {isTurn && hand?.turn && <TimerRing deadline={hand.turn.deadline} now={p.now} size={48} />}
        {s.bot ? <BotOrb size={40} /> : <Avatar user={s.user} size={40} />}
        {s.dealer && <span className="pk-seat__d" aria-label="Дилер">D</span>}
        {p.float && <span key={p.float.k} className="pk-seat__float" aria-hidden="true">{emojiOf(p.float.r)}</span>}
      </button>
      <div className="pk-me__main">
        <div className="pk-me__name"><span>{s.user ? s.user.name : 'Ты'}</span>{s.user && <NameBadge u={s.user} />}</div>
        <div className="pk-me__sub">{fmt(chips)}{status ? ' · ' + status : ''}</div>
      </div>
      {s.last && s.inHand && <div key={s.last.a + s.last.amount + (hand?.phase || '')} className="pk-me__last">{lastText(s.last)}</div>}
      {s.bet > 0
        ? <div className="pk-seat__bet pk-me__bet" data-bet={s.seat}><i className="pk-chip" /><span>{fmt(s.bet)}</span></div>
        : <span className="pk-seat__betspot pk-me__betspot" data-bet={s.seat} aria-hidden="true" />}
    </div>
  );
}

/** Ряд реакций над своей строкой. */
export function ReactRow(p: { onPick: (r: GameReaction) => void }): JSX.Element {
  return (
    <div className="pk-reacts" role="group" aria-label="Реакция">
      {(['wave', 'like', 'wow', 'lol', 'fire', 'deal'] as GameReaction[]).map((r) => (
        <button key={r} type="button" className="pk-react" aria-label={r} onClick={() => p.onPick(r)}>{emojiOf(r)}</button>
      ))}
    </div>
  );
}

