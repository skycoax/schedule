// Окно «на главный экран». Android — системная кнопка, iPhone — наглядные шаги.
import { useState } from 'react';
import { useInstall, IS_IOS } from '../hooks/useInstall';

const IosSteps = () => (
  <div className="steps">
    <div className="step">
      <span className="step__i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13" /><path d="m8 7 4-4 4 4" /><path d="M6 12H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" /></svg></span>
      <span className="step__t">Нажми<br />«Поделиться»</span>
    </div>
    <span className="step__a">›</span>
    <div className="step">
      <span className="step__i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><path d="M12 8.5v7M8.5 12h7" /></svg></span>
      <span className="step__t">На экран<br />«Домой»</span>
    </div>
    <span className="step__a">›</span>
    <div className="step">
      <span className="step__i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>
      <span className="step__t">Готово</span>
    </div>
  </div>
);

const AndroidSteps = () => (
  <div className="steps">
    <div className="step">
      <span className="step__i"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" /></svg></span>
      <span className="step__t">Меню<br />в Chrome</span>
    </div>
    <span className="step__a">›</span>
    <div className="step">
      <span className="step__i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5v11" /><path d="m8 10.5 4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg></span>
      <span className="step__t">Установить<br />приложение</span>
    </div>
    <span className="step__a">›</span>
    <div className="step">
      <span className="step__i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>
      <span className="step__t">Готово</span>
    </div>
  </div>
);

export function Install({ open, url, onClose }: { open: boolean; url: string; onClose: () => void }) {
  const { canInstall, doInstall } = useInstall();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* пусто */ }
  };

  return (
    <div className={'modal' + (open ? ' open' : '')}>
      <div className="modal__c">
        <div className="eyebrow">Чтобы открывалось в один тап</div>
        <div className="modal__h">Добавь на главный экран</div>
        <div className="modal__sub">Ссылка уже содержит твою группу — расписание откроется
          настроенным, даже если браузер почистит хранилище.</div>

        {canInstall
          ? <button className="modal__ok" onClick={doInstall}>Установить приложение</button>
          : (IS_IOS ? <IosSteps /> : <AndroidSteps />)}

        <button className="modal__ok" onClick={copy}>{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</button>
        <input className="cal__u" readOnly value={url} onClick={(e) => (e.target as HTMLInputElement).select()} />
        <button className="modal__doc" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}
