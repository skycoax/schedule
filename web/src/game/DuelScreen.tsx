// Игра 1 на 1 (и её итог на том же экране). Каждый взламывает чужой код в своём темпе: сверху — соперник
// (12 точек попыток и его последние ●○, цифр его попыток не видно никогда), подсказка, своя история, ячейки
// и клавиатура. Свои попытки закончились — «Ждём соперника»; игра решена — итог вместо клавиатуры.
// ☺ — реакции (только когда соперник сейчас в игре), ••• — «Как играть», «Пожаловаться», «Заблокировать», «Сдаться».
// Board — общая часть с тренировкой (Practice.tsx).
import { useEffect, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { chooseAction, confirmDialog } from '../ui/ActionSheet';
import type { SheetAction } from '../ui/ActionSheet';
import { Icon } from '../ui/icons';
import { toast } from '../ui/Toast';
import { isApiError } from '../social/api';
import { useSocialActions } from '../social/actions';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import type { DuelView, GameMark, GameMove, GameReaction } from '../social/types';
import { gameApi } from './api';
import { useGx } from './ctx';
import {
  Bar, FlipCode, GIcon, Keypad, Marks, MoveRow, Pips, REACTIONS, Slots, attemptsText, emojiOf, errText, handledBySession,
  inAttempts, leftText, spaced, untilText, useCode, useScreen,
} from './parts';

// ─── Общая доска: соперник, подсказка, история, ввод или итог ───

export function Board(p: {
  oppLabel: string; oppN: number; oppMarks: GameMark[]; myCode: string | null;
  moves: GameMove[]; hint: string | null; canGuess: boolean; wait: string | null; result: ReactNode | null;
  onGuess: (code: string) => Promise<boolean>; busy: boolean;
  /** Код дня: соперника нет — без полосы соперника. */
  solo?: boolean;
}): JSX.Element {
  const { top } = useScreen();
  const first = useRef(p.moves.length);
  const list = useRef<HTMLOListElement>(null);
  const submitRef = useRef<() => void>(() => {});
  const c = useCode(top && p.canGuess && !p.busy, () => submitRef.current());
  const last = p.oppMarks[p.oppMarks.length - 1];
  const left = 12 - p.moves.length;

  const submit = async () => {
    if (c.code.length !== 4 || p.busy) return;
    if (p.moves.some((m) => m.g === c.code)) { toast('Эта комбинация уже была'); return; }
    if (await p.onGuess(c.code)) c.clear();
  };
  submitRef.current = () => { void submit(); };

  // Новая строка истории — видна (прокручиваем к ней).
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [p.moves.length]);

  return (
    <div className={'gx-duel' + (p.result ? ' is-over' : '')}>
      {!p.solo && <div className="gx-opp">
        <Pips n={p.oppN} />
        <div className="gx-opp__row">
          <span>
            {p.oppLabel}: {attemptsText(p.oppN)}
            {last && <span className="ui-vh">, последняя: {last.on} на месте, {last.near} не на месте</span>}
          </span>
          {last && <Marks on={last.on} near={last.near} small />}
        </div>
        {p.myCode && <div className="gx-opp__code">Твой код: {spaced(p.myCode)}</div>}
      </div>}
      {p.hint && <p className="gx-hint">{p.hint}</p>}
      <ol ref={list} className="gx-moves" aria-label="Твои попытки">
        {p.moves.map((m, i) => <MoveRow key={i} i={i + 1} g={m.g} on={m.on} near={m.near} fresh={i >= first.current} />)}
      </ol>
      {p.result ? p.result : p.canGuess ? (
        <div className="gx-input">
          <Slots value={c.code} small />
          <p className="gx-cap">{leftText(left)}</p>
          <Keypad value={c.code} onDigit={c.add} onErase={c.erase} disabled={p.busy}
            left={{ label: 'Очистить', onClick: c.clear }} />
          <button type="button" className="gx-primary" disabled={c.code.length !== 4 || p.busy} onClick={() => void submit()}>
            Проверить
          </button>
        </div>
      ) : p.wait ? <p className="gx-wait">{p.wait}</p> : null}
    </div>
  );
}

// ─── Тексты итога ───

function hintOf(d: DuelView): string {
  const s = d.opp.score;
  if (d.opp.res === 'cracked' && s !== null) {
    const n = d.me.moves.length;
    return s - 1 > n
      ? 'Соперник взломал твой код ' + inAttempts(s) + ' — уложись в ' + (s - 1) + ', чтобы победить, в ' + s + ' — ничья'
      : 'Соперник взломал твой код ' + inAttempts(s) + ' — взломай сейчас, будет ничья';
  }
  if (d.opp.res === 'failed' || d.opp.res === 'timeout') return 'Соперник не взломал твой код — любая удача твоя';
  return 'Взломай код соперника';
}

/** Итог без слов «он/она»: причины блокировки, ограничения и удаления аккаунта не называем. */
function subOf(d: DuelView): string {
  const o = d.outcome;
  if (!o || o.winner === 'none') return '';
  if (o.reason === 'timeout') return 'Время вышло';
  if (o.reason === 'left' || o.reason === 'banned' || o.reason === 'deleted') {
    return o.winner === 'me' ? 'Соперник сдался — победа за тобой' : 'Игра сдана';
  }
  if (o.winner === 'me') return o.reason === 'early' ? 'Соперник уже не догонит' : 'Код взломан ' + inAttempts(d.me.score ?? d.me.moves.length);
  if (o.winner === 'opp') return 'Соперник взломал твой код быстрее';
  return d.me.score !== null && d.me.score > 12 ? 'Оба кода устояли' : 'Поровну — ' + attemptsText(d.me.score ?? 0);
}

function wordOf(d: DuelView): string {
  if (d.status === 'expired') return 'Вызов истёк';
  if (d.status === 'cancelled' || !d.outcome || d.outcome.winner === 'none') return 'Игра прервана';
  return d.outcome.winner === 'me' ? 'Победа' : d.outcome.winner === 'opp' ? 'Поражение' : 'Ничья';
}

// ─── Итог игры ───

function Result({ d }: { d: DuelView }): JSX.Element {
  const g = useGx();
  const human = g.access === 'ok';
  const r = d.rematch;
  const counter = !!r && !r.mine && r.status === 'open';
  const waiting = !!r && r.mine && r.status === 'open';
  const started = !!r && (r.status === 'active' || r.status === 'done');
  const done = d.status === 'done';

  useEffect(() => { g.markSeen(d.id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [d.id]);

  const rematch = async () => {
    if (!human || !(await g.ensure())) return;
    g.push({ t: 'pad', purpose: { kind: 'rematch', id: d.id, counter } }, 'up');
  };
  const notNow = async () => {
    if (!r) return;
    try { await gameApi.decline(r.id); } catch (e) { if (!handledBySession(e)) toast(errText(e), { kind: 'error' }); }
    void g.loadDuel(d.id, true);
  };
  const another = async () => {
    if (!human || !(await g.ensure())) return;
    g.push({ t: 'pad', purpose: { kind: 'link' } }, 'up');
  };

  return (
    <div className="gx-result">
      <h2 className="gx-big">{wordOf(d)}</h2>
      {done && <p className="gx-sub">{subOf(d)}</p>}
      <div className="gx-codes">
        {d.me.code && <span className="gx-codes__i"><span className="gx-cap">Твой код</span><FlipCode code={d.me.code} label="Твой код" /></span>}
        {done && d.outcome?.oppCode && (
          <span className="gx-codes__i"><span className="gx-cap">Код соперника</span><FlipCode code={d.outcome.oppCode} label="Код соперника" /></span>
        )}
      </div>
      {d.opp.marks.length > 0 && (
        <div className="gx-oppmoves">
          <span className="gx-cap">Попытки соперника</span>
          <span className="gx-oppmoves__list" role="img" aria-label={'Попытки соперника: ' + d.opp.marks.map((m) => m.on + ' на месте, ' + m.near + ' не на месте').join('; ')}>
            {d.opp.marks.map((m, i) => <Marks key={i} on={m.on} near={m.near} small />)}
          </span>
        </div>
      )}
      <div className="gx-acts">
        {done && counter && (
          <>
            <button type="button" className="gx-primary" disabled={!human} onClick={() => void rematch()}>Реванш — соперник согласен</button>
            <button type="button" className="gx-second" onClick={() => void notNow()}>Не сейчас</button>
          </>
        )}
        {done && waiting && <button type="button" className="gx-primary" disabled>Ждём соперника</button>}
        {done && !counter && !waiting && started && r && (
          <button type="button" className="gx-primary" onClick={() => g.push({ t: 'duel', id: r.id })}>Открыть реванш</button>
        )}
        {done && !counter && !waiting && !started && d.canRematch && (
          <button type="button" className="gx-primary" disabled={!human} onClick={() => void rematch()}>Реванш</button>
        )}
        <button type="button" className="gx-second" disabled={!human} onClick={() => void another()}>Вызвать другого</button>
        <button type="button" className="gx-second" onClick={g.back}>Готово</button>
      </div>
    </div>
  );
}

// ─── Открытый вызов (ещё не принят) ───

function Pending({ d }: { d: DuelView }): JSX.Element {
  const g = useGx();
  const [busy, setBusy] = useState(false);
  const name = d.opp.user?.name || 'Соперник';
  const human = g.access === 'ok';
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { if (!handledBySession(e)) toast(errText(e), { kind: 'error' }); }
    setBusy(false);
    void g.loadLobby(true);
  };
  if (d.role === 'invited') {
    return (
      <div className="gx-body gx-center">
        <Avatar user={d.opp.user} size={64} />
        <h2 className="gx-h"><span>{name} вызывает тебя</span><NameBadge u={d.opp.user} /></h2>
        <div className="gx-acts">
          <button type="button" className="gx-primary" disabled={!human || busy}
            onClick={() => void (async () => { if (await g.ensure()) g.push({ t: 'pad', purpose: { kind: 'accept', id: d.id, fromDuel: true } }, 'up'); })()}>
            Принять вызов
          </button>
          <button type="button" className="gx-second" disabled={busy}
            onClick={() => void run(async () => { await gameApi.decline(d.id); toast('Вызов отклонён'); g.back(); })}>Не сейчас</button>
        </div>
      </div>
    );
  }
  return (
    <div className="gx-body gx-center">
      <Avatar user={d.opp.user} size={64} />
      <h2 className="gx-h">{d.kind === 'friend' ? 'Ждём ответа: ' + name : 'Ждём соперника'}</h2>
      {d.kind === 'friend' && <p className="gx-note">Можно закрыть — игра начнётся, когда друг примет вызов.</p>}
      <button type="button" className="gx-link gx-link--danger" disabled={busy}
        onClick={() => void run(async () => {
          try {
            g.applyDuel(await gameApi.leave(d.id, 'open'));
            g.back();
          } catch (e) {
            // Вызов успели принять — не поражение: перечитываем, экран сам покажет начатую игру.
            if (!isApiError(e, 'conflict')) throw e;
            void g.loadDuel(d.id, true);
          }
        })}>Отменить вызов</button>
    </div>
  );
}

// ─── Экран игры ───

interface Float { key: number; emoji: string }

export function DuelScreen({ id }: { id: number }): JSX.Element {
  const g = useGx();
  const a = useSocialActions();
  const d = g.duels[id];
  const [busy, setBusy] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [floats, setFloats] = useState<Float[]>([]);
  const fseq = useRef(0);

  // Всегда свежая игра с сервера (там же ленивое подведение итогов по сроку).
  useEffect(() => {
    void g.loadDuel(id, !!d).then((x) => { if (x === null) { toast('Игра не найдена'); g.back(); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Открытый вызов по ссылке и поиск — у них свои экраны.
  useEffect(() => {
    if (d?.status !== 'open' || d.role !== 'creator') return;
    if (d.kind === 'link') g.replace({ t: 'invite', id }, 'still');
    else if (d.kind === 'quick') g.replace({ t: 'search', id }, 'still');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.status, d?.kind, d?.role]);

  // Реакции соперника: всплывают у его аватара.
  useEffect(() => g.onReact((duel: number, r: GameReaction) => {
    if (duel !== id || g.noReact) return;
    const key = ++fseq.current;
    setFloats((f) => [...f.slice(-4), { key, emoji: emojiOf(r) }]);
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.key !== key)), 1600);
  }), [g, id]);

  const active = d?.status === 'active';
  const live = !!d && active && d.opp.live;
  useEffect(() => { if (!live) setReactOpen(false); }, [live]);

  const guess = async (code: string): Promise<boolean> => {
    if (!d || busy) return false;
    setBusy(true);
    try {
      g.applyDuel(await gameApi.guess(id, code, d.me.moves.length + 1));
      return true;
    } catch (e) {
      if (isApiError(e, 'conflict')) { void g.loadDuel(id, true); return false; }
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const react = async (r: GameReaction) => {
    setReactOpen(false);
    try { await gameApi.react(id, r); } catch (e) {
      if (isApiError(e, 'rate')) toast(errText(e));
      else if (!isApiError(e, 'conflict') && !handledBySession(e)) toast(errText(e), { kind: 'error' });
    }
  };

  const menu = async () => {
    if (!d) return;
    const u = d.opp.user;
    const acts: SheetAction[] = [{ id: 'how', label: 'Как играть' }];
    if (u) {
      acts.push({ id: 'report', label: 'Пожаловаться' });
      acts.push({ id: 'block', label: 'Заблокировать' });
    }
    if (active && !d.me.res) acts.push({ id: 'leave', label: 'Сдаться', role: 'destructive' });
    const pick = await chooseAction({ actions: acts });
    if (pick === 'how') g.howTo();
    else if (pick === 'report' && u) {
      await a.report({ type: 'user', id: u.id }, { username: u.username, kind: 'user' });
      void g.loadDuel(id, true);
    } else if (pick === 'block' && u) {
      if (await a.block(u)) { void g.loadDuel(id, true); void g.loadLobby(true); }
    } else if (pick === 'leave') {
      const ok = await confirmDialog({ title: 'Сдаться?', message: 'Соперник получит победу.', confirm: 'Сдаться', destructive: true, cancel: 'Отмена' });
      if (!ok) return;
      try { g.applyDuel(await gameApi.leave(id, 'active')); } catch (e) {
        if (isApiError(e, 'conflict')) { void g.loadDuel(id, true); return; }
        if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
      }
    }
  };

  const u = d?.opp.user || null;
  const who = (
    <span className="gx-who">
      <span className="gx-who__av">
        <Avatar user={d?.opp.gone ? null : u} size={32} />
        {floats.map((f) => <span key={f.key} className="gx-float" aria-hidden="true">{f.emoji}</span>)}
      </span>
      <span className="gx-who__name">{d?.opp.gone ? 'Удалённый аккаунт' : u?.name || ''}</span>
      <NameBadge u={u} />
      {live && <span className="gx-who__live">в игре</span>}
    </span>
  );
  const right = (
    <>
      {live && !g.noReact && (
        <button type="button" className="ix__icon" aria-label="Реакции" aria-expanded={reactOpen} onClick={() => setReactOpen((v) => !v)}>
          <GIcon name="smile" />
        </button>
      )}
      <button type="button" className="ix__icon" aria-label="Ещё" onClick={() => void menu()}><Icon name="ellipsis" size={24} /></button>
    </>
  );

  let body: ReactNode = <div className="gx-body"><div className="skel gx-skel" /><div className="skel gx-skel" /></div>;
  if (d && d.status === 'open') body = <Pending d={d} />;
  else if (d) {
    const over = d.status !== 'active';
    const wait = active && d.me.res
      ? (d.me.res === 'cracked' ? 'Код соперника взломан ' + inAttempts(d.me.score ?? d.me.moves.length) : 'Попытки кончились — код не взломан')
        + '. Ждём соперника — у него время ' + untilText(d.deadlineAt, g.now())
      : null;
    body = (
      <Board oppLabel="Соперник" oppN={d.opp.n} oppMarks={d.opp.marks} myCode={d.me.code} moves={d.me.moves}
        hint={over || d.me.res ? null : hintOf(d)} canGuess={active && !d.me.res} wait={wait} busy={busy} onGuess={guess}
        result={over ? <Result d={d} /> : null} />
    );
  }

  return (
    <>
      <Bar left="back" onLeft={g.back} title={who} right={right} />
      {reactOpen && (
        <div className="gx-reacts" role="group" aria-label="Реакции">
          {REACTIONS.map((r) => (
            <button key={r.id} type="button" className="gx-react" aria-label={r.label} onClick={() => void react(r.id)}>{r.emoji}</button>
          ))}
        </div>
      )}
      {body}
    </>
  );
}
