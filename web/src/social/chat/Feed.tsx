// Лента вуза: 20 постов на страницу, догрузка у конца списка, кэш по темам (переключение чипов —
// без ожидания), тихое обновление первой страницы и плашка «Новые посты». Списки согласованы через
// события (social/events): новый пост, удаление, отметки, блокировка, скрытие автора, жалоба.
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState } from 'react';
import type { JSX, Ref } from 'react';
import { brand } from '../../brand';
import { store } from '../../lib/store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Spinner } from '../../ui/Spinner';
import { toast } from '../../ui/Toast';
import { useOnline } from '../../ui/online';
import { socialApi } from '../api';
import { useSocialEvents } from '../events';
import { hiddenUsers } from '../local';
import { useSession } from '../session';
import { categoryOf } from '../types';
import type { CategoryId, Page, Post } from '../types';
import { EmptyState } from '../ui/EmptyState';
import { PostCard, errText, handledBySession, isAbortError, reducedMotion, uniShort, withMe } from './PostCard';
import './chat.css';

const PAGE = 20;
const STALE_MS = 60_000;
const PILL_Y = 300;
const AHEAD = 800;

export interface FeedHandle {
  /** Первая страница заново (потянуть вниз, повторное нажатие на вкладку); список при этом не мигает. */
  reload(): Promise<void>;
}

interface Entry {
  items: Post[];
  next: string | null;
  at: number;                       // когда пришла первая страница
  state: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  more: 'idle' | 'loading' | 'error';
  fresh: Post[];                    // новые посты за плашкой «Новые посты»
  stale: boolean;                   // сменился человек (вход/выход) — список заменить целиком
  seq: number;
  main: AbortController | null;
  moreCtrl: AbortController | null;
}

const blank = (): Entry => ({
  items: [], next: null, at: 0, state: 'idle', error: '', more: 'idle', fresh: [], stale: false, seq: 0,
  main: null, moreCtrl: null,
});

function unique(list: Post[]): Post[] {
  const seen = new Set<number>();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/** Свежая первая страница поверх уже показанного списка (без прыжков: новое — сверху или за плашкой). */
function mergeTop(e: Entry, page: Page<Post>, holdNew: boolean) {
  const fresh = page.items;
  const byId = new Map(fresh.map((p) => [p.id, p]));
  const top = e.items.length ? e.items[0].id : 0;
  const known = new Set([...e.items, ...e.fresh].map((p) => p.id));
  const add = fresh.filter((p) => !known.has(p.id) && p.id > top);
  const addIds = new Set(add.map((p) => p.id));
  let rest: Post[];
  if (!page.next) {
    // Весь список помещается в первую страницу — она и есть список.
    rest = fresh.filter((p) => !addIds.has(p.id));
    e.next = null;
  } else {
    // Внутри свежего диапазона остаётся только то, что прислал сервер (удалённое и скрытое уходит).
    const bottom = fresh[fresh.length - 1].id;
    rest = e.items.filter((p) => p.id < bottom || byId.has(p.id)).map((p) => byId.get(p.id) ?? p);
  }
  if (holdNew) {
    e.items = rest;
    const held = e.fresh.map((p) => byId.get(p.id)).filter((p): p is Post => !!p);
    e.fresh = unique([...add, ...held]).sort((a, b) => b.id - a.id);
  } else {
    e.items = unique([...add, ...e.fresh, ...rest]);
    e.fresh = [];
  }
}

function OfflineRow(): JSX.Element {
  return (
    <div className="offline chat-offline" role="status">
      <Icon name="wifiOff" size={20} />
      <span><b>Без интернета.</b> Обсуждения обновятся, когда появится связь.</span>
    </div>
  );
}

function Skeleton(): JSX.Element {
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="post is-skel">
          <span className="post__skav" />
          <span className="post__skl">
            <i style={{ width: '46%' }} /><i style={{ width: '92%' }} /><i style={{ width: i === 1 ? '58%' : '74%' }} />
          </span>
        </div>
      ))}
    </div>
  );
}

const FeedItem = memo(function FeedItem(p: {
  post: Post;
  onOpenThread: (id: number, focus?: boolean) => void;
  onOpenUser: (username: string) => void;
  onPatch: (id: number, np: Post | null) => void;
}): JSX.Element {
  const { post, onOpenThread, onPatch } = p;
  return (
    <PostCard
      post={post} clamp onOpenUser={p.onOpenUser}
      onOpen={(focus) => onOpenThread(post.id, focus)}
      onChange={(np) => onPatch(post.id, np)}
    />
  );
});

export function Feed(p: {
  ref?: Ref<FeedHandle>;
  active: boolean;
  cat: CategoryId | '';
  canCompose: boolean;
  onCompose: () => void;
  onOpenThread: (id: number, focus?: boolean) => void;
  onOpenUser: (username: string) => void;
}): JSX.Element {
  const session = useSession();
  const online = useOnline();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [hideVer, setHideVer] = useState(0);
  const cache = useRef(new Map<string, Entry>());
  const catRef = useRef(p.cat);
  catRef.current = p.cat;
  const activeRef = useRef(p.active);
  activeRef.current = p.active;
  const sentinel = useRef<HTMLDivElement>(null);

  const get = useCallback((cat: string): Entry => {
    let e = cache.current.get(cat);
    if (!e) { e = blank(); cache.current.set(cat, e); }
    return e;
  }, []);

  const near = () => {
    const el = sentinel.current;
    return !!el && el.getClientRects().length > 0 && el.getBoundingClientRect().top < window.innerHeight + AHEAD;
  };

  const loadMore = useCallback(async (cat: string) => {
    const e = get(cat);
    if (!e.next || e.more === 'loading' || e.state !== 'ready' || !store('agreed')) return;
    const c = new AbortController();
    e.moreCtrl = c;
    e.more = 'loading';
    bump();
    let got = 0;
    try {
      const page = await socialApi.feed({ category: categoryOf(cat)?.id ?? null, cursor: e.next, limit: PAGE }, c.signal);
      if (c.signal.aborted) return;
      const known = new Set(e.items.map((x) => x.id));
      const add = page.items.filter((x) => !known.has(x.id));
      got = add.length;
      e.items = [...e.items, ...add];
      e.next = page.next;
      e.more = 'idle';
    } catch (err) {
      if (isAbortError(err) || c.signal.aborted) return;
      e.more = 'error';
    } finally {
      if (e.moreCtrl === c) e.moreCtrl = null;
      bump();
    }
    // Конец списка всё ещё рядом (короткая страница) — берём следующую.
    if (got > 0) requestAnimationFrame(() => { if (catRef.current === cat && activeRef.current && near()) void loadMore(cat); });
  }, [get]);

  const run = useCallback(async (cat: string, kindIn: 'first' | 'refresh' | 'silent') => {
    if (!store('agreed')) return;
    const e = get(cat);
    let kind = kindIn;
    if (kind !== 'first' && !e.items.length) kind = 'first';
    if (kind === 'silent' && e.stale) kind = 'refresh';
    e.main?.abort();
    if (kind !== 'silent') { e.moreCtrl?.abort(); e.moreCtrl = null; e.more = 'idle'; }
    const c = new AbortController();
    e.main = c;
    const seq = ++e.seq;
    if (kind === 'first') { e.state = 'loading'; e.error = ''; }
    bump();
    try {
      const page = await socialApi.feed({ category: categoryOf(cat)?.id ?? null, limit: PAGE }, c.signal);
      if (seq !== e.seq) return;
      if (kind === 'silent') {
        const hold = activeRef.current && catRef.current === cat && window.scrollY > PILL_Y;
        mergeTop(e, page, hold);
      } else {
        e.items = unique(page.items);
        e.next = page.next;
        e.fresh = [];
      }
      e.stale = false;
      e.state = 'ready';
      e.error = '';
      e.at = Date.now();
    } catch (err) {
      if (isAbortError(err) || seq !== e.seq) return;
      if (!e.items.length) { e.state = 'error'; e.error = errText(err); }
      else if (kind === 'refresh' && !handledBySession(err)) toast(errText(err), { kind: 'error' });
    } finally {
      if (e.main === c) e.main = null;
      bump();
    }
  }, [get]);

  useImperativeHandle(p.ref, () => ({ reload: () => run(catRef.current, 'refresh') }), [run]);

  // Открыли вкладку или сменили тему: первая загрузка, либо тихое обновление, если данные старше минуты.
  useEffect(() => {
    if (!p.active) return;
    const e = get(p.cat);
    if (e.state === 'idle' || e.state === 'error') void run(p.cat, 'first');
    else if (e.state === 'ready' && (e.stale || Date.now() - e.at > STALE_MS)) void run(p.cat, 'silent');
  }, [p.active, p.cat, get, run]);

  // Вернулась сеть — обновить то, что на экране.
  const wasOnline = useRef(online);
  useEffect(() => {
    const was = wasOnline.current;
    wasOnline.current = online;
    if (!online || was || !activeRef.current) return;
    void run(catRef.current, 'silent');
  }, [online, run]);

  // Вернулись в приложение через минуту и больше — тихо проверить новое.
  useEffect(() => {
    const on = () => {
      if (document.visibilityState !== 'visible' || !activeRef.current) return;
      const e = get(catRef.current);
      if (e.state === 'ready' && Date.now() - e.at > STALE_MS) void run(catRef.current, 'silent');
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [get, run]);

  // Сменился человек (вход, выход, сессия истекла): отметки, «мои» и жалобы у всех постов другие.
  const meKey = session.status === 'loading' ? null : session.status === 'signed' ? (session.me?.id ?? 0) : 0;
  const lastKey = useRef<number | null>(null);
  useEffect(() => {
    if (meKey === null) return;
    const prev = lastKey.current;
    lastKey.current = meKey;
    if (prev === null || prev === meKey) return;
    for (const e of cache.current.values()) if (e.items.length) e.stale = true;
    if (activeRef.current) void run(catRef.current, 'refresh');
  }, [meKey, run]);

  // Догрузка, когда до конца списка меньше 800 px.
  const cur = get(p.cat);
  const hasNext = !!cur.next;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNext || typeof IntersectionObserver === 'undefined') return;
    const cat = p.cat;
    const io = new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting)) void loadMore(cat);
    }, { rootMargin: `0px 0px ${AHEAD}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNext, p.cat, cur.state, loadMore]);

  // Прокрутили наверх сами — новые посты встают в список без плашки.
  const pill = cur.fresh.length > 0;
  const showFresh = useCallback(() => {
    const e = get(catRef.current);
    if (!e.fresh.length) return;
    e.items = unique([...e.fresh, ...e.items]);
    e.fresh = [];
    bump();
  }, [get]);
  useEffect(() => {
    if (!pill || !p.active) return;
    const on = () => { if (window.scrollY < 80) showFresh(); };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [pill, p.active, showFresh]);

  // Закрываем запросы при уходе.
  useEffect(() => () => {
    for (const e of cache.current.values()) { e.main?.abort(); e.moreCtrl?.abort(); }
  }, []);

  // ─── События ───
  const each = (fn: (e: Entry, cat: string) => void) => { for (const [cat, e] of cache.current) fn(e, cat); };
  const patchAll = (id: number, fn: (x: Post) => Post | null) => {
    each((e) => {
      if (!e.items.some((x) => x.id === id) && !e.fresh.some((x) => x.id === id)) return;
      const map = (list: Post[]) => list.map((x) => (x.id === id ? fn(x) : x)).filter((x): x is Post => !!x);
      e.items = map(e.items);
      e.fresh = map(e.fresh);
    });
  };
  const dropAuthor = (userId: number) => {
    each((e) => {
      e.items = e.items.filter((x) => x.author?.id !== userId);
      e.fresh = e.fresh.filter((x) => x.author?.id !== userId);
    });
  };

  useSocialEvents((ev) => {
    switch (ev.type) {
      case 'post-created': {
        const post = ev.post;
        if (post.rootId !== null || post.uni !== brand.id) return;
        each((e, cat) => {
          if (cat !== '' && cat !== post.category) return;
          if (e.items.some((x) => x.id === post.id)) return;
          if (e.state === 'ready') e.items = [post, ...e.items];
        });
        break;
      }
      case 'post-deleted':
        if (ev.rootId === null) patchAll(ev.id, () => null);
        else patchAll(ev.rootId, (x) => ({ ...x, replies: Math.max(0, x.replies - 1) }));
        break;
      case 'reply-created':
        if (ev.reply.rootId !== null) patchAll(ev.reply.rootId, (x) => ({ ...x, replies: x.replies + 1 }));
        break;
      case 'like':
        patchAll(ev.id, (x) => ({ ...x, likes: ev.likes, liked: ev.liked }));
        break;
      case 'block':
        dropAuthor(ev.userId);
        break;
      case 'unblock':
        // Посты разблокированного вернутся при следующем показе ленты.
        each((e) => { if (e.items.length) e.stale = true; });
        if (activeRef.current) void run(catRef.current, 'refresh');
        return;
      case 'hide-user':
        dropAuthor(ev.userId);
        setHideVer((n) => n + 1);
        break;
      case 'reported':
        if (ev.target.type === 'post') patchAll(ev.target.id, (x) => ({ ...x, reported: true }));
        break;
      case 'me-changed': {
        // Сменили имя или фото — свои посты в списке сразу с новыми.
        const fix = withMe(ev.me);
        if (!fix) return;
        each((e) => { e.items = e.items.map(fix); e.fresh = e.fresh.map(fix); });
        break;
      }
      case 'moderated':
        if (ev.target.type !== 'post') return;
        if (ev.action === 'delete') patchAll(ev.target.id, () => null);
        else if (ev.action === 'hide') patchAll(ev.target.id, (x) => ({ ...x, hidden: true }));
        else if (ev.action === 'unhide') patchAll(ev.target.id, (x) => ({ ...x, hidden: false }));
        break;
      default:
        return;
    }
    bump();
  });

  const onPatch = useCallback((id: number, np: Post | null) => {
    for (const e of cache.current.values()) {
      if (!e.items.some((x) => x.id === id)) continue;
      e.items = np ? e.items.map((x) => (x.id === id ? np : x)) : e.items.filter((x) => x.id !== id);
    }
    bump();
  }, []);

  // Скрытые на этом телефоне авторы (для гостя; вошедший их снова видит — там есть блокировка).
  const guest = session.status !== 'signed';
  // hideVer: после «Скрыть посты @u» список скрытых перечитывается.
  const hidden = useMemo(() => (guest && hideVer >= 0 ? new Set(hiddenUsers().map((u) => u.id)) : null), [guest, hideVer]);
  const items = hidden ? cur.items.filter((x) => !x.author || !hidden.has(x.author.id)) : cur.items;

  const retryFirst = () => void run(p.cat, 'first');
  const label = categoryOf(p.cat)?.label;

  const toTop = () => {
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    showFresh();
  };

  return (
    <div className="chat-feed">
      {!online && <OfflineRow />}
      {cur.state === 'loading' && !cur.items.length && <Skeleton />}
      {cur.state === 'error' && !cur.items.length && online && (
        <div className="alert is-on" role="alert">
          <span className="dot dot--bad" />
          <div className="alert__text"><b>Не удалось загрузить обсуждения</b><span>{cur.error}</span></div>
          <button type="button" className="hdr__btn chat-retry" onClick={retryFirst}>Повторить</button>
        </div>
      )}
      {cur.state === 'ready' && !items.length && (
        p.cat === ''
          ? (
            <EmptyState
              icon="bubbles" title="Здесь пока тихо"
              text={`Задай вопрос или поделись новостью — обсуждение увидят все в ${uniShort()}.`}
              action={p.canCompose ? { label: 'Написать пост', onClick: p.onCompose } : undefined}
            />
          )
          : (
            <div className="chat-empty">
              <p className="chat-empty__t">В разделе «{label}» пока пусто</p>
              {p.canCompose && <Button variant="plain" onClick={p.onCompose}>Написать пост</Button>}
            </div>
          )
      )}
      {items.map((post) => (
        <FeedItem key={post.id} post={post} onOpenThread={p.onOpenThread} onOpenUser={p.onOpenUser} onPatch={onPatch} />
      ))}
      <div ref={sentinel} className="chat-sentinel" aria-hidden="true" />
      {cur.more === 'loading' && <div className="chat-more"><Spinner size={22} /></div>}
      {cur.more === 'error' && (
        <div className="chat-more chat-more--err">
          <span>Не удалось загрузить</span>
          <button type="button" className="hdr__btn chat-retry" onClick={() => { get(p.cat).more = 'idle'; void loadMore(p.cat); }}>
            Повторить
          </button>
        </div>
      )}
      {cur.state === 'ready' && !cur.next && items.length > 0 && <p className="chat-end">Это всё</p>}
      {pill && p.active && (
        <button type="button" className="newpill" onClick={toTop}>
          <Icon name="send" size={16} />Новые посты
        </button>
      )}
    </div>
  );
}
