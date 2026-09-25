// Индикатор загрузки в духе iOS: восемь лучей по кругу.
import type { JSX } from 'react';
import './ui.css';

const RAYS = [0, 1, 2, 3, 4, 5, 6, 7];

export function Spinner(p: { size?: number }): JSX.Element {
  const size = p.size ?? 20;
  return (
    <svg className="ui-spin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {RAYS.map((i) => (
        <rect
          key={i} x="11" y="2" width="2" height="6" rx="1" fill="currentColor"
          opacity={0.25 + (i / 7) * 0.75} transform={`rotate(${i * 45 + 45} 12 12)`}
        />
      ))}
    </svg>
  );
}
