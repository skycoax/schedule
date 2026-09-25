// Ответ в ветке (.rrow): аватар 32, имя, «в ответ @u» (нажатие — прокрутка к тому ответу),
// текст целиком, одно фото, «Ответить» и «нравится». «•••» — меню ответа (без «Скопировать ссылку»).
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../../ui/icons';
import { fmtCount, fullTime, relTime } from '../format';
import { useSocialActions } from '../actions';
import type { Post } from '../types';
import { Avatar } from '../ui/Avatar';
import { TeamBadge } from '../ui/Badges';
import { PhotoGrid } from '../ui/PhotoGrid';
import { PhotoViewer } from '../ui/PhotoViewer';
import { RichText } from '../ui/RichText';
import { BubbleIcon, hiddenText, useLike, useMinute } from './PostCard';
import './chat.css';

export function ReplyRow(p: {
  reply: Post;
  highlight: boolean;
  /** Писать нельзя (только чтение, обсуждения выключены). */
  readonly: boolean;
  returnTo: string;
  onReply: (r: Post) => void;
  onJump: (id: number) => void;
  onOpenUser: (username: string) => void;
  onChange: (id: number, np: Post | null) => void;
}): JSX.Element {
  const r = p.reply;
  const actions = useSocialActions();
  useMinute();
  const [reveal, setReveal] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const ref = useRef(r);
  ref.current = r;
  const onChangeRef = useRef(p.onChange);
  onChangeRef.current = p.onChange;
  const like = useLike(r, (np) => onChangeRef.current(np.id, np), p.returnTo);

  const hl = p.highlight ? ' is-hl' : '';
  if (r.deleted) {
    return <div className={'rrow rrow--gone' + hl} data-rid={r.id}><p>Ответ удалён</p></div>;
  }
  if (r.reported && !reveal) {
    return (
      <div className={'rrow rrow--min' + hl} data-rid={r.id}>
        <span>Жалоба отправлена</span>
        <span aria-hidden="true">{'\u00a0·'}</span>
        <button type="button" className="post__show" onClick={() => setReveal(true)}>Показать</button>
      </div>
    );
  }

  const author = r.author;
  const nameId = `r-${r.id}-name`;
  const openUser = () => { if (author) p.onOpenUser(author.username); };
  const menu = async () => {
    const res = await actions.postMenu(ref.current, p.returnTo);
    if (res === 'deleted' || res === 'blocked' || res === 'hidden') onChangeRef.current(r.id, null);
    else if (res === 'reported') onChangeRef.current(r.id, { ...ref.current, reported: true });
  };
  const to = r.replyTo;

  return (
    <article className={'rrow' + hl + (r.hidden ? ' is-hidden' : '')} data-rid={r.id} aria-labelledby={nameId}>
      <div className="rrow__av">
        <Avatar user={author} size={32} onClick={author ? openUser : undefined} label={author ? author.name : undefined} />
      </div>
      <div className="rrow__main">
        <div className={'post__head' + (author?.team ? ' post__head--team' : '')}>
          {author
            ? <button type="button" className="post__name" id={nameId} onClick={openUser}>{author.name}</button>
            : <span className="post__name post__name--gone" id={nameId}>Удалённый аккаунт</span>}
          {author?.team && <span className="post__badge"><TeamBadge /></span>}
          {author && <span className="post__meta"><span className="post__user">@{author.username}</span></span>}
          <span className="post__time">
            {author ? '\u00a0· ' : ''}
            <time dateTime={r.createdAt} title={fullTime(r.createdAt)}>{relTime(r.createdAt)}</time>
          </span>
          <button type="button" className="post__more" aria-label="Действия с ответом" aria-haspopup="menu" onClick={() => void menu()}>
            <Icon name="ellipsis" size={20} />
          </button>
        </div>
        {r.hidden && <p className="post__flag"><Icon name="lock" size={14} />{hiddenText(r)}</p>}
        {to && (
          to.username
            ? <button type="button" className="rrow__to" onClick={() => p.onJump(to.id)}>в ответ @{to.username}</button>
            : <p className="rrow__to rrow__to--gone">в ответ на удалённое сообщение</p>
        )}
        {r.text && <RichText className="rrow__text" text={r.text} onMention={p.onOpenUser} />}
        {r.media.length > 0 && <div className="rrow__media"><PhotoGrid media={r.media.slice(0, 1)} onOpen={setViewer} /></div>}
        <div className="rrow__acts">
          <button type="button" className="post__act post__act--label" disabled={p.readonly} onClick={() => p.onReply(ref.current)}>
            <BubbleIcon size={17} /><span>Ответить</span>
          </button>
          <button
            type="button" className={'post__act post__act--like' + (r.liked ? ' is-on' : '')} disabled={p.readonly}
            aria-pressed={r.liked} aria-label={`Нравится, ${r.likes}`} onClick={like}
          >
            <Icon name={r.liked ? 'heartFill' : 'heart'} size={17} />
            {r.likes > 0 && <span>{fmtCount(r.likes)}</span>}
          </button>
        </div>
      </div>
      <PhotoViewer media={r.media.slice(0, 1)} index={viewer ?? 0} open={viewer !== null} onClose={() => setViewer(null)} />
    </article>
  );
}
