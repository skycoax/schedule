// Связь с нашим бэкендом. В разработке /api проксируется на localhost:8790,
// в проде — тот же домен за nginx. Один код на оба случая.
import type { Schedule, Now } from './types';

const BASE = '/api';

/** group — ключ выбранной группы (пусто, если ещё не выбрана): пары придут только для неё. */
export async function getSchedule(group = ''): Promise<Schedule> {
  const res = await fetch(`${BASE}/schedule?group=${encodeURIComponent(group)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось получить расписание');
  return res.json();
}

/** Преподаватель в списке вуза: ключ, имя и сколько у него пар в неделю. */
export interface TeacherRow { key: string; name: string; n: number; }

export async function getTeachers(): Promise<TeacherRow[]> {
  const res = await fetch(`${BASE}/teachers`, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось получить список преподавателей');
  return json.data as TeacherRow[];
}

/** Одна пара преподавателя: время, предмет, кабинет и группы (склеены параллельные). */
export interface TeacherItem { time: string; subj: string; room: string; groups: string[]; }
export interface TeacherDay { day: string; items: TeacherItem[]; }
export interface TeacherSchedule { key: string; name: string; week: string; now: Now; days: TeacherDay[]; }

export async function getTeacher(key: string): Promise<TeacherSchedule> {
  const res = await fetch(`${BASE}/teacher?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось получить расписание преподавателя');
  return json.data as TeacherSchedule;
}

/** Обезличенный заход. Ошибки глотаем — аналитика не должна мешать пользователю. */
export function sendHit(fields: Record<string, string>): void {
  const qs = new URLSearchParams(fields).toString();
  // keepalive: долетит, даже если страницу тут же закрыли.
  fetch(`${BASE}/hit?${qs}`, { method: 'POST', keepalive: true }).catch(() => {});
}

/** Строка списка: название и сколько людей. */
export interface Row { name: string; n: number; }

export interface Stats {
  updated: string;
  total: number;
  uniquePeople: number;
  todayHits: number;
  todayUsers: number;
  todayNew: number;
  /** Сколько людей заходили хотя бы в два разных дня. */
  returning: number;
  trend: { date: string; hits: number; users: number; newUsers: number }[];
  /** Заходы по часам суток (Ташкент), все 24 часа. */
  byHour: { h: number; n: number }[];
  bySource: Row[];
  byDevice: Row[];
  byBrand: Row[];
  byModel: Row[];
  byGroup: Row[];
  byBrowser: Row[];
  byOs: Row[];
  byLang: Row[];
}

/** Статистика открыта всем — без пароля, данные обезличены. */
export async function getStats(): Promise<Stats> {
  const res = await fetch(`${BASE}/stats`, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Ошибка');
  return json.data as Stats;
}

export interface Summary {
  todayUsers: number;
  todayNew: number;
  uniquePeople: number;
  trend: { date: string; hits: number; users: number }[];
}

/** Короткая сводка для блока на главном экране. */
export async function getSummary(): Promise<Summary> {
  const res = await fetch(`${BASE}/stats/summary`, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Ошибка');
  return json.data as Summary;
}

/** Подключённый вуз: у каждого свой адрес, выбор вуза — переход на него. */
export interface University { id: string; short: string; university: string; url: string; logo: string; }

export async function getUniversities(): Promise<University[]> {
  const res = await fetch(`${BASE}/universities`, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось получить список вузов');
  return json.data as University[];
}

export interface Review { ts: string; name: string; rating: number; text: string; }
/** dist — сколько оценок каждой звезды: dist[0] — единицы, dist[4] — пятёрки. */
export interface ReviewsData { average: number; count: number; dist?: number[]; items: Review[]; }

export async function getReviews(): Promise<ReviewsData> {
  const res = await fetch(`${BASE}/reviews`, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Ошибка');
  return json.data as ReviewsData;
}

/** Без регистрации: cid — тот же анонимный номер браузера, что и в аналитике. */
export async function submitReview(fields: { cid: string; name?: string; rating: number; text?: string }): Promise<void> {
  const res = await fetch(`${BASE}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Не получилось отправить отзыв');
}
