// Значки у автора и поста: «Команда Para» и сокращение вуза («ТГЭУ»).
import type { JSX } from 'react';
import { abbrOf } from '../../lib/uni';
import './social-ui.css';

export function TeamBadge(): JSX.Element {
  return <span className="badge-team">Команда Para</span>;
}

export function UniBadge(p: { short: string }): JSX.Element {
  return <span className="badge-uni" title={p.short}>{abbrOf(p.short || '')}</span>;
}
