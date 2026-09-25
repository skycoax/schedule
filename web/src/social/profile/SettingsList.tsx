// Настройки в «Профиле» (для гостя и для вошедшего): расписание, оформление, общение, конфиденциальность,
// модерация, приложение, аккаунт. Разделы «Обсуждений» скрыты, пока сессия грузится и при SOCIAL_MODE=off.
import { useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { brand } from '../../brand';
import { Install } from '../../components/Install';
import { ViewportDebug } from '../../components/ViewportDebug';
import { ThemeControl } from '../../components/ThemeControl';
import { isStandalone } from '../../hooks/useInstall';
import { useUniversityMenu } from '../../shell/useUniversityMenu';
import type { Role, ScheduleContext, ThemeApi } from '../../tabs';
import { confirmDialog } from '../../ui/ActionSheet';
import { Icon } from '../../ui/icons';
import type { IconName } from '../../ui/icons';
import { useLayer } from '../../ui/layers';
import { ListRow, ListSection } from '../../ui/List';
import { Segmented } from '../../ui/Segmented';
import { Switch } from '../../ui/Switch';
import { socialApi } from '../api';
import { hiddenUsers } from '../local';
import { LINKS } from '../rules';
import { currentReturnTo, useSession } from '../session';
import type { FriendRequests, LinksVisibility, Me, MePatch } from '../types';
import { PolicySheet, RulesSheet } from './RulesSheet';
import { toastFail } from './UsernameField';
import './profile.css';

export const uniShortNow = () => brand.label.replace(/^Расписание\s+/i, '');

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
        <ListRow label="Вуз" value={uniShortNow()} icon={{ name: 'globe', color: 'var(--c7)' }} onClick={menu.open} />
        <ListRow
          label={teacher ? 'Преподаватель' : 'Группа'}
          value={sched && sched.kind === (teacher ? 'teacher' : 'group') ? sched.title : teacher ? 'Не выбран' : 'Не выбрана'}
          icon={{ name: teacher ? 'person' : 'calendar', color: 'var(--c1)' }}
          onClick={p.openPicker}
        />
        <CtlRow label="Режим" icon={{ name: 'people', color: 'var(--c8)' }}>
          <Segmented<Role>
            ariaLabel="Режим" value={p.role} onChange={p.setRole}
            options={[{ value: 'student', label: 'Студент' }, { value: 'teacher', label: 'Преподаватель' }]}
          />
        </CtlRow>
      </ListSection>

      <ListSection header="Оформление">
        <div className="set-row set-row--full">
          <ThemeControl mode={p.theme.mode} onChange={p.theme.set} />
        </div>
      </ListSection>

      {me && social && (
        <ListSection header="Общение">
          <ListRow label="Друзья" icon={{ name: 'people', color: 'var(--c3)' }} badge={me.requestsIn} onClick={p.nav.friends}
            ariaLabel={me.requestsIn > 0 ? `Друзья, новых заявок: ${me.requestsIn}` : undefined} />
          <ListRow label="Найти людей" icon={{ name: 'search', color: 'var(--c5)' }} onClick={p.nav.search} />
          <ListRow label="Заблокированные" icon={{ name: 'hand', color: 'var(--c4)' }} onClick={p.nav.blocked} />
        </ListSection>
      )}

      {me && social && privacy && (
        <>
          <ListSection header="Конфиденциальность" footer={minor ? 'До 18 лет — только друзья' : undefined}>
            <CtlRow label="Кто видит Telegram и Instagram" stack>
              <Segmented<LinksVisibility>
                ariaLabel="Кто видит Telegram и Instagram" value={minor ? 'friends' : privacy.links}
                onChange={(v) => void patch('links', v, { linksVisibility: v })}
                options={[{ value: 'friends', label: 'Друзья' }, { value: 'signed', label: 'Все, кто вошёл', disabled: minor }]}
              />
            </CtlRow>
          </ListSection>
          <ListSection footer="Если выключить, найти тебя можно будет только по точному @имени.">
            <CtlRow label="Показывать меня в поиске" sw>
              <Switch label="Показывать меня в поиске" checked={privacy.searchable}
                onChange={(v) => void patch('searchable', v, { searchable: v })} />
            </CtlRow>
          </ListSection>
          <ListSection
            footer={minor ? 'До 18 лет заявки по умолчанию выключены. Включай, только если знаешь, кто будет писать.' : undefined}
          >
            <CtlRow label="Кто может добавить в друзья" stack>
              <Segmented<FriendRequests>
                ariaLabel="Кто может добавить в друзья" value={privacy.friendRequests}
                onChange={(v) => void patch('friendRequests', v, { friendRequests: v })}
                options={[{ value: 'all', label: 'Все' }, { value: 'none', label: 'Никто' }]}
              />
            </CtlRow>
          </ListSection>
        </>
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
