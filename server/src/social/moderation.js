// Модерация: журнал действий, жалобы и автоскрытие, очередь и действия модератора, статистика
// (CONTRACT.md §B.5 #32–#36, §C.4). Модератор — подтверждённая почта из SOCIAL_ADMIN_EMAILS.
import { social } from '../config.js';
import { tx, nowIso, today, HOUR, DAY } from './db.js';
import {
  ok, invalid, notFound, forbidden, guard, isAdmin, banOf, bodyOf, TEXT, intField, cursorParam,
} from './http.js';
import { limit, keyOf, dailyCap, dayAgo } from './limits.js';
import { cleanText, tooLong, fold } from './text.js';
import { mediaRefsByIds, mediaUrl, thumbUrl, unlinkMedia } from './media.js';
import { usersByIds, userCardOf, uniShortOf, friendCount, BADGES, badgeOf } from './users.js';
import { postOut, deletePost, viewerOf } from './posts.js';
import { canSeeInstant, instantById, deleteInstantRows } from './instant-access.js';
import { forfeitAll } from './game-db.js';
import { closeStreams, publishDuels } from './game-stream.js';

const INSTANT_GONE = 'Момент недоступен';

/**
 * Запись в журнал (таблица audit). Без текста публикаций, почты, IP и токенов — только id и коды.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number|null} actorId  кто сделал (null — система)
 * @param {string} action        'account.delete' | 'profile.username' | 'post.hide.auto' | …
 * @param {string|null} target   'p:123' | 'u:45'
 * @param {string|null} uni
 * @param {object} info
 */
export function audit(db, actorId, action, target = null, uni = null, info = {}) {
  db.prepare('INSERT INTO audit (ts, actor_id, action, target, uni, info) VALUES (?,?,?,?,?,?)')
    .run(nowIso(), actorId ?? null, action, target, uni, JSON.stringify(info || {}));
}

/** Закрыть открытые жалобы на цель ('dismissed' | 'actioned'). У поста счётчик учитываемых жалоб обнуляется. */
export function resolveReports(db, key, status, adminId) {
  const n = db.prepare(`UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE target_key = ? AND status = 'open'`)
    .run(status, nowIso(), adminId, key).changes;
  const m = /^p:(\d+)$/.exec(key);
  if (m) db.prepare('UPDATE posts SET report_count = 0 WHERE id = ?').run(Number(m[1]));
  return n;
}

export const REASONS = ['spam', 'abuse', 'sexual', 'violence', 'privacy', 'scam', 'impersonation', 'child', 'other'];
const SEVERE = ['sexual', 'violence', 'privacy', 'child'];
const SEVERE_SQL = `('sexual','violence','privacy','child')`;

const REPORT_TEXT = {
  reason: 'Выбери причину жалобы',
  note: 'Комментарий к жалобе — не больше 300 символов',
  noteNeeded: 'Опиши, что случилось',
  self: 'Нельзя пожаловаться на себя',
  banReason: 'Укажи причину',
};

const ACTIONS = ['dismiss', 'hide', 'unhide', 'delete', 'ban', 'unban', 'reset', 'badge'];
const RESET_FIELDS = ['avatar', 'bio', 'links', 'name'];
const CASE_PAGE = 30;
const AUDIT_PAGE = 50;

/** Начало сегодняшнего дня по Ташкенту (UTC+5, без перехода на летнее время), ISO. */
function tashkentDayStart(now = Date.now()) {
  const d = new Date(now + 5 * HOUR);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 5 * HOUR).toISOString();
}

const parseJson = (s, def) => { try { return JSON.parse(s); } catch { return def; } };

/**
 * Жалобы (#32) и маршруты модератора (#33–#36).
 * @param {import('fastify').FastifyInstance} inst
 * @param {{ db: import('node:sqlite').DatabaseSync }} ctx
 */
export function adminRoutes(inst, ctx) {
  const db = ctx.db;
  const getPost = db.prepare('SELECT * FROM posts WHERE id = ?');
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const blockRow = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?');
  /** Автор (или человек) заблокировал зрителя. */
  const blockedMe = (authorId, meId) => !!authorId && !!blockRow.get(authorId, meId);
  /** Живой пост виден жалобщику: не скрыт, автор не ограничен и не заблокировал его (как V1–V3, но без «я → автор»). */
  const reportable = (me, p) => {
    if (!p || p.deleted_at) return false;
    if (p.author_id === me.id) return true;
    if (p.hidden) return false;
    const a = p.author_id ? getUser.get(p.author_id) : null;
    if (!a || a.status !== 'active') return false;
    return !blockedMe(a.id, me.id);
  };

  // ─── #32 жалоба (гостям нельзя; при ограничении и в readonly — можно) ───
  const reportStat = db.prepare('SELECT COUNT(*) n, MIN(created_at) first FROM reports WHERE reporter_id = ? AND created_at > ?');
  inst.post('/api/social/reports', async (req) => {
    const me = guard(req, 'S');
    const b = bodyOf(req);
    if (b.target !== 'post' && b.target !== 'user' && b.target !== 'instant') throw invalid(TEXT.invalid, 'target');
    const id = intField(b.id, 'id');
    if (!REASONS.includes(b.reason)) throw invalid(REPORT_TEXT.reason, 'reason');
    if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') throw invalid(REPORT_TEXT.note, 'note');
    const note = cleanText(b.note ?? '', { multiline: false });
    if (tooLong(note, 300)) throw invalid(REPORT_TEXT.note, 'note');
    if (b.reason === 'other' && !note) throw invalid(REPORT_TEXT.noteNeeded, 'note');

    const admin = isAdmin(me);
    let post = null;
    let target = null;
    let instant = null;
    if (b.target === 'post') {
      post = getPost.get(id);
      if (!post || post.deleted_at) throw notFound(TEXT.postGone);
      if (post.author_id === me.id) throw invalid(REPORT_TEXT.self);
    } else if (b.target === 'instant') {
      // Момент: пожаловаться можно, только пока он виден (друг автора, сутки) — или модератору.
      instant = instantById(db, id);
      if (!instant) throw notFound(INSTANT_GONE);
      if (instant.author_id === me.id) throw invalid(REPORT_TEXT.self);
      if (!canSeeInstant(db, me, instant, instant.author_status)) throw notFound(INSTANT_GONE);
    } else {
      if (id === me.id) throw invalid(REPORT_TEXT.self);
      target = getUser.get(id);
      if (!target || !target.username) throw notFound(TEXT.profileGone);
    }
    const key = (post ? 'p:' : instant ? 'i:' : 'u:') + id;
    const hiddenNow = () => (post ? !!getPost.get(id).hidden
      : instant ? !!Number((instantById(db, id) || { hidden: 1 }).hidden) : false);
    // Повтор своей же жалобы — тот же ответ (жалоба была подана, когда цель была видна).
    if (db.prepare('SELECT 1 FROM reports WHERE reporter_id = ? AND target_key = ?').get(me.id, key)) {
      return ok({ reported: true, hidden: hiddenNow() });
    }
    // Пожаловаться можно только на то, что видно (иначе по номерам можно выяснять, что скрыто модератором,
    // а заблокированный автором — продолжать жаловаться на его посты). Своя блокировка автора не мешает:
    // сначала жалуются, потом блокируют (или наоборот).
    if (!admin) {
      if (post) {
        if (!reportable(me, post)) throw notFound(TEXT.postGone);
        if (post.root_id) {
          const root = getPost.get(post.root_id);
          if (!root || (!root.deleted_at && !reportable(me, root))) throw notFound(TEXT.postGone);
        }
      } else if (target && (target.status !== 'active' || blockedMe(target.id, me.id))) {
        throw notFound(TEXT.profileGone);
      }
    }

    limit('report', 'u:' + me.id);
    dailyCap('report', me, reportStat.get(me.id, dayAgo()));

    const hidden = tx(db, () => {
      const now = nowIso();
      const oldEnough = Date.parse(me.created_at) <= Date.now() - social.reporterMinAgeH * HOUR;
      const childBurned = b.reason === 'child'
        && !!db.prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND reason = 'child' AND status = 'dismissed' LIMIT 1").get(me.id);
      // «Угроза ребёнку» учитывается и от аккаунта младше суток: одной такой жалобы достаточно (policy, rules,
      // ответ Play о защите детей). От злоупотреблений — правило «сгоревшего» жалобщика: если модератор
      // хоть раз отклонил его жалобу «Угроза ребёнку», такие жалобы больше не скрывают сами.
      const counted = admin ? 1 : b.reason === 'child' ? (childBurned ? 0 : 1) : (oldEnough ? 1 : 0);

      let snapshot;
      if (post) {
        const author = post.author_id ? getUser.get(post.author_id) : null;
        const media = db.prepare('SELECT id FROM media WHERE post_id = ? ORDER BY position').all(post.id).map((m) => m.id);
        snapshot = {
          kind: post.root_id ? 'reply' : 'post', rootId: post.root_id ?? null, text: post.text, name: null,
          username: author ? author.username : null, media, mediaCount: post.media_count, at: now,
        };
      } else if (instant) {
        const author = getUser.get(instant.author_id);
        snapshot = {
          kind: 'instant', rootId: null, text: '', name: author ? author.name : null,
          username: author ? author.username : null, media: [instant.media_id], mediaCount: 1, at: now,
        };
      } else {
        snapshot = {
          kind: 'user', rootId: null, text: target.bio, name: target.name, username: target.username,
          media: target.avatar_id ? [target.avatar_id] : [], mediaCount: target.avatar_id ? 1 : 0, at: now,
        };
      }
      db.prepare(`INSERT OR IGNORE INTO reports (reporter_id, target_key, post_id, user_id, uni, reason, note, snapshot, counts, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        me.id, key, post ? post.id : null, post ? post.author_id : instant ? instant.author_id : target.id,
        post ? post.uni : instant ? instant.uni : (req.tenant ? req.tenant.id : target.uni || null),
        b.reason, note, JSON.stringify(snapshot), counted, now);

      if (instant) {
        // Момент скрывается у всех (кроме автора и модератора) по тем же правилам, что пост.
        const st = db.prepare(`SELECT COUNT(*) n, SUM(reason = 'child') child, SUM(reason IN ${SEVERE_SQL}) severe
          FROM reports WHERE target_key = ? AND status = 'open' AND counts = 1`).get(key);
        const hide = admin || Number(st.child) >= 1 || Number(st.severe) >= 2 || st.n >= social.reportThreshold;
        if (hide) db.prepare('UPDATE instants SET hidden = 1 WHERE id = ?').run(instant.id);
        return hide || !!Number(instant.hidden);
      }
      if (!post) return false;
      const stat = db.prepare(`SELECT COUNT(*) n,
          SUM(reason = 'child') child,
          SUM(reason IN ${SEVERE_SQL}) severe
        FROM reports WHERE target_key = ? AND status = 'open' AND counts = 1`).get(key);
      db.prepare('UPDATE posts SET report_count = ? WHERE id = ?').run(stat.n, post.id);
      const cur = getPost.get(post.id);
      if (cur.hidden) return true;
      const hide = admin || Number(stat.child) >= 1 || Number(stat.severe) >= 2
        || stat.n >= social.reportThreshold;
      if (!hide) return false;
      db.prepare("UPDATE posts SET hidden = 1, hidden_reason = 'reports' WHERE id = ?").run(post.id);
      audit(db, null, 'post.hide.auto', key, post.uni, { reporters: stat.n });
      return true;
    });
    return ok({ reported: true, hidden });
  });

  // ─── #33 очередь жалоб ───
  const caseSql = (open) => db.prepare(`
    SELECT target_key AS key,
      SUM(status = 'open') AS open_n,
      SUM(status = 'open' AND counts = 1) AS counted,
      MAX(status = 'open' AND reason IN ${SEVERE_SQL}) AS severe,
      MIN(created_at) AS first_at, MAX(created_at) AS last_at, MAX(resolved_at) AS resolved_at
    FROM reports GROUP BY target_key
    HAVING ${open ? 'open_n > 0' : 'open_n = 0'}
    ORDER BY ${open
      ? "severe DESC, (target_key LIKE 'u:%' AND open_n >= 5) DESC, counted DESC, last_at DESC"
      : 'resolved_at DESC, last_at DESC'}
    LIMIT ? OFFSET ?`);
  const openCases = caseSql(true);
  const closedCases = caseSql(false);
  const caseReports = db.prepare('SELECT * FROM reports WHERE target_key = ? ORDER BY id');

  /** Цель-человек или автор поста — для модератора (исходные имя и «О себе»). */
  const adminUser = (uid) => {
    const u = uid ? getUser.get(uid) : null;
    if (!u) return null;
    const card = usersByIds(db, [u.id]).get(u.id);
    return {
      ...userCardOf(ctx, card, false),
      username: u.username || '',
      name: u.name,
      bio: u.bio,
      links: { tg: u.tg || '', ig: u.ig || '' },
      avatarFull: u.avatar_id ? mediaUrl(u.avatar_id) : null,
      status: u.status,
      banned: banOf(u),
      createdAt: u.created_at,
      openReports: db.prepare("SELECT COUNT(*) n FROM reports WHERE target_key = ? AND status = 'open'").get('u:' + u.id).n,
    };
  };

  const buildCase = (row, v) => {
    const [type, rawId] = row.key.split(':');
    const id = Number(rawId);
    const open = row.open_n > 0;
    const all = caseReports.all(row.key);
    const set = open ? all.filter((r) => r.status === 'open') : all;
    const reasons = {};
    for (const r of set) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    const notes = set.filter((r) => r.note).slice(-10).reverse().map((r) => r.note);
    const first = all[0];
    const snap = parseJson(first.snapshot, null);
    const snapshot = snap && typeof snap === 'object' ? {
      kind: snap.kind || (type === 'u' ? 'user' : 'post'),
      rootId: snap.rootId ?? null,
      text: String(snap.text ?? ''),
      name: snap.name ?? null,
      username: snap.username ?? null,
      media: mediaRefsByIds(db, snap.media),
      mediaCount: Number(snap.mediaCount) || 0,
      at: snap.at || first.created_at,
    } : null;
    const postRow = type === 'p' ? getPost.get(id) : null;
    const post = postRow ? postOut(ctx, v, postRow, { raw: true }) : null;
    const lastResolved = all.filter((r) => r.resolved_at).sort((a, b) => (a.resolved_at < b.resolved_at ? 1 : -1))[0] || null;
    const resolver = !open && lastResolved && lastResolved.resolved_by ? getUser.get(lastResolved.resolved_by) : null;
    let uid = type === 'u' ? id : null;
    if (type === 'p') uid = postRow && postRow.author_id ? postRow.author_id : (all[all.length - 1].user_id ?? null);
    const instantRow = type === 'i' ? instantById(db, id) : null;
    if (type === 'i') uid = instantRow ? instantRow.author_id : (all[all.length - 1].user_id ?? null);
    return {
      key: row.key,
      target: { type: type === 'p' ? 'post' : type === 'i' ? 'instant' : 'user', id },
      status: open ? 'open' : (lastResolved ? lastResolved.status : 'dismissed'),
      post,
      snapshot,
      user: adminUser(uid),
      reasons,
      notes,
      reporters: set.length,
      severe: set.some((r) => SEVERE.includes(r.reason)),
      hidden: !!(postRow && postRow.hidden) || !!(instantRow && Number(instantRow.hidden)),
      gone: type === 'i' && !instantRow,
      firstAt: row.first_at,
      lastAt: row.last_at,
      resolvedAt: open ? null : row.resolved_at || null,
      resolvedBy: resolver && resolver.username ? '@' + resolver.username : null,
    };
  };

  inst.get('/api/social/admin/reports', async (req) => {
    const me = guard(req, 'SA');
    const q = req.query || {};
    const status = q.status === undefined || q.status === '' ? 'open' : q.status;
    if (status !== 'open' && status !== 'closed') throw invalid();
    const offset = cursorParam(q.cursor) ?? 0;
    limit('read', keyOf(req));
    const rows = (status === 'open' ? openCases : closedCases).all(CASE_PAGE + 1, offset);
    const page = rows.slice(0, CASE_PAGE);
    const v = viewerOf(me);
    return ok({
      items: page.map((r) => buildCase(r, v)),
      next: rows.length > CASE_PAGE ? String(offset + CASE_PAGE) : null,
    });
  });

  // ─── #34 действие модератора ───
  inst.post('/api/social/admin/action', async (req) => {
    const me = guard(req, 'SA');
    const b = bodyOf(req);
    if (!ACTIONS.includes(b.action)) throw invalid(TEXT.invalid, 'action');
    const t = b.target;
    if (!t || typeof t !== 'object' || !['post', 'user', 'instant'].includes(t.type)) throw invalid(TEXT.invalid, 'target');
    const id = intField(t.id, 'target');
    const action = b.action;
    // Момент: удалить, отклонить жалобы, действия с автором; скрывать/возвращать — только посты.
    if (['hide', 'unhide'].includes(action) && t.type !== 'post') throw invalid(TEXT.invalid, 'target');
    if (action === 'delete' && t.type === 'user') throw invalid(TEXT.invalid, 'target');

    let days = null;
    let reason = '';
    let fields = [];
    if (action === 'ban') {
      if (![1, 7, 30, null].includes(b.days)) throw invalid(TEXT.invalid, 'days');
      days = b.days;
      reason = typeof b.reason === 'string' ? cleanText(b.reason, { multiline: false }) : '';
      if (!reason || tooLong(reason, 200)) throw invalid(REPORT_TEXT.banReason, 'reason');
      if (b.hidePosts !== undefined && typeof b.hidePosts !== 'boolean') throw invalid(TEXT.invalid, 'hidePosts');
    }
    // Значок у имени: один из BADGES или null — убрать. Выдаётся и себе (модератору), и автору поста/момента.
    const badge = action === 'badge' ? (b.badge === null ? null : BADGES.includes(b.badge) ? b.badge : undefined) : null;
    if (badge === undefined) throw invalid(TEXT.invalid, 'badge');
    if (action === 'reset') {
      if (!Array.isArray(b.fields) || !b.fields.length || b.fields.some((f) => !RESET_FIELDS.includes(f))) {
        throw invalid(TEXT.invalid, 'fields');
      }
      fields = [...new Set(b.fields)];
    }

    // Цель: пост (для hide/unhide/delete/dismiss) и человек (для ban/unban/reset — сам или автор поста).
    const post = t.type === 'post' ? getPost.get(id) : null;
    const instant = t.type === 'instant' ? instantById(db, id) : null;
    const userAction = ['ban', 'unban', 'reset', 'badge'].includes(action);
    // Пост удалён (надгробие) или его строки уже нет (автор удалил ответ без ответов): hide/unhide/delete — 404;
    // dismiss закрывает жалобы, а ban/unban/reset действуют на автора из жалоб (reports.user_id).
    const lastReport = (t.type === 'post' && (!post || post.deleted_at)) || (t.type === 'instant' && !instant)
      ? db.prepare('SELECT user_id FROM reports WHERE target_key = ? ORDER BY id DESC LIMIT 1').get((t.type === 'post' ? 'p:' : 'i:') + id)
      : null;
    if (t.type === 'instant' && !instant && !lastReport) throw notFound(INSTANT_GONE);
    if (t.type === 'instant' && !instant && action === 'delete') throw notFound(INSTANT_GONE);
    if (t.type === 'post' && !post && !lastReport) throw notFound(TEXT.postGone);
    if (t.type === 'post' && (!post || post.deleted_at) && action !== 'dismiss' && !userAction) throw notFound(TEXT.postGone);
    let user = null;
    if (userAction) {
      const uid = t.type === 'user' ? id
        : (post && post.author_id) || (instant && instant.author_id) || (lastReport && lastReport.user_id) || null;
      user = uid ? getUser.get(uid) : null;
      if (!user) throw notFound(TEXT.profileGone);
      if (action === 'ban' && isAdmin(user)) throw forbidden();
    }
    if (t.type === 'user' && action === 'dismiss' && !getUser.get(id)
      && !db.prepare('SELECT 1 FROM reports WHERE target_key = ?').get('u:' + id)) {
      throw notFound(TEXT.profileGone);
    }

    limit('admin', 'u:' + me.id);
    const key = (t.type === 'post' ? 'p:' : t.type === 'instant' ? 'i:' : 'u:') + id;
    const uni = post ? post.uni : instant ? instant.uni : null;
    let files = [];
    let duels = [];   // игры «Код», которые закончил бан
    tx(db, () => {
      if (action === 'dismiss') {
        resolveReports(db, key, 'dismissed', me.id);
        if (post && post.hidden && post.hidden_reason === 'reports') {
          db.prepare('UPDATE posts SET hidden = 0, hidden_reason = NULL, report_count = 0 WHERE id = ?').run(post.id);
        }
        if (instant && Number(instant.hidden)) db.prepare('UPDATE instants SET hidden = 0 WHERE id = ?').run(instant.id);
        audit(db, me.id, 'report.dismiss', key, uni, {});
      } else if (action === 'hide') {
        db.prepare("UPDATE posts SET hidden = 1, hidden_reason = 'admin' WHERE id = ?").run(post.id);
        resolveReports(db, key, 'actioned', me.id);
        audit(db, me.id, 'post.hide.admin', key, uni, {});
      } else if (action === 'unhide') {
        db.prepare('UPDATE posts SET hidden = 0, hidden_reason = NULL, report_count = 0 WHERE id = ?').run(post.id);
        resolveReports(db, key, 'dismissed', me.id);
        audit(db, me.id, 'post.unhide', key, uni, {});
      } else if (action === 'delete' && instant) {
        files = deleteInstantRows(db, instant);
        resolveReports(db, key, 'actioned', me.id);
        audit(db, me.id, 'instant.delete', key, uni, {});
      } else if (action === 'delete') {
        files = deletePost(db, post, 'admin');
        resolveReports(db, key, 'actioned', me.id);
        audit(db, me.id, 'post.delete', key, uni, { reply: !!post.root_id });
      } else if (action === 'ban') {
        db.prepare("UPDATE users SET status = 'banned', banned_until = ?, ban_reason = ? WHERE id = ?")
          .run(days ? nowIso(Date.now() + days * DAY) : null, reason, user.id);
        if (b.hidePosts === true) {
          db.prepare(`UPDATE posts SET hidden = 1, hidden_reason = 'admin'
            WHERE author_id = ? AND deleted_at IS NULL AND hidden = 0`).run(user.id);
        }
        resolveReports(db, 'u:' + user.id, 'actioned', me.id);
        if (t.type === 'post' || t.type === 'instant') resolveReports(db, key, 'actioned', me.id);
        // Игры «Код»: идущие — поражение («сдался»), открытые вызовы — отменены.
        duels = forfeitAll(db, user.id, 'banned');
        audit(db, me.id, 'user.ban', 'u:' + user.id, uni, { days, reason, hidePosts: b.hidePosts === true });
      } else if (action === 'unban') {
        db.prepare("UPDATE users SET status = 'active', banned_until = NULL, ban_reason = '' WHERE id = ?").run(user.id);
        audit(db, me.id, 'user.unban', 'u:' + user.id, uni, {});
      } else if (action === 'reset') {
        const set = [];
        const vals = [];
        if (fields.includes('name')) { set.push('name = ?', 'name_fold = ?'); vals.push('Пользователь', 'пользователь'); }
        if (fields.includes('bio')) { set.push("bio = ''"); }
        if (fields.includes('links')) { set.push("tg = ''", "ig = ''"); }
        if (fields.includes('avatar') && user.avatar_id) {
          set.push('avatar_id = NULL');
          files = [{ id: user.avatar_id }];
        }
        if (set.length) db.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?`).run(...vals, user.id);
        if (files.length) db.prepare('DELETE FROM media WHERE id = ?').run(user.avatar_id);
        resolveReports(db, 'u:' + user.id, 'actioned', me.id);
        audit(db, me.id, 'user.reset', 'u:' + user.id, uni, { fields });
      } else if (action === 'badge') {
        db.prepare('UPDATE users SET badge = ? WHERE id = ?').run(badge, user.id);
        audit(db, me.id, 'user.badge', 'u:' + user.id, uni, { badge });
      }
    });
    unlinkMedia(files);
    if (action === 'ban') {
      closeStreams(user.id, 'ban');
      publishDuels(ctx, duels);
    }
    return ok(null);
  });

  // ─── #35 сводка ───
  inst.get('/api/social/admin/stats', async (req) => {
    guard(req, 'SA');
    limit('read', keyOf(req));
    const start = tashkentDayStart();
    const n = (sql, ...args) => Number(db.prepare(sql).get(...args).n) || 0;
    return ok({
      users: n('SELECT COUNT(*) n FROM users'),
      usersToday: n('SELECT COUNT(*) n FROM users WHERE created_at >= ?', start),
      postsToday: n('SELECT COUNT(*) n FROM posts WHERE root_id IS NULL AND created_at >= ?', start),
      repliesToday: n('SELECT COUNT(*) n FROM posts WHERE root_id IS NOT NULL AND created_at >= ?', start),
      openReports: n("SELECT COUNT(DISTINCT target_key) n FROM reports WHERE status = 'open'"),
      hiddenPosts: n('SELECT COUNT(*) n FROM posts WHERE hidden = 1 AND deleted_at IS NULL'),
      bannedUsers: n("SELECT COUNT(*) n FROM users WHERE status = 'banned'"),
      mediaBytes: n('SELECT COALESCE(SUM(bytes + thumb_bytes), 0) n FROM media'),
    });
  });

  // ─── #37 пользователи: список со сводкой (только модераторам) ───
  // Всё, что Para знает об аккаунте, кроме Google ID, списка друзей и того, кто на кого жаловался
  // (политика, «Модерация»): почта, данные Google, возрастная группа, где и с какого устройства
  // завели аккаунт, входы и устройства. Имя — как написано (модератор видит без маскировки).
  // ?q= — поиск по имени, @имени и почте; страницы по 30, новые сверху.
  const USERS_PAGE = 30;
  const USER_COLS = `u.id, u.username, u.name, u.avatar_id, u.uni, u.email, u.email_verified, u.status,
    u.banned_until, u.ban_reason, u.created_at, u.rules_version, u.rules_at, u.age_group, u.bio, u.tg, u.ig,
    u.google_name, u.google_locale, u.google_hd, u.google_picture, u.signup_host, u.signup_device,
    u.last_login_at, u.login_count, u.badge, m.thumb_bytes AS av_thumb,
    (SELECT MAX(s.seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
    (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > $now) AS n_sessions,
    (SELECT GROUP_CONCAT(DISTINCT s.device) FROM sessions s WHERE s.user_id = u.id AND s.device != '') AS devices,
    (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.root_id IS NULL AND p.deleted_at IS NULL) AS n_posts,
    (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.root_id IS NOT NULL AND p.deleted_at IS NULL) AS n_replies,
    (SELECT COALESCE(SUM(p.like_count), 0) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS n_likes,
    (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id AND r.status = 'open') AS rep_open,
    (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id) AS rep_all`;
  const usersAll = db.prepare(`SELECT ${USER_COLS} FROM users u LEFT JOIN media m ON m.id = u.avatar_id
    WHERE u.id < $cursor ORDER BY u.id DESC LIMIT $lim`);
  const usersFound = db.prepare(`SELECT ${USER_COLS} FROM users u LEFT JOIN media m ON m.id = u.avatar_id
    WHERE u.id < $cursor AND (u.name_fold LIKE $like ESCAPE '\\' OR u.username LIKE $prefix ESCAPE '\\'
      OR u.email LIKE $like ESCAPE '\\') ORDER BY u.id DESC LIMIT $lim`);
  const likeEsc = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);
  inst.get('/api/social/admin/users', async (req) => {
    guard(req, 'SA');
    const q0 = (req.query || {}).q;
    const q = fold(cleanText(typeof q0 === 'string' ? q0 : '', { multiline: false })).replace(/^@/, '').slice(0, 40);
    const cursor = cursorParam((req.query || {}).cursor);
    limit('read', keyOf(req));
    const params = { $cursor: cursor ?? 9e15, $lim: USERS_PAGE + 1, $now: nowIso() };
    const rows = q
      ? usersFound.all({ ...params, $like: `%${likeEsc(q)}%`, $prefix: `${likeEsc(q)}%` })
      : usersAll.all(params);
    const page = rows.slice(0, USERS_PAGE);
    const items = page.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      avatar: u.avatar_id ? thumbUrl(u.avatar_id, u.av_thumb) : null,
      uni: u.uni || null,
      uniShort: uniShortOf(ctx, u.uni),
      createdAt: u.created_at,
      team: isAdmin(u),
      badge: badgeOf(u),
      rulesAccepted: Number(u.rules_version) === social.rulesVersion,
      banned: banOf(u),
      counts: { posts: u.n_posts, replies: u.n_replies, likes: u.n_likes, friends: friendCount(db, u.id) },
      reports: { open: u.rep_open, total: u.rep_all },
      // Только для админки:
      email: u.email,
      emailVerified: Number(u.email_verified) === 1,
      age: u.age_group,
      bio: u.bio || '',
      links: { tg: u.tg || '', ig: u.ig || '' },
      google: { name: u.google_name || '', locale: u.google_locale || '', domain: u.google_hd || '', picture: u.google_picture || '' },
      signup: { host: u.signup_host || '', device: u.signup_device || '' },
      rulesAt: u.rules_at || null,
      lastLoginAt: u.last_login_at || null,
      loginCount: Number(u.login_count) || 0,
      lastSeen: u.last_seen || null,
      sessions: Number(u.n_sessions) || 0,
      devices: u.devices ? String(u.devices).split(',').filter(Boolean) : [],
    }));
    // Сводка — с первой страницей общего списка. «Заходили за неделю» — только число, без имён.
    let stats = null;
    if (!q && cursor === null) {
      const n = (sql, ...args) => Number(db.prepare(sql).get(...args).n) || 0;
      stats = {
        total: n('SELECT COUNT(*) n FROM users'),
        today: n('SELECT COUNT(*) n FROM users WHERE created_at >= ?', tashkentDayStart()),
        week: n('SELECT COUNT(*) n FROM users WHERE created_at >= ?', nowIso(Date.now() - 7 * DAY)),
        active: n('SELECT COUNT(DISTINCT user_id) n FROM sessions WHERE seen_at >= ?', today(Date.now() - 7 * DAY)),
        noProfile: n('SELECT COUNT(*) n FROM users WHERE username IS NULL'),
        banned: n("SELECT COUNT(*) n FROM users WHERE status = 'banned'"),
      };
    }
    return ok({ items, next: rows.length > USERS_PAGE ? String(page[page.length - 1].id) : null, stats });
  });

  // ─── #36 журнал ───
  const auditRows = db.prepare(`SELECT a.*, u.username AS actor_username FROM audit a
    LEFT JOIN users u ON u.id = a.actor_id WHERE a.id < ? ORDER BY a.id DESC LIMIT ?`);
  inst.get('/api/social/admin/audit', async (req) => {
    guard(req, 'SA');
    const cursor = cursorParam((req.query || {}).cursor);
    limit('read', keyOf(req));
    const rows = auditRows.all(cursor ?? 9e15, AUDIT_PAGE + 1);
    const page = rows.slice(0, AUDIT_PAGE);
    return ok({
      items: page.map((a) => ({
        id: a.id,
        ts: a.ts,
        actor: a.actor_id === null ? null : { id: a.actor_id, username: a.actor_username ?? null },
        action: a.action,
        target: a.target ?? null,
        uni: a.uni ?? null,
        info: parseJson(a.info, {}),
      })),
      next: rows.length > AUDIT_PAGE ? String(page[page.length - 1].id) : null,
    });
  });
}
