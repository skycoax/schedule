// Бот шахмат для партии в приложении: ход считает bot.worker.ts в отдельном потоке. Сервер о таких партиях не знает.
export type BotLevel = 1 | 2 | 3;
export const BOT_LEVELS: { level: BotLevel; name: string }[] = [
  { level: 1, name: 'Лёгкий' },
  { level: 2, name: 'Средний' },
  { level: 3, name: 'Сложный' },
];
export const botName = (level: BotLevel): string => 'Бот · ' + (BOT_LEVELS.find((x) => x.level === level)?.name || '');

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (move: string | null) => void>();

function ensure(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; move: string | null }>) => {
    const done = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    done?.(e.data.move);
  };
  worker.onerror = () => {
    for (const done of waiting.values()) done(null);
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Ход бота в UCI ('e7e5') для позиции fen; null — ходов нет или поток не запустился. */
export function botMove(fen: string, level: BotLevel): Promise<string | null> {
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    try { ensure().postMessage({ id, fen, level }); } catch { waiting.delete(id); resolve(null); }
  });
}

/** Закрыли шахматы — поток больше не нужен. */
export function stopBot(): void {
  for (const done of waiting.values()) done(null);
  waiting.clear();
  worker?.terminate();
  worker = null;
}
