// Место за столом: карты (рубашкой или вскрытые), фото с кольцом таймера, имя со значком, стек, ставка перед
// местом, пузырь последнего действия, кнопка дилера, всплывающая реакция, «+240 · Две пары» победителю.
// Пустое место — кнопка «Сесть». Своё место внизу рисуется без карт: они крупно, отдельно (Table).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import { reducedMotion } from '../social/instants/motion';
import type { GameReaction, PokerHand, PokerLast, PokerSeat } from '../social/types';
import { PlayingCard } from './Card';
import { chips as fmt } from './logic';
import { useTween } from './fx';

export type SeatPos = 'bottom' | 'left' | 'top' | 'right';

export const REACTIONS: readonly { id: GameReaction; emoji: string; label: string }[] = [
  { id: 'wave', emoji: '👋', label: 'Привет' },
  { id: 'like', emoji: '👍', label: 'Класс' },
  { id: 'wow', emoji: '😮', label: 'Ого' },
  { id: 'lol', emoji: '😂', label: 'Смешно' },
  { id: 'fire', emoji: '🔥', label: 'Огонь' },
  { id: 'deal', emoji: '🤝', label: 'По рукам' },
];
export const emojiOf = (r: GameReaction): string => REACTIONS.find((x) => x.id === r)?.emoji || '';

const LAST: Record<PokerLast, string> = {
  fold: 'Сброс', check: 'Чек', call: 'Колл', bet: 'Бет', raise: 'Рейз', allin: 'Олл-ин', sb: 'Малый блайнд', bb: 'Большой блайнд', win: 'Банк',
};
export function lastText(l: { a: PokerLast; amount: number } | null): string {
  if (!l) return '';
  const t = LAST[l.a] || '';
  return l.amount > 0 && l.a !== 'fold' && l.a !== 'check' ? t + ' ' + fmt(l.amount) : t;
}

/** Робот вместо фото у бота. */
export function BotFace({ size = 44 }: { size?: number }): JSX.Element {
  return (
    <span className="pk-bot" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 44 44" width={size} height={size}>
        <rect x="11" y="15" width="22" height="17" rx="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17.5" cy="23.5" r="2.2" fill="currentColor" />
        <circle cx="26.5" cy="23.5" r="2.2" fill="currentColor" />
        <path d="M22 15v-4M19.5 9h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M18 28.5h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Кольцо таймера вокруг фото: убывает от полного к пустому к deadline (время сервера через now()). */
export function TimerRing(p: { deadline: number; now: () => number; size: number }): JSX.Element {
  const ref = useRef<SVGCircleElement>(null);
  const total = useRef({ deadline: 0, ms: 1 });
  useEffect(() => {
    if (total.current.deadline !== p.deadline) total.current = { deadline: p.deadline, ms: Math.max(1000, p.deadline - p.now()) };
    let raf = 0;
    const r = (p.size - 3) / 2;
    const len = 2 * Math.PI * r;
    const step = () => {
      const el = ref.current;
      if (!el) return;
      const left = Math.max(0, Math.min(1, (p.deadline - p.now()) / total.current.ms));
      el.style.strokeDashoffset = String(len * (1 - left));
      el.style.opacity = left < 0.25 ? String(0.55 + 0.45 * Math.abs(Math.sin(p.now() / 160))) : '1';
      raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [p.deadline, p.now, p.size]);
  const r = (p.size - 3) / 2;
  return (
    <svg className="pk-ring" viewBox={`0 0 ${p.size} ${p.size}`} width={p.size} height={p.size} aria-hidden="true">
      <circle cx={p.size / 2} cy={p.size / 2} r={r} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="2.5" />
      <circle ref={ref} cx={p.size / 2} cy={p.size / 2} r={r} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={2 * Math.PI * r} style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }} />
    </svg>
  );
}

interface Float { r: GameReaction; k: number }

export function Seat(p: {
  s: PokerSeat | null; pos: SeatPos; isMe: boolean;
  hand: PokerHand | null; now: () => number; deck: Element | null;
  float?: Float | null;
  onTap?: () => void; tapLabel?: string;
  sitLabel?: string;              // пустое место: «Сесть» (или ничего — не кнопка)
}): JSX.Element {
  const s = p.s;
  const hand = p.hand;
  const chips = useTween(s ? s.chips : 0);
  const winner = s && hand?.result ? hand.result.winners.find((w) => w.seat === s.seat) || null : null;
  const revealed = s && hand?.result ? hand.result.reveal.find((r) => r.seat === s.seat) || null : null;
  const isTurn = !!s && !!hand?.turn && hand.turn.seat === s.seat && !hand.result;

  // Карты чужого места: сбросил — рубашки уходят в сброс (короткий призрак), потом их нет.
  const shownCards = s && s.inHand ? (revealed ? revealed.cards : s.cards) : null;
  const [ghost, setGhost] = useState<string[] | null>(null);
  const prevCards = useRef<string[] | null>(null);
  useEffect(() => {
    const before = prevCards.current;
    prevCards.current = shownCards;
    if (before && !shownCards && s?.folded && !reducedMotion()) {
      setGhost(before);
      const t = window.setTimeout(() => setGhost(null), 460);
      return () => clearTimeout(t);
    }
    if (shownCards) setGhost(null);
    return undefined;
  }, [shownCards, s?.folded]);

  const cls = ['pk-seat', 'pk-seat--' + p.pos, s ? '' : 'pk-seat--empty', isTurn ? 'is-turn' : '', s?.folded ? 'is-folded' : '',
    s?.away ? 'is-away' : '', s?.reserved ? 'is-reserved' : '', winner ? 'is-win' : '', p.isMe ? 'is-me' : '',
    s && hand?.result && s.inHand && !winner && !s.folded ? 'is-lost' : ''].filter(Boolean).join(' ');

  if (!s) {
    return p.sitLabel && p.onTap
      ? (
        <button type="button" className={cls} onClick={p.onTap} aria-label={p.sitLabel}>
          <span className="pk-seat__free"><span className="pk-seat__plus">+</span><span>{p.sitLabel}</span></span>
        </button>
      )
      : <div className={cls} aria-hidden="true"><span className="pk-seat__free is-quiet"><span>Свободно</span></span></div>;
  }

  const name = s.bot ? 'Бот Para' : s.masked || !s.user ? 'Игрок' : s.user.name;
  const status = s.reserved ? 'ждёт раздачи' : s.leaving ? 'встаёт' : s.away ? 'отошёл' : s.allIn && s.inHand && !s.folded ? 'олл-ин' : '';
  const cards = shownCards || ghost;
  const faceUp = !!revealed || (!!shownCards && shownCards[0] !== '?');
  const winCards = hand?.result ? hand.result.winners.flatMap((w) => w.cards) : [];
  const body = (
    <>
      {cards && !p.isMe && (
        <div className={'pk-seat__cards' + (ghost && !shownCards ? ' is-muck' : '')} aria-hidden={!faceUp}>
          {cards.map((c, i) => (
            <PlayingCard key={(hand?.id ?? 0) + ':' + i} card={c} size="sm" up={faceUp}
              from={p.deck} delay={220 + s.seat * 140 + i * 90} flipDelay={revealed ? 140 + i * 160 : 0}
              win={winCards.includes(c)} dim={!!hand?.result && hand.result.showdown && !!revealed && !winCards.includes(c)}
              muck={!!ghost && !shownCards} />
          ))}
        </div>
      )}
      <div className="pk-seat__av">
        {isTurn && hand?.turn && <TimerRing deadline={hand.turn.deadline} now={p.now} size={52} />}
        {s.bot ? <BotFace size={44} /> : <Avatar user={s.masked ? null : s.user} size={44} />}
        {s.dealer && <span className="pk-seat__d" aria-label="Дилер">D</span>}
        {p.float && <span key={p.float.k} className="pk-seat__float" aria-hidden="true">{emojiOf(p.float.r)}</span>}
      </div>
      <div className="pk-seat__name"><span>{name}</span>{!s.bot && !s.masked && s.user && <NameBadge u={s.user} />}</div>
      <div className="pk-seat__chips">{fmt(chips)}</div>
      {status && <div className="pk-seat__st">{status}</div>}
      {s.bet > 0 && (
        <div className="pk-seat__bet" data-bet={s.seat}><i className="pk-chip" /><span>{fmt(s.bet)}</span></div>
      )}
      {!s.bet && <span className="pk-seat__betspot" data-bet={s.seat} aria-hidden="true" />}
      {s.last && s.inHand && !winner && (
        <div key={s.last.a + s.last.amount + (hand?.phase || '')} className="pk-seat__last" aria-live="polite">{lastText(s.last)}</div>
      )}
      {winner && (
        <div className="pk-seat__win" role="status">
          <b>+{fmt(winner.amount)}</b>{winner.name && <span>{winner.name}</span>}
        </div>
      )}
    </>
  );
  const style = { '--seat': s.seat } as CSSProperties;
  return p.onTap
    ? <button type="button" className={cls} style={style} data-seat={s.seat} onClick={p.onTap} aria-label={p.tapLabel || name}>{body}</button>
    : <div className={cls} style={style} data-seat={s.seat}>{body}</div>;
}
