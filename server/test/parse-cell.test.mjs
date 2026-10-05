// Разбор ячейки расписания (server/src/parse-cell.js; в приложении — web/src/lib/parse.ts, те же правила):
// node --test server/test/parse-cell.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCell, teacherNames } from '../src/parse-cell.js';

test('аудитория с буквой корпуса («301 П ауд.», «222 П ком.») — отдельно от предмета', () => {
  assert.deepEqual(parseCell('Математика 301 П ауд. Мирзаев А.Н. асс.'), { subj: 'Математика', room: '301 П ауд.', who: 'Мирзаев А.Н. асс.' });
  assert.deepEqual(parseCell('МИиМИПиТ   222 П ком.   Хайруллина Л.Э. доц.'), { subj: 'МИиМИПиТ', room: '222 П ком.', who: 'Хайруллина Л.Э. доц.' });
  assert.deepEqual(parseCell('Макроэкономика 2 305 П ауд. Цой М.П. доц.'), { subj: 'Макроэкономика 2', room: '305 П ауд.', who: 'Цой М.П. доц.' });
  assert.deepEqual(parseCell('РЯ к И 301 П ауд. Наврузова Е.П. асс.'), { subj: 'РЯ к И', room: '301 П ауд.', who: 'Наврузова Е.П. асс.' });
});

test('прежние форматы не меняются', () => {
  assert.deepEqual(parseCell('Инф. техн. в гуман. и обр. 114 ком. Ибрагимова Н.А. доц.'),
    { subj: 'Инф. техн. в гуман. и обр', room: '114 ком.', who: 'Ибрагимова Н.А. доц.' });
  assert.deepEqual(parseCell('Химия МСЦ П 2 эт.1 каб. Рузматов И.Р. проф.'), { subj: 'Химия МСЦ П 2 эт', room: '1 каб.', who: 'Рузматов И.Р. проф.' });
  assert.deepEqual(parseCell('Физика · ауд. 1/111 · Иванов И.И.'), { subj: 'Физика', room: '1/111', who: 'Иванов И.И.' });
  assert.deepEqual(parseCell('Консультации по дисциплинам текущего семестра'), { subj: 'Консультации по дисциплинам текущего семестра', room: '', who: '' });
  assert.equal(parseCell(''), null);
});

test('преподаватель: «А..Ю.» (опечатка) — тот же «А.Ю.»', () => {
  assert.deepEqual(teacherNames('Шагаева А..Ю. доц.'), ['Шагаева А.Ю.']);
  assert.deepEqual(teacherNames('Шагаева А.Ю. доц.'), ['Шагаева А.Ю.']);
});
