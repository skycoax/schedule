// Обсуждения Para: формы данных API (/api/auth/*, /api/social/*, /api/media/*).
// Зеркало server/src/social/*. Меняется только вместе с CONTRACT.md (раздел B).

export type SocialMode = 'on' | 'readonly' | 'off';
export type AgeGroup = 'minor' | 'adult';
export type CategoryId = 'study' | 'schedule' | 'events' | 'company' | 'lost' | 'other';
export type ReportReason =
  | 'spam' | 'abuse' | 'sexual' | 'violence' | 'privacy' | 'scam' | 'impersonation' | 'child' | 'other';
export type Relation = 'self' | 'none' | 'outgoing' | 'incoming' | 'friends' | 'blocked';
export type LinksVisibility = 'friends' | 'signed';
export type FriendRequests = 'all' | 'none';
export type AuthIntent = 'signin' | 'delete';
export type AuthOutcome =
  | 'ok' | 'cancelled' | 'expired' | 'failed' | 'browser' | 'limited' | 'unavailable' | 'unverified' | 'consent' | 'none';
export type AuthReason =
  | 'post' | 'reply' | 'like' | 'friend' | 'block' | 'report' | 'profile' | 'search' | 'account' | 'delete' | 'expired';
export type ErrorCode =
  | 'invalid' | 'uni' | 'auth' | 'profile' | 'rules' | 'banned' | 'readonly' | 'forbidden' | 'csrf' | 'blocked'
  | 'not_found' | 'conflict' | 'too_large' | 'media_type' | 'rate' | 'server' | 'disk' | 'network';

export interface Category { id: CategoryId; label: string; hint: string; photos: boolean }
/** Порядок показа. Сервер принимает ровно эти id. */
export const CATEGORIES: readonly Category[] = [
  { id: 'study', label: 'Учёба', hint: 'Вопросы по предметам, конспекты, помощь с заданиями', photos: true },
  { id: 'schedule', label: 'Расписание', hint: 'Замены, аудитории, переносы пар', photos: true },
  { id: 'events', label: 'События', hint: 'Мероприятия, кружки, спорт и жизнь вуза', photos: true },
  { id: 'company', label: 'Компания', hint: 'Найти, с кем учиться, заниматься спортом или ходить на мероприятия', photos: false },
  { id: 'lost', label: 'Потеряшки', hint: 'Потерянные и найденные вещи — напиши, где и когда', photos: true },
  { id: 'other', label: 'Разное', hint: 'Всё остальное, что не нарушает правила', photos: true },
];
export const categoryOf = (id: string | null | undefined): Category | null =>
  CATEGORIES.find((c) => c.id === id) || null;

export interface ReasonDef { id: ReportReason; label: string; severe: boolean }
export const REPORT_REASONS: readonly ReasonDef[] = [
  { id: 'spam', label: 'Спам или реклама', severe: false },
  { id: 'abuse', label: 'Оскорбления или травля', severe: false },
  { id: 'sexual', label: '18+ или откровенное', severe: true },
  { id: 'violence', label: 'Насилие, угрозы или жестокость', severe: true },
  { id: 'privacy', label: 'Чужие фото или личные данные', severe: true },
  { id: 'scam', label: 'Мошенничество или продажа работ', severe: false },
  { id: 'impersonation', label: 'Выдаёт себя за другого', severe: false },
  { id: 'child', label: 'Угроза ребёнку', severe: true },
  { id: 'other', label: 'Другое', severe: false },
];

export interface Limits {
  text: number; lines: number; links: number; media: number; replyMedia: number;
  mediaBytes: number; thumbBytes: number; mediaSide: number; thumbSide: number; avatarSide: number;
  name: number; bio: number; usernameMin: number; usernameMax: number; note: number;
}
export interface SocialConfig { rulesVersion: number; minAge: number; limits: Limits }
/** GET /api/auth/me. В режиме 'off' маршрут остаётся (ради удаления аккаунта); 404 клиент понимает так же, как 'off' без аккаунта. */
export interface AuthState { user: Me | null; google: boolean; dev: boolean; mode: SocialMode; config: SocialConfig }

export interface MediaRef { id: string; url: string; thumb: string; w: number; h: number }
export interface UploadedMedia extends MediaRef { bytes: number }

export interface Links { tg: string; ig: string }
export interface Ban { until: string | null; reason: string }

/** Автор в ленте, строка в поиске и в списках. Только люди с заполненным профилем. */
export interface UserCard {
  id: number;
  username: string;
  name: string;
  avatar: string | null;        // миниатюра 128 (или полное фото, если миниатюры нет)
  uni: string | null;           // «мой вуз», id. Гостю (в Post.author) всегда null; в ленте не показывается
  uniShort: string | null;      // 'ТГЭУ · Ташкент'. Гостю всегда null
  team: boolean;                // модератор Para → значок «Команда Para»
}

export interface UserProfile extends UserCard {
  avatarFull: string | null;    // 512
  bio: string;
  links: Links | null;          // null — скрыты от этого зрителя
  linksHidden: 'friends' | null;
  counts: { friends: number; posts: number };
  since: string;                // 'YYYY-MM'
  relation: Relation;
  canFriend: boolean;
  banned: Ban | null;           // только для модераторов; остальным всегда null
}

export interface Me {
  id: number;
  username: string | null;      // null → нужен SetupSheet
  name: string;
  avatar: string | null;
  avatarFull: string | null;
  bio: string;
  links: Links;
  uni: string | null;
  uniShort: string | null;
  team: boolean;
  isAdmin: boolean;
  email: string;                // только своё и замаскированное: 'a•••@gmail.com'
  age: AgeGroup;
  privacy: { links: LinksVisibility; searchable: boolean; friendRequests: FriendRequests };
  needsProfile: boolean;        // username === null
  suggestedUsername: string | null;  // только пока needsProfile
  rulesAccepted: boolean;       // rules_version === config.rulesVersion
  banned: Ban | null;
  requestsIn: number;           // входящие заявки в друзья
  modQueue: number;             // открытые жалобы (только у модераторов, иначе 0)
  counts: { friends: number; posts: number };
  usernameNextChange: string | null; // когда снова можно сменить @имя; null — можно сейчас
  createdAt: string;
}

/** Публикация и ответ — одна форма (одна таблица на сервере). */
export interface Post {
  id: number;
  uni: string;
  uniShort: string | null;
  rootId: number | null;        // null — публикация, иначе ответ в её ветке
  category: CategoryId | null;  // только у публикаций
  replyTo: { id: number; username: string | null } | null; // username null → «в ответ на удалённое сообщение»
  author: UserCard | null;      // null у удалённых
  text: string;                 // мат замаскирован
  media: MediaRef[];
  likes: number;
  liked: boolean;
  replies: number;              // живые ответы (у публикаций)
  createdAt: string;
  deleted: boolean;             // «Пост удалён» / «Ответ удалён»
  hidden: boolean;              // true видят только автор и модераторы
  mine: boolean;
  canDelete: boolean;
  reported: boolean;            // я уже жаловался
}
export type Reply = Post;

export interface Page<T> { items: T[]; next: string | null }
export interface Thread { post: Post; replies: Post[]; next: string | null; focus: number | null }
export interface ProfilePage { user: UserProfile; posts: Post[]; next: string | null }
export interface FriendRow extends UserCard { since: string }
export interface FriendLists { friends: FriendRow[]; incoming: FriendRow[]; outgoing: FriendRow[] }
export interface LikeState { liked: boolean; likes: number }
export interface UsernameCheck { available: boolean; error?: string }
export interface ReportResult { reported: true; hidden: boolean }

export interface NewPost { text: string; category: CategoryId; media: string[] }
export interface NewReply { text: string; media: string[]; replyTo?: number }
export interface MePatch {
  username?: string; name?: string; bio?: string; tg?: string; ig?: string;
  linksVisibility?: LinksVisibility; searchable?: boolean; friendRequests?: FriendRequests;
  avatar?: string | null; uni?: string /* '' — не показывать */; age?: 'adult';
}
export interface ReportBody { target: 'post' | 'user'; id: number; reason: ReportReason; note?: string }

export type ReportTarget = { type: 'post'; id: number } | { type: 'user'; id: number };
export type AdminAction = 'dismiss' | 'hide' | 'unhide' | 'delete' | 'ban' | 'unban' | 'reset';
export type ResetField = 'avatar' | 'bio' | 'links' | 'name';
export interface AdminActionBody {
  action: AdminAction;
  target: ReportTarget;
  days?: 1 | 7 | 30 | null;
  reason?: string;
  hidePosts?: boolean;
  fields?: ResetField[];
}
/** Снимок цели на момент первой жалобы. */
export interface ReportSnapshot {
  kind: 'post' | 'reply' | 'user';
  rootId: number | null;        // у ответа — id публикации, иначе null
  text: string;                 // пост/ответ — исходный текст; профиль — «О себе»
  name: string | null;          // профиль — имя
  username: string | null;
  media: MediaRef[];            // фото из снимка, которые ещё лежат на сервере (у профиля — аватар)
  mediaCount: number;           // сколько фото было на момент жалобы
  at: string;
}
export interface ReportCase {
  key: string;                                  // 'p:812' | 'u:7'
  target: ReportTarget;
  status: 'open' | 'dismissed' | 'actioned';
  post: (Post & { rawText: string }) | null;    // сейчас; null — удалён совсем или цель — человек
  snapshot: ReportSnapshot | null;
  /** Цель‑человек, а у цели‑поста — его автор (null — аккаунт удалён). */
  user: (UserCard & {
    bio: string; links: Links; avatarFull: string | null;
    status: 'active' | 'banned'; banned: Ban | null; createdAt: string; openReports: number;
  }) | null;
  reasons: Partial<Record<ReportReason, number>>;
  notes: string[];                              // до 10 последних комментариев
  reporters: number;
  severe: boolean;
  hidden: boolean;
  firstAt: string;
  lastAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;                    // '@username' модератора
}
export interface AdminStats {
  users: number; usersToday: number; postsToday: number; repliesToday: number;
  openReports: number; hiddenPosts: number; bannedUsers: number; mediaBytes: number;
}
/** Пользователь в админке (GET /api/social/admin/users). Без почты, Google ID, возраста и списка друзей. */
export interface AdminUser {
  id: number; username: string | null; name: string; avatar: string | null; uni: string | null; uniShort: string | null;
  createdAt: string; team: boolean; rulesAccepted: boolean; banned: Ban | null;
  counts: { posts: number; replies: number; likes: number; friends: number };
  reports: { open: number; total: number };
}
export interface AdminUsersStats { total: number; today: number; week: number; active: number; noProfile: number; banned: number }
export interface AdminUsersPage { items: AdminUser[]; next: string | null; stats: AdminUsersStats | null }
export interface AuditItem {
  id: number; ts: string; actor: { id: number; username: string | null } | null;
  action: string; target: string | null; uni: string | null; info: Record<string, unknown>;
}
