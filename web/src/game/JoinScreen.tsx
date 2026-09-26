// «Ввести код» и превью вызова. Код вызова — шесть створок над одним настоящим полем ввода (в верхней половине
// экрана, чтобы клавиатура не закрывала): чужие символы отбрасываются, вставка работает (и целой ссылкой, и текстом
// из Telegram), похожие русские буквы (К, М, Х…) становятся латинскими, на шестом знаке — проверка.
// Ссылка ?duel= открывает сразу превью. Гостю — «Войти и принять»: играть по ссылке без входа нельзя (возраст, баны).
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { FlipDigit } from '../components/FlipClock';
import { abbrOf } from '../lib/uni';
import { isApiError } from '../social/api';
import { useSocialActions } from '../social/actions';
import { currentReturnTo } from '../social/session';
import { Avatar } from '../social/ui/Avatar';
import { NameBadge } from '../social/ui/Badges';
import type { GameInvite } from '../social/types';
import { gameApi } from './api';
import { useGx } from './ctx';
import { shareInvite } from './InviteScreen';
import { NOTE } from './Lobby';
import { TOKEN_RE } from './logic';
import { Bar, errText, useScreen } from './parts';

type State =
  | { k: 'input'; err: boolean }
  | { k: 'loading' }
  | { k: 'preview'; inv: GameInvite }
  | { k: 'gone' }
  | { k: 'mine' }
  | { k: 'error'; text: string };

// Русские буквы, похожие на латинские из кода: на русской раскладке «K7M2QX» набирается как К, М, Х.
const HOMO: Record<string, string> = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', Р: 'P', Т: 'T', Х: 'X', У: 'Y',
};
const upper = (v: string) => v.toUpperCase().replace(/[АВСЕНКМРТХУ]/g, (ch) => HOMO[ch] || ch);
const clean = (v: string) => upper(v).replace(/[^A-HJKMNP-Z2-9]/g, '').slice(0, 6);
/** Есть знаки, которых в коде не бывает (кроме пробелов). */
const hasForeign = (v: string) => /[^A-HJKMNP-Z2-9\s]/.test(upper(v));

/**
 * Код из того, что вставили или набрали: ссылка с ?duel= (кнопка «Скопировать ссылку», «Копировать ссылку» в Telegram),
 * отдельное слово из шести знаков кода (текст приглашения), иначе — знаки кода подряд.
 */
export function extractToken(text: string): string {
  const s = text.trim();
  try {
    const d = new URL(s).searchParams.get('duel');
    if (d) return clean(d);
  } catch { /* не ссылка */ }
  const inLink = /duel=([A-Za-z0-9]{6})/i.exec(s);
  if (inLink) return clean(inLink[1]);
  const word = /(?:^|[^A-Z0-9])([A-HJKMNP-Z2-9]{6})(?![A-Z0-9])/.exec(s.toUpperCase());
  if (word) return word[1];
  return clean(s);
}

/** Экранная клавиатура iPhone и Android открывается только от нажатия — сами поле не фокусируем. */
const touch = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };

export function JoinScreen(p: { token?: string }): JSX.Element {
  const g = useGx();
  const a = useSocialActions();
  const { top } = useScreen();
  const fromLink = !!p.token;
  const [token, setToken] = useState(p.token || '');
  const [st, setSt] = useState<State>(() => (p.token ? { k: 'loading' } : { k: 'input', err: false }));
  const [focused, setFocused] = useState(false);
  const [foreign, setForeign] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ctrl = useRef<AbortController | null>(null);
  const off = g.access === 'off';

  const look = async (t: string) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setSt({ k: 'loading' });
    try {
      const inv = await gameApi.invite(t, c.signal);
      if (c.signal.aborted) return;
      setSt(inv.mine ? { k: 'mine' } : { k: 'preview', inv });
    } catch (e) {
      if (c.signal.aborted) return;
      if (isApiError(e, 'not_found')) {
        if (fromLink) setSt({ k: 'gone' });
        else {
          // Неверный код — ячейки пустые: следующая буква начинает код заново, стирать шесть знаков не нужно.
          setToken('');
          setSt({ k: 'input', err: true });
        }
      } else setSt({ k: 'error', text: errText(e) });
    }
  };

  useEffect(() => {
    // Игра с людьми выключена — вызов не проверяем (маршрутов нет, был бы ложный «Вызов истёк»).
    if (off) return;
    if (p.token && TOKEN_RE.test(p.token)) void look(p.token);
    else if (p.token) setSt({ k: 'gone' });
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Снова сверху (вернулись с «Твой код», где принять не вышло: вызов приняли, он истёк) — проверяем заново.
  const wasTop = useRef(top);
  useEffect(() => {
    const again = top && !wasTop.current;
    wasTop.current = top;
    if (again && st.k === 'preview' && TOKEN_RE.test(token)) void look(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top]);

  // Поле ввода — в фокус, когда экран доехал (клавиатура не дёргает анимацию). Только с мышью и клавиатурой:
  // на телефоне фокус не из нажатия клавиатуру не открывает — там подсказка «Нажми, чтобы ввести код».
  useEffect(() => {
    if (!top || st.k !== 'input' || touch()) return;
    const t = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 360);
    return () => clearTimeout(t);
  }, [top, st.k]);

  const onInput = (t: string, raw: string) => {
    setToken(t);
    setForeign(raw.length <= 7 && hasForeign(raw));
    if (st.k === 'input' && st.err) setSt({ k: 'input', err: false });
    if (t.length === 6) {
      input.current?.blur();
      void look(t);
    }
  };

  const canPlay = g.access === 'ok';
  const guest = g.access === 'guest' || g.access === 'loading';
  const note = g.access === 'banned' || g.access === 'readonly' ? NOTE[g.access] : null;
  const accept = async () => {
    if (guest) { await g.ensure(currentReturnTo({ duel: token })); return; }
    if (!canPlay || !(await g.ensure())) return;
    g.push({ t: 'pad', purpose: { kind: 'join', token } }, 'up');
  };
  const selfChallenge = async () => {
    if (guest) { await g.ensure(); return; }
    if (!canPlay || !(await g.ensure())) return;
    g.replace({ t: 'pad', purpose: { kind: 'link' } }, 'up');
  };

  let body: JSX.Element;
  if (off) {
    body = (
      <div className="gx-body gx-center">
        <p className="gx-h">{NOTE.off}</p>
        <div className="gx-acts">
          <button type="button" className="gx-primary" onClick={() => g.replace({ t: 'pad', purpose: { kind: 'practice' } }, 'up')}>
            Тренировка с ботом
          </button>
        </div>
      </div>
    );
  } else if (st.k === 'preview') {
    const u = st.inv.from;
    const meta = ['@' + u.username, u.uniShort ? abbrOf(u.uniShort) : ''].filter(Boolean).join(' · ');
    body = (
      <div className="gx-body gx-center">
        <Avatar user={u} size={64} />
        <h2 className="gx-h"><span>{u.name} вызывает тебя в «Код»</span><NameBadge u={u} /></h2>
        <p className="gx-cap">{meta}</p>
        <p className="gx-text">Кто взломает чужие четыре цифры за меньшее число попыток — победил. На игру — сутки.</p>
        <div className="gx-acts">
          <button type="button" className="gx-primary" disabled={!guest && !canPlay} onClick={() => void accept()}>
            {guest ? 'Войти и принять' : 'Принять вызов'}
          </button>
          <button type="button" className="gx-second" onClick={g.back}>Не сейчас</button>
        </div>
        {note && <p className="gx-note">{note}</p>}
      </div>
    );
  } else if (st.k === 'gone' || st.k === 'mine' || st.k === 'error') {
    body = (
      <div className="gx-body gx-center">
        <p className="gx-h">
          {st.k === 'gone' ? 'Вызов истёк или уже принят' : st.k === 'mine' ? 'Это твой вызов — отправь ссылку другу' : st.text}
        </p>
        <div className="gx-acts">
          {st.k === 'gone' && (canPlay || guest) && (
            <button type="button" className="gx-primary" onClick={() => void selfChallenge()}>Вызвать самому</button>
          )}
          {st.k === 'mine' && <button type="button" className="gx-primary" onClick={() => void shareInvite(token, a.copyLink)}>Отправить</button>}
          {st.k === 'error' && <button type="button" className="gx-primary" onClick={() => void look(token)}>Повторить</button>}
        </div>
        {st.k === 'gone' && note && <p className="gx-note">{note}</p>}
      </div>
    );
  } else {
    const loading = st.k === 'loading';
    body = (
      <div className="gx-body gx-join">
        <h2 className="gx-h">Код вызова</h2>
        <label className="gx-token gx-token--in">
          <span className="gx-token__cells" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <FlipDigit key={i} className={'is-sm' + (focused && i === token.length && !loading ? ' is-cur' : '')} char={token[i] || '·'} />
            ))}
          </span>
          <input ref={input} className="gx-token__input" type="text" inputMode="text" autoCapitalize="characters"
            autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={256} value={token} disabled={loading}
            aria-label="Код вызова" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onChange={(e) => { const raw = e.currentTarget.value; onInput(extractToken(raw), raw); }}
            onPaste={(e) => { e.preventDefault(); const raw = e.clipboardData.getData('text'); onInput(extractToken(raw), raw); }} />
        </label>
        {st.k === 'input' && st.err && <p className="gx-err" role="alert">Такого вызова нет или он уже принят</p>}
        {st.k === 'input' && !st.err && foreign && <p className="gx-cap" role="status">Код — латинские буквы и цифры</p>}
        {st.k === 'input' && !st.err && !foreign && !focused && (
          <button type="button" className="gx-cap" onClick={() => input.current?.focus({ preventScroll: true })}>Нажми, чтобы ввести код</button>
        )}
        {loading && <p className="gx-cap">Проверяем…</p>}
      </div>
    );
  }

  return (
    <>
      <Bar left="back" onLeft={g.back} title={!off && (st.k === 'input' || st.k === 'loading') ? 'Ввести код' : undefined} />
      {body}
    </>
  );
}
