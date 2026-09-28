// Тексты уведомлений об изменениях пар (server/src/social/push.js): node --test server/test/push.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pairChangesByGroup, schedText } from '../src/social/push.js';

const ch = (o) => ({ group: 'ИС-21', sheet: '2 курс', day: 'Вт', pair: 2, time: '10:00 – 11:20', ...o });

test('правки пар по группам: только ячейки пар, без шапки и групп целиком', () => {
  const m = pairChangesByGroup([
    { type: 'header', before: 'a', after: 'b' },
    { type: 'group_added', group: 'Новая' },
    { type: 'group_removed', group: 'Старая' },
    ch({ type: 'changed', before: 'Химия', after: 'Физика' }),
    ch({ type: 'added', group: 'ИС-22', before: '', after: 'Право' }),
    ch({ type: 'removed', day: 'Ср', before: 'История', after: '' }),
  ]);
  assert.deepEqual([...m.keys()], ['ИС-21', 'ИС-22']);
  assert.equal(m.get('ИС-21').length, 2);
  assert.equal(pairChangesByGroup(null).size, 0);
});

test('одна правка: день, пара и новое содержимое; отмена — старое и «отменена»', () => {
  assert.deepEqual(schedText([ch({ type: 'changed', before: 'Химия', after: 'Физика · ауд. 108' })]),
    { t: 'Изменения в расписании', b: 'Вт, 2-я пара: Физика · ауд. 108' });
  assert.equal(schedText([ch({ type: 'added', before: '', after: 'Право' })]).b, 'Вт, 2-я пара: Право');
  assert.equal(schedText([ch({ type: 'removed', before: 'История', after: '' })]).b, 'Вт, 2-я пара: История — отменена');
  assert.equal(schedText([ch({ type: 'changed', week: 'Неделя B', after: 'Физика' })]).b, 'Вт, 2-я пара (Неделя B): Физика');
});

test('несколько правок: «и ещё N» с правильным окончанием; длинная ячейка обрезается', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => ch({ type: 'changed', pair: i + 1, after: 'Пара ' + (i + 1) }));
  assert.equal(schedText(list(2)).b, 'Вт, 1-я пара: Пара 1\nИ ещё 1 изменение');
  assert.equal(schedText(list(3)).b.split('\n')[1], 'И ещё 2 изменения');
  assert.equal(schedText(list(6)).b.split('\n')[1], 'И ещё 5 изменений');
  assert.equal(schedText(list(12)).b.split('\n')[1], 'И ещё 11 изменений');
  assert.equal(schedText(list(22)).b.split('\n')[1], 'И ещё 21 изменение');
  const long = schedText([ch({ type: 'changed', after: 'Очень '.repeat(40) })]).b;
  assert.ok(long.endsWith('…') && [...long].length < 120, long);
});
