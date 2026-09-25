// Карточка гостя в «Профиле»: что даёт аккаунт и кнопка «Продолжить с Google» (открывает лист входа).
import type { JSX } from 'react';
import { Icon } from '../../ui/icons';
import { useSession } from '../session';
import { GOOGLE_OFF, GoogleButton, OFFLINE_SIGNIN } from './GoogleButton';
import './profile.css';

export function GuestCard(): JSX.Element {
  const s = useSession();
  const off = s.mode === 'off';
  // В разработке (dev) Google может быть не настроен, но лист входа нужен ради «Войти для разработки».
  const noGoogle = s.google === false && !s.dev;
  const caption = off ? 'Обсуждения временно недоступны' : !s.online ? OFFLINE_SIGNIN : noGoogle ? GOOGLE_OFF : undefined;
  return (
    <section className="prof-guest" aria-labelledby="prof-guest-t">
      <span className="prof-guest__ico" aria-hidden="true"><Icon name="person" size={56} /></span>
      <h2 className="prof-guest__t" id="prof-guest-t">Гостевой режим</h2>
      <p className="prof-guest__p">
        Расписание работает без входа. Войди через Google, чтобы писать в обсуждениях, заводить друзей и вести свой профиль.
      </p>
      <GoogleButton onClick={() => s.requestSignIn('account')} disabled={!!caption} caption={caption} />
      <p className="prof-guest__note">
        Другим будут видны имя, @имя пользователя, фото и твои посты. Почту другие люди не увидят.
      </p>
    </section>
  );
}

/** Пока /api/auth/me не ответил и в кэше никого: круг и две полосы. */
export function GuestCardSkeleton(): JSX.Element {
  return (
    <div className="prof-guest prof-guest--skel" aria-busy="true" aria-label="Загрузка профиля">
      <span className="prof-skel-circle" />
      <span className="prof-bar prof-bar--name" />
      <span className="prof-bar prof-bar--line" />
    </div>
  );
}
