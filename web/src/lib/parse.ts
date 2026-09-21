// Разбор ячейки расписания, цвета предметов и иконки направлений.
// Перенос из старой страницы. \b в JS не знает кириллицы — границы слов явные.
import type { Group, Day } from '../types';

export interface CellInfo { subj: string; room: string; who: string; }

const ROOM_RE = /^(.*?)(\d{1,4}\s*(?:ауд|аудитория|ком|каб|зал)(?![А-Яа-яЁё])\.?(?:\s*[A-Z]{2,5}(?![a-zA-Z]))?)\s*(.*)$/i;
const WHO_RE = /(?:(?:проф|доц|асс|ст\.\s*пр|преп)\.?\s*[А-ЯЁ][а-яё]+|[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.)/;

export function parseCell(txt: string): CellInfo | null {
  let t = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const link = t.match(/https?:\/\/\S+/);
  if (link) t = t.replace(link[0], '').trim();
  if (!t) return null;

  // Формат EduPage-источника: «Предмет · ауд. 1/111 · Преподаватель» — части явные,
  // угадывать регулярками не нужно. В ячейках таблицы КФУ « · » не встречается.
  if (t.includes(' · ')) {
    const parts = t.split(' · ').map((s) => s.trim()).filter(Boolean);
    const out: CellInfo = { subj: parts[0] || '', room: '', who: '' };
    parts.slice(1).forEach((p) => {
      if (/^ауд\.\s*/i.test(p)) out.room = p.replace(/^ауд\.\s*/i, '');
      else out.who = out.who ? out.who + ', ' + p : p;
    });
    return out.subj ? out : null;
  }

  let subj = t, room = '', who = '';
  const m = t.match(ROOM_RE);
  if (m && m[1].trim()) { subj = m[1].trim(); room = m[2].trim(); who = m[3].trim(); }
  if (!who) {
    const w = subj.match(WHO_RE);
    if (w && w.index !== undefined && w.index > 0) {
      who = subj.slice(w.index).trim();
      subj = subj.slice(0, w.index).trim();
    }
  }
  return {
    subj: subj.replace(/[,.\s]+$/, ''),
    room,
    who: who.replace(/^[,\s]+/, ''),
  };
}

export function pairsOf(g: Group, day: string): string[] {
  const f = (g.days || []).find((x: Day) => x.day === day);
  return f ? f.pairs : [];
}

/** Сколько пар в дне: у КФУ 6, у ТГЭУ 8 — берём из расписания звонков группы. */
export function pairCount(g: Group): number {
  return Math.max((g.times || []).length, ...(g.days || []).map((d) => (d.pairs || []).length), 0);
}

// ─── Цвет предмета: закреплён на неделю, раздаём по порядку первой встречи ───
export interface Subject { key: string; name: string; n: number; color: string; }
export interface Colors { colorOf: (subj: string) => string; subjects: Subject[]; }

const DAYS6 = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
function subjKey(s: string): string {
  return String(s || '').toLowerCase().replace(/[^а-яёa-z]/g, '');
}

export function buildColors(g: Group): Colors {
  const map: Record<string, string> = {};
  const seen: Record<string, Subject> = {};
  const subjects: Subject[] = [];
  DAYS6.forEach((d) => {
    pairsOf(g, d).forEach((cell) => {
      const info = parseCell(cell);
      if (!info) return;
      const k = subjKey(info.subj);
      if (!k) return;
      if (!seen[k]) { seen[k] = { key: k, name: info.subj, n: 0, color: '' }; subjects.push(seen[k]); }
      seen[k].n++;
    });
  });
  subjects.forEach((s, i) => { s.color = 'var(--c' + (i % 8 + 1) + ')'; map[s.key] = s.color; });
  return {
    colorOf: (subj: string) => map[subjKey(subj)] || 'var(--ink-30)',
    subjects,
  };
}

// ─── Иконки направлений ───
const ICONS: Record<string, string> = {
  geo: '<path d="M12 3 2.6 8 12 13l9.4-5L12 3Z"/><path d="M2.6 13 12 18l9.4-5"/>',
  it: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10.5 10.5h3v3h-3z"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  econ: '<path d="M3 20h18"/><path d="M6 20v-6M11 20V8M16 20v-9"/><path d="m5 9 5-4 4 3 5-5"/>',
  ling: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>',
  media: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  auto: '<path d="M3.5 18a9 9 0 1 1 17 0"/><path d="m12 14.2 4.6-4.6"/><circle cx="12" cy="15.8" r="1.4"/>',
  med: '<path d="M3 12h3.5l2-5 3.5 10 2.5-5H21"/>',
  dent: '<path d="M12 3.2c-1.6 0-2.6-1-4.4-.4C5.5 3.5 4 5.6 4.4 9c.5 3.4 1.3 12 3.2 12 1.6 0 1.2-6 4.4-6s2.8 6 4.4 6c1.9 0 2.7-8.6 3.2-12 .4-3.4-1.1-5.5-3.2-6.2-1.8-.6-2.8.4-4.4.4Z"/>',
  pharm: '<path d="M9.5 3h5"/><path d="M10.5 3v6L5.6 18.6A2 2 0 0 0 7.4 21.5h9.2a2 2 0 0 0 1.8-2.9L13.5 9V3"/><path d="M7.6 15h8.8"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M20 18.5H6.5"/>',
};
const ICO_COLOR: Record<string, string> = {
  geo: '--c2', it: '--c1', econ: '--c7', ling: '--c5', media: '--c6',
  auto: '--c8', med: '--c4', dent: '--c1', pharm: '--c3', book: '--c7',
};

export function iconKey(name: string): string {
  const s = String(name || '').toLowerCase();
  if (/геолог/.test(s)) return 'geo';
  if (/информац|программ|систем и техн|raqamli|axborot|kompyuter/.test(s)) return 'it';
  // Узбекские названия факультетов ТГЭУ: менеджмент, экономика, финансы, банк, учёт, налоги.
  if (/эконом|менедж|финанс|menejment|iqtisod|moliya|bank|buxgalter|soliq|audit|marketing|biznes/.test(s)) return 'econ';
  if (/лингвист|филолог|перевод|turizm/.test(s)) return 'ling';
  if (/журналист|медиа/.test(s)) return 'media';
  if (/автоматиз|мехатрон|инженер/.test(s)) return 'auto';
  if (/стоматолог/.test(s)) return 'dent';
  if (/фармац/.test(s)) return 'pharm';
  if (/лечебн|медиц|биохим|педиатр|сестрин/.test(s)) return 'med';
  return 'book';
}
export function iconColor(name: string): string {
  return 'var(' + (ICO_COLOR[iconKey(name)] || '--c1') + ')';
}
export function iconSvg(name: string): string {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round">' + ICONS[iconKey(name)] + '</svg>';
}

// ─── Состояние пары относительно «сейчас» ───
export type PairState = '' | 'past' | 'live';
export function pairState(g: Group, i: number, day: string, nowDay: string, nowMin: number): PairState {
  if (day !== nowDay) return '';
  const mm = minutesRange((g.times || [])[i]);
  if (!mm) return '';
  return nowMin >= mm.b ? 'past' : (nowMin >= mm.a ? 'live' : '');
}

// локальная копия minutesOf, чтобы parse не зависел от format
function minutesRange(range: string): { a: number; b: number } | null {
  const m = String(range || '').match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  return m ? { a: +m[1] * 60 + +m[2], b: +m[3] * 60 + +m[4] } : null;
}
