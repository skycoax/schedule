// Окно согласия при первом запуске. Пока не принято — аналитика молчит.
import { brand } from '../brand';

export function Consent({ open, onAccept, onOpenDoc }: {
  open: boolean; onAccept: () => void; onOpenDoc: () => void;
}) {
  return (
    <div className={'modal' + (open ? ' open' : '')}>
      <div className="modal__c">
        <div className="eyebrow">{brand.label}</div>
        <div className="modal__h">Перед началом</div>
        <ul className="modal__l">
          <li>Приложение <b>неофициальное</b>. {brand.sourceShort}</li>
          <li>Ведётся <b>обезличенная статистика посещений</b> — для аналитики.
            <b>Ни имени, ни телефона, ни почты, ни точного местоположения.</b>
            IP в исходном виде не хранится.</li>
          <li>В браузере остаются <b>только настройки</b>: группа, тема, метка правки,
            это согласие и случайный номер для подсчёта.</li>
          <li>Автор не отвечает за пропущенные пары и опоздания.</li>
        </ul>
        <button className="modal__doc" onClick={onOpenDoc}>Полный текст условий</button>
        <button className="modal__ok" onClick={onAccept}>Принимаю, продолжить</button>
      </div>
    </div>
  );
}
