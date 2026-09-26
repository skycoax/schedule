// «Ищем соперника»: очередь на сутки. Кто-то ещё нажмёт «Случайный соперник» — игра начнётся (ответ сервера
// или событие duel): на 0,9 с «Соперник найден» с его именем, потом сама игра.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { toast } from '../ui/Toast';
import { abbrOf } from '../lib/uni';
import { isApiError } from '../social/api';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import { gameApi } from './api';
import { useGx } from './ctx';
import { Bar, errText, handledBySession, useScreen } from './parts';

const FOUND_MS = 900;

export function SearchScreen({ id }: { id: number }): JSX.Element {
  const g = useGx();
  const { top } = useScreen();
  const d = g.duels[id];
  const [busy, setBusy] = useState(false);
  const found = d?.status === 'active';

  useEffect(() => { void g.loadDuel(id, !!d); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  // К игре — только когда поиск сверху: пока поверх него тренировка с ботом, её не обрываем
  // (вернётся к поиску — увидит «Соперник найден» и перейдёт к игре).
  useEffect(() => {
    if (!found || !top) return;
    const t = window.setTimeout(() => g.replace({ t: 'duel', id }), FOUND_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, top]);

  const cancel = async () => {
    setBusy(true);
    try {
      g.applyDuel(await gameApi.leave(id, 'open'));
      void g.loadLobby(true);
      g.back();
    } catch (e) {
      setBusy(false);
      // Соперник нашёлся в ту же секунду — не поражение: перечитываем, экран покажет «Соперник найден».
      if (isApiError(e, 'conflict')) { void g.loadDuel(id, true); return; }
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    }
  };

  const u = d?.opp.user;
  if (found) {
    return (
      <>
        <Bar left="back" onLeft={g.back} />
        <div className="gx-body gx-center gx-found" role="status">
          <h2 className="gx-h">Соперник найден</h2>
          <Avatar user={u || null} size={64} />
          <p className="gx-h gx-h--sm"><span>{u ? u.name : 'Удалённый аккаунт'}</span><NameBadge u={u} /></p>
          {u?.uniShort && <p className="gx-cap">{abbrOf(u.uniShort)}</p>}
        </div>
      </>
    );
  }

  const over = !!d && d.status !== 'open';
  return (
    <>
      <Bar left="back" onLeft={g.back} />
      <div className="gx-body gx-center">
        <div className="gx-radar" aria-hidden="true"><i /><i /><i /></div>
        <h2 className="gx-h">{over ? (d.status === 'expired' ? 'Вызов истёк' : 'Игра прервана') : 'Ищем соперника'}</h2>
        {!over && (
          <p className="gx-text">
            Как только кто-то ещё нажмёт «Случайный соперник», игра начнётся. Можно закрыть приложение — поиск продлится сутки.
          </p>
        )}
        <div className="gx-acts">
          <button type="button" className="gx-primary" onClick={() => g.push({ t: 'pad', purpose: { kind: 'practice' } }, 'up')}>
            Пока тренироваться с ботом
          </button>
          {!over && <button type="button" className="gx-second" disabled={busy} onClick={() => void cancel()}>Отменить поиск</button>}
        </div>
      </div>
    </>
  );
}
