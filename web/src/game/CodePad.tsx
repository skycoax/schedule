// «Твой код» (выезжает снизу): четыре ячейки-створки и клавиатура. Свои четыре разные цифры загадывают перед
// каждой игрой — вызов ссылкой или другу, случайный соперник, принять вызов, реванш и тренировка с ботом.
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { toast } from '../ui/Toast';
import { isApiError } from '../social/api';
import { gameApi } from './api';
import { useGx } from './ctx';
import type { PadPurpose } from './ctx';
import { validCode } from './logic';
import { Bar, Keypad, Slots, errText, handledBySession, useCode, useScreen } from './parts';

function buttonText(p: PadPurpose): string {
  switch (p.kind) {
    case 'link': return 'Создать вызов';
    case 'friend': return 'Отправить вызов';
    case 'quick': return 'Искать соперника';
    case 'join': case 'accept': return 'Принять вызов';
    case 'rematch': return p.counter ? 'Начать реванш' : 'Предложить реванш';
    case 'practice': return 'Начать';
  }
}

export function CodePad({ purpose }: { purpose: PadPurpose }): JSX.Element {
  const g = useGx();
  const { top } = useScreen();
  const [busy, setBusy] = useState(false);
  const submitRef = useRef<() => void>(() => {});
  const c = useCode(top && !busy, () => submitRef.current());

  const submit = async () => {
    const code = c.code;
    if (!validCode(code) || busy) return;
    if (purpose.kind === 'practice') { g.replace({ t: 'practice', code }); return; }
    setBusy(true);
    try {
      switch (purpose.kind) {
        case 'link': {
          const r = await gameApi.create('link', code);
          g.applyDuel(r.duel);
          g.replace({ t: 'invite', id: r.duel.id });
          break;
        }
        case 'friend': {
          const r = await gameApi.create('friend', code, purpose.user.id);
          g.applyDuel(r.duel);
          // Друг уже вызвал тебя сам — сервер принял его вызов: сразу к игре.
          if (r.duel.status === 'active') {
            g.replace({ t: 'duel', id: r.duel.id });
            break;
          }
          toast('Вызов отправлен: ' + purpose.user.name);
          g.back();
          void g.loadLobby(true);
          break;
        }
        case 'quick': {
          const r = await gameApi.create('quick', code);
          g.applyDuel(r.duel);
          g.replace({ t: 'search', id: r.duel.id });
          break;
        }
        case 'join': {
          const d = await gameApi.join(purpose.token, code);
          g.applyDuel(d);
          // «Код вызова» под этим экраном больше не нужен.
          g.replace({ t: 'duel', id: d.id }, 'push', 2);
          break;
        }
        case 'accept': {
          const d = await gameApi.accept(purpose.id, code);
          g.applyDuel(d);
          // Под «Твой код» — экран этой же игры (вызов открыли из него): он уже покажет начатую игру.
          if (purpose.fromDuel) g.back();
          else g.replace({ t: 'duel', id: d.id });
          break;
        }
        case 'rematch': {
          const d = await gameApi.rematch(purpose.id, code);
          g.applyDuel(d);
          if (d.status === 'active') {
            g.replace({ t: 'duel', id: d.id }, 'push', 2);
          } else {
            if (d.friends) toast('Реванш предложен: ' + (d.opp.user?.name || 'сопернику'));
            g.back();
            void g.loadDuel(purpose.id, true);
          }
          break;
        }
      }
    } catch (e) {
      setBusy(false);
      if (handledBySession(e)) return;
      if (isApiError(e, 'blocked') && purpose.kind === 'friend') { toast('Нельзя вызвать этого пользователя', { kind: 'error' }); return; }
      toast(errText(e), { kind: 'error' });
      // Вызов уже не тот (принят, истёк) — назад, там видно, что с ним: «Код вызова» проверит его заново,
      // экран игры — перечитает.
      if (isApiError(e, 'not_found') || isApiError(e, 'conflict')) {
        if (purpose.kind === 'accept' || purpose.kind === 'rematch') void g.loadDuel(purpose.id, true);
        g.back();
      }
      return;
    }
    setBusy(false);
  };
  submitRef.current = () => { void submit(); };

  return (
    <>
      <Bar left="back" onLeft={g.back} title="Твой код" />
      <div className="gx-pad">
        <div className="gx-pad__top">
          <Slots value={c.code} />
          <p className="gx-cap">Четыре разные цифры. Их будет взламывать соперник.</p>
          {purpose.kind === 'friend' && <p className="gx-cap">Вызов для: {purpose.user.name}</p>}
        </div>
        <div className="gx-pad__bottom">
          <Keypad value={c.code} onDigit={c.add} onErase={c.erase} disabled={busy}
            left={{ label: 'Случайно', onClick: c.random }} />
          <button type="button" className="gx-primary" disabled={c.code.length !== 4 || busy} aria-busy={busy || undefined}
            onClick={() => void submit()}>{buttonText(purpose)}</button>
        </div>
      </div>
    </>
  );
}
