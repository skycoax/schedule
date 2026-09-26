// Форма моментов — «суперэллипс» (скруглённый квадрат с чуть выпуклыми сторонами, как Instants в Instagram).
// Маска SVG считается один раз и кладётся в --sq-mask на <html>; класс .sq в instants.css её применяет.

function superellipse(n: number, steps = 120): string {
  const pts: string[] = [];
  for (let k = 0; k < steps; k++) {
    const t = (k / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = 50 + 50 * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = 50 + 50 * Math.sign(s) * Math.abs(s) ** (2 / n);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}

const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>`
  + `<path d='${superellipse(3.4)}'/></svg>`;

let installed = false;
/** Положить маску в --sq-mask (один раз за жизнь страницы). */
export function installSquircle(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.documentElement.style.setProperty('--sq-mask', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}
