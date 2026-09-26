// Действия над постами и людьми: ссылки, меню «•••», жалоба, блокировка, скрытие автора,
// действия модератора. Меню — chooseAction, подтверждения — confirmDialog (CONTRACT.md §E.2 actions).
import { useMemo, useRef } from 'react';
import { brand } from '../brand';
import { toast } from '../ui/Toast';
import { chooseAction, confirmDialog, promptText } from '../ui/ActionSheet';
import type { SheetAction } from '../ui/ActionSheet';
import { isApiError, socialApi } from './api';
import { emit } from './events';
import { hideUser } from './local';
import { openReportSheet, useSession } from './session';
import type { Session } from './session';
import type { AdminActionBody, Post, ReportResult, ReportTarget, ResetField, UserCard, UserProfile } from './types';

/** Ссылка на ветку: вуз поста и id публикации (для ответа — его публикации). */
export function postLink(p: Post): string {
  return location.origin + '/?uni=' + encodeURIComponent(p.uni) + '&post=' + (p.rootId ?? p.id);
}

/** Ссылка на профиль (вуз — текущий). */
export function userLink(username: string): string {
  return location.origin + '/?uni=' + encodeURIComponent(brand.id) + '&user=' + encodeURIComponent(username);
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* нет доступа к буферу — старый способ */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Эти ошибки показывает сама сессия (вход, профиль, правила, ограничение). */
const SESSION_CODES = ['auth', 'profile', 'rules', 'banned'] as const;
function fail(e: unknown) {
  if (SESSION_CODES.some((c) => isApiError(e, c))) return;
  toast(e instanceof Error && e.message ? e.message : 'Не получилось — попробуй ещё раз', { kind: 'error' });
}

const BAN_TERMS: { id: string; label: string; days: 1 | 7 | 30 | null }[] = [
  { id: '1', label: 'На сутки', days: 1 },
  { id: '7', label: 'На неделю', days: 7 },
  { id: '30', label: 'На месяц', days: 30 },
  { id: 'forever', label: 'Навсегда', days: null },
];

const RESET_FIELDS: { id: ResetField; label: string }[] = [
  { id: 'avatar', label: 'Сбросить фото' },
  { id: 'bio', label: 'Сбросить «О себе»' },
  { id: 'links', label: 'Сбросить ссылки' },
  { id: 'name', label: 'Сбросить имя' },
];

type PostMenuResult = 'deleted' | 'reported' | 'blocked' | 'hidden' | 'moderated' | null;
type UserMenuResult = 'reported' | 'blocked' | 'unblocked' | 'moderated' | null;

/** Недолго ждём первый ответ сессии, чтобы меню было для того, кто вошёл, а не для гостя. */
async function settled(s: Session): Promise<void> {
  if (s.status !== 'loading') return;
  await Promise.race([s.ready, new Promise<void>((r) => setTimeout(r, 1500))]);
}

export function useSocialActions(): {
  /** returnTo: куда вернуть гостя после входа (ThreadView передаёт currentReturnTo({ post: rootId })). */
  report(target: ReportTarget, o: { username: string; kind: 'post' | 'reply' | 'user' | 'instant'; returnTo?: string }): Promise<ReportResult | null>;
  block(user: Pick<UserCard, 'id' | 'username'>, returnTo?: string): Promise<boolean>;
  unblock(user: Pick<UserCard, 'id' | 'username'>): Promise<boolean>;
  hideLocally(user: Pick<UserCard, 'id' | 'username' | 'name'>): void;
  copyLink(url: string): Promise<void>;
  share(url: string, title?: string): Promise<void>;
  postMenu(post: Post, returnTo?: string): Promise<PostMenuResult>;
  userMenu(user: UserProfile): Promise<UserMenuResult>;
} {
  const session = useSession();
  // Меню ждут ответов пользователя — читаем самую свежую сессию, а не ту, что была при создании.
  const ref = useRef(session);
  ref.current = session;

  return useMemo(() => {
    const cur = () => ref.current;

    const copyLink = async (url: string) => {
      if (await copyText(url)) toast('Ссылка скопирована');
      else toast('Не получилось скопировать ссылку', { kind: 'error' });
    };

    const share = async (url: string, title?: string) => {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share(title ? { url, title } : { url });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      await copyLink(url);
    };

    const hideLocally = (user: Pick<UserCard, 'id' | 'username' | 'name'>) => {
      hideUser({ id: user.id, username: user.username, name: user.name });
      emit({ type: 'hide-user', userId: user.id });
      toast('Посты @' + user.username + ' скрыты');
    };

    /** Блокировка после входа и подтверждения. userId неизвестен — узнаём по @имени. */
    const blockFlow = async (user: { id: number | null; username: string }, returnTo?: string): Promise<boolean> => {
      if (!(await cur().ensure('block', returnTo))) return false;
      const u = user.username;
      const ok = await confirmDialog({
        title: 'Заблокировать @' + u + '?',
        message: 'Ты не будешь видеть посты и ответы @' + u + ', а @' + u + ' не сможет отвечать тебе, отмечать твои посты, открывать твой профиль и добавлять тебя в друзья. @' + u + ' не узнает о блокировке.',
        confirm: 'Заблокировать',
        destructive: true,
      });
      if (!ok) return false;
      try {
        const id = user.id ?? (await socialApi.user(u)).user.id;
        await socialApi.block(id);
        emit({ type: 'block', userId: id });
      } catch (e) {
        fail(e);
        return false;
      }
      toast('Пользователь заблокирован');
      return true;
    };

    const block = (user: Pick<UserCard, 'id' | 'username'>, returnTo?: string) =>
      blockFlow({ id: user.id, username: user.username }, returnTo);

    const unblock = async (user: Pick<UserCard, 'id' | 'username'>) => {
      try {
        await socialApi.unblock(user.id);
      } catch (e) {
        fail(e);
        return false;
      }
      emit({ type: 'unblock', userId: user.id });
      toast('Пользователь разблокирован');
      return true;
    };

    /** Жалоба: вход (гостю), лист, а если в листе нажали «Заблокировать @u» — блокировка. */
    const reportFlow = async (target: ReportTarget, o: { username: string; kind: 'post' | 'reply' | 'user' | 'instant'; returnTo?: string },
      authorId: number | null): Promise<{ result: ReportResult | null; blocked: boolean }> => {
      if (!(await cur().ensure('report', o.returnTo))) return { result: null, blocked: false };
      const r = await openReportSheet({ target, kind: o.kind, username: o.username });
      let blocked = false;
      if (r.block && o.username) blocked = await blockFlow({ id: authorId, username: o.username }, o.returnTo);
      return { result: r.result, blocked };
    };

    const report = async (target: ReportTarget, o: { username: string; kind: 'post' | 'reply' | 'user' | 'instant'; returnTo?: string }) =>
      (await reportFlow(target, o, target.type === 'user' ? target.id : null)).result;

    /** Действие модератора: запрос, событие 'moderated', тост. */
    const moderate = async (body: AdminActionBody, done: string): Promise<boolean> => {
      try {
        await socialApi.adminAction(body);
      } catch (e) {
        fail(e);
        return false;
      }
      emit({ type: 'moderated', target: body.target, action: body.action });
      if (done) toast(done);
      return true;
    };

    /** «Ограничить…»: срок, затем причина. */
    const banFlow = async (target: ReportTarget, title: string): Promise<boolean> => {
      const term = await chooseAction({
        title,
        actions: [...BAN_TERMS.map((t) => ({ id: t.id, label: t.label })), { id: 'cancel', label: 'Отмена', role: 'cancel' }],
      });
      const t = BAN_TERMS.find((x) => x.id === term);
      if (!t) return false;
      const reason = await promptText({
        title: 'Причина', placeholder: 'Например: спам', confirm: 'Ограничить', required: true, maxLength: 200,
      });
      if (!reason) return false;
      return moderate({ action: 'ban', target, days: t.days, reason }, 'Автор ограничен');
    };

    const postMenu = async (post: Post, returnTo?: string): Promise<PostMenuResult> => {
      if (post.deleted) return null;               // у «Пост удалён» меню нет
      await settled(cur());
      const s = cur();
      const me = s.status === 'signed' ? s.me : null;
      const reply = post.rootId !== null;
      const author = post.author;
      const u = author?.username || '';
      const own = !!me && (post.mine || (!!author && author.id === me.id));
      const admin = !!me?.isAdmin && !own;

      const actions: SheetAction[] = [];
      if (!reply) actions.push({ id: 'copy', label: 'Скопировать ссылку' });
      if (own) {
        actions.push({ id: 'delete', label: 'Удалить', role: 'destructive' });
      } else {
        actions.push({ id: 'report', label: 'Пожаловаться' });
        if (author) {
          if (me) actions.push({ id: 'block', label: 'Заблокировать @' + u, role: 'destructive' });
          else actions.push({ id: 'hide', label: 'Скрыть посты @' + u });
        }
      }
      if (admin) {
        actions.push(post.hidden
          ? { id: 'mod-unhide', label: 'Вернуть (модератор)' }
          : { id: 'mod-hide', label: 'Скрыть (модератор)' });
        actions.push({ id: 'mod-delete', label: 'Удалить как модератор', role: 'destructive' });
        if (author) actions.push({ id: 'mod-ban', label: 'Ограничить автора…' });
      }

      const pick = await chooseAction({ actions });
      const target: ReportTarget = { type: 'post', id: post.id };
      switch (pick) {
        case 'copy':
          await copyLink(postLink(post));
          return null;
        case 'delete': {
          const ok = await confirmDialog(reply
            ? { title: 'Удалить ответ?', message: 'Это нельзя отменить.', confirm: 'Удалить', destructive: true }
            : {
              title: 'Удалить пост?',
              message: 'Ответы других останутся, а на месте поста будет «Пост удалён». Это нельзя отменить.',
              confirm: 'Удалить', destructive: true,
            });
          if (!ok) return null;
          try {
            await socialApi.deletePost(post.id);
          } catch (e) {
            if (isApiError(e, 'not_found')) {
              // Уже удалён (например, с другого устройства) — всё равно убираем из списков.
              emit({ type: 'post-deleted', id: post.id, rootId: post.rootId });
              return 'deleted';
            }
            fail(e);
            return null;
          }
          emit({ type: 'post-deleted', id: post.id, rootId: post.rootId });
          toast('Удалено');
          return 'deleted';
        }
        case 'report': {
          const r = await reportFlow(target, { username: u, kind: reply ? 'reply' : 'post', returnTo }, author?.id ?? null);
          return r.blocked ? 'blocked' : r.result ? 'reported' : null;
        }
        case 'block':
          return author && (await blockFlow({ id: author.id, username: u }, returnTo)) ? 'blocked' : null;
        case 'hide':
          if (!author) return null;
          hideLocally(author);
          return 'hidden';
        case 'mod-hide':
          return (await moderate({ action: 'hide', target }, 'Скрыто')) ? 'moderated' : null;
        case 'mod-unhide':
          return (await moderate({ action: 'unhide', target }, 'Возвращено')) ? 'moderated' : null;
        case 'mod-delete': {
          const ok = await confirmDialog({
            title: 'Удалить как модератор?', message: 'Публикация исчезнет у всех. Это нельзя отменить.',
            confirm: 'Удалить', destructive: true,
          });
          if (!ok) return null;
          if (!(await moderate({ action: 'delete', target }, 'Удалено'))) return null;
          emit({ type: 'post-deleted', id: post.id, rootId: post.rootId });
          return 'moderated';
        }
        case 'mod-ban':
          return (await banFlow(target, 'Ограничить автора')) ? 'moderated' : null;
        default:
          return null;
      }
    };

    const userMenu = async (user: UserProfile): Promise<UserMenuResult> => {
      await settled(cur());
      const s = cur();
      const me = s.status === 'signed' ? s.me : null;
      const self = user.relation === 'self' || (!!me && me.id === user.id);
      const admin = !!me?.isAdmin && !self;
      const u = user.username;

      const actions: SheetAction[] = [{ id: 'copy', label: 'Скопировать ссылку' }];
      if (!self) {
        actions.push({ id: 'report', label: 'Пожаловаться' });
        actions.push(user.relation === 'blocked'
          ? { id: 'unblock', label: 'Разблокировать' }
          : { id: 'block', label: 'Заблокировать @' + u, role: 'destructive' });
      }
      if (admin) {
        actions.push(user.banned
          ? { id: 'mod-unban', label: 'Снять ограничение' }
          : { id: 'mod-ban', label: 'Ограничить…' });
        actions.push({ id: 'mod-reset', label: 'Сбросить профиль…' });
        actions.push({ id: 'mod-badge', label: user.badge ? 'Изменить значок…' : 'Выдать значок…' });
      }

      const pick = await chooseAction({ actions });
      const target: ReportTarget = { type: 'user', id: user.id };
      switch (pick) {
        case 'copy':
          await copyLink(userLink(u));
          return null;
        case 'report': {
          const r = await reportFlow(target, { username: u, kind: 'user' }, user.id);
          return r.blocked ? 'blocked' : r.result ? 'reported' : null;
        }
        case 'block':
          return (await blockFlow({ id: user.id, username: u })) ? 'blocked' : null;
        case 'unblock':
          return (await unblock(user)) ? 'unblocked' : null;
        case 'mod-unban':
          return (await moderate({ action: 'unban', target }, 'Ограничение снято')) ? 'moderated' : null;
        case 'mod-ban':
          return (await banFlow(target, 'Ограничить @' + u)) ? 'moderated' : null;
        case 'mod-reset': {
          const f = await chooseAction({
            title: 'Сбросить профиль @' + u,
            actions: RESET_FIELDS.map((x) => ({ id: x.id, label: x.label, role: 'destructive' as const })),
          });
          const field = RESET_FIELDS.find((x) => x.id === f);
          if (!field) return null;
          return (await moderate({ action: 'reset', target, fields: [field.id] }, 'Сброшено')) ? 'moderated' : null;
        }
        case 'mod-badge': {
          const { pickBadge } = await import('./ui/BadgePicker');
          const badge = await pickBadge({ name: user.name + ' · @' + u, current: user.badge || null });
          if (badge === undefined || badge === (user.badge || null)) return null;
          return (await moderate({ action: 'badge', target, badge }, badge ? 'Значок выдан' : 'Значок убран')) ? 'moderated' : null;
        }
        default:
          return null;
      }
    };

    return { report, block, unblock, hideLocally, copyLink, share, postMenu, userMenu };
  }, []);
}
