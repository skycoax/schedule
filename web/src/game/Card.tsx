// Игральная карта: тёмная, простая — тонкая светлая рамка, лёгкий глянец и глубокая тень. Рубашка — тонкая штриховка.
// Переворачивается (3D), прилетает из колоды (deal), уходит в сброс (muck). На сильной руке «тлеет»: бегущий по краю
// свет и угольки; на очень сильной — ещё и искры. Победившая пятёрка на вскрытии подсвечивается, остальные гаснут.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { isRed, rankText } from './logic';

export type CardSize = 'sm' | 'md' | 'lg';
const DEAL_MS = 560;

const SUIT_PATH: Record<string, string> = {
  s: 'M12 2C9.2 6.6 3.6 9.2 3.6 13.6c0 2.5 1.9 4.4 4.3 4.4 1.5 0 2.7-.7 3.4-1.7-.1 2-.9 3.6-2.4 4.9h6.2c-1.5-1.3-2.3-2.9-2.4-4.9.7 1 1.9 1.7 3.4 1.7 2.4 0 4.3-1.9 4.3-4.4C20.4 9.2 14.8 6.6 12 2Z',
  h: 'M12 21.2S3.2 15.9 2.4 10.2C2 7.4 4 5 6.7 5c2.1 0 3.8 1.2 5.3 3.1C13.5 6.2 15.2 5 17.3 5 20 5 22 7.4 21.6 10.2 20.8 15.9 12 21.2 12 21.2Z',
  d: 'M12 2.2 20.2 12 12 21.8 3.8 12Z',
  c: 'M12 2.4a4.1 4.1 0 0 0-3.4 6.4A4.2 4.2 0 1 0 10 15.5c.3 2.2-.5 4-2.1 5.5h8.2c-1.6-1.5-2.4-3.3-2.1-5.5a4.2 4.2 0 1 0 1.4-6.7A4.1 4.1 0 0 0 12 2.4Z',
};

export function Suit(p: { s: string; className?: string }): JSX.Element {
  return (
    <svg className={p.className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={SUIT_PATH[p.s] || SUIT_PATH.s} fill="currentColor" />
    </svg>
  );
}

const SUIT_NAME: Record<string, string> = { s: 'пики', h: 'червы', d: 'бубны', c: 'трефы' };
const RANK_NAME: Record<string, string> = {
  A: 'туз', K: 'король', Q: 'дама', J: 'валет', T: 'десятка', 9: 'девятка', 8: 'восьмёрка', 7: 'семёрка',
  6: 'шестёрка', 5: 'пятёрка', 4: 'четвёрка', 3: 'тройка', 2: 'двойка',
};
export const cardLabel = (c: string): string => (c === '?' || c.length !== 2 ? 'закрытая карта' : RANK_NAME[c[0]] + ' ' + SUIT_NAME[c[1]]);

export function PlayingCard(p: {
  card: string;                 // 'As' или '?' (рубашка)
  size: CardSize;
  up?: boolean;                 // лицом вверх (переворот анимируется)
  /** Прилететь из этого элемента (колода) при появлении; delay — задержка полёта, мс. */
  from?: Element | null; delay?: number;
  /** Переворот лицом: мс после приземления (может быть меньше нуля — ещё в полёте); для уже лежащей карты — просто задержка. */
  flipDelay?: number;
  heat?: 0 | 1 | 2;
  win?: boolean; dim?: boolean; muck?: boolean;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const face = p.card !== '?' && p.card.length === 2;
  const wantUp = !!p.up && face;
  // Переворот — переход CSS, а он не играет при первой отрисовке: карта появляется рубашкой и переворачивается
  // чуть позже (после приземления, если летела из колоды).
  const mounted = useRef(performance.now());
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (!wantUp) { setUp(false); return; }
    const landing = mounted.current + (p.from ? (p.delay || 0) + DEAL_MS : 0);
    const now = performance.now();
    const fd = p.flipDelay || 0;
    const wait = now < landing ? Math.max(0, landing - now + fd) : Math.max(0, fd);
    const t = window.setTimeout(() => setUp(true), wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantUp]);

  // Откуда лететь — считаем до первой отрисовки: из центра колоды в свой центр.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !p.from) return;
    const a = p.from.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    el.style.setProperty('--dx', (a.left + a.width / 2 - (b.left + b.width / 2)).toFixed(1) + 'px');
    el.style.setProperty('--dy', (a.top + a.height / 2 - (b.top + b.height / 2)).toFixed(1) + 'px');
    el.classList.add('is-deal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = { '--d': (p.delay || 0) + 'ms' } as CSSProperties;
  const cls = ['pc', 'pc--' + p.size, up ? 'is-up' : '', p.heat ? 'is-hot' : '', p.heat === 2 ? 'is-fire' : '',
    p.win ? 'is-win' : '', p.dim ? 'is-dim' : '', p.muck ? 'is-muck' : '', p.className || ''].filter(Boolean).join(' ');
  const red = face && isRed(p.card);
  return (
    <div ref={ref} className={cls} style={style} role="img" aria-label={up ? cardLabel(p.card) : 'закрытая карта'}>
      {p.heat ? <span className="pc__ring" aria-hidden="true"><i /></span> : null}
      <div className="pc__in">
        <div className="pc__f pc__back" />
        {face && (
          <div className={'pc__f pc__face' + (red ? ' is-red' : '')}>
            <span className="pc__r">{rankText(p.card)}<Suit s={p.card[1]} className="pc__s" /></span>
            <Suit s={p.card[1]} className="pc__big" />
            <span className="pc__r pc__r--b">{rankText(p.card)}<Suit s={p.card[1]} className="pc__s" /></span>
          </div>
        )}
      </div>
      {p.heat ? (
        <span className="pc__fx" aria-hidden="true">
          <i className="pc__ember" style={{ '--i': 0 } as CSSProperties} />
          <i className="pc__ember" style={{ '--i': 1 } as CSSProperties} />
          <i className="pc__ember" style={{ '--i': 2 } as CSSProperties} />
          <i className="pc__ember" style={{ '--i': 3 } as CSSProperties} />
          {p.heat === 2 && <><b className="pc__spark" style={{ '--i': 0 } as CSSProperties} /><b className="pc__spark" style={{ '--i': 1 } as CSSProperties} /><b className="pc__spark" style={{ '--i': 2 } as CSSProperties} /></>}
        </span>
      ) : null}
    </div>
  );
}
