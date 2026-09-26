// Лобби «Кода»: четыре цифры-створки для настроения, режимы (код дня, вызвать друга, случайный соперник,
// ввести код, тренировка), вызовы мне и свои игры. Гостю, без сети, с ограничением, в «только чтение» и
// когда игра выключена — игры с людьми приглушены (гостю нажатие открывает вход), тренировка работает всегда.
import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { FlipDigit } from '../components/FlipClock';
import { chooseAction } from '../ui/ActionSheet';
import { Icon } from '../ui/icons';
import { toast } from '../ui/Toast';
import { plural } from '../lib/plural';
import { reducedMotion } from '../social/instants/motion';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import type { DuelRow } from '../social/types';
import { gameApi } from './api';
import { useGx } from './ctx';
import type { Access } from './ctx';
import { randomCode } from './logic';
import { Bar, GIcon, attemptsText, errText, handledBySession, leftTime, useScreen } from './parts';

export const NOTE: Record<Exclude<Access, 'ok' | 'loading'>, string> = {
  guest: 'Войди, чтобы играть с другими. Тренировка — без входа.',
  offline: 'Без интернета доступна только тренировка',
  banned: 'Пока действует ограничение, играть можно только с ботом',
  readonly: 'Игры с людьми временно на паузе',
  off: 'Игры с людьми сейчас недоступны — можно потренироваться с ботом',
};

/** Четыре створки: раз в 2,4 с одна из цифр меняется (при «уменьшить движение» — стоят). */
function Deco(): JSX.Element {
  const [code, setCode] = useState(() => randomCode());
  useEffect(() => {
    if (reducedMotion()) return;
    const t = window.setInterval(() => {
      setCode((c) => {
        const i = Math.floor(Math.random() * 4);
        const free = '0123456789'.split('').filter((d) => !c.includes(d));
        const d = free[Math.floor(Math.random() * free.length)];
        return c.slice(0, i) + d + c.slice(i + 1);
      });
    }, 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="gx-deco" aria-hidden="true">
      {code.split('').map((d, i) => <FlipDigit key={i} char={d} />)}
    </div>
  );
}

function Row(p: {
  title: string; sub: ReactNode; value?: string; onClick: () => void; dim?: boolean; icon?: ReactNode;
}): JSX.Element {
  return (
    <button type="button" className={'gx-row' + (p.dim ? ' is-dim' : '')} onClick={p.onClick} aria-disabled={p.dim || undefined}>
      {p.icon && <span className="gx-row__ico" aria-hidden="true">{p.icon}</span>}
      <span className="gx-row__main">
        <span className="gx-row__t">{p.title}</span>
        <span className="gx-row__s">{p.sub}</span>
      </span>
      {p.value && <span className="gx-row__v">{p.value}</span>}
      <Icon name="chevronRight" size={16} className="gx-row__chev" />
    </button>
  );
}

const oppName = (r: { opp: { name: string } | null; gone: boolean }) =>
  r.gone ? 'Удалённый аккаунт' : r.opp?.name || '';

/** Счёт «5 против 7»; неизвестный счёт — «—». */
const vs = (a: number | null, b: number | null, word: string) => (a ?? '—') + ' ' + word + ' ' + (b ?? '—');

/** Строка игры: что сейчас с ней. */
function rowText(r: DuelRow, now: number): string {
  switch (r.state) {
    case 'turn': return 'Твой ход · ' + r.myN + ' из 12';
    case 'wait_join':
      if (r.kind === 'quick') return 'Ищем соперника';
      if (r.kind === 'link') return 'Вызов ждёт соперника · ' + leftTime(r.deadlineAt, now);
      if (r.kind === 'friend') return 'Ждём ответа: ' + oppName(r);
      return 'Ждём соперника';
    case 'wait_opp':
      return (r.myScore === null || r.myScore > 12 ? 'Код не взломан' : 'Ты — ' + attemptsText(r.myScore)) + ' · соперник ещё играет';
    case 'won': return r.reason === 'left' ? 'Победа · соперник сдался' : 'Победа · ' + vs(r.myScore, r.oppScore, 'против');
    case 'lost': return r.reason === 'left' ? 'Поражение · игра сдана' : 'Поражение · ' + vs(r.myScore, r.oppScore, 'против');
    case 'draw': return 'Ничья · ' + vs(r.myScore, r.oppScore, 'и');
    case 'expired': return 'Вызов истёк';
    case 'cancelled': return 'Игра прервана';
    case 'invited': return 'Вызывает тебя';
  }
}

function rowTitle(r: DuelRow): string {
  if (r.opp || r.gone) return oppName(r);
  if (r.kind === 'quick') return 'Случайный соперник';
  if (r.kind === 'link') return 'Вызов по ссылке';
  return 'Соперник';
}

export function Lobby(): JSX.Element {
  const g = useGx();
  const { top } = useScreen();
  const [now, setNow] = useState(() => g.now());
  const human = g.access === 'ok';
  const guest = g.access === 'guest' || g.access === 'loading';
  const note = g.access === 'ok' || g.access === 'loading' ? null : NOTE[g.access];
  const lobby = g.lobby;
  const canLook = g.signed && g.access !== 'off' && g.access !== 'offline';

  // Лобби снова сверху (или появился вход, сеть) — обновляем.
  useEffect(() => {
    if (top && canLook) void g.loadLobby(g.lobbyState === 'ready');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, canLook]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(g.now()), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Игра с людьми: гостю — вход (и назад в игру), приглушённым — ничего, остальным — проверки сессии. */
  const withPeople = async (fn: () => void) => {
    if (guest) { if (await g.ensure()) fn(); return; }
    if (!human) return;
    if (await g.ensure()) fn();
  };

  const duels = lobby?.duels || [];
  const invited = duels.filter((r) => r.state === 'invited');
  const mine = duels.filter((r) => r.state !== 'invited');
  const search = mine.find((r) => r.kind === 'quick' && r.status === 'open');
  const daily = lobby?.daily;
  const dailyValue = !daily ? undefined
    : daily.status === 'new' ? 'Не сыгран'
      : daily.status === 'playing' ? daily.n + ' из 12'
        : daily.status === 'cracked' ? 'Взломан · ' + daily.n : 'Не взломан';
  const searching = lobby?.searching || 0;
  const quickSub = search ? 'Ищем тебе соперника…'
    : searching >= 1 ? 'Сейчас ищут соперника: ' + searching + ' — заходи'
      : 'Любой игрок Para · ответ в течение суток';

  const challenge = async () => {
    const pick = await chooseAction({
      title: 'Вызвать друга',
      actions: [{ id: 'link', label: 'Отправить ссылку' }, { id: 'friends', label: 'Выбрать из друзей' }],
    });
    if (pick === 'link') g.push({ t: 'pad', purpose: { kind: 'link' } }, 'up');
    else if (pick === 'friends') g.pickFriend();
  };

  const accept = (r: DuelRow) => withPeople(() => g.push({ t: 'pad', purpose: { kind: 'accept', id: r.id } }, 'up'));
  const decline = async (r: DuelRow) => {
    try {
      await gameApi.decline(r.id);
      toast('Вызов отклонён');
    } catch (e) {
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    }
    void g.loadLobby(true);
  };

  const open = (r: DuelRow) => {
    if (r.kind === 'link' && r.status === 'open') g.push({ t: 'invite', id: r.id });
    else if (r.kind === 'quick' && r.status === 'open') g.push({ t: 'search', id: r.id });
    else g.push({ t: 'duel', id: r.id });
  };

  const st = lobby?.me;
  const stats = st && (st.wins > 0 || st.losses > 0 || st.draws > 0 || st.streak > 0)
    ? st.wins + ' ' + plural(st.wins, ['победа', 'победы', 'побед']) + ' · '
      + st.losses + ' ' + plural(st.losses, ['поражение', 'поражения', 'поражений']) + ' · '
      + st.draws + ' ' + plural(st.draws, ['ничья', 'ничьи', 'ничьих']) + ' · серия кода дня: ' + st.streak
    : '';
  const dimPeople = !human && !guest;
  const joinDim = g.access === 'offline' || g.access === 'off';
  const loading = canLook && !lobby && g.lobbyState !== 'error';

  return (
    <>
      <Bar left="close" onLeft={g.closeAll} title="Код"
        right={<button type="button" className="ix__icon" aria-label="Как играть" onClick={g.howTo}><GIcon name="help" /></button>} />
      <div className="gx-body">
        <Deco />
        <p className="gx-lead">Взломай четыре цифры быстрее соперника</p>

        <div className="gx-list">
          <Row title="Код дня" sub="Новый код каждый день · 12 попыток" value={dailyValue}
            dim={dimPeople} onClick={() => void withPeople(() => g.push({ t: 'daily' }, 'up'))} />
          <Row title="Вызвать друга" sub="Ссылкой в Telegram или из друзей Para" dim={dimPeople}
            onClick={() => void withPeople(() => void challenge())} />
          {g.mode !== 'friends' && (
            <Row title="Случайный соперник" sub={human ? quickSub : 'Любой игрок Para · ответ в течение суток'} dim={dimPeople}
              onClick={() => {
                if (search && human) g.push({ t: 'search', id: search.id });
                else void withPeople(() => g.push({ t: 'pad', purpose: { kind: 'quick' } }, 'up'));
              }} />
          )}
          {/* Посмотреть вызов можно и гостю, и в «только чтение»; принять — там, где можно играть. */}
          <Row title="Ввести код" sub="Если друг прислал код вызова" dim={joinDim}
            onClick={() => { if (!joinDim) g.push({ t: 'join' }); }} />
          <Row title="Тренировка с ботом" sub="Без счёта, работает без интернета"
            icon={<Icon name="grid" size={18} />}
            onClick={() => g.push({ t: 'pad', purpose: { kind: 'practice' } }, 'up')} />
        </div>
        {note && <p className="gx-note">{note}</p>}

        {loading && (
          <div aria-busy="true" aria-label="Загрузка">
            <div className="skel gx-skel" />
            <div className="skel gx-skel" />
          </div>
        )}

        {invited.length > 0 && (
          <section>
            <h3 className="gx-sec">Тебя вызывают</h3>
            <div className="gx-list">
              {invited.map((r) => (
                <div key={r.id} className="gx-inv">
                  <Avatar user={r.opp} size={40} />
                  <span className="gx-row__main">
                    <span className="gx-row__t">
                      <span className="gx-name">{oppName(r)} вызывает тебя</span><NameBadge u={r.opp} />
                    </span>
                    <span className="gx-row__s">{r.opp ? '@' + r.opp.username + ' · ' : ''}{leftTime(r.deadlineAt, now)}</span>
                  </span>
                  <button type="button" className="gx-pill" disabled={!human} onClick={() => void accept(r)}>Принять</button>
                  <button type="button" className="ix__icon gx-x" aria-label="Отклонить" onClick={() => void decline(r)}>
                    <Icon name="close" size={18} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {mine.length > 0 && (
          <section>
            <h3 className="gx-sec">Твои игры</h3>
            <div className="gx-list">
              {mine.map((r) => (
                <button key={r.id} type="button" className={'gx-row gx-game' + (r.unseen ? ' is-unseen' : '')} onClick={() => open(r)}>
                  <Avatar user={r.gone ? null : r.opp} size={40} />
                  <span className="gx-row__main">
                    <span className="gx-row__t"><span className="gx-name">{rowTitle(r)}</span><NameBadge u={r.opp} /></span>
                    <span className="gx-row__s">{rowText(r, now)}</span>
                  </span>
                  {r.unseen && <i className="gx-unseen" aria-label="Новое" role="img" />}
                  <Icon name="chevronRight" size={16} className="gx-row__chev" />
                </button>
              ))}
            </div>
          </section>
        )}

        {stats && <p className="gx-foot">{stats}</p>}
      </div>
    </>
  );
}
