// Приглашение закрепить приложение — заметной карточкой, а не серой строкой в подвале.
// Само окно с шагами для Android и iPhone — Install.tsx; здесь только вход в него.

export function InstallCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="panel inst" onClick={onOpen}>
      <img className="inst__ico" src="/brand/icon-192.png" alt="" width={52} height={52} />
      <span className="inst__txt">
        <span className="inst__t">На главный экран</span>
        <span className="inst__s">Расписание откроется в одно касание, как приложение</span>
      </span>
      <span className="inst__btn">Добавить</span>
    </button>
  );
}
