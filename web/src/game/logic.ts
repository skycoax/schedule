// Правила «Кода» на телефоне — зеркало server/src/social/game-logic.js: оценка попытки, проверка кода,
// случайный код, значки ●○·, итог тренировки с ботом (та же settle, только без срока).
// Только стираемый TypeScript (аннотации, без enum и namespace): файл вместе с bot.ts проверяется
// через node --experimental-strip-types, поэтому и импорты — с расширением .ts.

export const ATTEMPTS = 12;
export const FAIL_SCORE = 13;
/** Буквы кода вызова: без 0/O, 1/I/L — их легко перепутать. */
export const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TOKEN_RE = /^[A-HJKMNP-Z2-9]{6}$/;

/** Четыре разные цифры 0–9, ноль впереди можно. */
export function validCode(s: string): boolean {
  return /^\d{4}$/.test(s) && new Set(s).size === 4;
}

/** on — цифра на своём месте (●), near — есть в коде, но в другом месте (○). */
export function evaluate(code: string, guess: string): { on: number; near: number } {
  let on = 0;
  let near = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === code[i]) on++;
    else if (code.includes(guess[i])) near++;
  }
  return { on, near };
}

/** Случайный код из 5040 возможных. rand — для проверок с зерном. */
export function randomCode(rand: () => number = Math.random): string {
  const d = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  let out = '';
  for (let i = 0; i < 4; i++) {
    const j = Math.floor(rand() * d.length);
    out += d[j];
    d.splice(j, 1);
  }
  return out;
}

let every: string[] | null = null;
/** Все 5040 кодов по порядку (для бота). */
export function allCodes(): string[] {
  if (every) return every;
  const out: string[] = [];
  for (let n = 0; n < 10000; n++) {
    const s = String(n).padStart(4, '0');
    if (validCode(s)) out.push(s);
  }
  every = out;
  return out;
}

/** «●●○·»: сначала на месте, потом не на месте, остальное — точки. Порядок значков о цифрах ничего не говорит. */
export function markGlyphs(on: number, near: number): string {
  const a = Math.max(0, Math.min(4, on));
  const b = Math.max(0, Math.min(4 - a, near));
  return '●'.repeat(a) + '○'.repeat(b) + '·'.repeat(4 - a - b);
}

/** «2 на месте · 2 не на месте». */
export function markWords(on: number, near: number): string {
  return on + ' на месте · ' + near + ' не на месте';
}

// ─── Итог тренировки: та же settle, что на сервере, только без срока ───

export type SideRes = 'cracked' | 'failed' | 'left' | null;
export interface Side { n: number; res: SideRes }
export interface Settled { winner: 'a' | 'b' | 'draw'; reason: 'score' | 'early' | 'left' }

/** Очки стороны: число попыток до взлома, не взломал — 13, ещё играет — null. */
export function scoreOf(s: Side): number | null {
  return s.res === 'cracked' ? s.n : s.res === 'failed' ? FAIL_SCORE : null;
}

/** Решено ли уже: оба закончили, кто-то сдался или отстающий уже не догонит (ранняя победа). null — играем дальше. */
export function settleLocal(a: Side, b: Side): Settled | null {
  if (a.res === 'left') return { winner: 'b', reason: 'left' };
  if (b.res === 'left') return { winner: 'a', reason: 'left' };
  const sa = scoreOf(a);
  const sb = scoreOf(b);
  if (sa !== null && sb !== null) return { winner: sa < sb ? 'a' : sb < sa ? 'b' : 'draw', reason: 'score' };
  if (sa !== null && sb === null && b.n >= sa) return { winner: 'a', reason: 'early' };
  if (sb !== null && sa === null && a.n >= sb) return { winner: 'b', reason: 'early' };
  return null;
}

/** Сторона после ещё одной попытки: взломал на 4 ●, не взломал за 12 — провал. */
export function afterMove(s: Side, on: number): Side {
  const n = s.n + 1;
  return { n, res: on === 4 ? 'cracked' : n >= ATTEMPTS ? 'failed' : null };
}
