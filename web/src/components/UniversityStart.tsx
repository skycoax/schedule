// Первый экран Para: в каком ты вузе. У каждого вуза своя эмблема и видно, сколько
// людей уже смотрит его расписание (столбики — по дням). Выбор — переход на /?uni=<id>:
// сервер отдаст страницу уже с расписанием этого вуза, дальше — обычный первый запуск
// (согласие, роль, группа). Сама Para остаётся нейтральной: эмблемы — только здесь.
// Ссылка внутрь приложения (?user=…, ?tab=profile&delete=1, #auth=…), открытая без выбранного вуза,
// едет дальше вместе с выбором (openUni) — над списком об этом напоминает строка «Выбери вуз…».
// Внизу — обычные ссылки на политику и правила: их ищут Google (проверка входа) и Play.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getUniversities, type University } from '../api';
import { useTheme } from '../hooks/useTheme';
import { colorOf, openUni, pendingDeepLink } from '../lib/uni';
import { plural } from '../lib/format';
import { hideBoot } from '../lib/boot';
import { Spark } from './Spark';

const searchKey = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const num = (n: number) => n.toLocaleString('ru-RU');

// Ссылки мелким текстом, но с областью нажатия 44 px в высоту; на узком экране встают друг под другом.
const links: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 18, paddingTop: 4 };
const tap: CSSProperties = { display: 'inline-flex', alignItems: 'center', minHeight: 44, color: 'var(--ink-60)' };

export function UniversityStart() {
  useTheme();
  const [list, setList] = useState<University[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  // Читаем один раз: адрес меняется только при уходе на страницу вуза.
  const [pending] = useState(pendingDeepLink);

  useEffect(() => {
    getUniversities().then(setList).catch((e) => setErr(String(e.message || e))).finally(hideBoot);
  }, []);

  const qk = searchKey(q);
  const shown = useMemo(() => (list || [])
    .filter((u) => !qk || searchKey(u.short + ' ' + u.university).includes(qk)), [list, qk]);
  // Сколько человек уже смотрит здесь расписание — по всем вузам сразу.
  const people = (list || []).reduce((s, u) => s + (u.people || 0), 0);

  return (
    <div className="sheet open">
      <div className="sheet__hello">
        <div className="eyebrow">Para</div>
        <div className="sheet__h">Где ты учишься?</div>
        <div className="sheet__p">Выбери вуз — дальше Para будет сразу открываться на его расписании.
          Сменить можно в любой момент: значок Para вверху.</div>
        {people > 0 && <div className="unis__total">Расписанием уже пользуются <b>{num(people)}</b>{' '}
          {plural(people, 'человек', 'человека', 'человек')}</div>}
      </div>
      <div className="sheet__bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название или сокращение вуза" autoComplete="off" />
      </div>

      <div className="sheet__list">
        {pending && (
          <div className="offline" role="note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.8 5.8" />
              <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4" />
            </svg>
            <span><b>Выбери вуз, чтобы продолжить</b></span>
          </div>
        )}
        {err && (
          <div className="unis__err">
            <div className="sheet__head">{err}</div>
            <button className="hdr__btn" onClick={() => location.reload()}>Повторить</button>
          </div>
        )}
        {!list && !err && <div className="sheet__head">Загрузка…</div>}
        {list && !shown.length && <div className="sheet__head">Ничего не нашлось</div>}
        {shown.map((u) => (
          <button key={u.id} className="opt" onClick={() => openUni(u.id)}>
            <span className="unis__logo" aria-hidden="true"
              style={{ ['--logo' as string]: `url("${u.logo}")`, ['--c' as string]: colorOf(u.id) }} />
            <span className="opt__txt">
              <span className="opt__name">{u.university}</span>
              <span className="opt__code">{u.short}</span>
            </span>
            {u.people > 0 && (
              <span className="unis__act" aria-label={`${num(u.people)} ${plural(u.people, 'человек', 'человека', 'человек')}`}>
                <Spark values={u.spark} color={colorOf(u.id)} />
                <span className="unis__n">{num(u.people)}</span>
              </span>
            )}
          </button>
        ))}
        {list && <p className="unis__note">Para — неофициальное приложение и не связано ни с одним вузом.
          Расписания берутся из открытых источников самих вузов.</p>}
        <p className="unis__note" style={links}>
          <a href="/policy" style={tap}>Политика конфиденциальности</a>
          <a href="/rules" style={tap}>Правила обсуждений</a>
        </p>
      </div>
    </div>
  );
}
