// Настройки в «Профиле» (для гостя и для вошедшего): расписание, оформление, общение, конфиденциальность,
// модерация, приложение, аккаунт. Разделы «Обсуждений» скрыты, пока сессия грузится и при SOCIAL_MODE=off.
import { useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { brand } from '../../brand';
import { Install } from '../../components/Install';
import { ViewportDebug } from '../../components/ViewportDebug';
import { isStandalone } from '../../hooks/useInstall';
import { useUniversityMenu } from '../../shell/useUniversityMenu';
import type { Role, ScheduleContext, ThemeApi } from '../../tabs';
import type { ThemeMode } from '../../hooks/useTheme';
import { chooseAction, confirmDialog } from '../../ui/ActionSheet';
import { Icon } from '../../ui/icons';
import type { IconName } from '../../ui/icons';
import { useLayer } from '../../ui/layers';
import { ListRow, ListSection } from '../../ui/List';
import { Switch } from '../../ui/Switch';
import { socialApi } from '../api';
import { hiddenUsers } from '../local';
import { LINKS } from '../rules';
import { currentReturnTo, useSession } from '../session';
import type { LinksVisibility, Me, MePatch } from '../types';
import { PolicySheet, RulesSheet } from './RulesSheet';
import { toastFail } from './UsernameField';
import './profile.css';

export const uniShortNow = () => brand.label.replace(/^Расписание\s+/i, '');

// Значения строк-выборов: слева название, справа текущее значение; нажатие — список с галочкой (как в iOS).
const ROLE: Record<Role, string> = { student: 'Студент', teacher: 'Преподаватель' };
const THEME: Record<ThemeMode, string> = { auto: 'Как в системе', light: 'Светлая', dark: 'Тёмная' };
const LINKS_VIS: Record<LinksVisibility, string> = { friends: 'Друзья', signed: 'Все, кто вошёл' };

/** Список вариантов с галочкой у текущего; выбрали другой — onPick. */
async function choose(title: string, current: string, options: Record<string, string>, onPick: (v: string) => void) {
  const v = await chooseAction({
    title,
    actions: Object.entries(options).map(([id, label]) => ({ id, label, checked: id === current })),
  });
  if (v && v !== current) onPick(v);
}

/** Строка с элементом управления (сегменты, переключатель). stack — подпись сверху, элемент под ней. */
function CtlRow(p: { label: string; icon?: { name: IconName; color: string }; stack?: boolean; sw?: boolean; id?: string; children: ReactNode }) {
  return (
    <div className={'set-row' + (p.stack ? ' set-row--stack' : ' set-row--line') + (p.sw ? ' set-row--sw' : '') + (p.icon ? ' has-icon' : '')}>
      {p.icon && (
        <span className="set-ico" style={{ background: p.icon.color }} aria-hidden="true"><Icon name={p.icon.name} size={18} /></span>
      )}
      <span className="set-row__l" id={p.id}>{p.label}</span>
      <div className="set-row__ctl">{p.children}</div>
    </div>
  );
}

export interface SettingsNav {
  friends: () => void;
  search: () => void;
  blocked: () => void;
  hidden: () => void;
  moderation: () => void;
  users: () => void;
  instants: () => void;
  deleteAccount: () => void;
}

export function SettingsList(p: {
  theme: ThemeApi;
  role: Role;
  setRole: (r: Role) => void;
  schedule: ScheduleContext | null;
  openPicker: () => void;
  nav: SettingsNav;
  /** Вошедший известен только по me_cache (сервер ещё не ответил): настройки и почта неизвестны. */
  stale?: boolean;
}): JSX.Element {
  const s = useSession();
  const menu = useUniversityMenu();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [opt, setOpt] = useState<Partial<Me['privacy']>>({});
  const [debug, setDebug] = useState(false);
  const taps = useRef<number[]>([]);
  const tapFoot = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 5) { taps.current = []; setDebug(true); }
  };

  // Старые окна (политика, «На главный экран») — слои истории: «Назад» закрывает их, а не вкладку.
  useLayer(installOpen, () => setInstallOpen(false), 'install');

  const ready = s.status !== 'loading';
  const me = ready && s.status === 'signed' ? s.me : null;
  const social = ready && s.mode !== 'off';
  const guest = ready && s.status === 'guest';
  const teacher = p.role === 'teacher';
  const sched = p.schedule;
  const hiddenCount = guest && social ? hiddenUsers().length : 0;
  const installUrl = sched?.installUrl || '';

  const privacy = me && !p.stale ? { ...me.privacy, ...opt } : null;
  const minor = me?.age === 'minor';

  const patch = async <K extends keyof Me['privacy']>(k: K, v: Me['privacy'][K], body: MePatch) => {
    setOpt((o) => ({ ...o, [k]: v }));
    try {
      s.setMe(await socialApi.updateMe(body));
    } catch (e) {
      toastFail(e);
    } finally {
      setOpt((o) => { const c = { ...o }; delete c[k]; return c; });
    }
  };

  const signOut = async (all: boolean) => {
    const ok = await confirmDialog(all
      ? { title: 'Выйти на всех устройствах?', message: 'Придётся снова войти на каждом телефоне и компьютере.', confirm: 'Выйти' }
      : { title: 'Выйти из аккаунта?', message: 'Расписание и настройки на этом телефоне останутся.', confirm: 'Выйти' });
    if (ok) await s.signOut(all);
  };

  return (
    <div className="set">
      <ListSection header="Расписание">
        {/* На адресе вуза вуз задан самим адресом — выбирать нечего. */}
        {brand.hub && (
          <ListRow label="Вуз" value={uniShortNow()} icon={{ name: 'globe', color: 'var(--c7)' }} onClick={menu.open} />
        )}
        <ListRow
          label={teacher ? 'Преподаватель' : 'Группа'}
          value={sched && sched.kind === (teacher ? 'teacher' : 'group') ? sched.title : teacher ? 'Не выбран' : 'Не выбрана'}
          icon={{ name: teacher ? 'person' : 'calendar', color: 'var(--c1)' }}
          onClick={p.openPicker}
        />
        <ListRow
          label="Режим" value={ROLE[p.role]} icon={{ name: 'people', color: 'var(--c8)' }}
          onClick={() => void choose('Режим', p.role, ROLE, (v) => p.setRole(v as Role))}
        />
      </ListSection>

      <ListSection header="Оформление">
        <ListRow
          label="Тема" value={THEME[p.theme.mode]} icon={{ name: 'contrast', color: 'var(--c6)' }}
          onClick={() => void choose('Тема', p.theme.mode, THEME, (v) => p.theme.set(v as ThemeMode))}
        />
      </ListSection>

      {me && social && (
        <ListSection header="Общение">
          <ListRow label="Друзья" icon={{ name: 'people', color: 'var(--c3)' }} badge={me.requestsIn} onClick={p.nav.friends}
            ariaLabel={me.requestsIn > 0 ? `Друзья, новых заявок: ${me.requestsIn}` : undefined} />
          <ListRow label="Найти людей" icon={{ name: 'search', color: 'var(--c5)' }} onClick={p.nav.search} />
          <ListRow label="Мои моменты" icon={{ name: 'camera', color: 'var(--c6)' }} onClick={p.nav.instants} />
          <ListRow label="Заблокированные" icon={{ name: 'hand', color: 'var(--c4)' }} onClick={p.nav.blocked} />
        </ListSection>
      )}

      {me && social && privacy && (
        <ListSection
          header="Конфиденциальность"
          footer={minor
            ? 'Контакты — Telegram и Instagram в профиле; до 18 лет их видят только друзья. Без поиска тебя найдут только по точному @имени.'
            : 'Контакты — Telegram и Instagram в профиле. Без поиска тебя найдут только по точному @имени.'}
        >
          <ListRow
            label="Контакты" value={LINKS_VIS[minor ? 'friends' : privacy.links]} disabled={minor}
            icon={{ name: 'link', color: 'var(--c2)' }}
            chevron={!minor}
            onClick={minor ? undefined : () => void choose('Кто видит Telegram и Instagram', privacy.links, LINKS_VIS,
              (v) => void patch('links', v as LinksVisibility, { linksVisibility: v as LinksVisibility }))}
          />
          <CtlRow label="Показывать в поиске" icon={{ name: 'person', color: 'var(--c7)' }} sw>
            <Switch label="Показывать меня в поиске людей" checked={privacy.searchable}
              onChange={(v) => void patch('searchable', v, { searchable: v })} />
          </CtlRow>
        </ListSection>
      )}

      {hiddenCount > 0 && (
        <ListSection header="Скрытые авторы">
          <ListRow label="Скрытые авторы" value={String(hiddenCount)} onClick={p.nav.hidden} />
        </ListSection>
      )}

      {me && social && me.isAdmin && (
        <ListSection header="Модерация">
          <ListRow label="Жалобы" icon={{ name: 'flag', color: 'var(--c2)' }} badge={me.modQueue} onClick={p.nav.moderation}
            ariaLabel={me.modQueue > 0 ? `Жалобы, открытых: ${me.modQueue}` : undefined} />
          <ListRow label="Пользователи" icon={{ name: 'people', color: 'var(--c1)' }} onClick={p.nav.users} />
        </ListSection>
      )}

      <ListSection header="Приложение">
        {!isStandalone() && !!installUrl && <ListRow label="На главный экран" onClick={() => setInstallOpen(true)} />}
        <ListRow label="Правила обсуждений" onClick={() => setRulesOpen(true)} />
        <ListRow label="Политика конфиденциальности" onClick={() => setDocOpen(true)} />
        <ListRow label="Написать автору" href={LINKS.telegram} external />
        {guest && (
          <ListRow label="Удалить аккаунт" onClick={() => s.requestSignIn('delete', currentReturnTo({ delete: 1 }))} />
        )}
      </ListSection>

      {me && (
        <ListSection header="Аккаунт">
          {!!me.email && <ListRow label="Аккаунт Google" value={me.email} />}
          <ListRow label="Выйти" tone="accent" chevron={false} onClick={() => void signOut(false)} />
          <ListRow label="Выйти на всех устройствах" tone="accent" chevron={false} onClick={() => void signOut(true)} />
          <ListRow label="Удалить аккаунт" tone="destructive" chevron={false} onClick={p.nav.deleteAccount} />
        </ListSection>
      )}

      {/* Пять быстрых нажатий — диагностика экрана (components/ViewportDebug), для разбора вёрстки на iPhone. */}
      <p className="set__foot" onClick={tapFoot}>Para — неофициальное приложение и не связано ни с одним вузом.</p>
      {debug && <ViewportDebug onClose={() => setDebug(false)} />}

      {menu.element}
      <RulesSheet open={rulesOpen} mode="read" onClose={() => setRulesOpen(false)} />
      <PolicySheet open={docOpen} onClose={() => setDocOpen(false)} />
      {installOpen && <Install open url={installUrl} onClose={() => setInstallOpen(false)} />}
    </div>
  );
}
