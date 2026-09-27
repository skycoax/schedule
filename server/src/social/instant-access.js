// Кто видит момент (instants.js) и его фото (/api/media/*, media.js), на что можно пожаловаться (moderation.js),
// кому сказать, что момент появился или пропал (живые обновления, live.js).
// Отдельный маленький файл без зависимостей от маршрутов — чтобы media.js и moderation.js не тянули instants.js.
import { nowIso } from './db.js';
import { isAdmin, marks } from './http.js';
import { liveTo, liveUsers } from './live.js';

/** Друзья ли a и b (заявка принята). */
export function areFriends(db, a, b) {
  if (!a || !b || a === b) return false;
  return !!db.prepare("SELECT 1 FROM friends WHERE user_lo = ? AND user_hi = ? AND status = 'accepted'")
    .get(Math.min(a, b), Math.max(a, b));
}

/** Заблокировал ли кто-то из двоих другого. */
function blockedEither(db, a, b) {
  return !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
    .get(a, b, b, a);
}

/**
 * Видит ли viewer момент i (строка instants) при статусе автора authorStatus.
 * Автор и модератор — всегда (архив, жалобы). Остальные — пока момент не истёк и не скрыт, автор не ограничен
 * и никто из двоих не заблокировал другого: момент «для всех» — любой вошедший, «для друзей» — только друг.
 */
export function canSeeInstant(db, viewer, i, authorStatus) {
  if (!viewer || !i) return false;
  if (viewer.id === i.author_id || isAdmin(viewer)) return true;
  if (Number(i.hidden) || i.expires_at <= nowIso() || authorStatus !== 'active') return false;
  if (blockedEither(db, viewer.id, i.author_id)) return false;
  return i.audience === 'all' || areFriends(db, viewer.id, i.author_id);
}

/** Момент со статусом автора по id (или null). */
export function instantById(db, id) {
  return db.prepare(`SELECT i.*, u.status AS author_status FROM instants i JOIN users u ON u.id = i.author_id
    WHERE i.id = ?`).get(id) || null;
}

/**
 * Живые обновления: instants {} — момент i (строка instantById; при удалении и скрытии — строка до них) появился
 * или пропал. Получают все живые, кто его видит (или видел) — canSeeInstant, модераторы тоже, — кроме автора.
 * Вызывать после COMMIT; не бросает.
 */
export function liveInstant(db, i, log) {
  try {
    const ids = liveUsers().filter((id) => id !== i.author_id);
    if (!ids.length) return;
    const viewers = db.prepare(`SELECT id, email, email_verified FROM users WHERE id IN (${marks(ids)})`).all(...ids);
    liveTo(viewers.filter((u) => canSeeInstant(db, u, i, i.author_status)).map((u) => u.id), 'instants', {});
  } catch (err) {
    if (log) log.warn({ msg: err && err.message }, 'живые обновления: моменты');
  }
}

/** Удалить момент целиком (внутри tx): строка media (каскадом — момент и просмотры). Возвращает файлы. */
export function deleteInstantRows(db, i) {
  const m = db.prepare('SELECT id FROM media WHERE id = ?').get(i.media_id);
  db.prepare('DELETE FROM media WHERE id = ?').run(i.media_id);
  db.prepare('DELETE FROM instants WHERE id = ?').run(i.id);
  return m ? [m.id] : [];
}
