// Лист «Значок» для модератора: сетка значков (галочки, корона, сердечко…), «Без значка».
// pickBadge() открывает лист поверх всего и ждёт выбора: значок | null (убрать) | undefined (закрыли).
import { useState } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { Sheet } from '../../ui/Sheet';
import type { UserBadge } from '../types';
import { BADGES, BadgeIcon } from './Badges';
import './social-ui.css';

type Pick = UserBadge | null | undefined;

function Picker(p: { name: string; current: UserBadge | null; onDone: (v: Pick) => void }): JSX.Element {
  const [open, setOpen] = useState(true);
  const close = (v: Pick) => {
    if (!open) return;
    setOpen(false);
    p.onDone(v);
  };
  return (
    <Sheet open={open} onClose={() => close(undefined)} variant="bottom" detent="large" title="Значок" right={null}>
      <div className="bdg">
        <p className="bdg__who">{p.name}</p>
        <div className="bdg__grid" role="radiogroup" aria-label="Значок у имени">
          {BADGES.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={p.current === b.id}
              className={'bdg__opt' + (p.current === b.id ? ' is-on' : '')} onClick={() => close(b.id)}>
              <BadgeIcon id={b.id} size={30} />
              <span className="bdg__label">{b.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="bdg__none" disabled={!p.current} onClick={() => close(null)}>Без значка</button>
        <p className="bdg__note">Значок видят все рядом с именем. Он не значит, что аккаунт официальный — Para к вузам отношения не имеет.</p>
      </div>
    </Sheet>
  );
}

/** Выбор значка: значок | null — убрать | undefined — закрыли без выбора. */
export function pickBadge(o: { name: string; current: UserBadge | null }): Promise<Pick> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: Pick) => {
      resolve(v);
      // Даём листу доиграть уход.
      window.setTimeout(() => { root.unmount(); host.remove(); }, 450);
    };
    root.render(<Picker name={o.name} current={o.current} onDone={done} />);
  });
}
