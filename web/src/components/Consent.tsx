// Окно согласия при первом запуске. Пока не принято — аналитика молчит, а на адресе Para
// ещё и не уходит ни одного запроса к /api/auth и /api/social (CONTRACT.md D31).
// Тем, кто уже принял условия, окно заново не показываем: аккаунт — отдельное согласие при входе.
import { brand } from '../brand';

export function Consent({ open, onAccept, onOpenDoc }: {
  open: boolean; onAccept: () => void; onOpenDoc: () => void;
}) {
  return (
    <div className={'modal' + (open ? ' open' : '')} role="dialog" aria-modal="true" aria-labelledby="consent-h">
      {/* Если карточка выше экрана (320×568), прокручивается само окно .modal (index.css). */}
      <div className="modal__c">
        <div className="eyebrow">{brand.label}</div>
        <h2 className="modal__h" id="consent-h">Перед началом</h2>
        <ul className="modal__l">
          <li>Приложение <b>неофициальное</b>. {brand.sourceShort}</li>
          <li>Ведётся <b>обезличенная статистика посещений</b> — для аналитики.{' '}
            <b>Ни имени, ни телефона, ни почты, ни точного местоположения.</b>{' '}
            IP в исходном виде не хранится.</li>
          {/* На старых адресах вузов вуз задан самим адресом и в браузере не хранится. */}
          <li>В браузере остаются <b>только настройки</b>: {brand.hub ? 'вуз, ' : ''}группа, тема, метка правки,
            это согласие и случайный номер для подсчёта.</li>
          {brand.hub && (
            <li>Аккаунт — <b>по желанию</b>: он нужен только для «Обсуждений» и друзей, вход через Google.</li>
          )}
          <li>Автор не отвечает за пропущенные пары и опоздания.</li>
        </ul>
        <button type="button" className="modal__doc" style={{ minHeight: 44 }} onClick={onOpenDoc}>Полный текст условий</button>
        <button type="button" className="modal__ok" onClick={onAccept}>Принимаю, продолжить</button>
      </div>
    </div>
  );
}
