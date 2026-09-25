// Формы данных, которые отдаёт бэкенд (/api/schedule). Держать в паре с server/.

export interface Day {
  day: string;        // 'Пн'..'Вс'
  pairs: string[];    // ячейки по парам (у КФУ 6, у ТГЭУ 8), сырой текст пары
}

// В лёгком ответе (/api/schedule?group=…) у невыбранных групп times и days пустые.
export interface Group {
  key: string;        // уникальный ключ группы
  sheet: string;      // раздел в списке: «1 курс», «Магистратура · 2 курс»
  course: string;     // цифра курса, если есть
  name: string;       // «1 курс Геология 05.03.01», «MO-900/26»
  sub?: string;       // вторая строка в списке — факультет (у EduPage-вуза)
  link: string;       // ссылка на телемост, если есть
  times: string[];    // диапазоны времени «08:30 – 09:50», по одному на пару
  days: Day[];
  /** Совместные пары (только у выбранной группы): 'Пн#3' → другие группы в той же
   *  аудитории в то же время. Номер пары с 1, как в журнале правок. server/src/together.js */
  with?: Record<string, string[]>;
}

export interface ChangeItem {
  type: 'header' | 'added' | 'removed' | 'changed' | 'group_added' | 'group_removed' | 'link';
  group?: string;
  sheet?: string;
  day?: string;
  pair?: number;
  time?: string;
  week?: string;      // «Неделя A», если пары чередуются по неделям
  before?: string;
  after?: string;
}

export interface ChangeEntry {
  ts: string;
  changes: ChangeItem[];
}

export interface Now {
  day: string;
  minutes: number;
  dateLabel: string;  // 'd.MM'
  stamp: string;      // 'HH:mm'
}

export interface Schedule {
  header: string;
  groups: Group[];
  changes: ChangeEntry[];
  now: Now;
  fetchedAt: string | null;
  ready: boolean;
  week?: string;      // «Неделя B» — какая неделя сейчас показана (если чередуются)
  /** Не из сети, а сохранённое на телефоне (нет интернета): когда сохранено, ISO. */
  savedAt?: string;
}
