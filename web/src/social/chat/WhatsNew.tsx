// «Что нового?» над лентой и в своём профиле — как в Threads: аватар, приглашение и «Опубликовать».
// Гостю — «Войти»: писать можно только с аккаунтом.
import type { JSX } from 'react';
import type { Me } from '../types';
import { Avatar } from '../ui/Avatar';
import './chat.css';

export function WhatsNew(p: { me: Me | null; guest: boolean; onCompose: () => void; onSignIn: () => void }): JSX.Element {
  const go = p.guest ? p.onSignIn : p.onCompose;
  return (
    <div className="whatsnew">
      <button type="button" className="whatsnew__open" aria-label={p.guest ? 'Войти, чтобы написать' : 'Новый пост'} onClick={go} />
      <Avatar user={p.me} size={36} />
      <span className="whatsnew__t" aria-hidden="true">{p.guest ? 'Войди, чтобы написать' : 'Что нового?'}</span>
      <button type="button" className="whatsnew__btn" tabIndex={-1} aria-hidden="true" onClick={go}>
        {p.guest ? 'Войти' : 'Опубликовать'}
      </button>
    </div>
  );
}
