// Второй шаг онбординга (после согласия): кто открыл приложение — студент или
// преподаватель. Выбор запоминается; сменить можно позже в списке (студент ↔ преподаватель).
import { brand } from '../brand';

export function RolePick({ open, onPick }: {
  open: boolean; onPick: (role: 'student' | 'teacher') => void;
}) {
  return (
    <div className={'modal' + (open ? ' open' : '')}>
      <div className="modal__c">
        <div className="eyebrow">{brand.label}</div>
        <div className="modal__h">Кто ты?</div>
        <div className="roles">
          <button className="role" onClick={() => onPick('student')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4 2.5 8.5 12 13l9.5-4.5L12 4Z" /><path d="M6 10.5V15c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4.5" /><path d="M21.5 8.5v5" />
            </svg>
            <b>Студент</b>
            <span>Расписание своей группы</span>
          </button>
          <button className="role" onClick={() => onPick('teacher')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="12.5" rx="1.6" /><path d="M7 20h10" /><path d="M12 16.5V20" /><path d="M7 8.5h8M7 12h5" />
            </svg>
            <b>Преподаватель</b>
            <span>Свои пары и кабинеты</span>
          </button>
        </div>
      </div>
    </div>
  );
}
