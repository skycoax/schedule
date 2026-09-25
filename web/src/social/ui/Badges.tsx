// Значки у автора и поста: «Команда Para» (синяя галочка, как «подтверждён» в Threads) и сокращение вуза («ТГЭУ»).
import type { JSX } from 'react';
import { abbrOf } from '../../lib/uni';
import './social-ui.css';

export function TeamBadge(): JSX.Element {
  return (
    <span className="badge-team" role="img" aria-label="Команда Para" title="Команда Para">
      <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path d="m8.2 12.2 2.6 2.6 5-5.2" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function UniBadge(p: { short: string }): JSX.Element {
  return <span className="badge-uni" title={p.short}>{abbrOf(p.short || '')}</span>;
}
