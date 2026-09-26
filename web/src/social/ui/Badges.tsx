// Значки у автора и поста: «Команда Para» (синяя галочка, как «подтверждён» в Threads), значок, который выдал
// модератор (галочки разных цветов, корона, сердечко, звёздочка…), и сокращение вуза («ТГЭУ»).
// У имени — один значок: выданный модератором, иначе «Команда Para» у модераторов (NameBadge).
import type { JSX } from 'react';
import { abbrOf } from '../../lib/uni';
import type { UserBadge } from '../types';
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

/** Волнистый круг «подтверждён» (как у Instagram): 10 волн по краю. */
const SEAL = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const r = 10.3 + 1.2 * Math.cos(a * 10);
    pts.push((12 + r * Math.sin(a)).toFixed(2) + ' ' + (12 - r * Math.cos(a)).toFixed(2));
  }
  return 'M' + pts.join('L') + 'Z';
})();

const seal = (
  <>
    <path d={SEAL} fill="currentColor" />
    <path d="m8.3 12.3 2.6 2.6 5-5.3" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

/** Значки, которые выдаёт модератор (id — как в server/src/social/users.js BADGES). */
export const BADGES: { id: UserBadge; label: string; color: string; icon: JSX.Element }[] = [
  { id: 'blue', label: 'Синяя галочка', color: '#1d9bf0', icon: seal },
  { id: 'gold', label: 'Золотая галочка', color: '#e9a800', icon: seal },
  { id: 'gray', label: 'Серая галочка', color: '#8e8e93', icon: seal },
  { id: 'green', label: 'Зелёная галочка', color: '#30b857', icon: seal },
  { id: 'purple', label: 'Фиолетовая галочка', color: '#a35ee8', icon: seal },
  {
    id: 'crown', label: 'Корона', color: '#f2b200',
    icon: (
      <>
        <path d="M3.2 8.2 7.7 12 12 5.2l4.3 6.8 4.5-3.8-1.9 9.2H5.1L3.2 8.2Z" fill="currentColor" strokeLinejoin="round"
          stroke="currentColor" strokeWidth="1.2" />
        <rect x="5.1" y="18.6" width="13.8" height="2.2" rx="1.1" fill="currentColor" />
      </>
    ),
  },
  {
    id: 'heart', label: 'Сердечко', color: '#ff3040',
    icon: <path d="M12 20.6s-7.6-4.6-9.3-9.4C1.5 7.8 3.6 4.4 7 4.4c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.5 3.4 4.3 6.8-1.7 4.8-9.3 9.4-9.3 9.4Z" fill="currentColor" />,
  },
  {
    id: 'star', label: 'Звёздочка', color: '#f7b500',
    icon: (
      <path d="m12 2.9 2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.1l-5.7 3.1 1.2-6.3-4.6-4.4 6.3-.8L12 2.9Z" fill="currentColor"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    ),
  },
  {
    id: 'fire', label: 'Огонь', color: '#ff6a00',
    icon: (
      <path d="M12 22c-4.1 0-7.2-2.9-7.2-6.8 0-3.1 1.9-5.3 3.7-7.1.2 1.6.9 2.8 2.2 3.5-.2-3.6 1.4-6.8 4.2-8.8.2 2.9 1.6 4.7 3.2 6.5 1.5 1.7 3.1 3.5 3.1 6.3 0 3.8-3.3 6.4-9.2 6.4Z"
        fill="currentColor" />
    ),
  },
  {
    id: 'bolt', label: 'Молния', color: '#f5c400',
    icon: <path d="M13.6 2 4.4 13.6h6.7L10 22l9.6-12.2h-6.8L13.6 2Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />,
  },
  {
    id: 'gem', label: 'Кристалл', color: '#2fa8e0',
    icon: (
      <>
        <path d="M7 3.5h10l4.6 5.6L12 21 2.4 9.1 7 3.5Z" fill="currentColor" />
        <path d="M2.6 9.1h18.8M9.3 3.6 7.6 9.1 12 20.6M14.7 3.6l1.7 5.5L12 20.6" fill="none" stroke="#fff" strokeOpacity=".5"
          strokeWidth="1.1" strokeLinejoin="round" />
      </>
    ),
  },
];

export const badgeInfo = (id: UserBadge | null | undefined) => BADGES.find((b) => b.id === id) || null;

/** Иконка значка (для листа выбора — крупнее, у имени — по размеру строки). */
export function BadgeIcon(p: { id: UserBadge; size?: number }): JSX.Element | null {
  const b = badgeInfo(p.id);
  if (!b) return null;
  return (
    <svg viewBox="0 0 24 24" width={p.size || '100%'} height={p.size || '100%'} style={{ color: b.color }} aria-hidden="true" focusable="false">
      {b.icon}
    </svg>
  );
}

/** Значок у имени: выданный модератором, иначе «Команда Para» у модераторов. */
export function NameBadge(p: { u: { team?: boolean; badge?: UserBadge | null } | null | undefined }): JSX.Element | null {
  const u = p.u;
  if (!u) return null;
  const b = badgeInfo(u.badge);
  if (b) {
    return (
      <span className="badge-team badge-user" role="img" aria-label={b.label} title={b.label}>
        <BadgeIcon id={b.id} />
      </span>
    );
  }
  return u.team ? <TeamBadge /> : null;
}

export function UniBadge(p: { short: string }): JSX.Element {
  return <span className="badge-uni" title={p.short}>{abbrOf(p.short || '')}</span>;
}
