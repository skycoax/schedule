// Кнопки хода: «Сбросить», «Чек» / «Уравнять 40», «Поднять» (панель: мин, ½ банка, банк, олл-ин, ползунок).
// Суммы — «до» (итоговая ставка на улице), кратны 10; олл-ин — отдельным действием.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { PokerAction, PokerActions, PokerHand, PokerSeat } from '../social/types';
import { chips as fmt } from './logic';

const step10 = (n: number) => Math.round(n / 10) * 10;

export function Actions(p: {
  a: PokerActions; hand: PokerHand; seats: (PokerSeat | null)[]; big: number; busy: boolean;
  onAct: (action: PokerAction, amount?: number) => void;
}): JSX.Element {
  const { a, hand } = p;
  const [open, setOpen] = useState(false);
  const r = a.raise;
  const potNow = hand.pot + p.seats.reduce((n, s) => n + (s ? s.bet : 0), 0);
  const clamp = (v: number) => (r ? Math.max(r.min, Math.min(r.max, v)) : 0);
  const [amt, setAmt] = useState(() => (r ? r.min : 0));
  useEffect(() => { setAmt(r ? r.min : 0); setOpen(false); }, [hand.id, hand.phase, r?.min, r?.max]);

  const presets: { label: string; v: number }[] = r ? [
    { label: 'Мин', v: r.min },
    { label: '½ банка', v: clamp(step10(hand.currentBet + (potNow + a.call) / 2)) },
    { label: 'Банк', v: clamp(step10(hand.currentBet + potNow + a.call)) },
    { label: 'Олл-ин', v: r.max },
  ] : [];

  const raiseNow = () => {
    if (!r) return;
    const v = clamp(step10(amt));
    if (v >= r.max) p.onAct('allin');
    else p.onAct('raise', v);
  };

  const callAllIn = !a.check && a.call > 0 && a.allin > 0 && a.call >= a.allin;   // уравнять — значит поставить всё
  const mainLabel = a.check ? 'Чек' : callAllIn ? 'Олл-ин ' + fmt(a.allin) : a.call > 0 ? 'Уравнять ' + fmt(a.call) : 'Уравнять';
  const canCall = a.check || a.call > 0;

  return (
    <div className="pk-acts" aria-label="Твой ход">
      {open && r && (
        <div className="pk-raise">
          <div className="pk-raise__pre">
            {presets.map((x) => (
              <button key={x.label} type="button" className={'pk-raise__p' + (amt === x.v ? ' is-on' : '')} onClick={() => setAmt(x.v)}>{x.label}</button>
            ))}
          </div>
          <div className="pk-raise__row">
            <input type="range" className="pk-raise__slider" min={r.min} max={r.max} step={10} value={amt}
              aria-label="Сумма ставки" onChange={(e) => setAmt(Number(e.currentTarget.value))} />
            <span className="pk-raise__amt" aria-live="polite">{amt >= r.max ? 'Олл-ин' : 'до ' + fmt(amt)}</span>
          </div>
        </div>
      )}
      <div className="pk-acts__row">
        <button type="button" className="pk-btn pk-btn--fold" disabled={p.busy} onClick={() => p.onAct('fold')}>Сбросить</button>
        {!open && (
          <button type="button" className="pk-btn pk-btn--main" disabled={p.busy || !canCall}
            onClick={() => p.onAct(a.check ? 'check' : 'call')}>{mainLabel}</button>
        )}
        {r ? (
          open
            ? <button type="button" className="pk-btn pk-btn--main pk-btn--go" disabled={p.busy} onClick={raiseNow}>{amt >= r.max ? 'Олл-ин ' + fmt(r.max) : 'Поднять до ' + fmt(amt)}</button>
            : <button type="button" className="pk-btn pk-btn--raise" disabled={p.busy} onClick={() => setOpen(true)}>Поднять</button>
        ) : a.allin > a.call && !callAllIn ? (
          <button type="button" className="pk-btn pk-btn--raise" disabled={p.busy} onClick={() => p.onAct('allin')}>Олл-ин {fmt(a.allin)}</button>
        ) : null}
        {open && <button type="button" className="pk-btn pk-btn--x" aria-label="Не поднимать" onClick={() => setOpen(false)}>✕</button>}
      </div>
    </div>
  );
}
