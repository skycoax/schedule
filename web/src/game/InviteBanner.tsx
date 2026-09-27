// «Алиса зовёт тебя в покер» — плашка сверху на любом экране приложения (основной бандл). «Играть» — открыть стол и
// сразу сесть; крестик — «не сейчас» (приглашение гаснет и у сервера). Сама уходит через 30 с. Пока стол открыт — не видна.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Avatar } from '../social/ui/Avatar';
import { dropInvite, useInvite } from '../social/live';
import { openGame, useGameRequest } from './entry';

const SHOW_MS = 30_000;
const LEAVE_MS = 220;

/** Сказать серверу «не сейчас» (файл API — отдельный кусок, грузится по требованию). */
function dismissOnServer(): void {
  void import('../social/api').then(({ apiCall }) => apiCall('POST', '/api/social/games/invite/dismiss', { body: {} })).catch(() => {});
}

export function InviteBanner(): JSX.Element | null {
  const inv = useInvite();
  const game = useGameRequest();
  const [leaving, setLeaving] = useState(false);

  const close = (then?: () => void) => {
    setLeaving(true);
    window.setTimeout(() => { setLeaving(false); dropInvite(); then?.(); }, LEAVE_MS);
  };

  useEffect(() => {
    if (!inv) return;
    const t = window.setTimeout(() => close(), SHOW_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv]);

  // Стол уже открыт — приглашение сделало своё.
  useEffect(() => { if (inv && game.status !== 'closed') dropInvite(); }, [inv, game.status]);

  if (!inv || game.status !== 'closed') return null;
  const name = inv.from.name;
  return (
    <div className={'gi' + (leaving ? ' is-leaving' : '')} role="status" aria-live="polite">
      <Avatar user={inv.from} size={36} />
      <div className="gi__t"><b>{name}</b><span>зовёт тебя в покер</span></div>
      <button type="button" className="gi__go" onClick={() => close(() => openGame({ sit: true }))}>Играть</button>
      <button type="button" className="gi__x" aria-label="Не сейчас" onClick={() => { dismissOnServer(); close(); }}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
