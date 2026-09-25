// Нижний колонтитул — общий для режимов студента и преподавателя: только «Условия и данные» и политика.
// «Политика конфиденциальности» — обычная ссылка на страницу /policy: её ищут Google (проверка
// приложения для входа) и Play. Страница одна на все адреса — и на Para, и на адресах вузов.
// То, что приложение неофициальное, сказано в окне согласия, в «Условиях и данных» и внизу настроек.
import type { CSSProperties } from 'react';

// Строка ссылок: у каждой область нажатия не меньше 44 px в высоту, текст остаётся мелким. Разделитель —
// просто отступ: на узком экране ссылки встают друг под другом без висящей точки.
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: 18 };
const tap: CSSProperties = { display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 2px', color: 'var(--ink-60)' };

export function SiteFooter({ onOpenDoc }: { onOpenDoc: () => void }) {
  return (
    <footer className="made">
      <div className="made__fine">
        <div style={row}>
          <button type="button" style={tap} onClick={onOpenDoc}>Условия и данные</button>
          <a href="/policy" target="_blank" rel="noopener" style={tap}>Политика конфиденциальности</a>
        </div>
      </div>
    </footer>
  );
}
