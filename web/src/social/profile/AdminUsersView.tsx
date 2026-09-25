// Пользователи (только модераторам): сводка, поиск по имени, @имени и почте, список аккаунтов — новые сверху.
// Нажатие раскрывает подробности: почта, данные Google, возраст, регистрация, входы и устройства; оттуда —
// профиль (там «•••» — ограничить, сбросить, снять ограничение). Google ID, списка друзей и того, кто
// на кого жаловался, здесь нет (политика конфиденциальности, «Модерация»).
// Грузится лениво, как и «Жалобы».
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { plural } from '../../lib/plural';
import { BackButton, NavBar } from '../../shell/NavBar';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Spinner } from '../../ui/Spinner';
import { socialApi } from '../api';
import { banText } from '../format';
import type { AdminUser, AdminUsersStats } from '../types';
import { Avatar } from '../ui/Avatar';
import { TeamBadge } from '../ui/Badges';
import { ListSkeleton, LoadError } from './ProfileHeader';
import { failText, isAbort } from './UsernameField';
import './profile.css';

interface ListState { items: AdminUser[]; next: string | null; loading: boolean; error: string }

const DATE_Y = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tashkent' });
const DATE = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', timeZone: 'Asia/Tashkent' });
/** Дата регистрации: «25 сент.», год — только если не текущий. */
const dateOf = (iso: string) => {
  const t = Date.parse(iso);
  return new Date(t).getFullYear() === new Date().getFullYear() ? DATE.format(t) : DATE_Y.format(t);
};
const n = (x: number, forms: [string, string, string]) => `${x} ${plural(x, forms)}`;

function Stats({ st }: { st: AdminUsersStats }): JSX.Element {
  const cells: [string, number][] = [
    ['Всего', st.total], ['Новых сегодня', st.today], ['За неделю', st.week],
    ['Заходили за неделю', st.active], ['Без профиля', st.noProfile], ['Ограничены', st.banned],
  ];
  return (
    <div className="adm-stats">
      {cells.map(([label, v]) => (
        <div key={label} className="adm-stat">
          <span className="adm-stat__v">{v}</span>
          <span className="adm-stat__l">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Row({ u, onOpen }: { u: AdminUser; onOpen: (username: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const meta = [u.username ? '@' + u.username : 'профиль не заполнен', u.uniShort || ''].filter(Boolean).join(' · ');
  const counts = [
    n(u.counts.posts, ['пост', 'поста', 'постов']),
    n(u.counts.replies, ['ответ', 'ответа', 'ответов']),
    n(u.counts.likes, ['отметка', 'отметки', 'отметок']),
    n(u.counts.friends, ['друг', 'друга', 'друзей']),
  ].join(' · ');
  const body = (
    <>
      <Avatar user={u} size={44} />
      <span className="adm-row__main">
        <span className="adm-row__top">
          <span className="adm-row__name">{u.name || 'Без имени'}</span>
          {u.team && <TeamBadge />}
          <span className="adm-row__date" title="Дата регистрации">{dateOf(u.createdAt)}</span>
        </span>
        <span className="adm-row__meta">{meta}</span>
        <span className="adm-row__counts">{counts}</span>
        {(u.banned || u.reports.total > 0 || !u.rulesAccepted) && (
          <span className="adm-row__tags">
            {u.banned && <span className="adm-tag adm-tag--bad">{banText(u.banned)}</span>}
            {u.reports.total > 0 && (
              <span className={'adm-tag' + (u.reports.open ? ' adm-tag--warn' : '')}>
                Жалобы: {u.reports.open ? `${u.reports.open} открыт${u.reports.open === 1 ? 'а' : 'ы'} из ${u.reports.total}` : u.reports.total}
              </span>
            )}
            {!u.rulesAccepted && <span className="adm-tag">Правила не приняты</span>}
          </span>
        )}
      </span>
    </>
  );
  return (
    <li className={'adm-row' + (open ? ' is-open' : '')}>
      <button type="button" className="adm-row__btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {body}<Icon name="chevronDown" size={16} className="adm-row__chev" />
      </button>
      {open && <Details u={u} onOpen={onOpen} />}
    </li>
  );
}

const DATE_TIME = new Intl.DateTimeFormat('ru', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent',
});
const whenOf = (iso: string | null) => (iso ? DATE_TIME.format(Date.parse(iso)) : '—');
/** Дни в sessions.seen_at — 'YYYY-MM-DD' (UTC). */
const dayOf = (d: string | null) => (d ? DATE_Y.format(Date.parse(d + 'T12:00:00Z')) : '—');

/** Подробности аккаунта (только модераторам): почта, данные Google, регистрация, входы и устройства. */
function Details({ u, onOpen }: { u: AdminUser; onOpen: (username: string) => void }): JSX.Element {
  const rows: [string, string][] = [
    ['Почта', u.email + (u.emailVerified ? '' : ' (не подтверждена)')],
    ['Имя в Google', u.google.name || '—'],
    ['Возраст', u.age === 'minor' ? '16–17 лет' : '18 и старше'],
    ['Язык Google', u.google.locale || '—'],
    ...(u.google.domain ? [['Домен Google', u.google.domain] as [string, string]] : []),
    ['Регистрация', [whenOf(u.createdAt), u.signup.host, u.signup.device].filter(Boolean).join(' · ')],
    ['Последний вход', u.lastLoginAt
      ? `${whenOf(u.lastLoginAt)} · всего ${n(u.loginCount, ['вход', 'входа', 'входов'])}`
      : 'ещё не входил после обновления — данные появятся при следующем входе'],
    ['Был в приложении', dayOf(u.lastSeen)],
    ['Устройства', u.devices.length ? u.devices.join(', ') : '—'],
    ['Активные входы', String(u.sessions)],
    ['Правила приняты', u.rulesAt ? whenOf(u.rulesAt) : 'нет'],
    ...(u.links.tg ? [['Telegram', '@' + u.links.tg] as [string, string]] : []),
    ...(u.links.ig ? [['Instagram', u.links.ig] as [string, string]] : []),
    ...(u.bio ? [['О себе', u.bio] as [string, string]] : []),
  ];
  return (
    <div className="adm-det">
      <dl className="adm-det__list">
        {rows.map(([k, v]) => (
          <div key={k} className="adm-det__row"><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <div className="adm-det__acts">
        {u.username && <Button variant="tinted" size={32} onClick={() => onOpen(u.username!)}>Открыть профиль</Button>}
        <a className="ui-btn ui-btn--plain ui-btn--32" href={'mailto:' + u.email}>Написать на почту</a>
      </div>
    </div>
  );
}

export function AdminUsersView(p: {
  active: boolean;
  onBack: () => void;
  onOpenUser: (username: string) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ListState>({ items: [], next: null, loading: true, error: '' });
  const [stats, setStats] = useState<AdminUsersStats | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  // Поиск — через 300 мс после последней буквы.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback((more: boolean) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setList((l) => ({ ...(more ? l : { items: [], next: null }), loading: true, error: '' }));
    const cursor = more ? list.next : null;
    socialApi.adminUsers(query, cursor, c.signal).then(
      (pg) => {
        if (c.signal.aborted) return;
        if (pg.stats) setStats(pg.stats);
        setList((l) => ({ items: more ? [...l.items, ...pg.items] : pg.items, next: pg.next, loading: false, error: '' }));
      },
      (e) => { if (!c.signal.aborted && !isAbort(e)) setList((l) => ({ ...l, loading: false, error: failText(e) })); },
    );
  }, [query, list.next]);

  // Новый поиск — первая страница заново.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(false); return () => ctrl.current?.abort(); }, [query]);

  let body: JSX.Element;
  if (list.loading && !list.items.length) body = <ListSkeleton rows={5} />;
  else if (list.error && !list.items.length) body = <LoadError text="Не удалось загрузить пользователей" detail={list.error} onRetry={() => load(false)} />;
  else if (!list.items.length) body = <p className="ppl-hint">{query ? 'Никого не нашли' : 'Пользователей пока нет'}</p>;
  else {
    body = (
      <>
        <ul className="adm-list">
          {list.items.map((u) => <Row key={u.id} u={u} onOpen={p.onOpenUser} />)}
        </ul>
        {list.next && (
          <div className="prof-more">
            {list.error
              ? <LoadError text="Не удалось загрузить" onRetry={() => load(true)} />
              : <Button variant="plain" size={44} busy={list.loading} onClick={() => load(true)}>Показать ещё</Button>}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="wrap wrap--prof prof-screen">
      {p.active && <NavBar left={<BackButton onClick={p.onBack} />} title="Пользователи" />}
      {stats ? <Stats st={stats} /> : <div className="adm-stats adm-stats--skel" aria-hidden="true" />}
      <form className="ppl-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <Icon name="search" size={18} className="ppl-search__ico" />
        <input
          className="ppl-search__in" type="search" value={q} placeholder="Имя, @имя или почта" aria-label="Имя, @имя или почта"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" maxLength={40}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        {list.loading && list.items.length > 0 && <Spinner size={16} />}
        {q && (
          <button type="button" className="ppl-search__x" aria-label="Очистить" onClick={() => setQ('')}>
            <Icon name="close" size={14} />
          </button>
        )}
      </form>
      <p className="adm-note">Нажми на человека — откроются почта, данные Google, входы и устройства.</p>
      {body}
    </div>
  );
}

export default AdminUsersView;
