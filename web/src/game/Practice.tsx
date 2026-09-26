// Тренировка с ботом — только на телефоне: работает гостю, без сети, с ограничением и когда игра с людьми
// выключена. Свой код выбрал человек, бот загадал случайный. После каждой попытки человека бот делает одну
// свою (bot.ts); итог — как в игре с людьми (settleLocal). Счёт против бота — store('game_bot') = «w:l:d».
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../ui/icons';
import { store } from '../lib/store';
import type { GameMove } from '../social/types';
import { botGuess } from './bot';
import { useGx } from './ctx';
import { Board } from './DuelScreen';
import { ATTEMPTS, evaluate, randomCode, settleLocal } from './logic';
import type { Settled, Side } from './logic';
import { Bar, FlipCode, inAttempts } from './parts';

const BOT_MS = 600;

const sideOf = (moves: GameMove[]): Side => {
  const n = moves.length;
  const cracked = n > 0 && moves[n - 1].on === 4;
  return { n, res: cracked ? 'cracked' : n >= ATTEMPTS ? 'failed' : null };
};

function readScore(): [number, number, number] {
  const p = (store('game_bot') || '').split(':').map((x) => Math.max(0, Math.floor(Number(x)) || 0));
  return [p[0] || 0, p[1] || 0, p[2] || 0];
}

function hintOf(me: Side, bot: Side): string {
  if (bot.res === 'cracked') {
    const s = bot.n;
    return s - 1 > me.n
      ? 'Бот взломал твой код ' + inAttempts(s) + ' — уложись в ' + (s - 1) + ', чтобы победить, в ' + s + ' — ничья'
      : 'Бот взломал твой код ' + inAttempts(s) + ' — взломай сейчас, будет ничья';
  }
  if (bot.res === 'failed') return 'Бот не взломал твой код — любая удача твоя';
  return 'Взломай код бота';
}

export function Practice({ code }: { code: string }): JSX.Element {
  const g = useGx();
  const [botCode] = useState(() => randomCode());
  const [mine, setMine] = useState<GameMove[]>([]);
  const [bot, setBot] = useState<GameMove[]>([]);
  const [thinking, setThinking] = useState(false);
  const botRef = useRef(bot);
  botRef.current = bot;
  const counted = useRef(false);
  const [score, setScore] = useState(readScore);

  const me = sideOf(mine);
  const b = sideOf(bot);
  const res: Settled | null = settleLocal(me, b);

  /** Одна попытка бота (если он ещё играет). */
  const botMove = () => {
    const cur = botRef.current;
    if (sideOf(cur).res) return;
    const guess = botGuess(cur);
    const next = [...cur, { g: guess, ...evaluate(code, guess) }];
    botRef.current = next;
    setBot(next);
  };

  const guess = async (c: string): Promise<boolean> => {
    if (thinking || res || me.res) return false;
    const next = [...mine, { g: c, ...evaluate(botCode, c) }];
    setMine(next);
    if (!sideOf(botRef.current).res && !settleLocal(sideOf(next), sideOf(botRef.current))) {
      setThinking(true);
      window.setTimeout(() => { botMove(); setThinking(false); }, BOT_MS);
    }
    return true;
  };

  // Свои попытки кончились, а исход не решён — бот доигрывает сам.
  useEffect(() => {
    if (res || !me.res || thinking) return;
    const t = window.setTimeout(botMove, BOT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, me.res, thinking, bot.length]);

  // Итог — в счёт против бота, один раз.
  useEffect(() => {
    if (!res || counted.current) return;
    counted.current = true;
    const [w, l, d] = readScore();
    const next: [number, number, number] = res.winner === 'a' ? [w + 1, l, d] : res.winner === 'b' ? [w, l + 1, d] : [w, l, d + 1];
    store('game_bot', next.join(':'));
    setScore(next);
  }, [res]);

  const result = res ? (
    <div className="gx-result">
      <h2 className="gx-big">{res.winner === 'a' ? 'Ты быстрее бота' : res.winner === 'b' ? 'Бот оказался быстрее' : 'Ничья'}</h2>
      <div className="gx-codes">
        <span className="gx-codes__i"><span className="gx-cap">Твой код</span><FlipCode code={code} label="Твой код" /></span>
        <span className="gx-codes__i"><span className="gx-cap">Код бота</span><FlipCode code={botCode} label="Код бота" /></span>
      </div>
      <div className="gx-acts">
        <button type="button" className="gx-primary" onClick={() => g.replace({ t: 'pad', purpose: { kind: 'practice' } }, 'up')}>Ещё раз</button>
        <button type="button" className="gx-second" onClick={g.back}>Готово</button>
      </div>
      <p className="gx-foot">Против бота: {score[0]} : {score[1]}</p>
    </div>
  ) : null;

  const title = (
    <span className="gx-who">
      <span className="gx-who__bot" aria-hidden="true"><Icon name="grid" size={18} /></span>
      <span className="gx-who__name">Бот Para · тренировка</span>
    </span>
  );

  return (
    <>
      <Bar left="back" onLeft={g.back} title={title} />
      <Board oppLabel="Бот" oppN={b.n} oppMarks={bot.map((m) => ({ on: m.on, near: m.near }))} myCode={code} moves={mine}
        hint={res ? null : hintOf(me, b)} canGuess={!res && !me.res} wait={!res && me.res ? 'Бот ещё играет' : null}
        busy={thinking} onGuess={guess} result={result} />
    </>
  );
}
