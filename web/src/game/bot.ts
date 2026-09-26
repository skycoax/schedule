// Бот Para для тренировки: после каждой попытки человека делает одну свою. Первая попытка — случайная,
// дальше — случайный код, который согласуется с ответами только на последние BOT_K попыток (и не повтор).
// Короткая память делает его человечнее: в среднем 6,5–8,5 попытки (проверка — web/src/game/bot.ts через
// node --experimental-strip-types, 2000 игр). Играет только на телефоне, на сервер ничего не уходит.
// Только стираемый TypeScript: аннотации, без enum и namespace.
import { allCodes, evaluate, randomCode } from './logic.ts';

export const BOT_K = 3;

export interface BotMove { g: string; on: number; near: number }

/** Следующая попытка бота по своим прошлым попыткам и ответам на них. */
export function botGuess(moves: readonly BotMove[], rand: () => number = Math.random, k: number = BOT_K): string {
  if (!moves.length) return randomCode(rand);
  const tried = new Set(moves.map((m) => m.g));
  const recent = moves.slice(-k);
  const fits: string[] = [];
  for (const c of allCodes()) {
    if (tried.has(c)) continue;
    let ok = true;
    for (const m of recent) {
      const e = evaluate(c, m.g);
      if (e.on !== m.on || e.near !== m.near) { ok = false; break; }
    }
    if (ok) fits.push(c);
  }
  // Загаданный код всегда подходит, так что пусто не бывает; на всякий случай — любой новый.
  if (!fits.length) {
    let g = randomCode(rand);
    while (tried.has(g)) g = randomCode(rand);
    return g;
  }
  return fits[Math.floor(rand() * fits.length)];
}
