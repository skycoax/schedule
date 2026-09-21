// Серверный разбор ячейки расписания — держать в паре с web/src/lib/parse.ts.
// В браузере это parse.ts (для карточек студента); на сервере та же логика нужна
// индексу преподавателей (teachers.js), где полное расписание всех групп есть только тут.
// \b в JS не знает кириллицы — границы слов задаём явно, как в оригинале.

const ROOM_RE = /^(.*?)(\d{1,4}\s*(?:ауд|аудитория|ком|каб|зал)(?![А-Яа-яЁё])\.?(?:\s*[A-Z]{2,5}(?![a-zA-Z]))?)\s*(.*)$/i;
const WHO_RE = /(?:(?:проф|доц|асс|ст\.\s*пр|преп)\.?\s*[А-ЯЁ][а-яё]+|[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.)/;

/** Ячейка → { subj, room, who } или null для пустой. Тот же алгоритм, что в parse.ts. */
export function parseCell(txt) {
  let t = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const link = t.match(/https?:\/\/\S+/);
  if (link) t = t.replace(link[0], '').trim();
  if (!t) return null;

  // Формат EduPage: «Предмет · ауд. 1/111 · Преподаватель» — части явные.
  if (t.includes(' · ')) {
    const parts = t.split(' · ').map((s) => s.trim()).filter(Boolean);
    const out = { subj: parts[0] || '', room: '', who: '' };
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

/** «08:30 – 09:50» → { a: минуты начала, b: минуты конца } или null. */
export function minutesRange(range) {
  const m = String(range || '').match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  return m ? { a: +m[1] * 60 + +m[2], b: +m[3] * 60 + +m[4] } : null;
}
