// Лист выбора преподавателя: поиск по фамилии, плоский список (без разделов).
// По образцу Picker (выбор группы), чтобы выглядело единообразно.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TeacherRow } from '../api';
import { brand } from '../brand';
import { plural } from '../lib/format';

// Ищем без учёта регистра и пунктуации в имени: «иванов ии» найдёт «Иванов И.И.».
const searchKey = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export function TeacherPicker({ teachers, selected, open, first, onPick, onClose, onStudent }: {
  teachers: TeacherRow[]; selected: string | null; open: boolean; first: boolean;
  onPick: (key: string) => void; onClose: () => void; onStudent: () => void;
}) {
  const [q, setQ] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const queryKey = searchKey(q.trim());

  const shown = useMemo(
    () => (queryKey ? teachers.filter((t) => searchKey(t.name).includes(queryKey)) : teachers),
    [teachers, queryKey],
  );

  useEffect(() => { listRef.current?.scrollTo(0, 0); }, [queryKey]);

  return (
    <div className={'sheet' + (open ? ' open' : '')}>
      {first && (
        <div className="sheet__hello">
          <div className="eyebrow">{brand.label}</div>
          <div className="sheet__h">Найди себя в списке</div>
          <div className="sheet__p">Дальше приложение будет открываться сразу на твоём расписании.</div>
        </div>
      )}
      <div className="sheet__bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Фамилия преподавателя…" autoComplete="off" />
        {!first && <button className="hdr__btn" onClick={onClose}>Закрыть</button>}
      </div>

      <div className="sheet__list" ref={listRef}>
        {!teachers.length && <div className="sheet__head">Для этого вуза данных о преподавателях нет</div>}
        {!!teachers.length && !shown.length && <div className="sheet__head">Ничего не нашлось</div>}
        {shown.map((t) => (
          <button key={t.key} className={'opt' + (t.key === selected ? ' is-sel' : '')} onClick={() => onPick(t.key)}>
            <span className="opt__txt">
              <span className="opt__name">{t.name}</span>
              <span className="opt__code">{t.n} {plural(t.n, 'пара', 'пары', 'пар')} в неделю</span>
            </span>
            {t.key === selected && (
              <svg className="opt__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round" aria-label="Выбран"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            )}
          </button>
        ))}
      </div>

      <button className="sheet__switch" onClick={onStudent}>Я студент — показать группы →</button>
    </div>
  );
}
