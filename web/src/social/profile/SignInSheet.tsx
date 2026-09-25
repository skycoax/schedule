// Лист входа (AuthHost, prompt.kind === 'signin'). Возраст спрашиваем ДО Google, согласие с правилами и
// политикой — обязательная галочка; вход — полный переход на /api/auth/google/start (session.signIn).
// Режим удаления (reason 'delete'): без возраста и галочки, аккаунт при таком входе не создаётся.
import { useId, useState } from 'react';
import type { JSX } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import type { IconName } from '../../ui/icons';
import { ageBlocked, setAgeBlock } from '../local';
import { LINKS } from '../rules';
import { useSession } from '../session';
import type { AgeGroup, AuthReason } from '../types';
import { GOOGLE_OFF, GoogleButton, OFFLINE_SIGNIN } from './GoogleButton';
import { PolicySheet, RulesSheet } from './RulesSheet';
import './profile.css';

const TITLE: Record<AuthReason, string> = {
  post: 'Войди, чтобы написать пост',
  reply: 'Войди, чтобы ответить',
  like: 'Войди, чтобы ставить отметки',
  friend: 'Войди, чтобы добавлять друзей',
  block: 'Войди, чтобы блокировать',
  report: 'Войди, чтобы пожаловаться',
  profile: 'Войди, чтобы открывать профили',
  search: 'Войди, чтобы искать людей',
  account: 'Вход в Para',
  delete: 'Удаление аккаунта',
  expired: 'Сессия истекла — войди снова',
};

const ICON: Record<AuthReason, IconName> = {
  post: 'compose', reply: 'reply', like: 'heart', friend: 'people', block: 'hand', report: 'flag',
  profile: 'person', search: 'search', account: 'person', delete: 'trash', expired: 'person',
};

type Age = 'under' | AgeGroup;

/** Удаление, пока вход через Google не настроен (как на странице /delete-account, но на «ты»). */
const GOOGLE_OFF_DELETE = 'Вход через Google пока недоступен. Напиши @skycoax — удалим аккаунт вручную.';

function Telegram(): JSX.Element {
  return (
    <p className="signin__tg">
      Или напиши нам в Telegram: <a href={LINKS.telegram} target="_blank" rel="noopener noreferrer">@skycoax</a>
    </p>
  );
}

export function SignInSheet(p: { reason: AuthReason; returnTo: string; onClose: () => void }): JSX.Element {
  const s = useSession();
  const del = p.reason === 'delete';
  const minAge = s.config?.minAge ?? 16;
  const titleId = useId();
  const ageName = useId();
  const consentId = useId();

  const [age, setAge] = useState<Age | null>(null);
  const [accept, setAccept] = useState(false);
  const [blocked, setBlocked] = useState(() => !del && ageBlocked());
  const [rulesOpen, setRulesOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [devName, setDevName] = useState('');
  const [devBusy, setDevBusy] = useState(false);

  const pickAge = (a: Age) => {
    setAge(a);
    if (a === 'under') { setAgeBlock(); setBlocked(true); }
  };

  const noGoogle = s.google === false;
  const caption = noGoogle ? (del ? GOOGLE_OFF_DELETE : GOOGLE_OFF) : !s.online ? OFFLINE_SIGNIN : undefined;
  const ready = del || ((age === 'minor' || age === 'adult') && accept);

  const google = () => {
    if (del) s.signIn({ returnTo: p.returnTo, intent: 'delete', accept: false });
    else if (age === 'minor' || age === 'adult') s.signIn({ returnTo: p.returnTo, intent: 'signin', age, accept: true });
  };

  const dev = async () => {
    const name = devName.trim().toLowerCase();
    if (!name || devBusy) return;
    setDevBusy(true);
    await s.devSignIn(name, age === 'minor' || age === 'adult' ? age : 'adult', del ? 'delete' : 'signin');
    setDevBusy(false);
  };

  let body: JSX.Element;
  if (blocked) {
    body = (
      <div className="signin">
        <span className="signin__ico" aria-hidden="true"><Icon name="lock" size={28} /></span>
        <h2 className="signin__t" id={titleId}>Обсуждения — с {minAge} лет</h2>
        <p className="signin__p">Расписание, правки и отзывы работают как раньше.</p>
        {p.reason === 'report' && <Telegram />}
        <div className="signin__acts">
          <Button full size={50} onClick={p.onClose}>Понятно</Button>
        </div>
      </div>
    );
  } else {
    const opts: { id: Age; label: string }[] = [
      { id: 'under', label: `Младше ${minAge}` },
      ...(minAge < 18 ? [{ id: 'minor' as Age, label: `${minAge}–17` }] : []),
      { id: 'adult', label: '18 и старше' },
    ];
    body = (
      <div className="signin">
        <span className="signin__ico" aria-hidden="true"><Icon name={ICON[p.reason]} size={28} /></span>
        <h2 className="signin__t" id={titleId}>{TITLE[p.reason]}</h2>
        <p className="signin__p">
          {del
            ? 'Войди тем же аккаунтом Google, чтобы удалить его. Новый аккаунт при этом не создастся.'
            : 'Расписание работает и без аккаунта. Аккаунт нужен, чтобы писать в «Обсуждениях», вести профиль и добавлять друзей.'}
        </p>
        {p.reason === 'report' && <Telegram />}

        {!del && (
          <>
            <fieldset className="signin__age">
              <legend className="signin__q">Сколько тебе лет?</legend>
              <div className="signin__opts">
                {opts.map((o) => (
                  <label key={o.id} className="signin__opt">
                    <input type="radio" name={ageName} className="signin__radio" checked={age === o.id}
                      onChange={() => pickAge(o.id)} />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="signin__consent">
              <label className="signin__cbwrap">
                <input type="checkbox" className="signin__cb" checked={accept} aria-labelledby={consentId}
                  onChange={(e) => setAccept(e.currentTarget.checked)} />
              </label>
              <p className="signin__consent-t" id={consentId}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setAccept((v) => !v); }}>
                Принимаю{' '}
                <button type="button" className="signin__link" onClick={() => setRulesOpen(true)}>Правила обсуждений</button>
                {' '}и{' '}
                <button type="button" className="signin__link" onClick={() => setDocOpen(true)}>Политику конфиденциальности</button>
              </p>
            </div>
            <p className="signin__note">Para сохранит от Google только Google ID, почту и имя. Почту никто не увидит.</p>
          </>
        )}

        <div className="signin__acts">
          <GoogleButton onClick={google} disabled={!ready || noGoogle || !s.online} caption={caption} />
          <Button full variant="plain" size={44} onClick={p.onClose}>Не сейчас</Button>
        </div>

        {s.dev && (
          <div className="signin__dev">
            {!devOpen ? (
              <button type="button" className="signin__devbtn" onClick={() => setDevOpen(true)}>Войти для разработки</button>
            ) : (
              <form className="signin__devform" onSubmit={(e) => { e.preventDefault(); void dev(); }}>
                <input className="signin__devin" type="text" value={devName} placeholder="Имя латиницей"
                  aria-label="Имя латиницей" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
                  onChange={(e) => setDevName(e.currentTarget.value)} />
                <Button type="submit" variant="tinted" size={44} busy={devBusy} disabled={!devName.trim()}>Войти</Button>
              </form>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <Sheet open onClose={p.onClose} variant="bottom" labelledBy={titleId} right={null} className="signin-sheet">
        {body}
      </Sheet>
      <RulesSheet open={rulesOpen} mode="read" onClose={() => setRulesOpen(false)} />
      <PolicySheet open={docOpen} onClose={() => setDocOpen(false)} />
    </>
  );
}
