// «Код дня» (выезжает снизу): у каждого свой код на день по Ташкенту, 12 попыток. Взломал — время, место
// в Para (когда в таблице хотя бы трое), серия и «Поделиться» без цифр (🟩🟨⬜, как в Wordle). Не взломал —
// код открывается. Таблица: «Все», «Мой вуз» — только взрослые, которых можно найти в поиске; «Друзья» — всегда.
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { brand } from '../brand';
import { plural } from '../lib/plural';
import { abbrOf } from '../lib/uni';
import { Segmented } from '../ui/Segmented';
import { toast } from '../ui/Toast';
import { isApiError } from '../social/api';
import { useSocialActions } from '../social/actions';
import { useSession } from '../social/session';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import type { BoardScope, DailyBoard, DailyView, UserCard } from '../social/types';
import { gameApi } from './api';
import { useGx } from './ctx';
import { Board } from './DuelScreen';
import { Bar, dayTitle, errText, fmtMs, handledBySession, inAttempts, isAbort } from './parts';

function shareText(d: DailyView): string {
  const lines = d.moves.map((m) => '🟩'.repeat(m.on) + '🟨'.repeat(m.near) + '⬜'.repeat(Math.max(0, 4 - m.on - m.near)));
  const url = location.origin + '/?uni=' + encodeURIComponent(brand.id) + '&game=1';
  return 'Para · Код дня, ' + dayTitle(d.day) + ' — ' + d.n + '/12\n' + lines.join('\n') + '\n' + url;
}

export function DailyScreen(): JSX.Element {
  const g = useGx();
  const a = useSocialActions();
  const d = g.daily;
  const [busy, setBusy] = useState(false);

  useEffect(() => { void g.loadDaily(!!d); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const playing = !!d && (d.status === 'new' || d.status === 'playing');
  const canPlay = g.access === 'ok';

  const guess = async (code: string): Promise<boolean> => {
    if (!d || busy) return false;
    setBusy(true);
    try {
      g.setDaily(await gameApi.dailyGuess(d.day, code, d.moves.length + 1));
      void g.loadLobby(true);
      return true;
    } catch (e) {
      if (isApiError(e, 'conflict')) {
        if (isApiError(e) && e.field === 'day') toast(errText(e));
        void g.loadDaily(true);
        return false;
      }
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!d) return;
    const text = shareText(d);
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ text }); return; } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await a.copyLink(text);
  };

  let result: JSX.Element | null = null;
  if (d && d.status === 'cracked') {
    result = (
      <div className="gx-result">
        <h2 className="gx-h">{'Взломан ' + inAttempts(d.n) + ' · ' + fmtMs(d.ms)}</h2>
        {d.place !== null && d.total >= 3 && <p className="gx-sub">{d.place}-е место в Para сегодня</p>}
        {d.streak > 0 && <p className="gx-sub">Серия: {d.streak} {plural(d.streak, ['день', 'дня', 'дней'])}</p>}
        <p className="gx-cap">Новый код — в полночь</p>
        <div className="gx-acts">
          <button type="button" className="gx-primary" onClick={() => void share()}>Поделиться</button>
          <button type="button" className="gx-second" onClick={() => g.push({ t: 'board' })}>Таблица</button>
        </div>
      </div>
    );
  } else if (d && d.status === 'failed') {
    result = (
      <div className="gx-result">
        <h2 className="gx-h">Не взломан. Код был {d.code || '····'}. Новый — в полночь</h2>
        <div className="gx-acts">
          <button type="button" className="gx-second" onClick={() => g.push({ t: 'board' })}>Таблица</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Bar left="back" onLeft={g.back} title={'Код дня' + (d ? ' · ' + dayTitle(d.day) : '')} />
      {!d ? (
        <div className="gx-body"><div className="skel gx-skel" /><div className="skel gx-skel" /></div>
      ) : (
        <Board oppLabel="" oppN={0} oppMarks={[]} myCode={null} moves={d.moves} hint={null}
          canGuess={playing && canPlay} wait={playing && g.access === 'offline' ? 'Без интернета доступна только тренировка' : null}
          busy={busy} onGuess={guess} result={result} solo />
      )}
    </>
  );
}

// ─── Таблица кода дня ───

const SCOPES: { value: BoardScope; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'uni', label: 'Мой вуз' },
  { value: 'friends', label: 'Друзья' },
];

function Line(p: { place: number; user: UserCard; n: number; ms: number; me: boolean }): JSX.Element {
  return (
    <li className={'gx-lb' + (p.me ? ' is-me' : '')}>
      <span className="gx-lb__p">{p.place}</span>
      <Avatar user={p.user} size={32} />
      <span className="gx-lb__main">
        <span className="gx-lb__name"><span>{p.user.name}</span><NameBadge u={p.user} /></span>
        {p.user.uniShort && <span className="gx-lb__uni">{abbrOf(p.user.uniShort)}</span>}
      </span>
      <span className="gx-lb__v">{p.n} · {fmtMs(p.ms)}</span>
    </li>
  );
}

export function BoardScreen(): JSX.Element {
  const g = useGx();
  const s = useSession();
  const friendsOnly = g.mode === 'friends';
  const [scope, setScope] = useState<BoardScope>(friendsOnly ? 'friends' : 'all');
  const [data, setData] = useState<DailyBoard | null>(null);
  const [err, setErr] = useState('');
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setErr('');
    gameApi.board(scope, c.signal).then((b) => { if (!c.signal.aborted) setData(b); }, (e) => {
      if (c.signal.aborted || isAbort(e)) return;
      if (!handledBySession(e)) setErr(errText(e));
    });
    return () => c.abort();
  }, [scope]);

  const me = s.status === 'signed' ? s.me : null;
  const board = data && data.scope === scope ? data : null;
  const outside = board && board.me && !board.items.some((x) => x.me) && me && me.username
    ? { ...board.me, user: { id: me.id, username: me.username, name: me.name, avatar: me.avatar, uni: me.uni, uniShort: me.uniShort, team: me.team, badge: me.badge ?? null } }
    : null;

  return (
    <>
      <Bar left="back" onLeft={g.back} title="Таблица" />
      <div className="gx-body">
        <div className="gx-seg">
          <Segmented<BoardScope> value={scope} onChange={setScope} ariaLabel="Какая таблица"
            options={friendsOnly ? SCOPES.filter((x) => x.value === 'friends') : SCOPES} />
        </div>
        {err && <p className="gx-err">{err}</p>}
        {!board && !err && <><div className="skel gx-skel" /><div className="skel gx-skel" /></>}
        {board && board.items.length === 0 && !outside && <p className="gx-empty">Сегодня код ещё никто не взломал — будь первым</p>}
        {board && (board.items.length > 0 || outside) && (
          <ol className="gx-lbs">
            {board.items.map((x) => <Line key={x.user.id} {...x} />)}
            {outside && <Line place={outside.place} user={outside.user} n={outside.n} ms={outside.ms} me />}
          </ol>
        )}
        <p className="gx-foot">
          В общей таблице и таблице вуза — твои друзья и взрослые, которых можно найти в поиске (Профиль → Настройки).
          Таблица вуза — по вузу из профиля.
        </p>
      </div>
    </>
  );
}
