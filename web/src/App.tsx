import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getSchedule, getReviews, getSummary, type ReviewsData, type Summary } from './api';
import type { Schedule, Group, ChangeItem } from './types';
import { store } from './lib/store';
import { buildColors, parseCell, pairsOf } from './lib/parse';
import { DAYS, MONTHS, minutesOf } from './lib/format';
import { useTheme } from './hooks/useTheme';
import type { Role, ScheduleSlotProps } from './tabs';
import { AppShell, LazyModal, Panel, hasTabBar, lazyWithReload } from './shell/AppShell';
import { scrollToTop, useReselect } from './shell/NavBar';
import { useUniversityMenu } from './shell/useUniversityMenu';
import { useHideTabBar } from './ui/bar';
import { openLayerCount } from './ui/layers';
import { ScheduleNav } from './components/ScheduleNav';
import { ScheduleTitle, uniShort } from './components/ScheduleTitle';
import { ChangesSheet } from './components/ChangesSheet';
import { ThemeSection } from './components/ThemeSection';
import { Hero } from './components/Hero';
import { DayCard } from './components/DayCard';
import { WeekView } from './components/WeekView';
import { Picker } from './components/Picker';
import { PullRefresh } from './components/PullRefresh';
import { Consent } from './components/Consent';
import { RolePick } from './components/RolePick';
import { SiteFooter } from './components/SiteFooter';
import { DocSheet } from './components/DocSheet';
import { ReviewsModal } from './components/ReviewsModal';
import { ReviewPrompt } from './components/ReviewPrompt';
import { InstallCard } from './components/InstallCard';
import { ReviewsBlock } from './components/ReviewsBlock';
import { StatsBlock } from './components/StatsBlock';
import { OfflineNote } from './components/OfflineNote';
import { brand } from './brand';
import { isStandalone } from './hooks/useInstall';
import { trackVisit } from './lib/track';
import { hideBoot } from './lib/boot';

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

// Режим преподавателя — отдельным файлом: он нужен немногим, а основной файл так легче.
type TeacherProps = ScheduleSlotProps & { onSwitchRole: () => void };
const teacherPanel = lazyWithReload<TeacherProps>(
  () => import('./components/TeacherApp').then((m) => ({ default: m.TeacherApp })),
);

// Редкие окна — тоже отдельными файлами. Подгружаются заранее, в простое после показа
// расписания, поэтому открываются сразу и работают без сети.
const statsModal = lazyWithReload<{ open: boolean; onClose: () => void }>(
  () => import('./components/StatsModal').then((m) => ({ default: m.StatsModal })),
);
const installModal = lazyWithReload<{ open: boolean; url: string; onClose: () => void }>(
  () => import('./components/Install').then((m) => ({ default: m.Install })),
);
function prefetchModals() {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  const go = () => { void statsModal.load(); void installModal.load(); };
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 5000 });
  else window.setTimeout(go, 1500);
}

function readRole(): Role | null {
  const r = store('role');
  return r === 'student' || r === 'teacher' ? r : null;
}

// Приложение: тема и режим (студент / преподаватель) живут здесь, а вкладки, история «Назад»
// и «Обсуждения» — в оболочке (shell/AppShell). Расписание — одна из вкладок.
export default function App() {
  const { mode, set } = useTheme();
  const [role, setRoleState] = useState<Role | null>(readRole);
  const setRole = useCallback((r: Role) => { store('role', r); setRoleState(r); }, []);
  const theme = useMemo(() => ({ mode, set }), [mode, set]);

  const renderSchedule = useCallback((slot: ScheduleSlotProps) => (role === 'teacher'
    ? <Panel panel={teacherPanel} title="Преподаватель" active={slot.active}
        props={{ ...slot, onSwitchRole: () => setRole('student') }} />
    : <StudentApp {...slot} setRole={setRole} />), [role, setRole]);

  return <AppShell theme={theme} role={role} setRole={setRole} renderSchedule={renderSchedule} />;
}

type View = 'today' | 'week';

/** Вкладка «Расписание» в режиме студента. */
function StudentApp({ active, command, onContext, theme, setRole }: ScheduleSlotProps & { setRole: (r: Role) => void }) {
  const [sched, setSched] = useState<Schedule | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<View>('today');
  const [sel, setSel] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ open: boolean; first: boolean }>({ open: false, first: false });
  const [agreed, setAgreed] = useState(() => !!store('agreed'));
  const [consent, setConsent] = useState(false);
  const [rolePick, setRolePick] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [seenTs, setSeenTs] = useState(() => store('seenTs') || '');
  const [reviews, setReviews] = useState<ReviewsData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rateInit, setRateInit] = useState(0);
  const [tick, setTick] = useState(0);
  const t0 = useRef(Date.now());
  const prevNowMin = useRef<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const uniMenu = useUniversityMenu();

  // Загрузка расписания + восстановление выбранной группы.
  const load = useCallback(() => {
    setErr('');
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
  }, []);
  useEffect(() => { load(); }, [load]);

  // Расписание пришло (или не пришло) — экран запуска больше не нужен.
  useEffect(() => { if (sched || err) hideBoot(); }, [sched, err]);
  const hasSched = !!sched;
  useEffect(() => { if (hasSched) prefetchModals(); }, [hasSched]);

  // Нижние блоки — отзывы и короткая статистика. Ошибки молча: это не главное на экране.
  const loadReviews = useCallback(() => { getReviews().then(setReviews).catch(() => {}); }, []);
  const loadSummary = useCallback(() => { getSummary().then(setSummary).catch(() => {}); }, []);
  useEffect(() => { loadReviews(); loadSummary(); }, [loadReviews, loadSummary]);

  // Посекундный тик для отсчёта + перерисовка при возврате из фона. Только пока вкладка видна:
  // скрытая вкладка каждую секунду не перерисовывается.
  useEffect(() => {
    if (!active) return;
    setTick((t) => t + 1);
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    const onVis = () => { if (!document.hidden) setTick((t) => t + 1); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [active]);

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

  // Интернет вернулся — сразу берём свежее расписание вместо сохранённого.
  useEffect(() => {
    const onOnline = () => { refresh().catch(() => {}); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh]);

  // Непросмотренная правка в твоей группе: одна правда для точки на «Правках», красного
  // свечения страницы (html.is-changed), точки на вкладке и «Профиля».
  const last = sched?.changes[0];
  const unseen = !!(group && last && (last.changes || []).some((c) => c.group === group.name) && seenTs !== last.ts);
  useEffect(() => {
    document.documentElement.classList.toggle('is-changed', unseen);
  }, [unseen]);
  useEffect(() => () => document.documentElement.classList.remove('is-changed'), []);

  // Заголовок: чистое имя группы — без курса и кода направления.
  const bare = group ? group.name.replace(/^\s*\d\s*курс\s*/i, '') : '';
  const code = (bare.match(/\d{2}\.\d{2}\.\d{2}/) || [''])[0];
  const gname = bare.replace(code, '').trim();
  const subtitle = group ? [uniShort(), group.sheet, code].filter(Boolean).join(' · ') : '';

  // Личная ссылка: группа и номер зашиты в адрес — переживает очистку хранилища.
  // В Para — ещё и вуз, иначе ссылка откроется на чужом вузе или на выборе вуза.
  const cid = store('cid') || '';
  const myUrl = group
    ? location.origin + location.pathname + '?' + (brand.hub ? 'uni=' + encodeURIComponent(brand.id) + '&' : '')
      + 'group=' + encodeURIComponent(group.key) + '&ok=1' + (cid ? '&u=' + encodeURIComponent(cid) : '')
    : '';

  // Оболочке — что показывать в «Профиле» и точке на вкладке. Только когда группа выбрана
  // человеком (не запасная первая из списка) и есть согласие.
  useEffect(() => {
    if (!agreed || !sel || !group) return;
    onContext({ kind: 'group', title: gname, subtitle, unseenChanges: unseen, installUrl: myUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreed, sel, gname, subtitle, unseen, myUrl]);

  // Онбординг (согласие → роль → группа) — без нижних вкладок.
  useHideTabBar(active && (!agreed || consent || rolePick || (picker.open && picker.first)), 'onboarding');

  const openChanges = () => {
    if (last) { store('seenTs', last.ts); setSeenTs(last.ts); }
    document.documentElement.classList.remove('is-changed');
    setChangesOpen(true);
  };
  const openChangesRef = useRef(openChanges);
  openChangesRef.current = openChanges;

  // Команды оболочки: «Профиль → Группа» открывает выбор группы. Команду, что была до
  // появления вкладки (например, в режиме преподавателя), не повторяем.
  const seenCmd = useRef(command?.n ?? 0);
  useEffect(() => {
    if (!command || command.n === seenCmd.current) return;
    seenCmd.current = command.n;
    if (command.kind === 'picker') setPicker({ open: true, first: false });
    else if (command.kind === 'changes') openChangesRef.current();
  }, [command]);

  // Повторное нажатие на вкладку «Расписание» — наверх страницы.
  useReselect('schedule', scrollToTop);

  // Не спрашиваем отзыв поверх другого окна или на другой вкладке — стопка окон хуже,
  // чем пропущенный момент.
  const overlayOpenRef = useRef(false);
  useEffect(() => {
    overlayOpenRef.current = !active || consent || picker.open || installOpen || docOpen || statsOpen
      || reviewsOpen || promptOpen || changesOpen || openLayerCount(['tab']) > 0;
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

  const pickerOpen = () => setPicker({ open: true, first: false });
  const nav = (withChanges: boolean) => active && (
    <ScheduleNav view={view} onView={(v) => { setView(v); window.scrollTo(0, 0); }} onUniversities={uniMenu.open}
      changes={withChanges ? { unseen, onOpen: openChanges } : undefined} />
  );

  if (err) {
    return (
      <>
        {nav(false)}
        <div className="wrap wrap--sched">
          <div className="alert is-on" role="alert">
            <span className="dot dot--bad"></span>
            <div className="alert__text"><b>Не удалось получить расписание</b><span>{err}</span></div>
            <button type="button" className="hdr__btn" onClick={load}>Повторить</button>
          </div>
        </div>
        {uniMenu.element}
      </>
    );
  }
  if (!sched || !group) {
    return (
      <>
        {nav(false)}
        <div className="wrap wrap--sched" aria-busy="true">
          <ScheduleTitle kind="group" title="" subtitle="" onPick={pickerOpen} />
          <div className="skel" /><div className="skel" />
        </div>
        {uniMenu.element}
      </>
    );
  }

  const now = sched.now;
  const nowMin = now.minutes + (Date.now() - t0.current) / 60000;
  const colors = buildColors(group);

  // Пока пары выбранной группы не пришли (лёгкий ответ), показываем заглушки, а не «нет пар».
  const groupLoaded = (group.times || []).length > 0 || (group.days || []).length > 0;

  // Карта правок для карточек дня.
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
    // После первой настройки предлагаем закрепить на экране (там же личная ссылка) —
    // если человек всё ещё на расписании (ссылка из «Обсуждений» могла увести на другую вкладку).
    if (wasFirst && !store('homeShown') && !isStandalone()) {
      setTimeout(() => { if (activeRef.current) setInstallOpen(true); }, 500);
    }
  };
  const closeInstall = () => { store('homeShown', '1'); setInstallOpen(false); };
  const closeReviews = () => { setReviewsOpen(false); loadReviews(); };
  const closePrompt = () => { setPromptOpen(false); loadReviews(); };
  // rating > 0 — звезду уже нажали в блоке, модал откроется сразу с ней.
  const openReviews = (rating = 0) => { setRateInit(rating); setReviewsOpen(true); };

  const acceptConsent = () => {
    store('agreed', '1');
    setAgreed(true);
    setConsent(false);
    if (!store('role')) { setRolePick(true); return; } // сначала спросим, кто ты
    if (sel) trackVisit(group?.name || '');
    else setPicker({ open: true, first: true });
  };
  const chooseRole = (r: Role) => {
    setRolePick(false);
    setRole(r);
    if (r === 'student') {
      if (sel) trackVisit(group?.name || '');
      else setPicker({ open: true, first: true });
    }
    // teacher: перерисовка вернёт <TeacherApp/> (он сам предложит выбрать преподавателя)
  };

  // ── Экран «Сегодня» ──
  const today = () => {
    const dl = now.dateLabel.split('.');
    const date = dl.length === 2 ? (+dl[0]) + ' ' + MONTHS[+dl[1] - 1] : '';
    const cards: ReactNode[] = [];
    const dayAt = (offset: number) => DAYS[(DAYS.indexOf(now.day) + offset) % DAYS.length];
    const hasPairs = (day: string) => pairsOf(group, day).some((cell) => !!parseCell(cell));

    if (now.day !== 'Вс') cards.push(<DayCard key="d" g={group} day={now.day} note={date} ctx={ctx} />);

    // Обычно второй карточкой идёт завтрашний учебный день. Но если и сегодня, и завтра
    // пусто, показываем ближайший день с парами. Это важно для расписаний выходного дня, как у TIUE.
    const nextOffset = dayAt(1) === 'Вс' ? 2 : 1;
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
      {nav(true)}
      <PullRefresh onRefresh={refresh} enabled={active} target=".wrap--sched" />
      <div className="wrap wrap--sched">
        <ScheduleTitle kind="group" title={gname} subtitle={subtitle} onPick={pickerOpen} />

        {sched.savedAt && <OfflineNote at={sched.savedAt} />}

        <div id="sched-view" role="tabpanel" aria-label={view === 'today' ? 'Сегодня' : 'Неделя'}>
          {/* key: при смене «Сегодня | Неделя» содержимое появляется заново (.view-in), а не подменяется. */}
          {!groupLoaded ? <><div className="skel" /><div className="skel" /></> : (
            <div key={view} className="view-in">
              {view === 'today' ? today() : <WeekView group={group} ctx={ctx} week={sched.week} />}
            </div>
          )}
        </div>

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

        {!hasTabBar() && <ThemeSection theme={theme} />}

        <SiteFooter onOpenDoc={() => setDocOpen(true)} />
      </div>

      <Picker groups={sched.groups} selected={sel} open={picker.open} first={picker.first}
        onPick={pickGroup} onClose={() => setPicker({ open: false, first: false })}
        onTeacher={() => setRole('teacher')} />
      <ChangesSheet open={changesOpen} group={group} changes={sched.changes} onClose={() => setChangesOpen(false)} />
      <Consent open={consent} onAccept={acceptConsent} onOpenDoc={() => setDocOpen(true)} />
      <RolePick open={rolePick} onPick={chooseRole} />
      <DocSheet open={docOpen} onClose={() => setDocOpen(false)} />
      <LazyModal panel={installModal} open={installOpen} props={{ open: installOpen, url: myUrl, onClose: closeInstall }}
        onFail={() => setInstallOpen(false)} />
      <LazyModal panel={statsModal} open={statsOpen} props={{ open: statsOpen, onClose: () => setStatsOpen(false) }}
        onFail={() => setStatsOpen(false)} />
      <ReviewsModal open={reviewsOpen} initialRating={rateInit} onClose={closeReviews} />
      <ReviewPrompt open={promptOpen} onClose={closePrompt} />
      {uniMenu.element}
    </>
  );
}
