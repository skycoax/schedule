// Клиент API «Обсуждений» и входа: /api/auth/*, /api/social/*.
// Правила транспорта — CONTRACT.md §B.1: uni= в каждом запросе, credentials same-origin,
// cache no-store, у изменений заголовок X-Para: 1 и тело (JSON — хотя бы {}).
// web/src/api.ts (расписание) сюда не импортируем и не меняем.
import { brand } from '../brand';
import type {
  AdminActionBody, AdminStats, AdminUsersPage, AgeGroup, InstantAudience, InstantDetail, InstantReaction, InstantsFeed, MyInstant, AuditItem, AuthIntent, AuthOutcome, AuthState, CategoryId, ErrorCode, FriendLists,
  LikeState, Me, MePatch, MediaRef, NewPost, NewReply, Page, Post, ProfilePage, Relation, ReportBody, ReportCase,
  ReportResult, Thread, UploadedMedia, UserCard, UsernameCheck,
} from './types';

/** Тексты ошибок по умолчанию (§B.3), когда сервер не прислал свой. */
const TEXT: Record<ErrorCode, string> = {
  invalid: 'Неверный запрос',
  uni: 'Сначала выбери вуз',
  auth: 'Войди через Google, чтобы продолжить',
  profile: 'Сначала заполни профиль',
  rules: 'Сначала прими правила обсуждений',
  banned: 'Публикация ограничена. Читать можно.',
  readonly: 'Обсуждения временно доступны только для чтения',
  forbidden: 'Недостаточно прав',
  csrf: 'Запрос отклонён — обнови страницу и попробуй ещё раз',
  blocked: 'Нельзя ответить на эту публикацию',
  not_found: 'Нет такого адреса API',
  conflict: 'Это имя уже занято',
  too_large: 'Слишком большой запрос',
  media_type: 'Нужна фотография в формате JPEG',
  rate: 'Слишком часто — подожди немного',
  server: 'Ошибка сервера — попробуй чуть позже',
  disk: 'Сейчас нельзя загрузить фото — попробуй позже',
  network: 'Сервер не отвечает — попробуй чуть позже',
};
const MEDIA_TOO_LARGE = 'Фото больше 900 КБ — уменьши его';

/** Тост по итогу входа через Google (§B.5), для session.handleAuthOutcome. consent — без тоста. */
export const AUTH_OUTCOME_TEXT: Record<AuthOutcome, string> = {
  ok: 'Вход выполнен',
  cancelled: 'Вход отменён',
  expired: 'Время на вход истекло — попробуй ещё раз',
  failed: 'Не получилось войти через Google — попробуй ещё раз',
  browser: 'Вход не завершился: браузер не сохранил данные входа. Открой Para в Chrome или Safari и попробуй ещё раз',
  limited: 'Слишком много попыток входа — попробуй позже',
  unavailable: 'Вход через Google пока недоступен',
  unverified: 'В этом аккаунте Google не подтверждена почта',
  consent: '',
  none: 'Аккаунта Para с этим Google нет — удалять нечего',
};
const CODES = new Set(Object.keys(TEXT));

/** Пределы тела запроса на сервере (§B.1): проверяем до отправки. */
const MAX_FULL = 921_600;
const MAX_THUMB = 153_600;

export class ApiError extends Error {
  status: number;
  code: ErrorCode;
  field?: string;
  retryAfter?: number;
  constructor(status: number, code: ErrorCode, message: string, extra?: { field?: string; retryAfter?: number }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (extra?.field) this.field = extra.field;
    if (extra?.retryAfter != null) this.retryAfter = extra.retryAfter;
  }
}

export const isApiError = (e: unknown, code?: ErrorCode): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);

type AuthCode = 'auth' | 'profile' | 'rules' | 'banned';
let authHandler: ((code: AuthCode) => void) | null = null;

/** SessionProvider регистрирует обработчик. Вызывается уже после того, как промис отклонён,
 *  на каждый 401 'auth' (кроме /api/auth/me) и на 403 'profile' | 'rules' | 'banned'. */
export function setAuthErrorHandler(fn: ((code: AuthCode) => void) | null): void {
  authHandler = fn;
}

function notifyAuth(e: ApiError, path: string) {
  const c = e.code;
  if (c !== 'auth' && c !== 'profile' && c !== 'rules' && c !== 'banned') return;
  if (path.startsWith('/api/auth/me')) return;
  // setTimeout: вызывающий код сначала получает свой отказ, потом сессия реагирует.
  setTimeout(() => { authHandler?.(c); }, 0);
}

const networkError = () =>
  new ApiError(0, 'network', typeof navigator !== 'undefined' && !navigator.onLine ? 'Нет интернета' : TEXT.network);

const abortError = () => new DOMException('Запрос отменён', 'AbortError');
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

function codeOfStatus(status: number): ErrorCode {
  switch (status) {
    case 400: return 'invalid';
    case 401: return 'auth';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 413: return 'too_large';
    case 415: return 'media_type';
    case 429: return 'rate';
    case 507: return 'disk';
    default: return 'server';
  }
}

/** Адрес с uni= (как в web/src/api.ts). */
function url(path: string, params?: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  if (params) for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  if (brand.id) q.set('uni', brand.id);
  const s = q.toString();
  return path + (s ? '?' + s : '');
}

interface Raw { status: number; text: string; retryAfter: string | null }

/** Разбор ответа по правилам §B.3. media — маршруты загрузки фото (другой текст 413). */
function parse<T>(raw: Raw, path: string, media: boolean): T {
  const isMe = path.startsWith('/api/auth/me');
  let json: unknown = null;
  let isJson = false;
  if (raw.text) {
    try { json = JSON.parse(raw.text); isJson = !!json && typeof json === 'object'; } catch { isJson = false; }
  }
  const ok = raw.status >= 200 && raw.status < 300;
  if (isMe && raw.status === 404) throw new ApiError(404, 'not_found', TEXT.not_found);
  if (isMe && (raw.status >= 500 || !isJson)) throw networkError();
  if (!isJson) {
    if (ok && !raw.text) return null as T;
    if (raw.status === 413) throw new ApiError(413, 'too_large', MEDIA_TOO_LARGE);
    throw new ApiError(raw.status || 500, 'server', TEXT.server);
  }
  const body = json as { ok?: boolean; data?: unknown; error?: string; code?: string; field?: string; retryAfter?: number };
  if (ok && body.ok !== false) return (body.data ?? null) as T;
  const code: ErrorCode = body.code && CODES.has(body.code) ? (body.code as ErrorCode) : codeOfStatus(raw.status);
  let message = typeof body.error === 'string' && body.error ? body.error : TEXT[code];
  if (code === 'too_large' && media && !body.error) message = MEDIA_TOO_LARGE;
  const header = raw.retryAfter ? Number(raw.retryAfter) : NaN;
  const retryAfter = typeof body.retryAfter === 'number' ? body.retryAfter : Number.isFinite(header) ? header : undefined;
  throw new ApiError(raw.status, code, message, { field: body.field, retryAfter });
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function call<T>(method: Method, path: string, o: {
  params?: Record<string, string | number | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /** X-Para: 1 и у GET — там, где сервер его требует (просмотр вызова в игру: чужая страница его не пошлёт). */
  para?: boolean;
} = {}): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store', signal: o.signal };
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json', 'X-Para': '1' };
    init.body = JSON.stringify(o.body ?? {});
  } else if (o.para) {
    init.headers = { 'X-Para': '1' };
  }
  let res: Response;
  try {
    res = await fetch(url(path, o.params), init);
  } catch (e) {
    if (isAbort(e) || o.signal?.aborted) throw abortError();
    throw networkError();
  }
  let text = '';
  try { text = await res.text(); } catch (e) {
    if (isAbort(e) || o.signal?.aborted) throw abortError();
    throw networkError();
  }
  try {
    return parse<T>({ status: res.status, text, retryAfter: res.headers.get('retry-after') }, path, false);
  } catch (e) {
    if (e instanceof ApiError) notifyAuth(e, path);
    throw e;
  }
}

/** Загрузка сырого JPEG через XHR (ради прогресса). */
function sendJpeg<T>(method: 'POST' | 'PUT', path: string, params: Record<string, string>, blob: Blob,
  onProgress?: (p: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    xhr.open(method, url(path, params));
    xhr.setRequestHeader('Content-Type', 'image/jpeg');
    xhr.setRequestHeader('X-Para', '1');
    if (onProgress) xhr.upload.onprogress = (ev) => { if (ev.lengthComputable && ev.total) onProgress(ev.loaded / ev.total); };
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      try {
        resolve(parse<T>({
          status: xhr.status, text: xhr.responseText, retryAfter: xhr.getResponseHeader('retry-after'),
        }, path, true));
      } catch (e) {
        if (e instanceof ApiError) notifyAuth(e, path);
        reject(e);
      }
    };
    xhr.onerror = () => { signal?.removeEventListener('abort', onAbort); reject(networkError()); };
    xhr.onabort = () => { signal?.removeEventListener('abort', onAbort); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(blob);
  });
}

/** Общий транспорт для мини-игры «Код» (game/api.ts): те же правила §B.1 и разбор ошибок §B.3. */
export { call as apiCall };

const enc = encodeURIComponent;

export const socialApi = {
  me(signal?: AbortSignal): Promise<AuthState> {
    return call<AuthState>('GET', '/api/auth/me', { signal });
  },

  /** /api/auth/google/start?return=&intent=&uni= ; для 'signin' ещё &age= и &accept=1 (только при o.accept === true).
   *  Для 'delete' ни age, ни accept не добавляются никогда. */
  signInUrl(o: { returnTo: string; intent: AuthIntent; age?: AgeGroup; accept: boolean }): string {
    const params: Record<string, string> = { return: o.returnTo, intent: o.intent };
    if (o.intent === 'signin') {
      if (o.age) params.age = o.age;
      if (o.accept === true) params.accept = '1';
    }
    return url('/api/auth/google/start', params);
  },

  devLogin(name: string, age?: AgeGroup, intent?: AuthIntent): Promise<Me> {
    const body: Record<string, string> = { name };
    if (age) body.age = age;
    if (intent) body.intent = intent;
    return call<Me>('POST', '/api/auth/dev', { body });
  },

  async logout(all?: boolean): Promise<void> {
    await call<null>('POST', '/api/auth/logout', { body: all ? { all: true } : {} });
  },

  feed(o: { category?: CategoryId | null; cursor?: string | null; limit?: number }, signal?: AbortSignal): Promise<Page<Post>> {
    return call<Page<Post>>('GET', '/api/social/feed', { params: { category: o.category, cursor: o.cursor, limit: o.limit }, signal });
  },

  thread(id: number, cursor?: string | null, signal?: AbortSignal): Promise<Thread> {
    return call<Thread>('GET', '/api/social/posts/' + id, { params: { cursor }, signal });
  },

  createPost(b: NewPost): Promise<Post> {
    return call<Post>('POST', '/api/social/posts', { body: b });
  },

  createReply(rootId: number, b: NewReply): Promise<Post> {
    return call<Post>('POST', '/api/social/posts/' + rootId + '/replies', { body: b });
  },

  async deletePost(id: number): Promise<void> {
    await call<null>('DELETE', '/api/social/posts/' + id, { body: {} });
  },

  like(id: number, on: boolean): Promise<LikeState> {
    return call<LikeState>(on ? 'PUT' : 'DELETE', '/api/social/posts/' + id + '/like', { body: {} });
  },

  /** POST полного фото (XHR, прогресс 0..0.9), затем PUT миниатюры (0.9..1), если она есть.
   *  Неудачная миниатюра не ломает загрузку: тогда thumb = url. */
  async uploadMedia(img: { full: Blob; thumb?: Blob | null },
    o?: { kind?: 'post' | 'avatar'; onProgress?: (p: number) => void; signal?: AbortSignal }): Promise<UploadedMedia> {
    if (img.full.size > MAX_FULL || (img.thumb && img.thumb.size > MAX_THUMB)) {
      throw new ApiError(413, 'too_large', MEDIA_TOO_LARGE);
    }
    const kind = o?.kind || 'post';
    const progress = o?.onProgress;
    const up = await sendJpeg<UploadedMedia>('POST', '/api/social/media', { kind }, img.full,
      progress ? (p) => progress(p * 0.9) : undefined, o?.signal);
    if (!img.thumb) { progress?.(1); return up; }
    progress?.(0.9);
    try {
      const ref = await sendJpeg<MediaRef>('PUT', '/api/social/media/' + enc(up.id) + '/thumb', {}, img.thumb,
        progress ? (p) => progress(0.9 + p * 0.1) : undefined, o?.signal);
      progress?.(1);
      return { ...up, thumb: ref?.thumb || up.url };
    } catch (e) {
      if (isAbort(e)) throw e;
      progress?.(1);
      return { ...up, thumb: up.url };
    }
  },

  async deleteMedia(id: string): Promise<void> {
    await call<null>('DELETE', '/api/social/media/' + enc(id), { body: {} });
  },

  updateMe(p: MePatch): Promise<Me> {
    return call<Me>('PATCH', '/api/social/me', { body: p });
  },

  async setAvatar(img: { full: Blob; thumb: Blob }, onProgress?: (p: number) => void): Promise<Me> {
    const up = await socialApi.uploadMedia(img, { kind: 'avatar', onProgress });
    return socialApi.updateMe({ avatar: up.id });
  },

  removeAvatar(): Promise<Me> {
    return socialApi.updateMe({ avatar: null });
  },

  acceptRules(version: number): Promise<Me> {
    return call<Me>('POST', '/api/social/me/rules', { body: { version } });
  },

  async deleteAccount(): Promise<void> {
    await call<null>('DELETE', '/api/social/me', { body: { confirm: true } });
  },

  checkUsername(u: string, signal?: AbortSignal): Promise<UsernameCheck> {
    return call<UsernameCheck>('GET', '/api/social/username', { params: { u }, signal });
  },

  async searchUsers(q: string, signal?: AbortSignal): Promise<UserCard[]> {
    const d = await call<{ items: UserCard[] }>('POST', '/api/social/users/search', { body: { q }, signal });
    return d?.items || [];
  },

  user(username: string, signal?: AbortSignal): Promise<ProfilePage> {
    return call<ProfilePage>('GET', '/api/social/users/' + enc(username), { signal });
  },

  userPosts(username: string, cursor: string, signal?: AbortSignal): Promise<Page<Post>> {
    return call<Page<Post>>('GET', '/api/social/users/' + enc(username) + '/posts', { params: { cursor }, signal });
  },

  friends(signal?: AbortSignal): Promise<FriendLists> {
    return call<FriendLists>('GET', '/api/social/friends', { signal });
  },

  /** request → POST /friends/:id · accept → POST …/accept · decline → POST …/decline · cancel|remove → DELETE /friends/:id */
  async friend(userId: number, action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove'): Promise<Relation> {
    const base = '/api/social/friends/' + userId;
    const d = action === 'request' ? await call<{ relation: Relation }>('POST', base, { body: {} })
      : action === 'accept' ? await call<{ relation: Relation }>('POST', base + '/accept', { body: {} })
      : action === 'decline' ? await call<{ relation: Relation }>('POST', base + '/decline', { body: {} })
      : await call<{ relation: Relation }>('DELETE', base, { body: {} });
    return d?.relation ?? 'none';
  },

  async blocks(signal?: AbortSignal): Promise<UserCard[]> {
    const d = await call<{ items: UserCard[] }>('GET', '/api/social/blocks', { signal });
    return d?.items || [];
  },

  async block(userId: number): Promise<void> {
    await call<unknown>('PUT', '/api/social/blocks/' + userId, { body: {} });
  },

  async unblock(userId: number): Promise<void> {
    await call<unknown>('DELETE', '/api/social/blocks/' + userId, { body: {} });
  },

  // ─── Моменты ───
  instantsFeed(signal?: AbortSignal): Promise<InstantsFeed> {
    return call<InstantsFeed>('GET', '/api/social/instants', { signal });
  },
  createInstant(media: string, audience: InstantAudience): Promise<MyInstant> {
    return call<MyInstant>('POST', '/api/social/instants', { body: { media, audience } });
  },
  async viewInstant(id: number): Promise<void> {
    await call<null>('POST', '/api/social/instants/' + id + '/view', { body: {} });
  },
  reactInstant(id: number, emoji: InstantReaction | null): Promise<{ reaction: InstantReaction | null }> {
    return call<{ reaction: InstantReaction | null }>('POST', '/api/social/instants/' + id + '/react', { body: { emoji } });
  },
  myInstants(cursor?: string | null, signal?: AbortSignal): Promise<Page<MyInstant>> {
    return call<Page<MyInstant>>('GET', '/api/social/instants/mine', { params: { cursor }, signal });
  },
  instant(id: number, signal?: AbortSignal): Promise<InstantDetail> {
    return call<InstantDetail>('GET', '/api/social/instants/' + id, { signal });
  },
  async deleteInstant(id: number): Promise<void> {
    await call<null>('DELETE', '/api/social/instants/' + id, { body: {} });
  },

  report(b: ReportBody): Promise<ReportResult> {
    return call<ReportResult>('POST', '/api/social/reports', { body: b });
  },

  adminReports(status: 'open' | 'closed', cursor?: string | null, signal?: AbortSignal): Promise<Page<ReportCase>> {
    return call<Page<ReportCase>>('GET', '/api/social/admin/reports', { params: { status, cursor }, signal });
  },

  async adminAction(b: AdminActionBody): Promise<void> {
    await call<null>('POST', '/api/social/admin/action', { body: b });
  },

  adminStats(signal?: AbortSignal): Promise<AdminStats> {
    return call<AdminStats>('GET', '/api/social/admin/stats', { signal });
  },

  /** Пользователи для модератора: q — поиск по имени и @имени; сводка приходит с первой страницей без поиска. */
  adminUsers(q: string, cursor?: string | null, signal?: AbortSignal): Promise<AdminUsersPage> {
    return call<AdminUsersPage>('GET', '/api/social/admin/users', { params: { q: q || null, cursor }, signal });
  },
  adminAudit(cursor?: string | null, signal?: AbortSignal): Promise<Page<AuditItem>> {
    return call<Page<AuditItem>>('GET', '/api/social/admin/audit', { params: { cursor }, signal });
  },
};
