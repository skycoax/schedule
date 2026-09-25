// Нет связи: показано расписание, сохранённое на телефоне (public/sw.js). Отсчёт и
// «сейчас идёт» при этом считаются по часам телефона, а не по старому ответу сервера.
export function OfflineNote({ at }: { at: string }) {
  const d = new Date(at);
  const when = isNaN(+d) ? '' : d.toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  return (
    <div className="offline" role="status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 8.8a14 14 0 0 1 4.3-2.6M21.5 8.8A14 14 0 0 0 11 5.1" />
        <path d="M5.8 12.2a9 9 0 0 1 3.1-1.9M18.2 12.2a9 9 0 0 0-2.9-1.8" />
        <path d="M9.2 15.6a4.5 4.5 0 0 1 5.6 0" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
        <path d="m3 3 18 18" />
      </svg>
      <span><b>Без интернета.</b> Показано сохранённое расписание{when ? ` от ${when}` : ''}.</span>
    </div>
  );
}
