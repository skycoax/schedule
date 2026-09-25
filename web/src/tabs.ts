// Общий контракт оболочки (shell), вкладки «Расписание» и вкладок «Обсуждения»/«Профиль».
import type { ThemeMode } from './hooks/useTheme';

export type TabId = 'schedule' | 'chat' | 'profile';
export type Role = 'student' | 'teacher';

export interface ThemeApi { mode: ThemeMode; set: (m: ThemeMode) => void }

/** Что вкладка «Расписание» сообщает наверх: для строк «Профиля» и точки на вкладке. */
export interface ScheduleContext {
  kind: 'group' | 'teacher';
  title: string;          // «Информационные системы и технологии» / «Иванов И.И.»
  subtitle: string;       // «КФУ · Джизак · 1 курс · 09.03.02» / «Преподаватель · КФУ · Джизак»
  unseenChanges: boolean; // та же правда, что точка на кнопке «Правки»
  installUrl: string;     // личная ссылка для окна «На главный экран» ('' — группы ещё нет)
}

/** Разовая команда вкладке «Расписание». n растёт, чтобы повторить ту же команду. */
export interface ScheduleCommand { kind: 'picker' | 'changes'; n: number }

export interface ScheduleSlotProps {
  active: boolean;
  command: ScheduleCommand | null;
  /** Вызывать из эффекта, только когда есть согласие и выбрана группа/преподаватель, и только при изменении полей. */
  onContext: (c: ScheduleContext) => void;
  theme: ThemeApi;
}

export interface ChatLink { post?: number; compose?: boolean; user?: string }
export interface ProfileLink { user?: string; del?: boolean; mod?: boolean }

export interface ChatTabProps {
  active: boolean;
  link: ChatLink | null;
  onLinkHandled: () => void;
}

export interface ProfileTabProps {
  active: boolean;
  theme: ThemeApi;
  role: Role;
  setRole: (r: Role) => void;     // AppShell: сменить режим и открыть «Расписание»
  schedule: ScheduleContext | null;
  openPicker: () => void;         // AppShell: открыть «Расписание» и выбор группы/преподавателя
  link: ProfileLink | null;
  onLinkHandled: () => void;
}

/** window CustomEvent: повторное нажатие на активную вкладку, detail: TabId. */
export const RESELECT_EVENT = 'para:reselect';
