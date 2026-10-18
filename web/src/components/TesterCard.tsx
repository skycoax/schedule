// «Ранний доступ» в Google Play (brand.earlyAccess и brand.playTest из server/hub/hub.json).
// «Хочу» — вход через Google (если не вошёл) и согласие, что почту аккаунта добавят в список тестеров Para
// в Google Play (сервер — social/early.js). Без согласия почта никуда не уходит; выйти из списка — здесь же.
// Записался и есть ссылка тестирования — карточка ведёт в Play («Стать тестером» там нажимает сам человек).
// Записи нет (earlyAccess выключен) — только ссылка «Вступить», как раньше.
// Только Android в браузере: кто открыл Para из приложения Play (TWA), тот уже тестер. Крестик — больше не показываем.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { brand, hasSocial } from '../brand';
import { ls } from '../lib/store';
import { useSession } from '../social/session';
import { socialApi } from '../social/api';
import { toast } from '../ui/Toast';

const KEY = 'playTest';
const INTENT = 'earlyIntent';   // нажал «Хочу» гостем: после входа сразу спросим согласие
// Страница приложения в Google Play (пакет — android/twa-manifest.json). Пока идёт закрытое тестирование, она
// открывается только тестерам; остальным — ссылка участия (brand.playTest) на кнопке.
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=uz.skycoax.para';
const IS_ANDROID = /Android/i.test(navigator.userAgent || '');
const CAN_JOIN = !!brand.earlyAccess && hasSocial;

// Приложение из Play открывает Para с referrer android-app://<пакет> (android/twa-manifest.json) — запоминаем,
// что на этом телефоне Para уже из Play: referrer есть только у первой страницы после запуска.
try { if (document.referrer.startsWith('android-app://uz.skycoax.para')) ls('fromPlay', '1'); } catch { /* нет referrer */ }

export const testerCardWanted = (): boolean =>
  (CAN_JOIN || !!brand.playTest) && IS_ANDROID && !ls('fromPlay') && !ls(KEY);

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Не получилось — попробуй ещё раз');

export function TesterCard({ onDone }: { onDone: () => void }) {
  const s = useSession();
  const me = s.status === 'signed' ? s.me : null;
  const [joined, setJoined] = useState(!!me?.earlyAccess);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setJoined(!!me?.earlyAccess); }, [me?.earlyAccess]);
  // Вернулся после входа, начатого кнопкой «Хочу», — сразу окно согласия.
  useEffect(() => {
    if (!me || !CAN_JOIN || !ls(INTENT)) return;
    ls(INTENT, '');
    if (!me.earlyAccess) setAsk(true);
  }, [me]);

  const hide = () => { ls(KEY, 'done'); onDone(); };
  const want = async () => {
    if (me) { setAsk(true); return; }
    ls(INTENT, '1');
    // Вход уводит на Google и обратно; закрыли окно входа — намерение забываем.
    if (!(await s.ensure('early'))) ls(INTENT, '');
  };
  const setEarly = async (join: boolean) => {
    setBusy(true);
    try {
      const v = join ? await socialApi.earlyJoin() : await socialApi.earlyLeave();
      setJoined(v);
      setAsk(false);
      if (me) s.setMe({ ...me, earlyAccess: v });
      toast(v ? 'Ты в списке раннего доступа' : 'Ты больше не в списке раннего доступа');
    } catch (e) {
      toast(errText(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const link = (label: string, onClick?: () => void) => (
    <a className="inst__btn" href={brand.playTest} target="_blank" rel="noopener" onClick={onClick}>{label}</a>
  );
  let title = 'Ранний доступ';
  let sub = 'Para выходит в Google Play — вступи первым и установи приложение';
  let action = link('Вступить', hide);
  if (joined) {
    title = 'Ты в списке раннего доступа';
    sub = brand.playTest
      ? 'Открой Para в Google Play и нажми «Стать тестером» — с тем же аккаунтом Google'
      : 'Как только откроем доступ, ссылка появится здесь';
    action = brand.playTest ? link('Открыть') : <></>;
  } else if (CAN_JOIN) {
    sub = 'Para выходит в Google Play — запишись и получи доступ первым';
    action = <button type="button" className="inst__btn" disabled={busy} onClick={() => void want()}>Хочу</button>;
  }

  return (
    <div className="panel inst tst">
      <img className="inst__ico" src="/brand/icon-192.png" alt="" width={52} height={52} />
      <span className="inst__txt">
        <span className="inst__t">{title}</span>
        <span className="inst__s">{sub}</span>
        <span className="tst__links">
          <a className="tst__out" href={PLAY_STORE} target="_blank" rel="noopener">Страница в Google Play</a>
          {joined && (
            <button type="button" className="tst__out" disabled={busy} onClick={() => void setEarly(false)}>Выйти из списка</button>
          )}
        </span>
      </span>
      {action}
      <button type="button" className="tst__x" aria-label="Скрыть карточку" onClick={hide}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {CAN_JOIN && createPortal(
        <div className={'modal' + (ask ? ' open' : '')} role="dialog" aria-modal="true" aria-labelledby="early-h">
          <div className="modal__c">
            <div className="eyebrow">Ранний доступ</div>
            <div className="modal__h" id="early-h">Записаться в тестеры Para</div>
            <div className="modal__sub">
              Почту твоего аккаунта Google{me?.email ? ` (${me.email})` : ''} добавим в список тестеров Para
              в Google&nbsp;Play — только для этого, рассылок не будет. В Play войди тем же аккаунтом.
              Выйти из списка можно здесь же в любой момент, удаление аккаунта убирает и запись.
            </div>
            <button className="modal__ok" disabled={busy} onClick={() => void setEarly(true)}>Согласен, записаться</button>
            <button className="modal__doc" onClick={() => setAsk(false)}>Не сейчас</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
