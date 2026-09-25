// Карточка публикации (.post): лента «Обсуждений», «Мои посты» и посты в чужом профиле.
// Нажатие на карточку открывает ветку через прозрачную кнопку .post__open под текстом; аватар, имя,
// ссылки, упоминания, фото и действия — отдельные кнопки поверх неё (вложенных кнопок нет).
// Здесь же общие для чата помощники: минутный тик, отметка «нравится», тексты ошибок.
import { createContext, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { brand } from '../../brand';
import { Icon } from '../../ui/icons';
import { toast } from '../../ui/Toast';
import { isApiError, socialApi } from '../api';
import { emit } from '../events';
import { fmtCount, fullTime, relTime } from '../format';
import { postLink, useSocialActions } from '../actions';
import { useSession } from '../session';
import { categoryOf } from '../types';
import type { Me, Post } from '../types';
import { Avatar } from '../ui/Avatar';
import { TeamBadge, UniBadge } from '../ui/Badges';
import { PhotoGrid } from '../ui/PhotoGrid';
import { PhotoViewer } from '../ui/PhotoViewer';
import { RichText } from '../ui/RichText';
import './chat.css';

// ─── Общие помощники чата ───

/** «КФУ · Джизак» из «Расписание КФУ · Джизак». */
export const uniShort = (): string => brand.label.replace(/^Расписание\s+/i, '');

/** Эти ошибки показывает сама сессия (вход, профиль, правила, ограничение) — самим не тостить. */
export function handledBySession(e: unknown): boolean {
  return isApiError(e) && (e.code === 'auth' || e.code === 'profile' || e.code === 'rules' || e.code === 'banned');
}

export function errText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Не получилось — попробуй ещё раз';
}

export const isAbortError = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/**
 * Экран стека сейчас сверху (виден). Стек «Обсуждений» держит нижние экраны смонтированными, но скрытыми:
 * ветка под открытым поверх неё профилем не должна прятать панель вкладок. По умолчанию — виден.
 */
export const ScreenVisible = createContext(true);

/** В системе включено «Уменьшить движение». */
export const reducedMotion = (): boolean => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// Один таймер на все карточки: «5 мин» обновляется раз в минуту, пока страница видна.
const minuteSubs = new Set<() => void>();
let minuteTimer = 0;
const minuteNow = () => Math.floor(Date.now() / 60000);
function subscribeMinute(f: () => void) {
  minuteSubs.add(f);
  if (!minuteTimer) {
    minuteTimer = window.setInterval(() => {
      if (!document.hidden) minuteSubs.forEach((g) => g());
    }, 20000);
  }
  return () => {
    minuteSubs.delete(f);
    if (!minuteSubs.size) { clearInterval(minuteTimer); minuteTimer = 0; }
  };
}
/** Перерисовка, когда сменилась минута (для относительного времени). */
export function useMinute(): number {
  return useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);
}

// Один ResizeObserver на все тексты: «Показать полностью» пересчитывается, когда карточка
// становится видимой (вкладка была скрыта) или меняется ширина.
const sizeCbs = new Map<Element, () => void>();
let sizeRo: ResizeObserver | null = null;
export function observeSize(el: Element, cb: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  sizeRo ??= new ResizeObserver((entries) => { for (const e of entries) sizeCbs.get(e.target)?.(); });
  sizeCbs.set(el, cb);
  sizeRo.observe(el);
  return () => { sizeCbs.delete(el); sizeRo?.unobserve(el); };
}

/** Отметка «нравится»: сразу на экране, потом запрос; при ошибке — назад и тост с текстом сервера. */
export function useLike(post: Post, onChange: (p: Post) => void, returnTo?: string): () => void {
  const session = useSession();
  const ensure = session.ensure;
  const ref = useRef(post);
  ref.current = post;
  const cb = useRef(onChange);
  cb.current = onChange;
  const busy = useRef(false);
  return useCallback(() => {
    if (busy.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { toast('Нет интернета'); return; }
    busy.current = true;
    void (async () => {
      try {
        if (!(await ensure('like', returnTo))) return;
        const was = ref.current;
        const on = !was.liked;
        cb.current({ ...was, liked: on, likes: Math.max(0, was.likes + (on ? 1 : -1)) });
        try {
          const r = await socialApi.like(was.id, on);
          cb.current({ ...ref.current, liked: r.liked, likes: r.likes });
          emit({ type: 'like', id: was.id, likes: r.likes, liked: r.liked });
        } catch (e) {
          cb.current({ ...ref.current, liked: was.liked, likes: was.likes });
          if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
        }
      } finally {
        busy.current = false;
      }
    })();
  }, [ensure, returnTo]);
}

/** Одно облачко «ответы» (в наборе значков его нет: там два облачка — значок вкладки). */
export function BubbleIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 4c4.97 0 9 3.36 9 7.5S16.97 19 12 19c-1.1 0-2.15-.16-3.12-.46L4.5 20l1.2-3.6C4.02 15.06 3 13.36 3 11.5 3 7.36 7.03 4 12 4Z" />
    </svg>
  );
}

/** После смены своего имени или фото: функция, обновляющая автора в своих постах (null — нечего менять). */
export function withMe(me: Me | null): ((p: Post) => Post) | null {
  if (!me || !me.username) return null;
  const username = me.username;
  return (p) => (p.author && p.author.id === me.id && (p.author.name !== me.name || p.author.username !== username || p.author.avatar !== me.avatar)
    ? { ...p, author: { ...p.author, name: me.name, username, avatar: me.avatar } }
    : p);
}

/** Своё скрытое (или модератору — чужое скрытое). */
export function hiddenText(post: Post): string {
  if (!post.mine) return 'Скрыто — видят только автор и модераторы.';
  return post.rootId === null
    ? 'Скрыто до проверки модератором — на пост пожаловались.'
    : 'Скрыто до проверки модератором — на ответ пожаловались.';
}

const CLAMP = 8;

// ─── Карточка ───

export function PostCard(p: {
  post: Post;
  clamp?: boolean;
  onOpen: (focusReply?: boolean) => void;
  onOpenUser: (username: string) => void;
  onChange: (p: Post | null) => void;
}): JSX.Element {
  const { post } = p;
  const session = useSession();
  const actions = useSocialActions();
  useMinute();
  const [expanded, setExpanded] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const postRef = useRef(post);
  postRef.current = post;
  const onChangeRef = useRef(p.onChange);
  onChangeRef.current = p.onChange;

  const like = useLike(post, (np) => onChangeRef.current(np));
  const clampOn = !!p.clamp && !expanded;

  // «Показать полностью» — только если текст действительно обрезан.
  useLayoutEffect(() => {
    const el = textRef.current?.firstElementChild as HTMLElement | null;
    if (!el || !clampOn) { setClamped(false); return; }
    const check = () => { if (el.clientHeight > 0) setClamped(el.scrollHeight > el.clientHeight + 2); };
    check();
    return observeSize(el, check);
  }, [post.text, clampOn]);

  const isReply = post.rootId !== null;
  if (post.deleted) {
    return (
      <article className="post post--gone">
        <p className="post__gone">{isReply ? 'Ответ удалён' : 'Пост удалён'}</p>
      </article>
    );
  }
  if (post.reported && !reveal) {
    return (
      <div className="post post--min">
        <span>Жалоба отправлена</span>
        <span aria-hidden="true">{'\u00a0·'}</span>
        <button type="button" className="post__show" onClick={() => setReveal(true)}>Показать</button>
      </div>
    );
  }

  const author = post.author;
  const nameId = `p-${post.id}-name`;
  const cat = categoryOf(post.category);
  const otherUni = post.uni !== brand.id && !!post.uniShort;
  const ro = session.mode !== 'on';
  const openUser = () => { if (author) p.onOpenUser(author.username); };
  const menu = async () => {
    const r = await actions.postMenu(postRef.current);
    if (r === 'deleted' || r === 'blocked' || r === 'hidden') onChangeRef.current(null);
    else if (r === 'reported') onChangeRef.current({ ...postRef.current, reported: true });
  };

  return (
    <article className={'post' + (post.hidden ? ' is-hidden' : '')} aria-labelledby={nameId}>
      <button type="button" className="post__open" aria-label="Открыть обсуждение" onClick={() => p.onOpen()} />
      <div className="post__av">
        <Avatar user={author} size={40} onClick={author ? openUser : undefined} label={author ? author.name : undefined} />
      </div>
      <div className="post__main">
        <div className={'post__head' + (author?.team ? ' post__head--team' : '')}>
          {author
            ? <button type="button" className="post__name" id={nameId} onClick={openUser}>{author.name}</button>
            : <span className="post__name post__name--gone" id={nameId}>Удалённый аккаунт</span>}
          {author?.team && <span className="post__badge"><TeamBadge /></span>}
          {author && <span className="post__meta"><span className="post__user">@{author.username}</span></span>}
          <span className="post__time">
            {author ? '\u00a0· ' : ''}
            <time dateTime={post.createdAt} title={fullTime(post.createdAt)}>{relTime(post.createdAt)}</time>
          </span>
          <button type="button" className="post__more" aria-label="Действия с постом" aria-haspopup="menu" onClick={() => void menu()}>
            <Icon name="ellipsis" size={20} />
          </button>
        </div>
        {post.hidden && <p className="post__flag"><Icon name="lock" size={14} />{hiddenText(post)}</p>}
        {post.text && (
          <div ref={textRef} className="post__text">
            <RichText text={post.text} clamp={clampOn ? CLAMP : undefined} onMention={p.onOpenUser} />
          </div>
        )}
        {clamped && (
          <button type="button" className="post__full" onClick={() => setExpanded(true)}>Показать полностью</button>
        )}
        {post.media.length > 0 && (
          <div className="post__media"><PhotoGrid media={post.media} onOpen={setViewer} /></div>
        )}
        {(cat || otherUni) && (
          <div className="post__cat">
            {cat && <span>{cat.label}</span>}
            {otherUni && <UniBadge short={post.uniShort as string} />}
          </div>
        )}
        <div className="post__acts">
          <button
            type="button" className="post__act" disabled={ro}
            aria-label={post.replies ? `Ответить, ${post.replies}` : 'Ответить'} onClick={() => p.onOpen(true)}
          >
            <BubbleIcon />
            {post.replies > 0 && <span>{fmtCount(post.replies)}</span>}
          </button>
          <button
            type="button" className={'post__act post__act--like' + (post.liked ? ' is-on' : '')} disabled={ro}
            aria-pressed={post.liked} aria-label={`Нравится, ${post.likes}`} onClick={like}
          >
            <Icon name={post.liked ? 'heartFill' : 'heart'} size={18} />
            {post.likes > 0 && <span>{fmtCount(post.likes)}</span>}
          </button>
          <button type="button" className="post__act post__act--end" aria-label="Поделиться" onClick={() => void actions.share(postLink(post))}>
            <Icon name="share" size={18} />
          </button>
        </div>
      </div>
      <PhotoViewer media={post.media} index={viewer ?? 0} open={viewer !== null} onClose={() => setViewer(null)} />
    </article>
  );
}
