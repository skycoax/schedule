// Оформление внизу расписания — только на адресах вузов (kfu.skycoax.uz…). В Para тема
// живёт в «Профиль → Оформление».
import type { JSX } from 'react';
import type { ThemeApi } from '../tabs';
import { ThemeControl } from './ThemeControl';
import '../shell/shell.css';

export function ThemeSection({ theme }: { theme: ThemeApi }): JSX.Element {
  return (
    <section className="themesec" aria-labelledby="themesec-t">
      <div className="sec__h"><h2 className="sec__t" id="themesec-t">Оформление</h2></div>
      <ThemeControl mode={theme.mode} onChange={theme.set} />
    </section>
  );
}
