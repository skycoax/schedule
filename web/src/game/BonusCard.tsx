// Ежедневный бонус — «момент награды»: карточка посреди стола, семь дней серии (прошедшие — закрашены, сегодняшний
// светится), большое «+500» и «Забрать». Забрал — число вспыхивает, из карточки вылетают фишки к твоему счёту,
// ниже — «Завтра: +600». Сама закрывается; «Позже» — закрыть без награды (её можно забрать из меню «…»).
import { useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { useLayer } from '../ui/layers';
import { reducedMotion } from '../social/instants/motion';
import type { PokerBonus } from '../social/types';
import { chips as fmt } from './logic';
import { buzz, flyChips, useTween } from './fx';

export const BONUS_DAYS = [500, 600, 700, 800, 900, 1000, 1200];

/** «через 5 ч 12 мин» / «через 12 мин» до полуночи по Ташкенту. */
export function untilReset(resetAt: number, now: number): string {
  const ms = Math.max(0, resetAt - now);
  const h = Math.floor(ms / 3600e3);
  const m = Math.max(1, Math.ceil((ms % 3600e3) / 60e3));
  return h > 0 ? 'через ' + h + ' ч ' + m + ' мин' : 'через ' + m + ' мин';
}

export function BonusCard(p: {
  bonus: PokerBonus; busy: boolean; target: () => Element | null;
  onClaim: () => Promise<number | null>; onClose: () => void;
}): JSX.Element {
  const b = p.bonus;
  const [got, setGot] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const shown = useTween(got ?? b.amount, 700);
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(p.onClose, reducedMotion() ? 0 : 240);
  };
  useLayer(true, close, 'game-bonus');

  // Какой день серии сейчас: забирая сегодня, продолжаешь серию (streak — дней подряд до вчера включительно).
  const day = Math.min(7, (got !== null ? b.streak : b.streak + 1) || 1);

  const claim = async () => {
    if (got !== null || p.busy) return;
    const n = await p.onClaim();
    if (n === null) return;
    setGot(n);
    buzz(24);
    const root = card.current?.closest('.pk-root') as HTMLElement | null;
    void flyChips(root, card.current?.querySelector('.pk-bonus__amt') || null, p.target(), n * 4);
    window.setTimeout(close, reducedMotion() ? 900 : 1900);
  };

  return (
    <div className={'pk-bonus' + (leaving ? ' is-leaving' : '')} role="dialog" aria-modal="true" aria-label="Ежедневный бонус"
      onClick={(e) => { if (e.target === e.currentTarget && got === null) close(); }}>
      <div ref={card} className={'pk-bonus__card' + (got !== null ? ' is-got' : '')}>
        <div className="pk-bonus__rays" aria-hidden="true" />
        <p className="pk-bonus__t">Ежедневный бонус</p>
        <div className="pk-bonus__amt" aria-live="polite"><i className="pk-chip pk-chip--big" />+{fmt(shown)}</div>
        <ol className="pk-bonus__days" aria-label={'День серии: ' + day + ' из 7'}>
          {BONUS_DAYS.map((v, i) => {
            const n = i + 1;
            const cls = n < day ? 'is-past' : n === day ? 'is-now' : '';
            return (
              <li key={n} className={'pk-bonus__d ' + cls} style={{ '--i': i } as CSSProperties}>
                <span className="pk-bonus__dot">{n < day || (n === day && got !== null) ? '✓' : n}</span>
                <span className="pk-bonus__v">{v >= 1000 ? v / 1000 + 'K' : v}</span>
              </li>
            );
          })}
        </ol>
        {got === null ? (
          <>
            <p className="pk-bonus__s">
              {b.streak > 0 ? 'Серия ' + b.streak + ' ' + dayWord(b.streak) + ' подряд — завтра будет ещё больше' : 'Заходи каждый день — бонус растёт'}
            </p>
            <button type="button" className="pk-btn pk-btn--main pk-bonus__go" disabled={p.busy} onClick={() => void claim()}>
              Забрать +{fmt(b.amount)}
            </button>
            <button type="button" className="pk-bonus__later" onClick={close}>Позже</button>
          </>
        ) : (
          <p className="pk-bonus__s is-done">Завтра: +{fmt(b.tomorrow)} · не пропусти день</p>
        )}
      </div>
    </div>
  );
}

const dayWord = (n: number): string => {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return 'день';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'дня';
  return 'дней';
};
