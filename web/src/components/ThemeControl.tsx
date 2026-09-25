// Выбор темы «Авто | Светлая | Тёмная»: Профиль → Оформление (Para) и ThemeSection
// внизу расписания (адреса вузов). Выбор применяется сразу и запоминается (useTheme().set).
import type { JSX } from 'react';
import type { ThemeMode } from '../hooks/useTheme';
import { Segmented } from '../ui/Segmented';

const OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'auto', label: 'Авто' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

export function ThemeControl({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }): JSX.Element {
  return <Segmented variant="inset" ariaLabel="Тема оформления" value={mode} options={OPTIONS} onChange={onChange} />;
}
