// Нижний колонтитул — общий для режимов студента и преподавателя.
export function SiteFooter({ onOpenDoc }: { onOpenDoc: () => void }) {
  return (
    <footer className="made">
      <div className="made__t">Сделал <a href="https://skycoax.uz" target="_blank" rel="noopener"><b>@skycoax</b></a></div>
      <div className="made__l">
        <a href="https://skycoax.uz" target="_blank" rel="noopener" aria-label="Сайт skycoax.uz"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" /></svg></a>
        <a href="https://t.me/skycoax" target="_blank" rel="noopener" aria-label="Telegram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21.7 4.1 2.8 11.2c-.8.3-.8 1.5.1 1.7l4.8 1.4 1.5 4.8c.3.8 1.4 1 1.9.2l2-3.1 4.7 3.4c.6.4 1.5.1 1.7-.6l3-13.5c.2-.8-.6-1.5-1.3-1.2Z" /><path d="M8 14.3 19 6.2" /></svg></a>
        <a href="https://www.instagram.com/skycoax" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="5.2" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="1.15" fill="currentColor" stroke="none" /></svg></a>
        <a href="https://github.com/skycoax" target="_blank" rel="noopener" aria-label="GitHub"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" /></svg></a>
        <a href="tel:+998905391575" aria-label="Телефон"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 3h3l1.5 4-2 1.4a12.2 12.2 0 0 0 5.5 5.5l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 3.6 5.2 2 2 0 0 1 5.6 3Z" /></svg></a>
      </div>
      <div className="made__fine">
        Неофициальное приложение · <button onClick={onOpenDoc}>Условия и данные</button>
      </div>
    </footer>
  );
}
