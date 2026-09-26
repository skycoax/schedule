// «Как играть»: правила «Кода» и переключатель «Скрыть реакции» (только на этом телефоне).
import type { JSX } from 'react';
import { Sheet } from '../ui/Sheet';
import { Switch } from '../ui/Switch';
import { useGx } from './ctx';

export function HowToSheet(p: { open: boolean; onClose: () => void }): JSX.Element {
  const g = useGx();
  return (
    <Sheet open={p.open} onClose={p.onClose} variant="bottom" detent="large" title="Как играть">
      <div className="gx-how">
        <p>Каждый загадывает четыре разные цифры. Ты взламываешь код соперника, он — твой.</p>
        <p>
          После каждой попытки видно: ● — цифра есть и стоит на своём месте; ○ — цифра есть, но в другом месте.
          По порядку значков не понять, какая цифра какая.
        </p>
        <p>Пример: код 4071, попытка 1074 — ●●○○.</p>
        <p>Побеждает тот, кто взломает код за меньшее число попыток. Попыток — 12, на игру — сутки, ходить можно когда удобно.</p>
        <p>
          В «Коде дня» у каждого свой код. Друзья видят друг друга во всех таблицах; остальные — только взрослых,
          которых можно найти в поиске. Таблица вуза — по вузу из профиля.
        </p>
        <label className="gx-how__row">
          <span>Скрыть реакции</span>
          <Switch checked={g.noReact} onChange={g.setNoReact} label="Скрыть реакции" />
        </label>
      </div>
    </Sheet>
  );
}
