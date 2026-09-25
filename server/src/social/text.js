// Текст от людей: очистка, длина в графемах, ссылки, маскировка мата (backend.md §4.3, §7.3).
// Мат маскируется только при выдаче («п•••»): в базе — как написал автор, модератор видит оригинал.

// Управляющие символы, невидимые пробелы и переключатели направления текста (ZWJ U+200D оставляем: эмодзи).
const STRIP = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Очистка текста перед проверкой длины и сохранением. multiline:false — одна строка (имя, заметка). */
export function cleanText(v, { multiline = true, maxLines = 30 } = {}) {
  let t = String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(STRIP, '');
  t = t.replace(/(\p{M}{3})\p{M}+/gu, '$1');                 // «залго»: не больше 3 диакритик подряд
  if (!multiline) t = t.replace(/\s+/g, ' ');
  t = t.replace(/[ ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const lines = t.split('\n');
  if (lines.length > maxLines) t = lines.slice(0, maxLines).join('\n');
  return t;
}

// Длина «как видит человек»: графемы (👨‍👩‍👧 = 1, «й» = 1). Тот же подсчёт — в счётчике на фронте.
const SEG = new Intl.Segmenter('ru', { granularity: 'grapheme' });
export const graphemes = (s) => { let n = 0; for (const _ of SEG.segment(String(s))) n++; return n; };
/** Длиннее max графем или больше 4·max единиц UTF-16 (жёсткий предел против мусора). */
export const tooLong = (s, max) => String(s).length > max * 4 || graphemes(s) > max;
export const lineCount = (s) => (String(s) ? String(s).split('\n').length : 0);

const LINKS = /\bhttps?:\/\/|\bwww\.|\bt\.me\//gi;
export const countLinks = (s) => (String(s).match(LINKS) || []).length;

/** Для поиска по имени: нижний регистр по-русски, ё → е. */
export const fold = (s) => String(s || '').toLocaleLowerCase('ru').replace(/ё/g, 'е');

// ─── Мат ───
// Корни (начало слова) и точные слова: ru, uz (латиница и кириллица), en.
const PREFIX = ['хуй', 'хуе', 'хуя', 'хуи', 'хуев', 'пизд', 'ебан', 'ебал', 'ебат', 'ебуч', 'ебну', 'ебл', 'ебаш', 'бляд', 'блят',
  'мудак', 'мудил', 'пидор', 'пидар', 'пидр', 'гандон', 'шлюх', 'залуп', 'дроч', 'долбоеб', 'заеб', 'наеб', 'выеб', 'поеб', 'уеб',
  'съеб', 'разъеб', 'отъеб', 'въеб', 'сучар', 'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'motherf', 'nigg', 'faggot', 'jalab',
  'qotaq', "qo'taq", 'dalbayob', 'dolbayob', 'qanjiq', 'sikam', 'sikay', 'sikdim', 'sikish', 'sikib', 'blyat', 'nahuy', 'pidor',
  'suchka', 'жалаб', 'қотақ', 'котак', 'қанжиқ', 'сикам', 'сикай', 'сикиш', 'далбаеб'];
const EXACT = ['бля', 'сука', 'суки', 'суку', 'сукой', 'сучка', 'нахуй', 'похуй', 'suka', 'xuy', 'huy'];

const CYR = /[Ѐ-ӿ]/;
// Латинские буквы, похожие на кириллицу: «сyка», «xyй» (только если в слове уже есть кириллица).
const LOOKALIKE = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н', 3: 'з', 0: 'о', z: 'з' };

function base(tok) {
  let t = String(tok).toLowerCase().replace(/ё/g, 'е').replace(/[ʻ‘’`]/g, "'");
  if (CYR.test(t)) t = t.replace(/[aeopcxykmtbh30z]/g, (ch) => LOOKALIKE[ch]);
  return t;
}
// «хуууй» → «хуй»: повторы сворачиваем. Слова, где в самом корне двойная буква (asshole, nigg…),
// сравниваем с повторами, урезанными до двух, — иначе «nig» совпало бы с «night».
const collapse = (s) => s.replace(/(.)\1+/gu, '$1');
const collapse2 = (s) => s.replace(/(.)\1{2,}/gu, '$1$1');

const RULES = [
  ...PREFIX.map((w) => ({ w: base(w), prefix: true })),
  ...EXACT.map((w) => ({ w: base(w), prefix: false })),
].map((r) => ({ ...r, single: collapse(r.w) === r.w, cw: collapse(r.w) }));

/** Одно слово — мат? */
export function isProfane(word) {
  const t = base(word);
  if (!t) return false;
  const c1 = collapse(t);
  const c2 = collapse2(t);
  for (const r of RULES) {
    const s = r.single ? c1 : c2;
    if (r.prefix ? s.startsWith(r.w) : s === r.w) return true;
  }
  return false;
}

const TOKEN = /[\p{L}\p{M}\p{N}'ʻ‘’`]+/gu;
/** Маскировка мата при выдаче: слово → первая буква + «•••». */
export function maskProfanity(s) {
  const text = String(s ?? '');
  if (!text) return text;
  return text.replace(TOKEN, (tok) => (isProfane(tok) ? Array.from(tok)[0] + '•••' : tok));
}
