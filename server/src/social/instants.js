// Моменты (как Instants в Instagram): фото с камеры приложения, которое сутки видят друзья автора и на которое
// они ставят реакции; автору — архив «Твои моменты» на год (старше стирает jobs.js). Фото — обычная строка
// media (kind 'post', post_id NULL) со связью instants.media_id: /api/media/* отдаёт его только автору,
// модератору и друзьям, пока момент не истёк (instant-access.js). Жалобы и модерация — moderation.js (цель 'i:<id>').
import { tx, nowIso, DAY } from './db.js';
import { ok, invalid, notFound, guard, isAdmin, bodyOf, cursorParam, marks } from './http.js';
import { limit, keyOf, dailyCap, dayAgo } from './limits.js';
import { MEDIA_ID_RE, mediaRefsByIds, unlinkMedia } from './media.js';
import { usersByIds, userCardOf } from './users.js';
import { canSeeInstant, instantById, deleteInstantRows } from './instant-access.js';
import { audit } from './moderation.js';

/** Сколько момент видят друзья и сколько хранится архив автора. */
export const INSTANT_TTL = DAY;
export const INSTANT_KEEP_DAYS = 365;
/** Реакции (как в Instagram) — одна на человека. */
export const REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];

const ARCHIVE_PAGE = 60;
const ID_RE = /^\d{1,12}$/;
const TEXT_I = {
  gone: 'Момент недоступен',
  media: 'Фото не найдено — сними момент ещё раз',
  self: 'Это твой момент',
  reaction: 'Такой реакции нет',
};

const idParam = (raw) => {
  const s = String(raw ?? '');
  if (!ID_RE.test(s) || Number(s) < 1) throw notFound(TEXT_I.gone);
  return Number(s);
};

/**
 * @param {import('fastify').FastifyInstance} inst
 * @param {{ db: import('node:sqlite').DatabaseSync }} ctx
 */
export function instantRoutes(inst, ctx) {
  const db = ctx.db;

  const refOf = (mediaId) => mediaRefsByIds(db, [mediaId])[0] || null;
  /** Реакции и просмотры для своих моментов: Map(id → { views, reactions: [{ emoji, count }] }). */
  const statsOf = (ids) => {
    const out = new Map(ids.map((id) => [id, { views: 0, reactions: [] }]));
    if (!ids.length) return out;
    for (const r of db.prepare(`SELECT instant_id, COUNT(*) n FROM instant_views WHERE instant_id IN (${marks(ids)})
      GROUP BY instant_id`).all(...ids)) out.get(r.instant_id).views = r.n;
    for (const r of db.prepare(`SELECT instant_id, reaction, COUNT(*) n FROM instant_views
      WHERE instant_id IN (${marks(ids)}) AND reaction IS NOT NULL GROUP BY instant_id, reaction ORDER BY n DESC`).all(...ids)) {
      out.get(r.instant_id).reactions.push({ emoji: r.reaction, count: r.n });
    }
    return out;
  };
  const mineOut = (i, st) => ({
    id: i.id,
    media: refOf(i.media_id),
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    active: i.expires_at > nowIso(),
    hidden: !!Number(i.hidden),
    views: st ? st.views : 0,
    reactions: st ? st.reactions : [],
  });

  // Новый момент: фото уже загружено (POST /api/social/media, затем миниатюра) — здесь оно становится моментом.
  inst.post('/api/social/instants', async (req, reply) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    const mediaId = typeof b.media === 'string' ? b.media : '';
    if (!MEDIA_ID_RE.test(mediaId)) throw invalid(TEXT_I.media, 'media');
    limit('instant', 'u:' + me.id);
    dailyCap('instant', me, db.prepare('SELECT COUNT(*) n, MIN(created_at) first FROM instants WHERE author_id = ? AND created_at > ?')
      .get(me.id, dayAgo()));
    const now = nowIso();
    const id = tx(db, () => {
      const m = db.prepare(`SELECT id FROM media WHERE id = ? AND owner_id = ? AND kind = 'post' AND post_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM instants i WHERE i.media_id = media.id)
        AND NOT EXISTS (SELECT 1 FROM users x WHERE x.avatar_id = media.id)`).get(mediaId, me.id);
      if (!m) throw invalid(TEXT_I.media, 'media');
      db.prepare('UPDATE media SET attached_at = ? WHERE id = ?').run(now, m.id);
      return Number(db.prepare('INSERT INTO instants (author_id, media_id, uni, created_at, expires_at) VALUES (?,?,?,?,?)')
        .run(me.id, m.id, req.tenant ? req.tenant.id : null, now, nowIso(Date.now() + INSTANT_TTL)).lastInsertRowid);
    });
    reply.code(201);
    const i = instantById(db, id);
    return ok(mineOut(i, statsOf([id]).get(id)));
  });

  // Моменты друзей за сутки — по авторам: сначала те, у кого есть непросмотренные, потом самые свежие.
  const feedRows = db.prepare(`
    SELECT i.id, i.author_id, i.media_id, i.created_at, i.expires_at, v.seen_at, v.reaction
    FROM instants i
    JOIN users u ON u.id = i.author_id AND u.status = 'active'
    JOIN friends f ON f.status = 'accepted' AND f.user_lo = MIN(i.author_id, $me) AND f.user_hi = MAX(i.author_id, $me)
    LEFT JOIN instant_views v ON v.instant_id = i.id AND v.user_id = $me
    WHERE i.expires_at > $now AND i.hidden = 0 AND i.author_id <> $me
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $me AND b.blocked_id = i.author_id)
                                                OR (b.blocker_id = i.author_id AND b.blocked_id = $me))
    ORDER BY i.id`);
  const myActive = db.prepare('SELECT id, media_id FROM instants WHERE author_id = ? AND expires_at > ? ORDER BY id DESC');
  inst.get('/api/social/instants', async (req) => {
    const me = guard(req, 'S');
    limit('read', keyOf(req));
    const now = nowIso();
    const rows = feedRows.all({ $me: me.id, $now: now });
    const refs = new Map(mediaRefsByIds(db, rows.map((r) => r.media_id)).map((m) => [m.id, m]));
    const cards = usersByIds(db, rows.map((r) => r.author_id));
    const groups = new Map();
    for (const r of rows) {
      const media = refs.get(r.media_id);
      const card = cards.get(r.author_id);
      if (!media || !card) continue;
      if (!groups.has(r.author_id)) groups.set(r.author_id, { author: userCardOf(ctx, card, false), items: [], unseen: 0, last: 0 });
      const g = groups.get(r.author_id);
      g.items.push({ id: r.id, media, createdAt: r.created_at, expiresAt: r.expires_at, seen: !!r.seen_at, reaction: r.reaction || null });
      if (!r.seen_at) g.unseen += 1;
      g.last = Math.max(g.last, r.id);
    }
    const list = [...groups.values()]
      .sort((a, b) => (Number(b.unseen > 0) - Number(a.unseen > 0)) || (b.last - a.last))
      .map(({ last, ...g }) => g);
    const mine = myActive.all(me.id, now);
    return ok({ groups: list, mine: { active: mine.length, latest: mine[0] ? refOf(mine[0].media_id) : null } });
  });

  // Открыл момент — отметка «просмотрено» (автору — число просмотров).
  inst.post('/api/social/instants/:id/view', async (req) => {
    const me = guard(req, 'S');
    const i = instantById(db, idParam(req.params.id));
    if (!i || !canSeeInstant(db, me, i, i.author_status)) throw notFound(TEXT_I.gone);
    if (i.author_id !== me.id) {
      db.prepare('INSERT OR IGNORE INTO instant_views (instant_id, user_id, seen_at) VALUES (?,?,?)').run(i.id, me.id, nowIso());
    }
    return ok(null);
  });

  // Реакция: одна из REACTIONS или null — убрать.
  inst.post('/api/social/instants/:id/react', async (req) => {
    const me = guard(req, 'SPNM');
    const b = bodyOf(req);
    const emoji = b.emoji === null ? null : (typeof b.emoji === 'string' && REACTIONS.includes(b.emoji) ? b.emoji : undefined);
    if (emoji === undefined) throw invalid(TEXT_I.reaction, 'emoji');
    const i = instantById(db, idParam(req.params.id));
    if (!i || !canSeeInstant(db, me, i, i.author_status)) throw notFound(TEXT_I.gone);
    if (i.author_id === me.id) throw invalid(TEXT_I.self);
    limit('like', 'u:' + me.id);
    const now = nowIso();
    db.prepare(`INSERT INTO instant_views (instant_id, user_id, seen_at, reaction, reacted_at) VALUES (?,?,?,?,?)
      ON CONFLICT(instant_id, user_id) DO UPDATE SET reaction = excluded.reaction, reacted_at = excluded.reacted_at`)
      .run(i.id, me.id, now, emoji, emoji ? now : null);
    return ok({ reaction: emoji });
  });

  // Архив автора «Твои моменты»: новые сверху, по 60.
  inst.get('/api/social/instants/mine', async (req) => {
    const me = guard(req, 'S');
    const cursor = cursorParam((req.query || {}).cursor);
    limit('read', keyOf(req));
    const rows = db.prepare('SELECT * FROM instants WHERE author_id = ? AND id < ? ORDER BY id DESC LIMIT ?')
      .all(me.id, cursor ?? 9e15, ARCHIVE_PAGE + 1);
    const page = rows.slice(0, ARCHIVE_PAGE);
    const st = statsOf(page.map((i) => i.id));
    return ok({
      items: page.map((i) => mineOut(i, st.get(i.id))),
      next: rows.length > ARCHIVE_PAGE ? String(page[page.length - 1].id) : null,
    });
  });

  // Один момент: автору и модератору — кто посмотрел и какая реакция; другу — сам момент.
  inst.get('/api/social/instants/:id', async (req) => {
    const me = guard(req, 'S');
    const i = instantById(db, idParam(req.params.id));
    if (!i || !canSeeInstant(db, me, i, i.author_status)) throw notFound(TEXT_I.gone);
    limit('read', keyOf(req));
    const own = i.author_id === me.id || isAdmin(me);
    const out = mineOut(i, own ? statsOf([i.id]).get(i.id) : null);
    const author = usersByIds(db, [i.author_id]).get(i.author_id);
    if (!own) return ok({ ...out, author: author ? userCardOf(ctx, author, false) : null });
    const views = db.prepare(`SELECT user_id, seen_at, reaction FROM instant_views WHERE instant_id = ?
      ORDER BY (reaction IS NULL), COALESCE(reacted_at, seen_at) DESC LIMIT 200`).all(i.id);
    const cards = usersByIds(db, views.map((v) => v.user_id));
    return ok({
      ...out,
      author: author ? userCardOf(ctx, author, false) : null,
      viewers: views.filter((v) => cards.has(v.user_id))
        .map((v) => ({ user: userCardOf(ctx, cards.get(v.user_id), false), reaction: v.reaction || null, seenAt: v.seen_at })),
    });
  });

  // Удалить свой момент (модератор — любой; жалобы на него закрываются как «приняты меры»).
  inst.delete('/api/social/instants/:id', async (req) => {
    const me = guard(req, 'S');
    const i = instantById(db, idParam(req.params.id));
    if (!i || (i.author_id !== me.id && !isAdmin(me))) throw notFound(TEXT_I.gone);
    limit('delete', 'u:' + me.id);
    const files = tx(db, () => {
      const f = deleteInstantRows(db, i);
      if (i.author_id !== me.id) {
        db.prepare(`UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ? WHERE target_key = ? AND status = 'open'`)
          .run(nowIso(), me.id, 'i:' + i.id);
        audit(db, me.id, 'instant.delete', 'i:' + i.id, i.uni, {});
      }
      return f;
    });
    unlinkMedia(files);
    return ok(null);
  });
}
