// Приглашение в закрытое тестирование Google Play (brand.playTest из server/hub/hub.json).
// Почты не собираем: человек сам открывает ссылку Play, нажимает «Стать тестером» и ставит приложение.
// Только Android в браузере: кто открыл Para из приложения Play (TWA), тот уже тестер.
// Закрыл крестиком или открыл ссылку — больше не показываем.
import { brand } from '../brand';
import { ls } from '../lib/store';

const KEY = 'playTest';
const IS_ANDROID = /Android/i.test(navigator.userAgent || '');

// Приложение из Play открывает Para с referrer android-app://<пакет> (android/twa-manifest.json) — запоминаем,
// что на этом телефоне Para уже из Play: referrer есть только у первой страницы после запуска.
try { if (document.referrer.startsWith('android-app://uz.skycoax.para')) ls('fromPlay', '1'); } catch { /* нет referrer */ }

export const testerCardWanted = (): boolean => !!brand.playTest && IS_ANDROID && !ls('fromPlay') && !ls(KEY);

export function TesterCard({ onDone }: { onDone: () => void }) {
  const done = () => { ls(KEY, 'done'); onDone(); };
  return (
    <div className="panel inst tst">
      <img className="inst__ico" src="/brand/icon-192.png" alt="" width={52} height={52} />
      <span className="inst__txt">
        <span className="inst__t">Para в Google Play</span>
        <span className="inst__s">Стань тестером и установи Para из Play</span>
      </span>
      <a className="inst__btn" href={brand.playTest} target="_blank" rel="noopener" onClick={done}>Вступить</a>
      <button type="button" className="tst__x" aria-label="Скрыть приглашение" onClick={done}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
