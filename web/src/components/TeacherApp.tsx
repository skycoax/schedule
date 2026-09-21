// Режим преподавателя: выбрал себя в списке — видишь свои пары на сегодня и на неделю
// (время, предмет, кабинет и группы). Данные — /api/teacher, собранные сервером из того
// же расписания, что видят студенты. Оболочка (шапка, вкладки, футер) — как у студента.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getTeachers, getTeacher, getReviews, getSummary,
  type TeacherRow, type TeacherSchedule, type TeacherItem, type ReviewsData, type Summary,
} from '../api';
import type { Group } from '../types';
import type { ThemeMode } from '../hooks/useTheme';
import { store } from '../lib/store';
import { trackVisit } from '../lib/track';
import { minutesOf, hhmm, plural, DAYS, FULL, MONTHS } from '../lib/format';
import { Header } from './Header';
import { TopBar } from './TopBar';
import { Hero } from './Hero';
import { TeacherPicker } from './TeacherPicker';
import { DocSheet } from './DocSheet';
import { SiteFooter } from './SiteFooter';
import { ReviewsBlock } from './ReviewsBlock';
import { StatsBlock } from './StatsBlock';
import { ReviewsModal } from './ReviewsModal';
import { StatsModal } from './StatsModal';
import { UniversityMenu, type MenuAnchor } from './UniversityMenu';

type Tab = 'today' | 'week';
const D6 = DAYS.slice(0, 6);
const subjKey = (s: string) => String(s || '').toLowerCase().replace(/[^а-яёa-z]/g, '');

// Цвет предмета — по порядку первой встречи, из той же палитры --c1..8, что у студента.
function useColors(sched: TeacherSchedule | null) {
  return useMemo(() => {
    const map: Record<string, string> = {};
    let n = 0;
    (sched?.days || []).forEach((d) => d.items.forEach((it) => {
      const k = subjKey(it.subj);
      if (k && !map[k]) map[k] = 'var(--c' + ((n++ % 8) + 1) + ')';
    }));
    return (subj: string) => map[subjKey(subj)] || 'var(--ink-30)';
  }, [sched]);
}

function itemState(time: string, isToday: boolean, nowMin: number): '' | 'past' | 'live' {
  if (!isToday) return '';
  const mm = minutesOf(time);
  if (!mm) return '';
  return nowMin >= mm.b ? 'past' : (nowMin >= mm.a ? 'live' : '');
}

function DayCard({ day, items, note, nowDay, nowMin, colorOf }: {
  day: string; items: TeacherItem[]; note?: string; nowDay: string; nowMin: number; colorOf: (s: string) => string;
}) {
  const isNow = day === nowDay;
  const head = (
    <div className="card__hdr">
      <div className="card__title">{FULL[day]}{note ? <span> {note}</span> : null}</div>
      <div className={'card__count' + (isNow && items.length ? ' is-now' : '')}>
        {items.length ? items.length + ' ' + plural(items.length, 'пара', 'пары', 'пар') : 'нет пар'}
      </div>
    </div>
  );
  if (!items.length) return <div className="card">{head}<div className="empty">Занятий нет</div></div>;
  return (
    <div className="card">
      {head}
      {items.map((it, idx) => {
        const st = itemState(it.time, isNow, nowMin);
        return (
          <div key={idx} className={'row' + (st ? ' is-' + st : '')} style={{ ['--c' as string]: colorOf(it.subj) }}>
            <div className="row__top">
              <div className="row__name">{it.subj}</div>
              <div className="row__ms">{hhmm(it.time, 0)}</div>
            </div>
            {(it.room || it.groups.length > 0) && (
              <div className="row__line2">
                {it.room && <span className="room">{it.room}</span>}
                {it.groups.length > 0 && <span className="who">{it.groups.join(', ')}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TeacherApp({ mode, cycle, onSwitchRole }: {
  mode: ThemeMode; cycle: () => void; onSwitchRole: () => void;
}) {
  const [teachers, setTeachers] = useState<TeacherRow[] | null>(null);
  const [sel, setSel] = useState<string | null>(store('teacher'));
  const [sched, setSched] = useState<TeacherSchedule | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [picker, setPicker] = useState<{ open: boolean; first: boolean }>({ open: false, first: false });
  const [docOpen, setDocOpen] = useState(false);
  const [uniAnchor, setUniAnchor] = useState<MenuAnchor | null>(null);
  const [err, setErr] = useState('');
  const [reviews, setReviews] = useState<ReviewsData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [rateInit, setRateInit] = useState(0);
  const [, setTick] = useState(0);
  const t0 = useRef(Date.now());

  // Список преподавателей вуза + восстановление выбранного.
  useEffect(() => {
    getTeachers().then((list) => {
      setTeachers(list);
      const saved = store('teacher');
      if (saved && list.some((x) => x.key === saved)) {
        load(saved);
        trackVisit('');
      } else {
        setPicker({ open: true, first: true });
      }
    }).catch((e) => setErr(String(e.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Посекундный тик — для отметки «идёт/прошла» и возврата из фона.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    const onVis = () => { if (!document.hidden) setTick((t) => t + 1); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const load = useCallback((key: string) => {
    getTeacher(key).then((d) => { t0.current = Date.now(); setSched(d); }).catch((e) => setErr(String(e.message || e)));
  }, []);

  const colorOf = useColors(sched);

  // Отзывы и краткая статистика вуза — те же, что у студента (данные общие, обезличенные).
  const loadReviews = useCallback(() => { getReviews().then(setReviews).catch(() => {}); }, []);
  const loadSummary = useCallback(() => { getSummary().then(setSummary).catch(() => {}); }, []);
  useEffect(() => { loadReviews(); loadSummary(); }, [loadReviews, loadSummary]);

  // Group-совместимый объект из расписания преподавателя — чтобы переиспользовать Hero
  // (таймер до текущей/следующей пары). Ячейка в формате «предмет · ауд. кабинет · группы».
  const timerGroup = useMemo<Group>(() => {
    const days = sched?.days || [];
    const times = [...new Set(days.flatMap((d) => d.items.map((it) => it.time)).filter(Boolean))]
      .sort((a, b) => ((minutesOf(a) || { a: 1e9 }).a) - ((minutesOf(b) || { a: 1e9 }).a));
    const idx = new Map(times.map((t, i) => [t, i]));
    const gdays = days.map((d) => {
      const pairs: string[] = new Array(times.length).fill('');
      d.items.forEach((it) => {
        const i = idx.get(it.time);
        if (i == null || pairs[i]) return;
        const parts = [it.subj];
        if (it.room) parts.push('ауд. ' + it.room);
        if (it.groups.length) parts.push(it.groups.join(', '));
        pairs[i] = parts.join(' · ');
      });
      return { day: d.day, pairs };
    });
    return { key: '', sheet: '', course: '', name: '', link: '', times, days: gdays };
  }, [sched]);

  const openReviews = (rating = 0) => { setRateInit(rating); setReviewsOpen(true); };
  const closeReviews = () => { setReviewsOpen(false); loadReviews(); };

  const pick = (key: string) => {
    setSel(key); store('teacher', key);
    setSched(null); load(key);
    if (store('agreed')) trackVisit('');
    setPicker({ open: false, first: false });
    window.scrollTo(0, 0);
  };

  const openUniversities = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = Math.min(344, window.innerWidth - 24);
    setUniAnchor({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)) });
  };

  if (err) return <div className="wrap"><div className="alert is-on"><span className="dot dot--bad"></span><div className="alert__text"><b>Не удалось получить данные</b><span>{err}</span></div></div></div>;

  const now = sched?.now;
  const nowMin = now ? now.minutes + (Date.now() - t0.current) / 60000 : 0;
  const byDay: Record<string, TeacherItem[]> = {};
  (sched?.days || []).forEach((d) => { byDay[d.day] = d.items; });
  const name = sched?.name || (sel ? '' : 'Преподаватель');

  // ── «Сегодня» + ближайший учебный день ──
  const today = () => {
    if (!now) return null;
    const dl = now.dateLabel.split('.');
    const date = dl.length === 2 ? (+dl[0]) + ' ' + MONTHS[+dl[1] - 1] : '';
    const at = (o: number) => DAYS[(DAYS.indexOf(now.day) + o) % DAYS.length];
    const has = (d: string) => (byDay[d] || []).length > 0;
    const cards: React.ReactNode[] = [];
    if (now.day !== 'Вс') cards.push(<DayCard key="d" day={now.day} items={byDay[now.day] || []} note={date} nowDay={now.day} nowMin={nowMin} colorOf={colorOf} />);

    let off = at(1) === 'Вс' ? 2 : 1;
    let nextDay = at(off);
    let nextNote = off === 1 ? 'завтра' : 'в понедельник';
    if (!has(now.day) && !has(nextDay)) {
      for (let o = 1; o <= 7; o++) { const c = at(o); if (c !== 'Вс' && has(c)) { nextDay = c; nextNote = 'ближайшие занятия'; break; } }
    }
    cards.push(<DayCard key="n" day={nextDay} items={byDay[nextDay] || []} note={nextNote} nowDay={now.day} nowMin={nowMin} colorOf={colorOf} />);
    return <><Hero group={timerGroup} nowMin={nowMin} nowDay={now.day} /><div id="days">{cards}</div></>;
  };

  const week = () => {
    const total = D6.reduce((s, d) => s + (byDay[d] || []).length, 0);
    return (
      <>
        <div className="card">
          <div className="card__hdr">
            <div className="card__title">{sched?.week || 'Неделя'}</div>
            <div className="card__count">{total} {plural(total, 'пара', 'пары', 'пар')}</div>
          </div>
        </div>
        <div id="days">
          {D6.map((d) => <DayCard key={d} day={d} items={byDay[d] || []} note={now && d === now.day ? 'сегодня' : ''} nowDay={now?.day || ''} nowMin={nowMin} colorOf={colorOf} />)}
        </div>
      </>
    );
  };

  return (
    <>
      <TopBar name={name} onPick={() => setPicker({ open: true, first: false })} onUniversities={openUniversities} />
      <div className="wrap">
        <Header name={name} mode={mode} onCycle={cycle} onPick={() => setPicker({ open: true, first: false })} onUniversities={openUniversities} />

        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'today'} onClick={() => { setTab('today'); window.scrollTo(0, 0); }}>Сегодня</button>
          <button role="tab" aria-selected={tab === 'week'} onClick={() => { setTab('week'); window.scrollTo(0, 0); }}>Неделя</button>
        </div>

        {!sched ? <><div className="skel" /><div className="skel" /></> : (tab === 'today' ? today() : week())}

        {sched && (
          <div className="extras">
            <ReviewsBlock data={reviews} myRating={Number(store('myRating') || 0)}
              onOpen={() => openReviews()} onRate={openReviews} />
            <StatsBlock data={summary} onOpen={() => setStatsOpen(true)} />
          </div>
        )}

        <SiteFooter onOpenDoc={() => setDocOpen(true)} />
      </div>

      <TeacherPicker teachers={teachers || []} selected={sel} open={picker.open} first={picker.first}
        onPick={pick} onClose={() => setPicker({ open: false, first: false })} onStudent={onSwitchRole} />
      <DocSheet open={docOpen} onClose={() => setDocOpen(false)} />
      <StatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
      <ReviewsModal open={reviewsOpen} initialRating={rateInit} onClose={closeReviews} />
      <UniversityMenu anchor={uniAnchor} onClose={() => setUniAnchor(null)} />
    </>
  );
}
