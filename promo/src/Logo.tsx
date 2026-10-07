// Знак Para (как в server/hub/icon-512.png): белая «p» и синяя дуга — она прорисовывается, как стрелка часов.
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';

const BLUE = '#0a84ff';

export const ParaMark: React.FC<{ start: number; size?: number }> = ({ start, size = 220 }) => {
  const f = useCurrentFrame() - start;
  const e = Easing.bezier(0.65, 0, 0.35, 1);
  const ring = interpolate(f, [0, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e });
  const stem = interpolate(f, [14, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e });
  const arc = interpolate(f, [24, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.1, 1) });
  const scale = interpolate(f, [0, 60], [0.92, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  // геометрия в координатах 512×512 значка
  const cx = 256, cy = 236, r = 85, sw = 40;
  const C = 2 * Math.PI * r;
  const a0 = -100, a1 = 10; // градусы, 0 — «3 часа», по часовой
  const arcLen = ((a1 - a0) / 360) * C;
  return (
    <svg width={size} height={size} viewBox="96 76 320 330" style={{ transform: `scale(${scale})`, overflow: 'visible' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fff" strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${C * ring} ${C}`} transform={`rotate(${a1} ${cx} ${cy})`} />
      <line x1={cx - r} y1={cy} x2={cx - r} y2={cy + (363 - cy) * stem} stroke="#fff" strokeWidth={sw} strokeLinecap="round"
        opacity={stem > 0 ? 1 : 0} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={BLUE} strokeWidth={sw + 1} strokeLinecap="round"
        strokeDasharray={`${arcLen * arc} ${C}`} transform={`rotate(${a0} ${cx} ${cy})`} opacity={arc > 0 ? 1 : 0} />
    </svg>
  );
};
