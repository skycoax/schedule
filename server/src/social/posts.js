// Лента, ветки, публикации, ответы и лайки (CONTRACT.md §B.5 #6–#12), удаление постов и аккаунта (§C.4).
// Видимость (V1–V7) — в SQL, а не на клиенте. Зритель-гость = id 0.
import { social } from '../config.js';
import { tx, nowIso, DAY } from './db.js';
import {
  ok, invalid, notFound, blocked, forbidden, guard, isAdmin, bodyOf, TEXT, postIdParam, cursorParam, limitParam, intField,
  marks, sha256hex,
} from './http.js';
import { limit, keyOf, dailyCap, dayAgo, isNewAccount } from './limits.js';
import { cleanText, tooLong, lineCount, countLinks, maskProfanity } from './text.js';
import { usersByIds, userCardOf, uniShortOf } from './users.js';
import { mediaByPost, unlinkMedia, MEDIA_ID_RE } from './media.js';
import { audit, resolveReports } from './moderation.js';

export const CATEGORY_IDS = ['study', 'schedule', 'events', 'company', 'lost', 'other'];

const POST_TEXT = {
  long: 'Слишком длинный текст — максимум 1000 символов',
  empty: 'Напиши текст или добавь фото',
  links: 'Не больше 3 ссылок в одном сообщении',
  newLinks: 'Ссылки можно добавлять через сутки после регистрации',
  dup: 'Такое сообщение уже отправлено',
  category: 'Выбери тему',
  media4: 'Можно прикрепить не больше 4 фото',
  media1: 'К ответу можно прикрепить одно фото',
  company: 'В теме «Компания» — только текст',
  mediaGone: 'Фото не найдено — загрузи его ещё раз',
  thread: 'В этой ветке уже слишком много ответов',
  replyBlocked: 'Нельзя ответить на эту публикацию',
};

const FEED_PAGE = 20;
const THREAD_PAGE = 50;
const MAX_REPLIES = 1000;

/** Зритель запроса: { id (0 — гость), admin (0|1), guest, user }. */
export function viewerOf(user) {
  return { id: user ? user.id : 0, admin: isAdmin(user) ? 1 : 0, guest: !user, user: user || null };
}

// Условие «автор виден зрителю»: V1 (бан), V3 (блокировка в любую сторону). Модератору и автору видно всё.
const AUTHOR_OK = `(a.status = 'active' AND NOT EXISTS (SELECT 1 FROM blocks b
    WHERE (b.blocker_id = $me AND b.blocked_id = a.id) OR (b.blocker_id = a.id AND b.blocked_id = $me)))`;

/**
 * Виден ли живой пост (или ответ) зрителю: не удалён; скрытые (V2) и посты заблокированных авторов (V1)
 * видят только автор и модераторы; блокировка в любую сторону (V3) — модераторам не мешает.
 */
export function rowVisible(db, v, p) {
  if (!p || p.deleted_at) return false;
  if (v.admin || (v.id && p.author_id === v.id)) return true;
  if (p.hidden) return false;
  const a = p.author_id ? db.prepare('SELECT status FROM users WHERE id = ?').get(p.author_id) : null;
  if (!a || a.status !== 'active') return false;
  if (!v.id) return true;
  return !db.prepare(`SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
    .get(v.id, p.author_id, p.author_id, v.id);
}

/** Ветка доступна: публикация-«надгробие» (V5) доступна всем, живая — по rowVisible. */
const threadOpen = (db, v, root) => !!root && !root.root_id && (!!root.deleted_at || rowVisible(db, v, root));

// ─── Сборка Post (types.ts) ───

/**
 * Post[] из строк posts. Одним запросом на каждое: авторы, фото, лайки, жалобы зрителя, адресаты ответов.
 * raw — для модератора: добавляет rawText (исходный текст без маскировки).
 */
export function postsOut(ctx, v, rows, { raw = false } = {}) {
  if (!rows.length) return [];
  const db = ctx.db;
  const live = rows.filter((p) => !p.deleted_at);
  const authors = usersByIds(db, live.map((p) => p.author_id).filter(Boolean));
  const media = mediaByPost(db, live.filter((p) => p.media_count > 0).map((p) => p.id));
  const ids = rows.map((p) => p.id);
  const liked = new Set(v.id
    ? db.prepare(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${marks(ids)})`).all(v.id, ...ids).map((r) => r.post_id)
    : []);
  const keys = ids.map((id) => 'p:' + id);
  const reported = new Set(v.id
    ? db.prepare(`SELECT target_key FROM reports WHERE reporter_id = ? AND target_key IN (${marks(keys)})`).all(v.id, ...keys)
      .map((r) => r.target_key)
    : []);

  // «в ответ @имя»: имя только если адресат жив и виден зрителю, иначе null («в ответ на удалённое сообщение»).
  const parentIds = [...new Set(rows.map((p) => p.parent_id).filter(Boolean))];
  const parentName = new Map();
  if (parentIds.length) {
    const ps = db.prepare(`SELECT p.id, p.hidden, p.deleted_at, u.id AS uid, u.username, u.status FROM posts p
      LEFT JOIN users u ON u.id = p.author_id WHERE p.id IN (${marks(parentIds)})`).all(...parentIds);
    const blockedIds = v.id && !v.admin ? new Set(db.prepare(`SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?
      UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?`).all(v.id, v.id).map((r) => r.id)) : new Set();
    for (const p of ps) {
      const mine = v.id && p.uid === v.id;
      const okName = !p.deleted_at && p.uid && p.username
        && (v.admin || mine || (!p.hidden && p.status === 'active' && !blockedIds.has(p.uid)));
      parentName.set(p.id, okName ? p.username : null);
    }
  }

  return rows.map((p) => {
    const deleted = !!p.deleted_at;
    const a = deleted ? null : authors.get(p.author_id) || null;
    const mine = !!v.id && p.author_id === v.id;
    const out = {
      id: p.id,
      uni: p.uni,
      uniShort: uniShortOf(ctx, p.uni),
      rootId: p.root_id ?? null,
      category: p.category ?? null,
      replyTo: p.parent_id ? { id: p.parent_id, username: parentName.get(p.parent_id) ?? null } : null,
      author: a && a.username ? userCardOf(ctx, a, v.guest) : null,
      text: deleted ? '' : maskProfanity(p.text),
      media: deleted ? [] : media.get(p.id) || [],
      likes: deleted ? 0 : p.like_count,
      liked: liked.has(p.id),
      replies: p.root_id ? 0 : p.reply_count,
      createdAt: p.created_at,
      deleted,
      hidden: !deleted && !!p.hidden,
      mine,
      canDelete: !deleted && (mine || !!v.admin),
      reported: reported.has('p:' + p.id),
    };
    if (raw) out.rawText = deleted ? '' : p.text;
    return out;
  });
}

export const postOut = (ctx, v, row, opts) => postsOut(ctx, v, [row], opts)[0];

// ─── Удаление (§C.4) ───

const mediaOf = (db, postId) => db.prepare('SELECT id, thumb_bytes FROM media WHERE post_id = ?').all(postId);

/** «Надгробие»: текст, автор, фото и лайки убираются, строка остаётся (на неё отвечали). */
function tombstone(db, id, by, now) {
  db.prepare(`UPDATE posts SET text = '', author_id = NULL, media_count = 0, like_count = 0, hidden = 0,
    deleted_at = ?, deleted_by = ? WHERE id = ?`).run(now, by, id);
  db.prepare('DELETE FROM media WHERE post_id = ?').run(id);
  db.prepare('DELETE FROM likes WHERE post_id = ?').run(id);
}

/** Ответ-«надгробие», на который больше никто не ссылается, удаляется совсем — и так вверх по цепочке. */
function pruneReplyTombstones(db, id) {
  let cur = id;
  for (let i = 0; cur && i < MAX_REPLIES; i++) {
    const r = db.prepare('SELECT id, root_id, parent_id, deleted_at FROM posts WHERE id = ?').get(cur);
    if (!r || !r.root_id || !r.deleted_at) return;
    if (db.prepare('SELECT 1 FROM posts WHERE parent_id = ? LIMIT 1').get(r.id)) return;
    db.prepare('DELETE FROM posts WHERE id = ?').run(r.id);
    cur = r.parent_id;
  }
}

/**
 * Удалить пост или ответ (внутри tx). Ответ: есть живые ответы на него — «надгробие», иначе совсем;
 * reply_count публикации −1. Публикация: есть живые ответы — «надгробие», иначе совсем (каскад).
 * Жалобы не удаляются (у них снимок). Возвращает файлы фото — удалить после COMMIT.
 * @param {'self'|'admin'|'account'} by
 */
export function deletePost(db, p, by) {
  const now = nowIso();
  if (p.root_id) {
    const files = mediaOf(db, p.id);
    if (db.prepare('SELECT 1 FROM posts WHERE parent_id = ? AND deleted_at IS NULL LIMIT 1').get(p.id)) {
      tombstone(db, p.id, by, now);
    } else {
      db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
      pruneReplyTombstones(db, p.parent_id);
    }
    db.prepare('UPDATE posts SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?').run(p.root_id);
    return files;
  }
  if (db.prepare('SELECT 1 FROM posts WHERE root_id = ? AND deleted_at IS NULL LIMIT 1').get(p.id)) {
    const files = mediaOf(db, p.id);
    tombstone(db, p.id, by, now);
    return files;
  }
  const files = db.prepare('SELECT id, thumb_bytes FROM media WHERE post_id = ? OR post_id IN (SELECT id FROM posts WHERE root_id = ?)')
    .all(p.id, p.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
  return files;
}

/**
 * Удалить аккаунт целиком (§C.4 deleteAccount): лайки, ответы, публикации, отпечаток бана, удержание @имени,
 * строка users (каскад: сессии, фото, друзья, блокировки; жалобщик обезличивается), свои записи журнала.
 * Файлы — после COMMIT.
 */
export function deleteAccount(ctx, u) {
  const db = ctx.db;
  const files = tx(db, () => {
    const now = nowIso();
    const out = db.prepare('SELECT id, thumb_bytes FROM media WHERE owner_id = ?').all(u.id);
    db.prepare('UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id IN (SELECT post_id FROM likes WHERE user_id = ?)')
      .run(u.id);
    db.prepare('DELETE FROM likes WHERE user_id = ?').run(u.id);
    const get = db.prepare('SELECT * FROM posts WHERE id = ?');
    const mine = (roots) => db.prepare(`SELECT id FROM posts WHERE author_id = ? AND deleted_at IS NULL
      AND root_id IS ${roots ? '' : 'NOT '}NULL ORDER BY id`).all(u.id);
    for (const roots of [false, true]) {
      for (const { id } of mine(roots)) {
        const p = get.get(id);
        if (p && !p.deleted_at) out.push(...deletePost(db, p, 'account'));
      }
    }
    if (u.status === 'banned' && (!u.banned_until || u.banned_until > now)) {
      db.prepare('INSERT OR REPLACE INTO ban_marks (sub_hash, until, reason, created_at) VALUES (?,?,?,?)')
        .run(sha256hex(social.salt + '|' + u.google_sub), u.banned_until || null, u.ban_reason || '', now);
    }
    if (u.username) {
      db.prepare('INSERT OR REPLACE INTO held_usernames (username, user_id, until) VALUES (?,NULL,?)')
        .run(u.username, nowIso(Date.now() + 30 * DAY));
    }
    db.prepare('UPDATE held_usernames SET user_id = NULL WHERE user_id = ?').run(u.id);
    const left = db.prepare('SELECT COUNT(*) n FROM posts WHERE author_id = ? AND deleted_at IS NULL').get(u.id).n;
    if (left) throw new Error('deleteAccount: остались живые посты');
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    // Записи журнала о самом человеке (смены @имени; auth.login — от ранних версий) уходят вместе
    // с аккаунтом. Остаются решения модераторов — без текстов, 180 дней.
    db.prepare(`DELETE FROM audit WHERE actor_id = ? AND action IN ('auth.login', 'profile.username')`)
      .run(u.id);
    audit(db, u.id, 'account.delete', 'u:' + u.id, null, {});
    return out;
  });
  unlinkMedia(files);
}

// ─── Ввод публикации и ответа (§B.4) ───

/**
 * Проверить тело NewPost / NewReply. Возвращает { text, category, media, replyTo }.
 * Порядок проверок: длина → тема → фото → пустота → ссылки.
 */
function readInput(b, me, { root, company }) {
  if (b.text !== undefined && typeof b.text !== 'string') throw invalid(TEXT.invalid, 'text');
  const text = cleanText(b.text ?? '', { maxLines: 100_000 });
  if (tooLong(text, 1000) || lineCount(text) > 30) throw invalid(POST_TEXT.long, 'text');

  let category = null;
  if (root) {
    if (!CATEGORY_IDS.includes(b.category)) throw invalid(POST_TEXT.category, 'category');
    category = b.category;
  }

  const raw = b.media === undefined || b.media === null ? [] : b.media;
  if (!Array.isArray(raw)) throw invalid(TEXT.invalid, 'media');
  const media = [...new Set(raw)];
  if (root && media.length > 4) throw invalid(POST_TEXT.media4, 'media');
  if (!root && media.length > 1) throw invalid(POST_TEXT.media1, 'media');
  if (media.some((id) => typeof id !== 'string' || !MEDIA_ID_RE.test(id))) throw invalid(POST_TEXT.mediaGone, 'media');
  if (media.length && (category === 'company' || company)) throw invalid(POST_TEXT.company, 'media');

  if (!text && !media.length) throw invalid(POST_TEXT.empty, 'text');
  const links = countLinks(text);
  if (links > 3) throw invalid(POST_TEXT.links, 'text');
  if (links > 0 && isNewAccount(me)) throw invalid(POST_TEXT.newLinks, 'text');

  let replyTo = null;
  if (!root && b.replyTo !== undefined && b.replyTo !== null) replyTo = intField(b.replyTo, 'replyTo');
  return { text, category, media, replyTo };
}

/** Прикрепить свои неотправленные фото (внутри tx); не вышло — откат с ошибкой поля. */
function attachMedia(db, postId, ownerId, media, now) {
  // Фото момента к посту не прикрепить: у него своя видимость (только друзья).
  const upd = db.prepare(`UPDATE media SET post_id = ?, position = ?, attached_at = ?
    WHERE id = ? AND owner_id = ? AND kind = 'post' AND post_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM instants i WHERE i.media_id = media.id)`);
  media.forEach((id, i) => {
    if (upd.run(postId, i, now, id, ownerId).changes !== 1) throw invalid(POST_TEXT.mediaGone, 'media');
  });
}

// ─── Маршруты ───

/**
 * @param {import('fastify').FastifyInstance} inst
 * @param {{ db: import('node:sqlite').DatabaseSync }} ctx
 */
export function postRoutes(inst, ctx) {
  const db = ctx.db;
  const getPost = db.prepare('SELECT * FROM posts WHERE id = ?');

  // Две выборки ленты: условия повторяют WHERE частичных индексов idx_posts_feed / idx_posts_feed_cat дословно.
  const feedWhere = `p.uni = $uni AND p.root_id IS NULL AND p.deleted_at IS NULL AND p.hidden = 0`;
  const feedTail = `AND p.id < $cursor AND ($admin = 1 OR a.id = $me OR ${AUTHOR_OK})
    ORDER BY p.id DESC LIMIT $lim`;
  const feedAll = db.prepare(`SELECT p.* FROM posts p JOIN users a ON a.id = p.author_id
    WHERE ${feedWhere} ${feedTail}`);
  const feedCat = db.prepare(`SELECT p.* FROM posts p JOIN users a ON a.id = p.author_id
    WHERE ${feedWhere} AND p.category = $cat ${feedTail}`);

  // #6 — лента выбранного вуза, новые сверху.
  inst.get('/api/social/feed', async (req) => {
    guard(req, 'U');
    const q = req.query || {};
    const cat = q.category === undefined || q.category === '' ? null : String(q.category);
    if (cat !== null && !CATEGORY_IDS.includes(cat)) throw invalid(POST_TEXT.category, 'category');
    const cursor = cursorParam(q.cursor);
    const size = limitParam(q.limit, FEED_PAGE, 50);
    limit('read', keyOf(req));
    const v = viewerOf(req.user);
    const params = { $uni: req.tenant.id, $cursor: cursor ?? 9e15, $admin: v.admin, $me: v.id, $lim: size + 1 };
    const rows = cat ? feedCat.all({ ...params, $cat: cat }) : feedAll.all(params);
    const page = rows.slice(0, size);
    return ok({ items: postsOut(ctx, v, page), next: rows.length > size ? String(page[page.length - 1].id) : null });
  });

  const threadReplies = db.prepare(`
    SELECT p.* FROM posts p LEFT JOIN users a ON a.id = p.author_id
    WHERE p.root_id = $root AND p.id > $cursor
      AND (p.deleted_at IS NOT NULL OR $admin = 1 OR p.author_id = $me OR (p.hidden = 0 AND ${AUTHOR_OK}))
    ORDER BY p.id LIMIT $lim`);

  // #7 — ветка: публикация и ответы (старые сверху, по 50). :id ответа — его ветка и focus.
  inst.get('/api/social/posts/:id', async (req) => {
    const id = postIdParam(req.params.id);
    const cursor = cursorParam((req.query || {}).cursor);
    limit('read', keyOf(req));
    const v = viewerOf(req.user);
    const row = getPost.get(id);
    if (!row) throw notFound(TEXT.postGone);
    const root = row.root_id ? getPost.get(row.root_id) : row;
    if (!threadOpen(db, v, root)) throw notFound(TEXT.postGone);
    const rows = threadReplies.all({ $root: root.id, $cursor: cursor ?? 0, $admin: v.admin, $me: v.id, $lim: THREAD_PAGE + 1 });
    const page = rows.slice(0, THREAD_PAGE);
    const [post, ...replies] = postsOut(ctx, v, [root, ...page]);
    return ok({
      post,
      replies,
      next: rows.length > THREAD_PAGE ? String(page[page.length - 1].id) : null,
      focus: row.root_id ? row.id : null,
    });
  });

  const rootStat = db.prepare(`SELECT COUNT(*) n, MIN(created_at) first FROM posts
    WHERE author_id = ? AND root_id IS NULL AND created_at > ?`);
  const replyStat = db.prepare(`SELECT COUNT(*) n, MIN(created_at) first FROM posts
    WHERE author_id = ? AND root_id IS NOT NULL AND created_at > ?`);
  const dupe = db.prepare(`SELECT 1 FROM posts WHERE author_id = ? AND text = ? AND created_at > ? AND deleted_at IS NULL LIMIT 1`);
  const checkDupe = (me, text) => {
    if (text && dupe.get(me.id, text, nowIso(Date.now() - 10 * 60_000))) throw invalid(POST_TEXT.dup, 'text');
  };

  // #8 — новая публикация в ленте выбранного вуза.
  inst.post('/api/social/posts', async (req, reply) => {
    const me = guard(req, 'SPNMU');
    const input = readInput(bodyOf(req), me, { root: true });
    limit('post', 'u:' + me.id);
    dailyCap('post', me, rootStat.get(me.id, dayAgo()));
    checkDupe(me, input.text);
    const now = nowIso();
    const id = tx(db, () => {
      const r = db.prepare(`INSERT INTO posts (uni, author_id, category, text, media_count, created_at)
        VALUES (?,?,?,?,?,?)`).run(req.tenant.id, me.id, input.category, input.text, input.media.length, now);
      const pid = Number(r.lastInsertRowid);
      attachMedia(db, pid, me.id, input.media, now);
      return pid;
    });
    reply.code(201);
    return ok(postOut(ctx, viewerOf(me), getPost.get(id)));
  });

  // #9 — ответ в ветке (вуз — как у публикации).
  inst.post('/api/social/posts/:id/replies', async (req, reply) => {
    const me = guard(req, 'SPNM');
    const rootId = postIdParam(req.params.id);
    const b = bodyOf(req);
    const v = viewerOf(me);
    const root = getPost.get(rootId);
    if (!root || root.deleted_at) throw notFound(TEXT.postGone);
    if (root.root_id) throw invalid();
    const input = readInput(b, me, { root: false, company: root.category === 'company' });
    // Видимость без учёта блокировки (её ответ — 403 blocked, а не 404).
    if (!v.admin && root.author_id !== me.id) {
      const a = db.prepare('SELECT status FROM users WHERE id = ?').get(root.author_id);
      if (root.hidden || !a || a.status !== 'active') throw notFound(TEXT.postGone);
    }
    // replyTo: живой ответ этой же ветки (или сама публикация → parent_id = NULL).
    let parent = null;
    if (input.replyTo !== null && input.replyTo !== root.id) {
      parent = getPost.get(input.replyTo);
      if (!parent || parent.root_id !== root.id || parent.deleted_at) throw invalid(TEXT.invalid, 'replyTo');
      if (!v.admin && parent.author_id !== me.id) {
        const pa = db.prepare('SELECT status FROM users WHERE id = ?').get(parent.author_id);
        if (parent.hidden || !pa || pa.status !== 'active') throw invalid(TEXT.invalid, 'replyTo');
      }
    }
    const parentId = parent ? parent.id : null;
    if (!v.admin && (blockedAuthor(db, me.id, root.author_id) || (parent && blockedAuthor(db, me.id, parent.author_id)))) {
      throw blocked(POST_TEXT.replyBlocked);
    }
    if (root.reply_count >= MAX_REPLIES) throw invalid(POST_TEXT.thread);

    limit('reply', 'u:' + me.id);
    dailyCap('reply', me, replyStat.get(me.id, dayAgo()));
    checkDupe(me, input.text);
    const now = nowIso();
    const id = tx(db, () => {
      const r = db.prepare(`INSERT INTO posts (uni, author_id, root_id, parent_id, category, text, media_count, created_at)
        VALUES (?,?,?,?,NULL,?,?,?)`).run(root.uni, me.id, root.id, parentId, input.text, input.media.length, now);
      const pid = Number(r.lastInsertRowid);
      attachMedia(db, pid, me.id, input.media, now);
      db.prepare('UPDATE posts SET reply_count = reply_count + 1, last_reply_at = ? WHERE id = ?').run(now, root.id);
      return pid;
    });
    reply.code(201);
    return ok(postOut(ctx, v, getPost.get(id)));
  });

  // #10 — удалить свой пост (и при ограничении) или любой — модератору.
  inst.delete('/api/social/posts/:id', async (req) => {
    const me = guard(req, 'S');
    const id = postIdParam(req.params.id);
    bodyOf(req);
    const p = getPost.get(id);
    if (!p || p.deleted_at) throw notFound(TEXT.postGone);
    const own = p.author_id === me.id;
    if (!own && !isAdmin(me)) throw forbidden();
    limit('delete', 'u:' + me.id);
    const files = tx(db, () => {
      const f = deletePost(db, p, own ? 'self' : 'admin');
      if (!own) {
        resolveReports(db, 'p:' + p.id, 'actioned', me.id);
        audit(db, me.id, 'post.delete', 'p:' + p.id, p.uni, { reply: !!p.root_id });
      }
      return f;
    });
    unlinkMedia(files);
    return ok(null);
  });

  // #11, #12 — лайк (идемпотентно).
  const likeState = (id) => getPost.get(id).like_count;
  const likeRoute = (on) => async (req) => {
    const me = guard(req, 'SPNM');
    const id = postIdParam(req.params.id);
    bodyOf(req);
    const v = viewerOf(me);
    const p = getPost.get(id);
    if (!rowVisible(db, v, p)) throw notFound(TEXT.postGone);
    if (p.root_id && !threadOpen(db, v, getPost.get(p.root_id))) throw notFound(TEXT.postGone);
    limit('like', 'u:' + me.id);
    tx(db, () => {
      if (on) {
        const c = db.prepare('INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?,?,?)').run(id, me.id, nowIso()).changes;
        if (c === 1) db.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?').run(id);
      } else {
        const c = db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(id, me.id).changes;
        if (c === 1) db.prepare('UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(id);
      }
    });
    return ok({ liked: on, likes: likeState(id) });
  };
  inst.put('/api/social/posts/:id/like', likeRoute(true));
  inst.delete('/api/social/posts/:id/like', likeRoute(false));
}

/** Блокировка в любую сторону между зрителем и автором. */
function blockedAuthor(db, me, authorId) {
  if (!authorId || authorId === me) return false;
  return !!db.prepare(`SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
    .get(me, authorId, authorId, me);
}
