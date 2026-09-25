// Удаление аккаунта (требование Google Play): галочка → «Удалить аккаунт навсегда» → DELETE /api/social/me.
// Работает в любом режиме «Обсуждений», в том числе при ограничении. Расписание и настройки на телефоне остаются.
import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Switch';
import { toast } from '../../ui/Toast';
import { socialApi } from '../api';
import { emit } from '../events';
import { clearSocialLocal } from '../local';
import { LINKS } from '../rules';
import { useSession } from '../session';
import './profile.css';

const FAILED = 'Не получилось удалить аккаунт. Попробуй ещё раз или напиши @skycoax.';

export function DeleteAccountSheet(p: { open: boolean; onClose: () => void }): JSX.Element | null {
  const s = useSession();
  const titleId = useId();
  const switchId = useId();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (p.open) return;
    setSure(false);
    setBusy(false);
    setError('');
  }, [p.open]);

  const run = async () => {
    if (!sure || busy || !s.online) return;
    setBusy(true);
    setError('');
    try {
      await socialApi.deleteAccount();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error && e.message ? e.message : FAILED);
      return;
    }
    // Сервер уже удалил сессию и куку: выходим только на телефоне, без запроса logout.
    clearSocialLocal();
    emit({ type: 'me-changed', me: null });
    p.onClose();
    toast('Аккаунт удалён');
    await s.refresh();
  };

  return (
    <Sheet open={p.open} onClose={p.onClose} variant="bottom" labelledBy={titleId} dismissible={!busy} right={null}>
      <div className="del">
        <h2 className="del__t" id={titleId}>Удалить аккаунт?</h2>
        <p className="del__p">
          Удалятся профиль, почта, посты, ответы, фото, отметки «нравится», друзья и блокировки. Вернуть их не получится.
          Расписание и настройки на этом телефоне останутся.
        </p>
        <a className="del__link" href={LINKS.deletion + '#kept'} target="_blank" rel="noopener">Что остаётся после удаления</a>

        <div className="del__confirm">
          <label className="del__confirm-l" htmlFor={switchId}>Понимаю, что это нельзя отменить</label>
          <Switch id={switchId} checked={sure} onChange={setSure} disabled={busy}
            label="Понимаю, что это нельзя отменить" />
        </div>

        {!s.online && <p className="del__err" role="alert">Нужен интернет, чтобы удалить аккаунт.</p>}
        {s.online && error && <p className="del__err" role="alert">{error}</p>}

        <div className="del__acts">
          <Button full size={50} variant="destructive-filled" disabled={!sure || busy || !s.online}
            className={busy ? 'del__working' : undefined} onClick={() => void run()}>
            {busy ? 'Удаляю…' : 'Удалить аккаунт навсегда'}
          </Button>
          <Button full size={44} variant="plain" disabled={busy} onClick={p.onClose}>Отмена</Button>
        </div>
      </div>
    </Sheet>
  );
}
