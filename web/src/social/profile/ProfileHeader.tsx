// Шапка профиля — своего («Профиль») и чужого (UserProfileView): фото слева, рядом имя и @имя с «моим вузом»;
// ниже «О себе», Telegram и Instagram строкой, счётчики. Кнопки под шапкой передаёт владелец экрана (children).
// action — кнопка в конце строки с фото и именем (≡ «Настройки» в своём профиле); прокручивается вместе со страницей.
import { useLayoutEffect, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { plural } from '../../lib/plural';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Avatar } from '../ui/Avatar';
import { NameBadge } from '../ui/Badges';
import { PhotoViewer } from '../ui/PhotoViewer';
import type { Links, MediaRef } from '../types';
import './profile.css';

export interface HeaderUser {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  avatarFull: string | null;
  bio: string;
  links: Links | null;
  linksHidden?: 'friends' | null;
  uniShort: string | null;
  team: boolean;
  counts: { friends: number; posts: number };
  since?: string;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября',
  'ноября', 'декабря'];

/** 'YYYY-MM' → «В Para с сентября 2026». */
export function sinceText(since?: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(since || '');
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `В Para с ${month} ${m[1]}` : '';
}

export const friendsText = (n: number) => `${n} ${plural(n, ['друг', 'друга', 'друзей'])}`;
export const postsText = (n: number) => `${n} ${plural(n, ['пост', 'поста', 'постов'])}`;

/** «О себе»: до трёх строк, дальше — «ещё». */
function Bio({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  // Меряем и при смене ширины (поворот, узкий экран), и когда скрытая вкладка снова видна (до этого размеры 0).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => { if (el.clientHeight > 0) setLong(el.scrollHeight > el.clientHeight + 1); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <div className="prof-hd__bio">
      <p ref={ref} className={'prof-hd__bio-t' + (open ? '' : ' is-clamped')}>{text}</p>
      {long && !open && (
        <button type="button" className="prof-hd__more" onClick={() => setOpen(true)}>ещё</button>
      )}
    </div>
  );
}

export function LinkChips({ links }: { links: Links }): JSX.Element | null {
  if (!links.tg && !links.ig) return null;
  return (
    <div className="prof-hd__links">
      {links.tg && (
        <a className="prof-chip" href={'https://t.me/' + encodeURIComponent(links.tg)} target="_blank"
          rel="noopener noreferrer nofollow" aria-label={'Telegram: ' + links.tg}>
          <Icon name="telegram" size={16} />
          <span className="prof-chip__t">t.me/{links.tg}</span>
        </a>
      )}
      {links.ig && (
        <a className="prof-chip" href={'https://instagram.com/' + encodeURIComponent(links.ig)} target="_blank"
          rel="noopener noreferrer nofollow" aria-label={'Instagram: ' + links.ig}>
          <Icon name="instagram" size={16} />
          <span className="prof-chip__t">{links.ig}</span>
        </a>
      )}
    </div>
  );
}

export function ProfileHeader(p: {
  user: HeaderUser;
  /** Счётчик друзей — кнопка (свой профиль). */
  onFriends?: () => void;
  /** Заблокирован: только фото, имя и @имя. */
  bare?: boolean;
  /** Строка под счётчиками (например, ограничение — для модератора). */
  note?: ReactNode;
  /** Кнопка в конце строки с фото и именем (≡ в своём профиле). */
  action?: ReactNode;
  children?: ReactNode;
}): JSX.Element {
  const u = p.user;
  const [viewer, setViewer] = useState(false);
  const full = u.avatarFull || u.avatar;
  const media: MediaRef[] = full ? [{ id: 'avatar-' + u.id, url: full, thumb: u.avatar || full, w: 512, h: 512 }] : [];
  const uni = p.bare ? '' : u.uniShort || '';
  const since = p.bare ? '' : sinceText(u.since);

  return (
    <header className="prof-hd" data-nav-hero="">
      <div className="prof-hd__top">
        <Avatar user={u} size={64} onClick={full ? () => setViewer(true) : undefined}
          label={full ? 'Фото профиля ' + u.name : undefined} />
        <div className="prof-hd__who">
          <h2 className="prof-hd__name">
            <span className="prof-hd__name-t">{u.name}</span>
            <NameBadge u={u} />
          </h2>
          {(u.username || uni) && (
            <p className="prof-hd__meta">
              {u.username && <span>@{u.username}</span>}
              {u.username && uni && <span className="prof-hd__uni"> · </span>}
              {uni && <span className="prof-hd__uni">{uni}</span>}
            </p>
          )}
        </div>
        {p.action}
      </div>
      {!p.bare && u.bio && <Bio text={u.bio} />}
      {!p.bare && u.links && <LinkChips links={u.links} />}
      {!p.bare && !u.links && u.linksHidden === 'friends' && (
        <p className="prof-hd__hidden"><Icon name="lock" size={14} />Контакты видны только друзьям</p>
      )}
      {!p.bare && (
        <p className="prof-hd__counts">
          {p.onFriends
            ? <button type="button" className="prof-hd__cnt" onClick={p.onFriends}>{friendsText(u.counts.friends)}</button>
            : <span>{friendsText(u.counts.friends)}</span>}
          <span aria-hidden="true"> · </span>
          <span>{postsText(u.counts.posts)}</span>
          {since && <><span aria-hidden="true"> · </span><span>{since}</span></>}
        </p>
      )}
      {p.note}
      {p.children && <div className="prof-hd__acts">{p.children}</div>}
      <PhotoViewer media={media} index={0} open={viewer && media.length > 0} onClose={() => setViewer(false)} />
    </header>
  );
}

/** Шапка, пока профиль грузится: фото и имя из кэша (если есть) и серые полосы.
 *  still — ждать нечего (нет сети): только то, что есть в кэше, без полос загрузки. */
export function ProfileHeaderSkeleton(p: {
  user?: { id: number; name: string; avatar: string | null; username?: string | null } | null;
  still?: boolean;
}): JSX.Element {
  const u = p.user;
  const still = !!p.still && !!u;
  return (
    <div className={'prof-hd' + (still ? '' : ' prof-hd--skel')}
      aria-busy={still ? undefined : true} aria-label={still ? undefined : 'Загрузка профиля'}>
      <div className="prof-hd__top">
        {u ? <Avatar user={{ id: u.id, name: u.name, avatar: u.avatar }} size={64} /> : <span className="prof-hd__skav" />}
        <div className="prof-hd__who">
          {u && u.name
            ? <p className="prof-hd__name"><span className="prof-hd__name-t">{u.name}</span></p>
            : <span className="prof-bar prof-bar--name" />}
          {u && u.username ? <p className="prof-hd__meta">@{u.username}</p> : !still && <span className="prof-bar prof-bar--meta" />}
        </div>
      </div>
      {!still && <span className="prof-bar prof-bar--line" />}
    </div>
  );
}

// ─── Общие состояния списков (загрузка, ошибка) ───

export function ListSkeleton(p: { rows?: number }): JSX.Element {
  return (
    <ul className="frd-list frd-list--skel" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: p.rows ?? 4 }, (_, i) => (
        <li key={i} className="frd-row"><span className="frd-row__main">
          <span className="prof-skel-circle prof-skel-circle--44" />
          <span className="frd-row__txt"><span className="prof-bar prof-bar--name" /><span className="prof-bar prof-bar--meta" /></span>
        </span></li>
      ))}
    </ul>
  );
}

export function LoadError(p: { text: string; detail?: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="prof-err" role="alert">
      <p className="prof-err__t">{p.text}</p>
      {p.detail && p.detail !== p.text && <p className="prof-err__d">{p.detail}</p>}
      <Button variant="tinted" size={32} onClick={p.onRetry}>Повторить</Button>
    </div>
  );
}
