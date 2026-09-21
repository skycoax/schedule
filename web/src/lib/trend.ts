// Дни до самого первого захода — это не «тишина», приложения тогда просто не было.
// Отрезаем их, иначе график выглядит как ноль-ноль-ноль и внезапный скачок.
export function fromFirstVisit<T extends { users: number }>(trend: T[]): T[] {
  const first = trend.findIndex((p) => p.users > 0);
  if (first < 0) return trend;
  return trend.slice(Math.min(first, Math.max(0, trend.length - 2)));
}

/** Точка ломаной в координатах SVG. */
export interface Pt { x: number; y: number; }

// Сглаженная линия через точки (Catmull-Rom → кубический Безье) — тот же
// изгиб, что у recharts с type="monotone", только без самой библиотеки:
// для маленького силуэта на главном экране тянуть ~190 КБ recharts незачем.
export function smoothPath(pts: Pt[]): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${p[1].x.toFixed(2)} ${p[1].y.toFixed(2)}`;
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}
