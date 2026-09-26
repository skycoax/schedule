// Жалобы (только модераторам): очередь по целям (пост, ответ, профиль), решения одной кнопкой.
// У каждого фото — превью и оригинал рядом: так видно, если миниатюру подменили (это повод для бессрочного ограничения).
// Грузится лениво: обычным людям этот код не нужен.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { plural } from '../../lib/plural';
import { NavBar, BackButton } from '../../shell/NavBar';
import { chooseAction, confirmDialog, promptText } from '../../ui/ActionSheet';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { toast } from '../../ui/Toast';
import { socialApi } from '../api';
import { emit } from '../events';
import { banText, relTime } from '../format';
import { useSession } from '../session';
import { REPORT_REASONS } from '../types';
import type { AdminActionBody, AdminStats, MediaRef, ReportCase, ReportReason, ResetField } from '../types';
import { Avatar } from '../ui/Avatar';
import { NameBadge } from '../ui/Badges';
import { EmptyState } from '../ui/EmptyState';
import { PhotoViewer } from '../ui/PhotoViewer';
import { RichText } from '../ui/RichText';
import { ListSkeleton, LoadError } from './ProfileHeader';
import { failText, isAbort, toastFail } from './UsernameField';
import './profile.css';

type Status = 'open' | 'closed';
interface ListState { items: ReportCase[]; next: string | null; loading: boolean; error: string }
const EMPTY: ListState = { items: [], next: null, loading: true, error: '' };

const REASON = new Map(REPORT_REASONS.map((r) => [r.id, r]));

function statsLine(st: AdminStats): string {
  return `Пользователей: ${st.users} · сегодня ${st.postsToday} ${plural(st.postsToday, ['пост', 'поста', 'постов'])} и `
    + `${st.repliesToday} ${plural(st.repliesToday, ['ответ', 'ответа', 'ответов'])} · скрыто ${st.hiddenPosts} · `
    + `ограничено ${st.bannedUsers}`;
}

function kindOf(c: ReportCase): 'ПОСТ' | 'ОТВЕТ' | 'ПРОФИЛЬ' | 'МОМЕНТ' {
  if (c.target.type === 'instant') return 'МОМЕНТ';
  if (c.target.type === 'user') return 'ПРОФИЛЬ';
  if (c.snapshot?.kind === 'reply' || (c.post && c.post.rootId !== null)) return 'ОТВЕТ';
  return 'ПОСТ';
}

/** Превью и оригинал рядом; нажатие открывает картинку во весь экран. */
function PhotoPairs(p: { pairs: { key: string; small: string; big: string; w: number; h: number; labels: [string, string] }[] }) {
  const [view, setView] = useState<MediaRef | null>(null);
  if (!p.pairs.length) return null;
  return (
    <div className="mod-photos">
      {p.pairs.map((m) => (
        <div key={m.key} className="mod-pair">
          {([[m.small, m.labels[0]], [m.big, m.labels[1]]] as const).map(([src, label]) => (
            <figure key={label} className="mod-ph">
              <button type="button" className="mod-ph__btn" aria-label={label + ' — открыть'}
                onClick={() => setView({ id: m.key + label, url: src, thumb: src, w: m.w, h: m.h })}>
                <img src={src} alt="" loading="lazy" decoding="async" />
              </button>
              <figcaption className="mod-ph__cap">{label}</figcaption>
            </figure>
          ))}
        </div>
      ))}
      <PhotoViewer media={view ? [view] : []} index={0} open={!!view} onClose={() => setView(null)} />
    </div>
  );
}

function CaseCard(p: {
  c: ReportCase;
  closed: boolean;
  busy: boolean;
  onAct: (c: ReportCase, a: 'delete' | 'hide' | 'unhide' | 'ban' | 'unban' | 'reset' | 'dismiss') => void;
  onOpenUser: (username: string) => void;
  onOpenThread: (postId: number) => void;
}): JSX.Element {
  const { c } = p;
  const kind = kindOf(c);
  const livePost = c.target.type === 'post' && c.post && !c.post.deleted ? c.post : null;
  const snap = c.snapshot;
  const u = c.user;
  const uni = livePost?.uniShort || (c.target.type === 'user' ? u?.uniShort : null);
  const count = `${c.reporters} ${plural(c.reporters, ['жалоба', 'жалобы', 'жалоб'])}`;
  const threadId = livePost ? livePost.rootId ?? livePost.id : snap?.rootId ?? null;

  // Фото: у поста — его фото (или из снимка), у момента — его снимок, у профиля — аватар 128 и 512.
  const pairs: { key: string; small: string; big: string; w: number; h: number; labels: [string, string] }[] = [];
  if (c.target.type === 'instant') {
    for (const m of snap?.media || []) pairs.push({ key: m.id, small: m.thumb || m.url, big: m.url, w: m.w, h: m.h, labels: ['Превью', 'Оригинал'] });
  } else if (c.target.type === 'post') {
    for (const m of (livePost ? livePost.media : snap?.media) || []) {
      pairs.push({ key: m.id, small: m.thumb || m.url, big: m.url, w: m.w, h: m.h, labels: ['Превью', 'Оригинал'] });
    }
  } else if (u && (u.avatar || u.avatarFull)) {
    pairs.push({ key: 'av' + u.id, small: u.avatar || u.avatarFull || '', big: u.avatarFull || u.avatar || '', w: 512, h: 512,
      labels: ['Превью', 'Оригинал'] });
  } else if (!u && snap) {
    for (const m of snap.media) pairs.push({ key: m.id, small: m.thumb || m.url, big: m.url, w: m.w, h: m.h, labels: ['Превью', 'Оригинал'] });
  }

  const reasons = (Object.entries(c.reasons) as [ReportReason, number][]).filter(([, n]) => n > 0);
  const name = u?.name ?? snap?.name ?? null;
  const username = u?.username ?? snap?.username ?? null;
  const banned = u?.status === 'banned';

  return (
    <article className={'mod-case' + (c.severe ? ' is-severe' : '')} aria-label={`${kind}, ${count}`}>
      <p className="mod-eb">
        <b>{kind}</b>
        {uni && <span> · {uni}</span>}
        <span> · {count}</span>
        <span> · {relTime(c.lastAt)}</span>
        {c.hidden && <span className="mod-tag">Скрыто</span>}
      </p>

      <div className="mod-who">
        {u ? (
          <button type="button" className="mod-who__btn" onClick={() => p.onOpenUser(u.username)}>
            <Avatar user={u} size={40} />
            <span className="mod-who__txt">
              <span className="mod-who__name">{u.name}<NameBadge u={u} /></span>
              <span className="mod-who__sub">@{u.username}{u.openReports > 1 ? ` · открытых жалоб: ${u.openReports}` : ''}</span>
            </span>
          </button>
        ) : (
          <span className="mod-who__btn">
            <Avatar user={null} size={40} />
            <span className="mod-who__txt">
              <span className="mod-who__name">{name || 'Удалённый аккаунт'}</span>
              {username && <span className="mod-who__sub">@{username}</span>}
            </span>
          </span>
        )}
      </div>

      {banned && u?.banned && <p className="mod-ban">{banText(u.banned)}</p>}

      {c.target.type === 'post' && livePost && (
        <RichText className="mod-text" text={livePost.rawText || livePost.text} onMention={p.onOpenUser} />
      )}
      {c.target.type === 'post' && !livePost && (
        <>
          {/* В открытом деле публикацию мог удалить только автор; в решённом — и модератор. */}
          <p className="mod-gone">{p.closed ? 'Публикация удалена' : 'Автор удалил публикацию'}</p>
          {snap?.text && <p className="mod-text mod-text--snap">{snap.text}</p>}
        </>
      )}
      {c.target.type === 'instant' && (
        <p className="mod-gone">{c.gone ? 'Момента больше нет' : 'Момент — фото, которое автор показывает на сутки'}</p>
      )}
      {c.target.type === 'user' && (
        <>
          {!u && <p className="mod-gone">Аккаунт удалён</p>}
          {(u?.bio || snap?.text) && <p className="mod-text mod-text--snap">{u ? u.bio : snap?.text}</p>}
          {u && (u.links.tg || u.links.ig) && (
            <p className="mod-links">
              {u.links.tg && <span>Telegram: {u.links.tg}</span>}
              {u.links.ig && <span>Instagram: {u.links.ig}</span>}
            </p>
          )}
        </>
      )}

      <PhotoPairs pairs={pairs} />

      {reasons.length > 0 && (
        <p className="mod-reasons">
          {reasons.map(([id, n], i) => (
            <span key={id} className={REASON.get(id)?.severe ? 'is-severe' : undefined}>
              {i > 0 && ' · '}{REASON.get(id)?.label || id} ×{n}
            </span>
          ))}
        </p>
      )}
      {c.notes.length > 0 && (
        <ul className="mod-notes">{c.notes.map((n, i) => <li key={i}>«{n}»</li>)}</ul>
      )}
      {threadId !== null && (
        <button type="button" className="mod-link" onClick={() => p.onOpenThread(threadId)}>Открыть обсуждение</button>
      )}
      {p.closed && (
        <p className="mod-done">Решено{c.resolvedBy ? ' · ' + c.resolvedBy : ''}{c.resolvedAt ? ' · ' + relTime(c.resolvedAt) : ''}</p>
      )}

      <div className="mod-acts">
        {c.target.type === 'instant' && !c.gone && (
          <Button size={32} variant="destructive" disabled={p.busy} onClick={() => p.onAct(c, 'delete')}>Удалить момент</Button>
        )}
        {livePost && (
          <>
            <Button size={32} variant="destructive" disabled={p.busy} onClick={() => p.onAct(c, 'delete')}>Удалить</Button>
            <Button size={32} variant="tinted" disabled={p.busy} onClick={() => p.onAct(c, c.hidden ? 'unhide' : 'hide')}>
              {c.hidden ? 'Вернуть' : 'Скрыть'}
            </Button>
          </>
        )}
        {u && (banned
          ? <Button size={32} variant="tinted" disabled={p.busy} onClick={() => p.onAct(c, 'unban')}>Снять ограничение</Button>
          : <Button size={32} variant="tinted" disabled={p.busy} onClick={() => p.onAct(c, 'ban')}>Ограничить…</Button>)}
        {u && c.target.type === 'user' && (
          <Button size={32} variant="tinted" disabled={p.busy} onClick={() => p.onAct(c, 'reset')}>Сбросить…</Button>
        )}
        {!p.closed && (
          <Button size={32} variant="plain" disabled={p.busy} onClick={() => p.onAct(c, 'dismiss')}>Отклонить</Button>
        )}
      </div>
    </article>
  );
}

export function ModerationView(p: {
  active: boolean;
  onBack: () => void;
  onOpenUser: (username: string) => void;
  onOpenThread: (postId: number) => void;
}): JSX.Element {
  const s = useSession();
  const [tab, setTab] = useState<Status>('open');
  const [lists, setLists] = useState<Record<Status, ListState | null>>({ open: null, closed: null });
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ctrl = useRef<Record<Status, AbortController | null>>({ open: null, closed: null });

  const loadStats = useCallback(() => {
    socialApi.adminStats().then(setStats, () => {});
  }, []);

  const listsRef = useRef(lists);
  listsRef.current = lists;

  const load = useCallback((st: Status, more = false) => {
    const had = listsRef.current[st];
    const cursor = more && had ? had.next : null;
    if (more && !cursor) return;
    ctrl.current[st]?.abort();
    const c = new AbortController();
    ctrl.current[st] = c;
    setLists((l) => {
      const cur = l[st];
      return { ...l, [st]: more && cur ? { ...cur, loading: true, error: '' } : { ...EMPTY } };
    });
    socialApi.adminReports(st, cursor, c.signal).then(
      (pg) => {
        if (c.signal.aborted) return;
        setLists((l) => {
          const prev = more ? l[st]?.items || [] : [];
          const items = [...prev, ...pg.items.filter((x) => !prev.some((y) => y.key === x.key))];
          return { ...l, [st]: { items, next: pg.next, loading: false, error: '' } };
        });
      },
      (e) => {
        if (c.signal.aborted || isAbort(e)) return;
        setLists((l) => ({ ...l, [st]: { ...(l[st] || EMPTY), loading: false, error: failText(e) } }));
      },
    );
  }, []);

  useEffect(() => {
    if (!p.active) return;
    loadStats();
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.active]);
  useEffect(() => () => { ctrl.current.open?.abort(); ctrl.current.closed?.abort(); }, []);

  // Вернулась сеть, а список не загрузился — загружаем снова.
  const online = s.online;
  useEffect(() => {
    const cur = listsRef.current[tab];
    if (!online || !p.active || !cur || !cur.error) return;
    loadStats();
    load(tab, !!cur.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const switchTab = (t: Status) => {
    setTab(t);
    if (!lists[t]) load(t);
  };

  const run = async (c: ReportCase, body: AdminActionBody, text: string) => {
    setBusy(c.key);
    try {
      await socialApi.adminAction(body);
      toast(text);
      emit({ type: 'moderated', target: body.target, action: body.action });
      // Ограничение касается человека: обновляем все его дела в списке, а не только это.
      const who = c.user?.id;
      const ban = body.action === 'ban'
        ? { until: body.days ? new Date(Date.now() + body.days * 864e5).toISOString() : null, reason: body.reason || '' }
        : null;
      const patch = (x: ReportCase): ReportCase => {
        if (!who || !x.user || x.user.id !== who) return x;
        if (body.action === 'ban') return { ...x, user: { ...x.user, status: 'banned', banned: ban } };
        if (body.action === 'unban') return { ...x, user: { ...x.user, status: 'active', banned: null } };
        return x;
      };
      // Жалобы дела решены, если действие было над самой целью дела (снятие ограничения их не решает).
      const resolved = body.action !== 'unban' && body.target.type === c.target.type && body.target.id === c.target.id;
      setLists((l) => {
        const upd = (st: Status): ListState | null => {
          const cur = l[st];
          if (!cur) return null;
          const items = st === 'open' && resolved ? cur.items.filter((x) => x.key !== c.key) : cur.items;
          return { ...cur, items: items.map(patch) };
        };
        // Решённое дело появится в «Решённых» — их перечитаем при переходе (или сразу, если открыты они).
        return { open: upd('open'), closed: tab === 'closed' ? upd('closed') : null };
      });
      if (tab === 'closed' && resolved) load('closed');
      loadStats();
    } catch (e) {
      toastFail(e);
    } finally {
      setBusy(null);
    }
  };

  const act = async (c: ReportCase, a: 'delete' | 'hide' | 'unhide' | 'ban' | 'unban' | 'reset' | 'dismiss') => {
    const target = c.target;
    // Публикации уже нет — ограничивать и сбрасывать можно только через самого автора (сервер не найдёт пост).
    const userTarget = c.user ? { type: 'user' as const, id: c.user.id } : null;
    const postGone = target.type === 'post' && (!c.post || c.post.deleted);
    const person = (postGone && userTarget) || target;
    switch (a) {
      case 'delete': {
        const ok = await confirmDialog({
          title: 'Удалить как модератор?', message: 'Публикация исчезнет у всех. Это нельзя отменить.', confirm: 'Удалить',
          destructive: true,
        });
        if (ok) await run(c, { action: 'delete', target }, 'Удалено');
        return;
      }
      case 'hide': await run(c, { action: 'hide', target }, 'Скрыто'); return;
      case 'unhide': await run(c, { action: 'unhide', target }, 'Возвращено'); return;
      case 'unban': await run(c, { action: 'unban', target: userTarget || target }, 'Ограничение снято'); return;
      case 'dismiss': await run(c, { action: 'dismiss', target }, 'Жалоба отклонена'); return;
      case 'ban': {
        const d = await chooseAction({
          title: target.type === 'post' ? 'Ограничить автора' : 'Ограничить пользователя',
          actions: [
            { id: '1', label: 'На сутки' }, { id: '7', label: 'На неделю' }, { id: '30', label: 'На месяц' },
            { id: 'forever', label: 'Навсегда' },
          ],
        });
        if (!d) return;
        const reason = await promptText({ title: 'Причина', placeholder: 'Например: спам', confirm: 'Ограничить', required: true, maxLength: 200 });
        if (!reason) return;
        const days = d === 'forever' ? null : (Number(d) as 1 | 7 | 30);
        await run(c, { action: 'ban', target: person, days, reason }, 'Автор ограничен');
        return;
      }
      case 'reset': {
        const f = await chooseAction({
          title: 'Сбросить профиль',
          actions: [
            { id: 'avatar', label: 'Сбросить фото' }, { id: 'bio', label: 'Сбросить «О себе»' },
            { id: 'links', label: 'Сбросить ссылки' }, { id: 'name', label: 'Сбросить имя' },
          ],
        });
        if (!f) return;
        await run(c, { action: 'reset', target: person, fields: [f as ResetField] }, 'Сброшено');
      }
    }
  };

  const cur = lists[tab];
  const openCount = stats?.openReports ?? s.me?.modQueue ?? 0;

  let body: JSX.Element;
  if (!cur || (cur.loading && !cur.items.length)) body = <ListSkeleton rows={3} />;
  else if (cur.error && !cur.items.length) body = <LoadError text="Не удалось загрузить жалобы" detail={cur.error} onRetry={() => load(tab)} />;
  else if (!cur.items.length) body = <EmptyState icon="shield" title="Жалоб нет" />;
  else {
    body = (
      <>
        <div className="mod-list">
          {cur.items.map((c) => (
            <CaseCard key={c.key} c={c} closed={tab === 'closed'} busy={busy === c.key}
              onAct={(x, a) => void act(x, a)} onOpenUser={p.onOpenUser} onOpenThread={p.onOpenThread} />
          ))}
        </div>
        {cur.next && (
          <div className="prof-more">
            {cur.error
              ? <LoadError text="Не удалось загрузить" onRetry={() => load(tab, true)} />
              : <Button variant="plain" size={44} busy={cur.loading} onClick={() => load(tab, true)}>Показать ещё</Button>}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="wrap wrap--prof prof-screen">
      {p.active && <NavBar left={<BackButton onClick={p.onBack} />} title="Жалобы" />}
      <p className="mod-stats">{stats ? statsLine(stats) : ' '}</p>
      <div className="frd-seg">
        <Segmented<Status>
          ariaLabel="Жалобы" value={tab} onChange={switchTab} asTabs controls="mod-panel"
          options={[{ value: 'open', label: `Открытые · ${openCount}` }, { value: 'closed', label: 'Решённые' }]}
        />
      </div>
      <div id="mod-panel" role="tabpanel">{body}</div>
    </div>
  );
}

export default ModerationView;
