// Лист выбора группы. Сверху чипы разделов (курсы), внутри раздела — подразделы
// по факультетам. Поиск ищет сразу по всем разделам.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group } from '../types';
import { iconSvg, iconColor } from '../lib/parse';
import { brand } from '../brand';

interface Section { sheet: string; subs: { sub: string; items: Group[] }[] }

// Студенты часто вводят код с пробелами или дефисами, хотя в EduPage он слитный:
// «BI101 A» должен находить «BI101AR».
const searchKey = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Группы → разделы (sheet) → подразделы (sub, факультет). Порядок — как пришёл с сервера.
function sectionsOf(groups: Group[]): Section[] {
  const out: Section[] = [];
  const bySheet = new Map<string, Section>();
  for (const g of groups) {
    let s = bySheet.get(g.sheet);
    if (!s) { s = { sheet: g.sheet, subs: [] }; bySheet.set(g.sheet, s); out.push(s); }
    const subName = g.sub || '';
    let sub = s.subs.find((x) => x.sub === subName);
    if (!sub) { sub = { sub: subName, items: [] }; s.subs.push(sub); }
    sub.items.push(g);
  }
  return out;
}

export function Picker({ groups, selected, open, first, onPick, onClose, onTeacher }: {
  groups: Group[]; selected: string | null; open: boolean; first: boolean;
  onPick: (key: string) => void; onClose: () => void; onTeacher?: () => void;
}) {
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const sheets = useMemo(() => [...new Set(groups.map((g) => g.sheet))], [groups]);
  const selectedSheet = groups.find((g) => g.key === selected)?.sheet || '';
  // Открываем на разделе своей группы; дальше — тот, что выбрали чипом.
  const active = sheets.includes(section) ? section : (selectedSheet || sheets[0] || '');
  const query = q.toLowerCase().trim();
  const queryKey = searchKey(query);

  const shown = useMemo(() => sectionsOf(groups.filter((g) => (query
    ? searchKey(g.name + ' ' + g.sheet + ' ' + (g.sub || '')).includes(queryKey)
    : g.sheet === active))), [groups, query, queryKey, active]);

  // Сменили раздел или запрос — список с начала.
  useEffect(() => { listRef.current?.scrollTo(0, 0); }, [active, query]);

  const option = (g: Group) => {
    const nm = g.name.replace(/^\s*\d\s*курс\s*/i, '');
    const code = (nm.match(/\d{2}\.\d{2}\.\d{2}/) || [''])[0];
    // Иконка — по названию и факультету (у ТГЭУ направление видно только в факультете).
    const hint = g.name + ' ' + (g.sub || '');
    // В поиске подразделов нет — факультет подписываем второй строкой.
    const second = code || (query ? g.sub || '' : '');
    return (
      <button key={g.key} className={'opt' + (g.key === selected ? ' is-sel' : '')} onClick={() => onPick(g.key)}>
        <span className="opt__ico" style={{ ['--c' as string]: iconColor(hint) }}
          dangerouslySetInnerHTML={{ __html: iconSvg(hint) }} />
        <span className="opt__txt">
          <span className="opt__name">{nm.replace(code, '').trim()}</span>
          {second && <span className="opt__code">{second}</span>}
        </span>
        {g.key === selected && (
          <svg className="opt__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round" aria-label="Выбрана"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        )}
      </button>
    );
  };

  return (
    <div className={'sheet' + (open ? ' open' : '')}>
      {first && (
        <div className="sheet__hello">
          <div className="eyebrow">{brand.label}</div>
          <div className="sheet__h">Выбери свою группу</div>
          <div className="sheet__p">Один раз — дальше приложение будет открываться сразу на ней.</div>
        </div>
      )}
      <div className="sheet__bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={brand.searchHint} autoComplete="off" />
        {!first && <button className="hdr__btn" onClick={onClose}>Закрыть</button>}
      </div>

      {!query && sheets.length > 1 && (
        <div className="chips" role="toolbar" aria-label="Разделы">
          {sheets.map((s) => (
            <button key={s} className="chip" aria-pressed={s === active} onClick={() => setSection(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="sheet__list" ref={listRef}>
        {!shown.length && <div className="sheet__head">Ничего не нашлось</div>}
        {shown.map((s) => (
          <div key={s.sheet}>
            {(query || sheets.length === 1) && <div className="sheet__head">{s.sheet}</div>}
            {s.subs.map((sub) => (
              <div key={sub.sub || '—'}>
                {sub.sub && (!query || s.subs.length > 1) && <div className="sheet__sub">{sub.sub}</div>}
                {sub.items.map(option)}
              </div>
            ))}
          </div>
        ))}
      </div>

      {onTeacher && <button className="sheet__switch" onClick={onTeacher}>Я преподаватель — показать пары →</button>}
    </div>
  );
}
