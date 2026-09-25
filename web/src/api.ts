// Связь с нашим бэкендом. В разработке /api проксируется на localhost:8790,
// в проде — тот же домен за nginx. Один код на оба случая.
import type { Schedule, Now } from './types';
import { brand } from './brand';
import { tashkentNow } from './lib/now';

const BASE = '/api';

// На адресе Para вуз выбирает человек, поэтому сервер узнаёт его из ?uni=
// (на адресе вуза параметр не нужен: вуз и так понятен по адресу).
const UNI = brand.hub && brand.id ? 'uni=' + encodeURIComponent(brand.id) : '';
const api = (path: string) => BASE + path + (UNI ? (path.includes('?') ? '&' : '?') + UNI : '');

/** Без сети fetch падает с невнятным «Failed to fetch» — говорим по-человечески. */
async function get(path: string): Promise<Response> {
  try {
    return await fetch(api(path), { cache: 'no-store' });
  } catch {
    throw new Error(navigator.onLine ? 'Сервер не отвечает — попробуй чуть позже' : 'Нет интернета');
  }
}

/** Ответ не из сети, а сохранённый на телефоне (см. public/sw.js): когда сохранён, ISO. */
const savedAt = (res: Response) => res.headers.get('x-para-saved') || '';

/** group — ключ выбранной группы (пусто, если ещё не выбрана): пары придут только для неё. */
export async function getSchedule(group = ''): Promise<Schedule> {
  const res = await get(`/schedule?group=${encodeURIComponent(group)}`);
  if (!res.ok) throw new Error('Не удалось получить расписание');
  const d = await res.json() as Schedule;
  // В сохранённом ответе «сейчас» — на момент сохранения; считаем заново по часам телефона.
  const saved = savedAt(res);
  if (saved) { d.now = tashkentNow(); d.savedAt = saved; }
  return d;
}

/** Преподаватель в списке вуза: ключ, имя и сколько у него пар в неделю. */
export interface TeacherRow { key: string; name: string; n: number; }

export async function getTeachers(): Promise<TeacherRow[]> {
  const res = await get('/teachers');
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось получить список преподавателей');
  return json.data as TeacherRow[];
}

/** Одна пара преподавателя: время, предмет, кабинет и группы (склеены параллельные). */
export interface TeacherItem { time: string; subj: string; room: string; groups: string[]; }
export interface TeacherDay { day: string; items: TeacherItem[]; }
export interface TeacherSchedule { key: string; name: string; week: string; now: Now; days: TeacherDay[]; savedAt?: string; }

export async function getTeacher(key: string): Promise<TeacherSchedule> {
  const res = await get(`/teacher?key=${encodeURIComponent(key)}`);
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось получить расписание преподавателя');
  const d = json.data as TeacherSchedule;
  const saved = savedAt(res);
  if (saved) { d.now = tashkentNow(); d.savedAt = saved; }
  return d;
}

/** Обезличенный заход. Ошибки глотаем — аналитика не должна мешать пользователю. */
export function sendHit(fields: Record<string, string>): void {
  const qs = new URLSearchParams(fields).toString();
  // keepalive: долетит, даже если страницу тут же закрыли.
  fetch(api(`/hit?${qs}`), { method: 'POST', keepalive: true }).catch(() => {});
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
  const res = await get('/stats');
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
  const res = await get('/stats/summary');
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Ошибка');
  return json.data as Summary;
}

/** Подключённый вуз. На адресе вуза выбор — переход на url, в Para — смена вуза на месте. */
export interface University {
  id: string; short: string; university: string; url: string; logo: string;
  /** Сколько всего людей смотрело расписание этого вуза, сколько сегодня и по дням недели. */
  people: number; today: number; spark: number[];
}

export async function getUniversities(): Promise<University[]> {
  const res = await get('/universities');
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось получить список вузов');
  return json.data as University[];
}

export interface Review { ts: string; name: string; rating: number; text: string; }
/** dist — сколько оценок каждой звезды: dist[0] — единицы, dist[4] — пятёрки. */
export interface ReviewsData { average: number; count: number; dist?: number[]; items: Review[]; }

export async function getReviews(): Promise<ReviewsData> {
  const res = await get('/reviews');
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Ошибка');
  return json.data as ReviewsData;
}

/** Без регистрации: cid — тот же анонимный номер браузера, что и в аналитике. */
export async function submitReview(fields: { cid: string; name?: string; rating: number; text?: string }): Promise<void> {
  const res = await fetch(api('/reviews'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Не получилось отправить отзыв');
}
