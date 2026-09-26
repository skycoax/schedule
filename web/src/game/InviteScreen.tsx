// «Вызов готов»: код вызова шестью створками, «Отправить» (системное «Поделиться», без него — копия ссылки),
// «Скопировать ссылку» и «Отменить вызов». Друг принял — сразу к игре.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { brand } from '../brand';
import { FlipDigit } from '../components/FlipClock';
import { confirmDialog } from '../ui/ActionSheet';
import { toast } from '../ui/Toast';
import { isApiError } from '../social/api';
import { useSocialActions } from '../social/actions';
import { gameApi } from './api';
import { useGx } from './ctx';
import { Bar, errText, handledBySession } from './parts';

export const duelLink = (token: string): string =>
  location.origin + '/?uni=' + encodeURIComponent(brand.id) + '&duel=' + token;

/** «Поделиться» вызовом; отменили — ничего; нет «Поделиться» — копия ссылки и «Ссылка скопирована». */
export async function shareInvite(token: string, copy: (url: string) => Promise<void>): Promise<void> {
  const url = duelLink(token);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'Код',
        text: 'Вызываю тебя в «Код» — кто быстрее взломает четыре цифры? Код вызова: ' + token,
        url,
      });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  await copy(url);
}

export function InviteScreen({ id }: { id: number }): JSX.Element {
  const g = useGx();
  const a = useSocialActions();
  const d = g.duels[id];
  const [busy, setBusy] = useState(false);

  useEffect(() => { void g.loadDuel(id, !!d); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  // Друг принял вызов — к игре.
  useEffect(() => {
    if (d?.status === 'active') g.replace({ t: 'duel', id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.status]);

  const token = d?.token || '';
  const open = d?.status === 'open';

  const cancel = async () => {
    const ok = await confirmDialog({ title: 'Отменить вызов?', message: 'Ссылка перестанет работать.', confirm: 'Отменить вызов', destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      g.applyDuel(await gameApi.leave(id, 'open'));
      void g.loadLobby(true);
      g.back();
    } catch (e) {
      setBusy(false);
      // Друг принял вызов, пока открыт был вопрос «Отменить вызов?», — это не поражение: перечитываем, экран сам
      // перейдёт к игре.
      if (isApiError(e, 'conflict')) {
        const x = await g.loadDuel(id, true);
        if (x?.status === 'active') toast('Вызов уже принят — игра началась');
        return;
      }
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    }
  };

  return (
    <>
      <Bar left="back" onLeft={g.back} title="Вызов готов" />
      <div className="gx-body gx-center">
        <div className="gx-token" role="img" aria-label={'Код вызова: ' + token.split('').join(' ')}>
          {(token || '······').split('').map((ch, i) => <FlipDigit key={i} className="is-sm" char={ch} />)}
        </div>
        <p className="gx-cap">Код вызова · действует 24 часа</p>
        {d && !open && <p className="gx-err">{d.status === 'expired' ? 'Вызов истёк' : 'Игра прервана'}</p>}
        <div className="gx-acts">
          <button type="button" className="gx-primary" disabled={!token || !open} onClick={() => void shareInvite(token, a.copyLink)}>Отправить</button>
          <button type="button" className="gx-second" disabled={!token || !open} onClick={() => void a.copyLink(duelLink(token))}>Скопировать ссылку</button>
        </div>
        <p className="gx-note">Можно закрыть — игра начнётся, когда друг примет вызов.</p>
        {open && (
          <button type="button" className="gx-link gx-link--danger" disabled={busy} onClick={() => void cancel()}>Отменить вызов</button>
        )}
      </div>
    </>
  );
}
