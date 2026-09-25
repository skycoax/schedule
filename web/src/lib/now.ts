// «Сейчас» в Ташкенте — то же, что nowInTz() в server/src/schedule.js. Нужно без
// интернета: у сохранённого расписания «сейчас» старое, и отсчёт пошёл бы от него.
import type { Now } from '../types';

const DAY: Record<string, string> = { 'пн': 'Пн', 'вт': 'Вт', 'ср': 'Ср', 'чт': 'Чт', 'пт': 'Пт', 'сб': 'Сб', 'вс': 'Вс' };

export function tashkentNow(): Now {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Tashkent',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => (parts.find((p) => p.type === t) || { value: '' }).value;
  return {
    day: DAY[get('weekday').toLowerCase().slice(0, 2)] || 'Пн',
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    dateLabel: get('day') + '.' + get('month'),
    stamp: get('hour') + ':' + get('minute'),
  };
}
