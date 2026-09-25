// Ветка: публикация целиком, ответы по порядку (старые сверху, по 50) и строка ответа внизу.
// Экран стека «Обсуждений» и «Профиля»: свой .wrap, своя строка навигации; пока открыт, панель вкладок
// скрыта. Ссылка на ответ (?post=<id ответа>) открывает ветку и подсвечивает этот ответ.
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { brand } from '../../brand';
import { plural } from '../../lib/plural';
import { BackButton, NavBar, NavButton, NavPlaceholder } from '../../shell/NavBar';
import { useHideTabBar } from '../../ui/bar';
import { Icon } from '../../ui/icons';
import { Spinner } from '../../ui/Spinner';
import { useOnline } from '../../ui/online';
import { isApiError, socialApi } from '../api';
import { useSocialEvents } from '../events';
import { hiddenUsers } from '../local';
import { fullTime } from '../format';
import { postLink, useSocialActions } from '../actions';
import { currentReturnTo, useSession } from '../session';
import { categoryOf } from '../types';
import type { Post } from '../types';
import { Avatar } from '../ui/Avatar';
import { TeamBadge, UniBadge } from '../ui/Badges';
import { EmptyState } from '../ui/EmptyState';
import { PhotoGrid } from '../ui/PhotoGrid';
import { PhotoViewer } from '../ui/PhotoViewer';
import { RichText } from '../ui/RichText';
import { BubbleIcon, ScreenVisible, errText, hiddenText, isAbortError, reducedMotion, useLike, useMinute, withMe } from './PostCard';
import { ReplyComposer } from './ReplyComposer';
import { ReplyRow } from './ReplyRow';
import './chat.css';

/** По возрастанию id, без повторов. */
function mergeReplies(a: Post[], b: Post[]): Post[] {
  const map = new Map<number, Post>();
  for (const x of a) map.set(x.id, x);
  for (const x of b) map.set(x.id, x);
  return [...map.values()].sort((x, y) => x.id - y.id);
}

const tomb = (x: Post): Post => ({ ...x, deleted: true, text: '', author: null, media: [], likes: 0, liked: false, hidden: false });

function Skeleton(): JSX.Element {
  return (
    <div aria-hidden="true">
      <div className="thr__main is-skel">
        <span className="thr__skhead"><span className="post__skav post__skav--44" /><span className="post__skl"><i style={{ width: '40%' }} /><i style={{ width: '28%' }} /></span></span>
        <span className="post__skl"><i style={{ width: '96%' }} /><i style={{ width: '88%' }} /><i style={{ width: '52%' }} /></span>
      </div>
      <div className="thr__list">
        {[0, 1].map((i) => (
          <div key={i} className="rrow is-skel">
            <span className="post__skav post__skav--32" />
            <span className="post__skl"><i style={{ width: '38%' }} /><i style={{ width: i ? '64%' : '84%' }} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Публикация наверху ветки: крупнее, текст целиком, полное время, счётчики и подписанные действия. */
function ThreadMain(p: {
  post: Post;
  returnTo: string;
  onChange: (np: Post) => void;
  onOpenUser: (username: string) => void;
  onReply: () => void;
}): JSX.Element {
  const { post } = p;
  const session = useSession();
  const actions = useSocialActions();
  const [reveal, setReveal] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const like = useLike(post, p.onChange, p.returnTo);

  if (post.deleted) {
    return <div className="thr__main thr__main--gone"><p>Пост удалён</p></div>;
  }
  if (post.reported && !reveal) {
    return (
      <div className="thr__main post--min">
        <span>Жалоба отправлена</span>
        <span aria-hidden="true">{'\u00a0·'}</span>
        <button type="button" className="post__show" onClick={() => setReveal(true)}>Показать</button>
      </div>
    );
  }

  const author = post.author;
  const cat = categoryOf(post.category);
  const otherUni = post.uni !== brand.id && !!post.uniShort;
  const ro = session.mode !== 'on';
  const openUser = () => { if (author) p.onOpenUser(author.username); };
  const counts = [
    post.replies > 0 ? `${post.replies} ${plural(post.replies, ['ответ', 'ответа', 'ответов'])}` : '',
    post.likes > 0 ? `${post.likes} ${plural(post.likes, ['отметка «нравится»', 'отметки «нравится»', 'отметок «нравится»'])}` : '',
  ].filter(Boolean);

  return (
    <article className={'thr__main' + (post.hidden ? ' is-hidden' : '')} aria-labelledby={`t-${post.id}-name`}>
      <div className="thr__head">
        <Avatar user={author} size={44} onClick={author ? openUser : undefined} label={author ? author.name : undefined} />
        <div className="thr__who">
          <div className="thr__nm">
            {author
              ? <button type="button" className="thr__name" id={`t-${post.id}-name`} onClick={openUser}>{author.name}</button>
              : <span className="thr__name post__name--gone" id={`t-${post.id}-name`}>Удалённый аккаунт</span>}
            {author?.team && <span className="post__badge"><TeamBadge /></span>}
          </div>
          {author && <span className="thr__user">@{author.username}</span>}
        </div>
      </div>
      {post.hidden && <p className="post__flag"><Icon name="lock" size={14} />{hiddenText(post)}</p>}
      {post.text && <RichText className="thr__text" text={post.text} onMention={p.onOpenUser} />}
      {post.media.length > 0 && <div className="thr__media"><PhotoGrid media={post.media} onOpen={setViewer} /></div>}
      <p className="thr__meta">
        <time dateTime={post.createdAt}>{fullTime(post.createdAt)}</time>
        {cat && <span>· {cat.label}</span>}
        {otherUni && <UniBadge short={post.uniShort as string} />}
      </p>
      {counts.length > 0 && <p className="thr__counts">{counts.join(' · ')}</p>}
      <div className="thr__acts">
        <button type="button" className="thr__act" disabled={ro} onClick={p.onReply}>
          <BubbleIcon size={20} /><span>Ответить</span>
        </button>
        <button type="button" className={'thr__act post__act--like' + (post.liked ? ' is-on' : '')} disabled={ro} aria-pressed={post.liked} onClick={like}>
          <Icon name={post.liked ? 'heartFill' : 'heart'} size={20} /><span>Нравится</span>
        </button>
        <button type="button" className="thr__act thr__act--icon" aria-label="Поделиться" onClick={() => void actions.share(postLink(post))}>
          <Icon name="share" size={20} />
        </button>
      </div>
      <PhotoViewer media={post.media} index={viewer ?? 0} open={viewer !== null} onClose={() => setViewer(null)} />
    </article>
  );
}

export function ThreadView(p: {
  postId: number;
  focusComposer?: boolean;
  onBack: () => void;
  onOpenUser: (username: string) => void;
}): JSX.Element {
  const session = useSession();
  const actions = useSocialActions();
  const online = useOnline();
  // Пока ветка на экране, внизу строка ответа, а не панель вкладок (под открытым поверх профилем — панель есть).
  useHideTabBar(useContext(ScreenVisible), 'thread');
  useMinute();
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'gone' | 'blocked' | 'hidden'>('loading');
  const [error, setError] = useState('');
  const [root, setRoot] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Post[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle');
  const [hl, setHl] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: number; username: string } | null>(null);
  const [focusN, setFocusN] = useState(0);
  const [hideVer, setHideVer] = useState(0);
  const rootEl = useRef<HTMLDivElement>(null);
  const ctrl = useRef<AbortController | null>(null);
  const moreCtrl = useRef<AbortController | null>(null);
  const focusWant = useRef<number | null>(null);
  const scrollWant = useRef<number | null>(null);
  const hlTimer = useRef(0);
  const S = useRef({ root, replies, next });
  S.current = { root, replies, next };

  const rootId = root?.id ?? p.postId;
  const returnTo = currentReturnTo({ post: rootId });

  const load = useCallback(async (quiet: boolean) => {
    ctrl.current?.abort();
    moreCtrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    if (!quiet) { setState('loading'); setError(''); }
    try {
      const t = await socialApi.thread(S.current.root?.id ?? p.postId, null, c.signal);
      if (c.signal.aborted) return;
      setRoot(t.post);
      setReplies(mergeReplies([], t.replies));
      setNext(t.next);
      setMore('idle');
      setState('ready');
      if (t.focus && !quiet) focusWant.current = t.focus;
    } catch (e) {
      if (isAbortError(e) || c.signal.aborted) return;
      if (isApiError(e, 'not_found')) { setState('gone'); return; }
      if (quiet && S.current.root) return;
      setError(errText(e));
      setState('error');
    }
  }, [p.postId]);

  useEffect(() => {
    void load(false);
    return () => { ctrl.current?.abort(); moreCtrl.current?.abort(); clearTimeout(hlTimer.current); };
  }, [load]);

  const loadMore = useCallback(async () => {
    const cur = S.current;
    if (!cur.next || !cur.root) return;
    moreCtrl.current?.abort();
    const c = new AbortController();
    moreCtrl.current = c;
    setMore('loading');
    try {
      const t = await socialApi.thread(cur.root.id, cur.next, c.signal);
      if (c.signal.aborted) return;
      setReplies((list) => mergeReplies(list, t.replies));
      setNext(t.next);
      setMore('idle');
    } catch (e) {
      if (isAbortError(e) || c.signal.aborted) return;
      setMore('error');
    }
  }, []);

  // Вернулась сеть, а ветка так и не загрузилась.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (online && stateRef.current === 'error') void load(false);
  }, [online, load]);

  // Сменился человек (вход, выход): отметки, «мои» и меню другие.
  const meKey = session.status === 'loading' ? null : session.status === 'signed' ? (session.me?.id ?? 0) : 0;
  const lastKey = useRef<number | null>(null);
  useEffect(() => {
    if (meKey === null) return;
    const prev = lastKey.current;
    lastKey.current = meKey;
    if (prev !== null && prev !== meKey) void load(true);
  }, [meKey, load]);

  const highlight = useCallback((id: number) => {
    setHl(null);
    requestAnimationFrame(() => {
      const el = rootEl.current?.querySelector<HTMLElement>(`[data-rid="${id}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      setHl(id);
      clearTimeout(hlTimer.current);
      hlTimer.current = window.setTimeout(() => setHl(null), 1400);
    });
  }, []);

  // Ссылка на ответ: догружаем страницы, пока он не найдётся, потом прокрутка и подсветка.
  useEffect(() => {
    const id = focusWant.current;
    if (state !== 'ready' || !id) return;
    if (replies.some((r) => r.id === id)) { focusWant.current = null; highlight(id); return; }
    if (next && more === 'idle') void loadMore();
    else if (!next) focusWant.current = null;
  }, [state, replies, next, more, loadMore, highlight]);

  // Только что отправленный ответ — показать над строкой ответа.
  useEffect(() => {
    const id = scrollWant.current;
    if (!id) return;
    const el = rootEl.current?.querySelector<HTMLElement>(`[data-rid="${id}"]`);
    if (!el) return;
    scrollWant.current = null;
    el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [replies]);

  // Открыли кнопкой «Ответить» на карточке: сразу к полю (гостю — окно входа).
  const autoFocused = useRef(false);
  useEffect(() => {
    if (state !== 'ready' || !p.focusComposer || autoFocused.current) return;
    autoFocused.current = true;
    const r0 = S.current.root;
    if (!r0 || r0.deleted || session.mode !== 'on') return;
    void session.ensure('reply', returnTo).then((ok) => { if (ok) setFocusN((n) => n + 1); });
  }, [state, p.focusComposer, session, returnTo]);

  const patch = useCallback((id: number, fn: (x: Post) => Post | null) => {
    const r0 = S.current.root;
    if (r0 && r0.id === id) {
      const np = fn(r0);
      if (np) setRoot(np);
      return;
    }
    setReplies((list) => list.map((x) => (x.id === id ? fn(x) : x)).filter((x): x is Post => !!x));
  }, []);

  const removeReply = useCallback((id: number) => {
    setReplies((list) => {
      const pointed = list.some((x) => !x.deleted && x.id !== id && x.replyTo?.id === id);
      return pointed ? list.map((x) => (x.id === id ? tomb(x) : x)) : list.filter((x) => x.id !== id);
    });
    setRoot((r) => (r ? { ...r, replies: Math.max(0, r.replies - 1) } : r));
  }, []);

  const rootGone = useCallback(() => {
    const cur = S.current;
    const live = cur.replies.some((x) => !x.deleted);
    if (live) setRoot((r) => (r ? tomb(r) : r));
    else setState('gone');
  }, []);

  useSocialEvents((ev) => {
    const r0 = S.current.root;
    if (!r0) return;
    switch (ev.type) {
      case 'reply-created': {
        const rep = ev.reply;
        if (rep.rootId !== r0.id || S.current.replies.some((x) => x.id === rep.id)) return;
        setReplies((list) => mergeReplies(list, [rep]));
        setRoot((r) => (r ? { ...r, replies: r.replies + 1 } : r));
        break;
      }
      case 'post-deleted':
        if (ev.id === r0.id) rootGone();
        else if (ev.rootId === r0.id && S.current.replies.some((x) => x.id === ev.id && !x.deleted)) removeReply(ev.id);
        break;
      case 'like':
        patch(ev.id, (x) => ({ ...x, likes: ev.likes, liked: ev.liked }));
        break;
      case 'block':
        if (r0.author?.id === ev.userId) setState('blocked');
        else setReplies((list) => list.filter((x) => x.author?.id !== ev.userId));
        break;
      case 'hide-user':
        // Скрыть автора может только гость; список скрытых перечитываем (фильтр — при показе).
        setHideVer((n) => n + 1);
        break;
      case 'reported':
        if (ev.target.type === 'post') patch(ev.target.id, (x) => ({ ...x, reported: true }));
        break;
      case 'me-changed': {
        const fix = withMe(ev.me);
        if (!fix) return;
        setRoot((r) => (r ? fix(r) : r));
        setReplies((list) => list.map(fix));
        break;
      }
      case 'moderated':
        if (ev.target.type !== 'post') return;
        if (ev.action === 'delete') {
          if (ev.target.id === r0.id) rootGone();
          else if (S.current.replies.some((x) => x.id === ev.target.id && !x.deleted)) removeReply(ev.target.id);
        } else if (ev.action === 'hide') patch(ev.target.id, (x) => ({ ...x, hidden: true }));
        else if (ev.action === 'unhide') patch(ev.target.id, (x) => ({ ...x, hidden: false }));
        break;
      default:
        break;
    }
  });

  const openUser = useCallback(async (username: string) => {
    if (!(await session.ensure('profile', returnTo))) return;
    p.onOpenUser(username);
  }, [session, returnTo, p]);

  const replyRoot = useCallback(async () => {
    setReplyTo(null);
    if (await session.ensure('reply', returnTo)) setFocusN((n) => n + 1);
  }, [session, returnTo]);

  const replyToRow = useCallback(async (r: Post) => {
    if (!(await session.ensure('reply', returnTo))) return;
    setReplyTo(r.author ? { id: r.id, username: r.author.username } : null);
    setFocusN((n) => n + 1);
  }, [session, returnTo]);

  const onRowChange = useCallback((id: number, np: Post | null) => {
    if (np) patch(id, () => np);
    else removeReply(id);
  }, [patch, removeReply]);

  const rootMenu = async () => {
    const r0 = S.current.root;
    if (!r0 || r0.deleted) return;
    const res = await actions.postMenu(r0, returnTo);
    if (res === 'deleted') {
      if (!S.current.replies.some((x) => !x.deleted)) p.onBack();
    } else if (res === 'blocked' || res === 'hidden') {
      p.onBack();
    } else if (res === 'reported') {
      setRoot((r) => (r ? { ...r, reported: true } : r));
    }
  };

  // Гость скрыл автора на этом телефоне: его ответов не видно, а его пост — заглушка (как в ленте).
  const guest = session.status !== 'signed';
  const hiddenSet = useMemo(() => (guest && hideVer >= 0 ? new Set(hiddenUsers().map((u) => u.id)) : null), [guest, hideVer]);
  const rootHidden = !!(root?.author && hiddenSet?.has(root.author.id));
  const shown = hiddenSet ? replies.filter((r) => !r.author || !hiddenSet.has(r.author.id)) : replies;
  const live = state === 'ready' && !!root && !rootHidden;

  const ro = session.mode !== 'on';
  const right = live && root && !root.deleted
    ? <NavButton label="Действия с постом" haspopup="menu" onClick={() => void rootMenu()}><Icon name="ellipsis" /></NavButton>
    : <NavPlaceholder />;

  let body: JSX.Element;
  if (state === 'loading') {
    body = <Skeleton />;
  } else if (state === 'gone') {
    body = (
      <EmptyState
        icon="bubbles" title="Пост удалён" text="Возможно, автор удалил его или он нарушал правила."
        action={{ label: 'Назад', onClick: p.onBack }}
      />
    );
  } else if (state === 'blocked') {
    body = (
      <EmptyState
        icon="hand" title="Автор заблокирован"
        text="Ты не видишь посты и ответы этого человека. Разблокировать можно в «Профиль → Заблокированные»."
        action={{ label: 'Назад', onClick: p.onBack }}
      />
    );
  } else if (state === 'ready' && rootHidden) {
    body = (
      <EmptyState
        icon="hand" title="Посты автора скрыты"
        text="Ты скрыл их на этом телефоне. Вернуть можно в «Профиль → Скрытые авторы»."
        action={{ label: 'Назад', onClick: p.onBack }}
      />
    );
  } else if (state === 'error' || !root) {
    body = !online
      ? (
        <div className="offline chat-offline" role="status">
          <Icon name="wifiOff" size={20} />
          <span><b>Без интернета.</b> Обсуждение загрузится, когда появится связь.</span>
        </div>
      )
      : (
        <div className="alert is-on" role="alert">
          <span className="dot dot--bad" />
          <div className="alert__text"><b>Не удалось загрузить</b><span>{error}</span></div>
          <button type="button" className="hdr__btn chat-retry" onClick={() => void load(false)}>Повторить</button>
        </div>
      );
  } else {
    body = (
      <>
        {!online && (
          <div className="offline chat-offline" role="status">
            <Icon name="wifiOff" size={20} />
            <span><b>Без интернета.</b> Обсуждения обновятся, когда появится связь.</span>
          </div>
        )}
        <ThreadMain
          post={root} returnTo={returnTo} onOpenUser={(u) => void openUser(u)} onReply={() => void replyRoot()}
          onChange={(np) => patch(np.id, () => np)}
        />
        {shown.length > 0 && (
          <section className="thr__list" aria-label="Ответы">
            {shown.map((r) => (
              <ReplyRow
                key={r.id} reply={r} highlight={hl === r.id} readonly={ro} returnTo={returnTo}
                onReply={(x) => void replyToRow(x)} onJump={highlight} onOpenUser={(u) => void openUser(u)} onChange={onRowChange}
              />
            ))}
          </section>
        )}
        {!shown.length && !next && !root.deleted && <p className="thr__none">Ответов пока нет</p>}
        {next && more !== 'error' && (
          <button type="button" className="thr__more" disabled={more === 'loading'} onClick={() => void loadMore()}>
            {more === 'loading' ? <Spinner size={20} /> : 'Показать ещё ответы'}
          </button>
        )}
        {more === 'error' && (
          <div className="chat-more chat-more--err">
            <span>Не удалось загрузить</span>
            <button type="button" className="hdr__btn chat-retry" onClick={() => void loadMore()}>Повторить</button>
          </div>
        )}
      </>
    );
  }

  return (
    <div ref={rootEl} className="wrap wrap--chat thr">
      <NavBar left={<BackButton onClick={p.onBack} />} title="Обсуждение" right={right} />
      {body}
      {live && root && (
        <ReplyComposer
          root={root} replyTo={replyTo} onClearReplyTo={() => setReplyTo(null)} focusSignal={focusN} returnTo={returnTo}
          onSent={(r) => { scrollWant.current = r.id; }}
        />
      )}
    </div>
  );
}
