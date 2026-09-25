// Показывает окно для session.prompt (вход, заполнение профиля, новые правила, ограничение) и сообщает итог
// через session.resolvePrompt. Грузится лениво (AppShell), внутри ErrorBoundary; монтируется, пока prompt есть.
import { useEffect, useId, useRef } from 'react';
import type { JSX } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { socialApi } from '../api';
import { banText } from '../format';
import { useSession } from '../session';
import type { AuthPrompt } from '../session';
import type { Ban } from '../types';
import { RulesSheet } from './RulesSheet';
import { SetupSheet } from './SetupSheet';
import { SignInSheet } from './SignInSheet';
import { toastFail } from './UsernameField';
import './profile.css';

/** Заголовок листа уже говорит «Публикация ограничена» — в тексте только срок и причина (ux §5.8):
 *  «До 2 октября. Причина: Спам.» / «Навсегда. Причина: …». */
function banBody(ban: Ban): string {
  const t = banText(ban).replace(/^Публикация ограничена\s+/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function BannedSheet(p: { ban: Ban; onClose: () => void }): JSX.Element {
  const titleId = useId();
  return (
    <Sheet open onClose={p.onClose} variant="bottom" detent="medium" labelledBy={titleId} right={null}>
      <div className="signin">
        <span className="signin__ico signin__ico--warn" aria-hidden="true"><Icon name="hand" size={28} /></span>
        <h2 className="signin__t" id={titleId}>Публикация ограничена</h2>
        <p className="signin__p">{banBody(p.ban)} Читать обсуждения, жаловаться и удалить аккаунт можно.</p>
        <div className="signin__acts">
          <Button full size={50} onClick={p.onClose}>Понятно</Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Окно показать нельзя (например, сессия уже гостевая) — сразу закрываем prompt. */
function Dismiss(p: { onDone: () => void }): null {
  const done = useRef(p.onDone);
  useEffect(() => { done.current(); }, []);
  return null;
}

export default function AuthHost(): JSX.Element | null {
  const s = useSession();
  const ref = useRef(s);
  ref.current = s;

  // Новый prompt — новое окно с чистым состоянием (ключ меняется вместе с объектом prompt).
  const seen = useRef<{ pr: AuthPrompt | null; n: number }>({ pr: null, n: 0 });
  if (s.prompt !== seen.current.pr) seen.current = { pr: s.prompt, n: seen.current.n + 1 };
  const key = seen.current.n;

  const pr = s.prompt;
  if (!pr) return null;
  const dismiss = () => ref.current.resolvePrompt(false);

  switch (pr.kind) {
    case 'signin':
      return <SignInSheet key={key} reason={pr.reason} returnTo={pr.returnTo} onClose={dismiss} />;
    case 'setup':
      // Без аккаунта заполнять профиль нечего — просто закрываем.
      if (s.status === 'guest' || !s.me) return <Dismiss key={key} onDone={dismiss} />;
      return <SetupSheet key={key} onDone={() => ref.current.resolvePrompt(true)} onLater={dismiss} />;
    case 'rules': {
      const accept = async () => {
        let cur = ref.current;
        if (!cur.config) { await cur.refresh(); cur = ref.current; }
        const v = cur.config?.rulesVersion;
        if (!v) { toastFail(new Error(cur.online ? 'Сервер не отвечает — попробуй чуть позже' : 'Нет интернета')); return; }
        try {
          const me = await socialApi.acceptRules(v);
          ref.current.setMe(me);
          ref.current.resolvePrompt(true);
        } catch (e) {
          toastFail(e);
          // Правила могли обновиться ещё раз — берём новую версию для следующей попытки.
          void ref.current.refresh();
        }
      };
      return <RulesSheet key={key} open mode="accept" onAccept={accept} onClose={dismiss} />;
    }
    case 'banned':
      return <BannedSheet key={key} ban={pr.ban} onClose={dismiss} />;
  }
}
