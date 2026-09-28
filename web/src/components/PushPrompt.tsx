// Предложение включить уведомления, когда Para закрыта (lib/push.ts) — один раз: после первой настройки в приложении
// с экрана «Домой» или при следующем запуске с уже выбранной группой. Разрешение браузер спрашивает прямо из нажатия.
import { useState } from 'react';
import { enablePush, pushAsked } from '../lib/push';

export function PushPrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const on = () => {
    pushAsked();
    setBusy(true);
    void enablePush().finally(() => { setBusy(false); onClose(); });
  };
  const later = () => { pushAsked(); onClose(); };
  return (
    <div className={'modal' + (open ? ' open' : '')} role="dialog" aria-modal="true" aria-labelledby="push-h">
      <div className="modal__c">
        <div className="eyebrow">Уведомления</div>
        <div className="modal__h" id="push-h">Узнавать об изменениях сразу</div>
        <div className="modal__sub">
          Если в расписании группы что-то поменяется, Para пришлёт уведомление — даже когда приложение закрыто.
          Ещё — заявки в друзья, ответы и приглашения в покер. Что присылать, выбирается в «Профиле».
        </div>
        <button className="modal__ok" disabled={busy} onClick={on}>Включить</button>
        <button className="modal__doc" onClick={later}>Не сейчас</button>
      </div>
    </div>
  );
}
