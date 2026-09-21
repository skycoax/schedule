import type { ThemeMode } from '../hooks/useTheme';
import { brand } from '../brand';

// Иконка темы: авто — половинка круга, светлая — солнце, тёмная — луна.
function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === 'light') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
      </svg>
    );
  }
  // авто
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Логотип вуза (КФУ — щит с гербом, ТГЭУ — портик; оба с Wikimedia Commons, CC BY-SA 4.0).
// Сам файл — только прозрачная маска формы, а цвет берётся из темы: белый в тёмной,
// тёмный в светлой. Поэтому это не <img>, а блок с CSS-маской (см. .hdr__logo, main.tsx).
// Логотип открывает выбор вуза, название группы — выбор группы (как и «Сменить»).
export function Header({ name, mode, onCycle, onPick, onUniversities }: {
  name: string; mode: ThemeMode;
  onCycle: () => void; onPick: () => void; onUniversities: (el: HTMLElement) => void;
}) {
  return (
    <div className="hdr">
      <button className="hdr__logo-btn" onClick={(e) => onUniversities(e.currentTarget)} aria-label={`${brand.university} — выбрать вуз`} aria-haspopup="menu">
        <span className="hdr__logo" />
      </button>
      <button className="hdr__txt hdr__txt--btn" onClick={onPick}>
        <h1>{name || 'Загрузка'}</h1>
      </button>
      <button className="hdr__ico" aria-label="Тема" onClick={onCycle}><ThemeIcon mode={mode} /></button>
      <button className="hdr__btn" onClick={onPick}>Сменить</button>
    </div>
  );
}
