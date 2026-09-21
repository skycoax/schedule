// Мелкие помощники форматирования — перенос из старой страницы.

export function plural(n: number, a: string, b: string, c: string): string {
  const x = Math.abs(n) % 100, y = x % 10;
  if (x > 10 && x < 20) return c;
  if (y > 1 && y < 5) return b;
  return y === 1 ? a : c;
}

/** «08:30 – 09:50» → { a: 510, b: 590 } минут от полуночи, или null. */
export function minutesOf(range: string): { a: number; b: number } | null {
  const m = String(range || '').match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  return m ? { a: +m[1] * 60 + +m[2], b: +m[3] * 60 + +m[4] } : null;
}

/** i-я половина диапазона: hhmm('08:30 – 09:50', 0) → '08:30'. */
export function hhmm(range: string, i: number): string {
  return (String(range || '').split('–')[i] || '').trim();
}

export function dur(mins: number): string {
  const NB = ' '; // неразрывный пробел: «17 мин» не рвём
  const h = Math.floor(mins / 60), m = mins % 60;
  return (h ? h + NB + 'ч ' : '') + (m ? m + NB + 'мин' : (h ? '' : '0' + NB + 'мин'));
}

export const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const FULL: Record<string, string> = {
  'Пн': 'Понедельник', 'Вт': 'Вторник', 'Ср': 'Среда', 'Чт': 'Четверг',
  'Пт': 'Пятница', 'Сб': 'Суббота', 'Вс': 'Воскресенье',
};
export const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
