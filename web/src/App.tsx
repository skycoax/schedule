import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSchedule, getReviews, getSummary, type ReviewsData, type Summary } from './api';
import type { Schedule, Group, ChangeItem } from './types';
import { store } from './lib/store';
import { buildColors, parseCell, pairsOf } from './lib/parse';
import { DAYS, MONTHS, minutesOf } from './lib/format';
import { useTheme } from './hooks/useTheme';
import { Header } from './components/Header';
import { TopBar } from './components/TopBar';
import { Hero } from './components/Hero';
import { DayCard } from './components/DayCard';
import { WeekView } from './components/WeekView';
import { ChangesView } from './components/ChangesView';
import { Picker } from './components/Picker';
import { PullRefresh } from './components/PullRefresh';
import { Consent } from './components/Consent';
import { RolePick } from './components/RolePick';
import { TeacherApp } from './components/TeacherApp';
import { SiteFooter } from './components/SiteFooter';
import { DocSheet } from './components/DocSheet';
import { StatsModal } from './components/StatsModal';
import { ReviewsModal } from './components/ReviewsModal';
import { ReviewPrompt } from './components/ReviewPrompt';
import { InstallCard } from './components/InstallCard';
import { ReviewsBlock } from './components/ReviewsBlock';
import { StatsBlock } from './components/StatsBlock';
import { Install } from './components/Install';
import { UniversityMenu, type MenuAnchor } from './components/UniversityMenu';
import { isStandalone } from './hooks/useInstall';
import { trackVisit } from './lib/track';

// Не звать чаще, чем раз в 4 часа после закрытия, и не звать вовсе 14 дней
// после того, как человек уже что-то оценил — иначе это не приглашение, а нытьё.
function canPromptReview(): boolean {
  if (!store('agreed')) return false;
  if (store('role') === 'teacher') return false; // приглашение оценить — только в студенческом режиме
  const reviewed = Number(store('reviewedAt') || 0);
  if (reviewed && Date.now() - reviewed < 14 * 86400000) return false;
  const asked = Number(store('reviewPromptAt') || 0);
  if (asked && Date.now() - asked < 4 * 3600000) return false;
  return true;
}

type Tab = 'today' | 'week' | 'changes';
type Role = 'student' | 'teacher';

export default function App() {
  const { mode, cycle } = useTheme();
  const [sched, setSched] = useState<Schedule | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('today');
  const [sel, setSel] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ open: boolean; first: boolean }>({ open: false, first: false });
  const [consent, setConsent] = useState(false);
  const [role, setRole] = useState<Role | null>((store('role') as Role) || null);
  const [rolePick, setRolePick] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [uniAnchor, setUniAnchor] = useState<MenuAnchor | null>(null);
  const [reviews, setReviews] = useState<ReviewsData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rateInit, setRateInit] = useState(0);
  const [tick, setTick] = useState(0);
  const t0 = useRef(Date.now());
  const prevNowMin = useRef<number | null>(null);

  // Загрузка расписания + восстановление выбранной группы.
  // В режиме преподавателя студенческое расписание не грузим — этим занимается TeacherApp.
  useEffect(() => {
    if (store('role') === 'teacher') return;
    const urlGroup = new URLSearchParams(location.search).get('group') || '';
    const saved = store('group') || urlGroup;
    // Пары приходят только для этой группы — у вуза на EduPage групп больше тысячи.
    getSchedule(saved).then((d) => {
      t0.current = Date.now();
      setSched(d);
      const ok = (d.groups || []).some((g) => g.key === saved);
      if (ok) { setSel(saved); if (saved !== store('group')) store('group', saved); }
      const gName = ((ok ? d.groups.find((g) => g.key === saved) : d.groups[0]) || { name: '' }).name || '';
      // Сначала согласие, потом выбор группы и заход — до согласия ничего не шлём.
      if (!store('agreed')) {
        setConsent(true);
      } else if (ok) {
        trackVisit(gName);
      } else {
        // Заход запишем после выбора группы — иначе в статистику попадёт
        // первая группа списка, которую человек даже не выбирал.
        setPicker({ open: true, first: true });
      }
    }).catch((e) => setErr(String(e.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Нижние блоки — отзывы и короткая статистика. Ошибки молча: это не главное на экране.
  const loadReviews = useCallback(() => { getReviews().then(setReviews).catch(() => {}); }, []);
  const loadSummary = useCallback(() => { getSummary().then(setSummary).catch(() => {}); }, []);
  useEffect(() => { loadReviews(); loadSummary(); }, [loadReviews, loadSummary]);

  // Посекундный тик для отсчёта + перерисовка при возврате из фона.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    const onVis = () => { if (!document.hidden) setTick((t) => t + 1); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const group: Group | null = useMemo(() => {
    if (!sched) return null;
    return sched.groups.find((g) => g.key === sel) || sched.groups[0] || null;
  }, [sched, sel]);

  // Потянул вниз — перечитываем расписание из нашей базы.
  const refresh = useCallback(async () => {
    loadReviews(); loadSummary();
    const d = await getSchedule(store('group') || '');
    t0.current = Date.now();
    setSched(d);
  }, [loadReviews, loadSummary]);

  // Красное свечение, если в твоей группе есть непросмотренная правка.
  useEffect(() => {
    if (!sched || !group) return;
    const last = sched.changes[0];
    const mineLast = last ? (last.changes || []).filter((c) => c.group === group.name) : [];
    const unseen = !!(mineLast.length && store('seenTs') !== last.ts);
    document.documentElement.classList.toggle('is-changed', unseen);
  }, [sched, group]);

  // Не спрашиваем отзыв поверх другого окна — стопка модалок хуже, чем пропущенный момент.
  const overlayOpenRef = useRef(false);
  useEffect(() => {
    overlayOpenRef.current = consent || picker.open || installOpen || docOpen || statsOpen || reviewsOpen || promptOpen || !!uniAnchor;
  });

  // Приглашение оценить — триггер 1: пара только что закончилась (самый живой момент спросить).
  useEffect(() => {
    if (!sched || !group) return;
    const n = sched.now;
    const nowMinNow = n.minutes + (Date.now() - t0.current) / 60000;
    const prev = prevNowMin.current;
    prevNowMin.current = nowMinNow;
    if (prev == null || n.day === 'Вс') return;
    if (overlayOpenRef.current || !canPromptReview()) return;
    const pairs = pairsOf(group, n.day);
    for (let i = 0; i < pairs.length; i++) {
      if (!parseCell(pairs[i])) continue;
      const mm = minutesOf((group.times || [])[i]);
      if (!mm) continue;
      if (prev < mm.b && nowMinNow >= mm.b) {
        store('reviewPromptAt', String(Date.now()));
        setPromptOpen(true);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, sched, group]);

  // Триггер 2: если за пару так и не спросили — предложить в случайный момент сеанса.
  useEffect(() => {
    const delay = 45000 + Math.random() * 75000; // 45–120 с, не подряд с открытием
    const t = setTimeout(() => {
      if (!overlayOpenRef.current && canPromptReview()) {
        store('reviewPromptAt', String(Date.now()));
        setPromptOpen(true);
      }
    }, delay);
    return () => clearTimeout(t);
  }, []);

  // Режим преподавателя — отдельная оболочка (студенческое расписание ему не нужно).
  if (role === 'teacher') {
    return <TeacherApp mode={mode} cycle={cycle} onSwitchRole={() => { store('role', 'student'); setRole('student'); }} />;
  }

  if (err) return <div className="wrap"><div className="alert is-on"><span className="dot dot--bad"></span><div className="alert__text"><b>Не удалось получить расписание</b><span>{err}</span></div></div></div>;
  if (!sched || !group) return <div className="wrap"><div className="skel" /><div className="skel" /></div>;

  const now = sched.now;
  const nowMin = now.minutes + (Date.now() - t0.current) / 60000;
  const colors = buildColors(group);

  // Пока пары выбранной группы не пришли (лёгкий ответ), показываем заглушки, а не «нет пар».
  const groupLoaded = (group.times || []).length > 0 || (group.days || []).length > 0;

  // Заголовок: чистое имя группы — без курса и кода направления (рядом логотип вуза).
  const bare = group.name.replace(/^\s*\d\s*курс\s*/i, '');
  const code = (bare.match(/\d{2}\.\d{2}\.\d{2}/) || [''])[0];
  const gname = bare.replace(code, '').trim();

  // Карта правок для карточек дня.
  const last = sched.changes[0];
  const edits: Record<string, ChangeItem> = {};
  if (last) (last.changes || []).forEach((c) => { if (c.group === group.name && c.day) edits[c.day + '#' + c.pair] = c; });
  const ctx = { colorOf: colors.colorOf, nowDay: now.day, nowMin, edits };

  const pickGroup = (key: string) => {
    const wasFirst = picker.first;
    setSel(key); store('group', key);
    // Пары новой группы сервер отдаёт отдельным запросом.
    getSchedule(key).then((d) => { t0.current = Date.now(); setSched(d); }).catch(() => {});
    // Первый выбор группы и есть момент первого захода (повторно trackVisit ничего не шлёт).
    if (store('agreed')) trackVisit(sched.groups.find((g) => g.key === key)?.name || '');
    setPicker({ open: false, first: false });
    window.scrollTo(0, 0);
    // После первой настройки предлагаем закрепить на экране (там же личная ссылка).
    if (wasFirst && !store('homeShown') && !isStandalone()) setTimeout(() => setInstallOpen(true), 500);
  };
  // Меню вузов встаёт прямо под нажатым логотипом (в большой или закреплённой шапке).
  const openUniversities = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = Math.min(344, window.innerWidth - 24);
    setUniAnchor({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)) });
  };
  const closeInstall = () => { store('homeShown', '1'); setInstallOpen(false); };
  const closeReviews = () => { setReviewsOpen(false); loadReviews(); };
  const closePrompt = () => { setPromptOpen(false); loadReviews(); };
  // rating > 0 — звезду уже нажали в блоке, модал откроется сразу с ней.
  const openReviews = (rating = 0) => { setRateInit(rating); setReviewsOpen(true); };

  // Личная ссылка: группа и номер зашиты в адрес — переживает очистку хранилища.
  const cid = store('cid') || '';
  const myUrl = group
    ? location.origin + location.pathname + '?group=' + encodeURIComponent(group.key) + '&ok=1' + (cid ? '&u=' + encodeURIComponent(cid) : '')
    : '';
  const acceptConsent = () => {
    store('agreed', '1');
    setConsent(false);
    if (!store('role')) { setRolePick(true); return; } // сначала спросим, кто ты
    if (sel) trackVisit(group?.name || '');
    else setPicker({ open: true, first: true });
  };
  const chooseRole = (r: Role) => {
    store('role', r);
    setRolePick(false);
    setRole(r);
    if (r === 'student') {
      if (sel) trackVisit(group?.name || '');
      else setPicker({ open: true, first: true });
    }
    // teacher: перерисовка вернёт <TeacherApp/> (он сам предложит выбрать преподавателя)
  };
  const openChanges = () => {
    if (last) store('seenTs', last.ts);
    document.documentElement.classList.remove('is-changed');
    setTab('changes'); window.scrollTo(0, 0);
  };

  // ── Экран «Сегодня» ──
  const today = () => {
    const dl = now.dateLabel.split('.');
    const date = dl.length === 2 ? (+dl[0]) + ' ' + MONTHS[+dl[1] - 1] : '';
    const cards: React.ReactNode[] = [];
    const dayAt = (offset: number) => DAYS[(DAYS.indexOf(now.day) + offset) % DAYS.length];
    const hasPairs = (day: string) => pairsOf(group, day).some((cell) => !!parseCell(cell));

    if (now.day !== 'Вс') cards.push(<DayCard key="d" g={group} day={now.day} note={date} ctx={ctx} />);

    // Обычно второй карточкой идёт завтрашний учебный день. Но если и сегодня, и завтра
    // пусто, показываем ближайший день с парами. Это важно для расписаний выходного дня, как у TIUE.
    let nextOffset = dayAt(1) === 'Вс' ? 2 : 1;
    let nextDay = dayAt(nextOffset);
    let nextNote = nextOffset === 1 ? 'завтра' : 'в понедельник';
    if (!hasPairs(now.day) && !hasPairs(nextDay)) {
      for (let offset = 1; offset <= 7; offset++) {
        const candidate = dayAt(offset);
        if (candidate !== 'Вс' && hasPairs(candidate)) {
          nextDay = candidate;
          nextNote = 'ближайшие занятия';
          break;
        }
      }
    }
    cards.push(<DayCard key="n" g={group} day={nextDay} note={nextNote} ctx={ctx} />);
    return <><Hero group={group} nowMin={nowMin} nowDay={now.day} /><div id="days">{cards}</div></>;
  };

  return (
    <>
      <TopBar name={gname} onPick={() => setPicker({ open: true, first: false })} onUniversities={openUniversities} />
      <PullRefresh onRefresh={refresh} />
      <div className="wrap">
        <Header name={gname} mode={mode} onCycle={cycle} onPick={() => setPicker({ open: true, first: false })} onUniversities={openUniversities} />

        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'today'} onClick={() => { setTab('today'); window.scrollTo(0, 0); }}>Сегодня</button>
          <button role="tab" aria-selected={tab === 'week'} onClick={() => { setTab('week'); window.scrollTo(0, 0); }}>Неделя</button>
          <button role="tab" aria-selected={tab === 'changes'} onClick={openChanges}>Правки</button>
        </div>

        {!groupLoaded ? <><div className="skel" /><div className="skel" /></> : <>
          {tab === 'today' && today()}
          {tab === 'week' && <WeekView group={group} ctx={ctx} week={sched.week} />}
          {tab === 'changes' && <ChangesView group={group} changes={sched.changes} />}
        </>}

        {group.link && (
          <a className="tm" href={group.link} target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="3" /><path d="m15.5 10.5 6-3.5v10l-6-3.5" /></svg>
            Телемост группы
          </a>
        )}

        <div className="extras">
          {!isStandalone() && <InstallCard onOpen={() => setInstallOpen(true)} />}
          <ReviewsBlock data={reviews} myRating={Number(store('myRating') || 0)}
            onOpen={() => openReviews()} onRate={openReviews} />
          <StatsBlock data={summary} onOpen={() => setStatsOpen(true)} />
        </div>

        <SiteFooter onOpenDoc={() => setDocOpen(true)} />
      </div>

      <Picker groups={sched.groups} selected={sel} open={picker.open} first={picker.first}
        onPick={pickGroup} onClose={() => setPicker({ open: false, first: false })}
        onTeacher={() => { store('role', 'teacher'); setRole('teacher'); }} />
      <Consent open={consent} onAccept={acceptConsent} onOpenDoc={() => setDocOpen(true)} />
      <RolePick open={rolePick} onPick={chooseRole} />
      <DocSheet open={docOpen} onClose={() => setDocOpen(false)} />
      <Install open={installOpen} url={myUrl} onClose={closeInstall} />
      <StatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
      <ReviewsModal open={reviewsOpen} initialRating={rateInit} onClose={closeReviews} />
      <ReviewPrompt open={promptOpen} onClose={closePrompt} />
      <UniversityMenu anchor={uniAnchor} onClose={() => setUniAnchor(null)} />
    </>
  );
}
