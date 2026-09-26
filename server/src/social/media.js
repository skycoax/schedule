// Фото: загрузка, миниатюры, удаление и выдача /api/media/<id>.jpg и <id>_t.jpg
// (CONTRACT.md §B.5 #13–#16, §A.1 D14; backend.md §5).
// Файл пишется только после очистки sanitizeJpeg() (без EXIF/GPS, XMP, ICC, комментариев и хвоста после EOI):
// сначала .tmp-<id>, потом rename. Имена файлов — только из 22 знаков base64url, путь из запроса в join() не попадает.
import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync, renameSync, rmSync, statfsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { social } from '../config.js';
import { nowIso, tx } from './db.js';
import {
  SocialError, ok, invalid, notFound, guard, isAdmin, TEXT, mediaTypeError, bodyOf, marks,
} from './http.js';
import { limit, dailyCap, dayAgo } from './limits.js';
import { sanitizeJpeg } from './jpeg.js';
import { canSeeInstant, instantById } from './instant-access.js';

export const MEDIA_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const FILE_RE = /^([A-Za-z0-9_-]{22})(_t)?\.jpg$/;
const FULL_BYTES = 921_600;
const THUMB_BYTES = 153_600;
const MIN_FREE = 1024 ** 3;                 // меньше 1 ГБ свободно — фото не принимаем
const MAX_UNATTACHED = 12;

/** Полное фото. */
export const mediaUrl = (id) => `/api/media/${id}.jpg`;
/** Миниатюра; нет миниатюры (thumb_bytes = 0) — полное фото. */
export const thumbUrl = (id, thumbBytes) => (Number(thumbBytes) > 0 ? `/api/media/${id}_t.jpg` : mediaUrl(id));
/** MediaRef (types.ts) из строки media. */
export const mediaRef = (m) => ({ id: m.id, url: mediaUrl(m.id), thumb: thumbUrl(m.id, m.thumb_bytes), w: m.width, h: m.height });

/** Фото публикаций: Map(post_id → MediaRef[]) по порядку position. */
export function mediaByPost(db, postIds) {
  const out = new Map();
  if (!postIds.length) return out;
  const rows = db.prepare(`SELECT id, post_id, width, height, thumb_bytes FROM media
    WHERE post_id IN (${marks(postIds)}) ORDER BY post_id, position`).all(...postIds);
  for (const m of rows) {
    if (!out.has(m.post_id)) out.set(m.post_id, []);
    out.get(m.post_id).push(mediaRef(m));
  }
  return out;
}

/** MediaRef для id, которые ещё есть на сервере (снимки жалоб). */
export function mediaRefsByIds(db, ids) {
  const list = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && MEDIA_ID_RE.test(x));
  if (!list.length) return [];
  const rows = db.prepare(`SELECT id, width, height, thumb_bytes FROM media WHERE id IN (${marks(list)})`).all(...list);
  const byId = new Map(rows.map((m) => [m.id, m]));
  return list.filter((id) => byId.has(id)).map((id) => mediaRef(byId.get(id)));
}

const fileOf = (id, thumb = false) => join(social.mediaDir, `${id}${thumb ? '_t' : ''}.jpg`);

/** Удалить файлы фото (после COMMIT). Отсутствующий файл — не ошибка. */
export function unlinkMedia(files) {
  for (const f of files || []) {
    const id = typeof f === 'string' ? f : f && f.id;
    if (!id || !MEDIA_ID_RE.test(id)) continue;
    try { rmSync(fileOf(id), { force: true }); } catch { /* задача уборки удалит позже */ }
    try { rmSync(fileOf(id, true), { force: true }); } catch { /* то же */ }
  }
}

/** Записать файл атомарно: .tmp-<id…> → rename. */
function writeAtomic(target, data, tmpName) {
  const tmp = join(social.mediaDir, tmpName);
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Места на диске мало — 507. Где statfs недоступен, проверка пропускается. */
function diskGuard() {
  let st;
  try { st = statfsSync(social.mediaDir); } catch { return; }
  if (Number(st.bavail) * Number(st.bsize) < MIN_FREE) throw new SocialError(507, 'disk', TEXT.disk);
}

/**
 * Совпадает ли миниатюра с полным фото (§B.4): у фото к публикации соотношение сторон в пределах 2 %
 * (или ±1 точка из-за округления), длинная сторона min(640, длинная сторона фото) ± 2;
 * у фото профиля — квадрат со стороной min(128, сторона фото) ± 2.
 */
export function thumbFits(full, t) {
  const longFull = Math.max(full.width, full.height);
  const longT = Math.max(t.width, t.height);
  if (full.kind === 'avatar') {
    return Math.abs(t.width - t.height) <= 2 && Math.abs(longT - Math.min(128, longFull)) <= 2;
  }
  if (Math.abs(longT - Math.min(640, longFull)) > 2) return false;
  const a = full.width / full.height;
  const b = t.width / t.height;
  if (Math.abs(b - a) / a <= 0.02) return true;
  // Узкие фото: при уменьшении короткая сторона округляется, и 2 % не хватает — допускаем ±1 точку.
  const scale = longT / longFull;
  return Math.abs(t.width - full.width * scale) <= 1.01 && Math.abs(t.height - full.height * scale) <= 1.01;
}

/**
 * Фото профиля из Google при регистрации (auth.js, только взрослым). Google сам отдаёт квадратный JPEG нужного
 * размера («=s512-c-rj» и «=s128-c-rj» в конце адреса фото), дальше — та же очистка, что у загрузки из приложения
 * (sanitizeJpeg: без EXIF, ICC и хвостов). Ставится, только если человек ещё не выбрал фото сам.
 * @returns {Promise<boolean>} поставлено ли фото
 */
export async function importGoogleAvatar(ctx, userId, picture) {
  if (!/^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(String(picture || ''))) return false;
  const base = String(picture).replace(/=[^/=]*$/, '');
  const get = async (side, max) => {
    const res = await fetch(`${base}=s${side}-c-rj`, {
      headers: { accept: 'image/jpeg' }, redirect: 'follow', signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('Google ответил ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new Error('фото слишком большое');
    return buf;
  };
  const full = sanitizeJpeg(await get(512, FULL_BYTES), 1024);
  if (Math.abs(full.width - full.height) > 2) return false;
  let thumb = null;
  try {
    const t = sanitizeJpeg(await get(128, THUMB_BYTES), 640);
    if (thumbFits({ kind: 'avatar', width: full.width, height: full.height }, t)) thumb = t;
  } catch { /* без миниатюры — покажется полное фото */ }
  diskGuard();

  const id = randomBytes(16).toString('base64url');
  writeAtomic(fileOf(id), full.data, `.tmp-${id}`);
  if (thumb) writeAtomic(fileOf(id, true), thumb.data, `.tmp-${id}_t`);
  const db = ctx.db;
  let set = false;
  try {
    set = tx(db, () => {
      const u = db.prepare("SELECT avatar_id FROM users WHERE id = ? AND status = 'active'").get(userId);
      if (!u || u.avatar_id) return false;   // аккаунт удалили или человек уже поставил своё фото
      const now = nowIso();
      db.prepare(`INSERT INTO media (id, owner_id, kind, width, height, bytes, thumb_bytes, sha256, created_at, attached_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id, userId, 'avatar', full.width, full.height, full.data.length, thumb ? thumb.data.length : 0,
          createHash('sha256').update(full.data).digest('hex'), now, now);
      db.prepare('UPDATE users SET avatar_id = ? WHERE id = ?').run(id, userId);
      return true;
    });
  } finally {
    if (!set) unlinkMedia([id]);
  }
  return set;
}

const MEDIA_TEXT = {
  square: 'Фото профиля должно быть квадратным',
  thumb: 'Миниатюра не совпадает с фото — загрузи фото ещё раз',
  unattached: 'Слишком много неотправленных фото — отправь или удали их',
};

/**
 * @param {import('fastify').FastifyInstance} inst
 * @param {{ db: import('node:sqlite').DatabaseSync }} ctx
 */
export function mediaRoutes(inst, ctx) {
  const db = ctx.db;
  const stat = db.prepare('SELECT COUNT(*) n, MIN(created_at) first FROM media WHERE owner_id = ? AND kind = ? AND created_at > ?');
  // Фото моментов — тоже post_id IS NULL, но они уже отправлены: в «неотправленные» не считаются.
  const unattached = db.prepare(`SELECT COUNT(*) n FROM media WHERE owner_id = ? AND kind = 'post' AND post_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM instants i WHERE i.media_id = media.id)`);
  const insert = db.prepare(`INSERT INTO media (id, owner_id, kind, width, height, bytes, sha256, created_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  const ownFree = db.prepare(`SELECT * FROM media WHERE id = ? AND owner_id = ? AND post_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM users x WHERE x.avatar_id = media.id) AND NOT EXISTS (SELECT 1 FROM instants i WHERE i.media_id = media.id)`);
  const setThumb = db.prepare(`UPDATE media SET thumb_bytes = ? WHERE id = ? AND owner_id = ? AND post_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM users x WHERE x.avatar_id = media.id) AND NOT EXISTS (SELECT 1 FROM instants i WHERE i.media_id = media.id)`);
  const dropFree = db.prepare(`DELETE FROM media WHERE id = ? AND owner_id = ? AND post_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM users x WHERE x.avatar_id = media.id) AND NOT EXISTS (SELECT 1 FROM instants i WHERE i.media_id = media.id)`);
  const lookup = db.prepare(`
    SELECT m.id, m.owner_id, m.kind, m.post_id, m.thumb_bytes, p.hidden, p.deleted_at, pa.status AS author_status,
           (SELECT 1 FROM users x WHERE x.avatar_id = m.id) AS is_avatar, ou.status AS owner_status,
           (SELECT i.id FROM instants i WHERE i.media_id = m.id) AS instant_id
    FROM media m
    JOIN users ou ON ou.id = m.owner_id
    LEFT JOIN posts p  ON p.id = m.post_id
    LEFT JOIN users pa ON pa.id = p.author_id
    WHERE m.id = ?`);

  // #13, #13a — загрузка полного фото (сырое тело image/jpeg).
  inst.post('/api/social/media', { bodyLimit: FULL_BYTES }, async (req, reply) => {
    const k = req.query && req.query.kind;
    const kind = k === undefined || k === '' || k === 'post' ? 'post' : k === 'avatar' ? 'avatar' : null;
    if (!kind) throw invalid();
    const me = guard(req, kind === 'post' ? 'SPNM' : 'SNM');
    if (!Buffer.isBuffer(req.body)) throw mediaTypeError();
    const img = sanitizeJpeg(req.body, kind === 'avatar' ? 1024 : 2048);
    if (kind === 'avatar' && Math.abs(img.width - img.height) > 2) throw invalid(MEDIA_TEXT.square);

    limit(kind === 'avatar' ? 'avatar' : 'upload', 'u:' + me.id);
    dailyCap(kind === 'avatar' ? 'avatar' : 'upload', me, stat.get(me.id, kind, dayAgo()));
    if (kind === 'post' && unattached.get(me.id).n >= MAX_UNATTACHED) {
      throw new SocialError(429, 'rate', MEDIA_TEXT.unattached, { retryAfter: 60 });
    }
    diskGuard();

    const id = randomBytes(16).toString('base64url');
    const file = fileOf(id);
    writeAtomic(file, img.data, `.tmp-${id}`);
    try {
      insert.run(id, me.id, kind, img.width, img.height, img.data.length,
        createHash('sha256').update(img.data).digest('hex'), nowIso());
    } catch (err) {
      rmSync(file, { force: true });
      throw err;
    }
    reply.code(201);
    return ok({ id, url: mediaUrl(id), thumb: mediaUrl(id), w: img.width, h: img.height, bytes: img.data.length });
  });

  // #14 — миниатюра к своему ещё не отправленному фото.
  inst.put('/api/social/media/:id/thumb', { bodyLimit: THUMB_BYTES }, async (req) => {
    const me = guard(req, 'SNM');
    const id = String(req.params.id || '');
    if (!MEDIA_ID_RE.test(id)) throw notFound(TEXT.mediaGone);
    if (!Buffer.isBuffer(req.body)) throw mediaTypeError();
    const m = ownFree.get(id, me.id);
    if (!m) throw notFound(TEXT.mediaGone);
    const t = sanitizeJpeg(req.body, 640);
    if (!thumbFits(m, t)) throw invalid(MEDIA_TEXT.thumb);

    limit('thumb', 'u:' + me.id);
    diskGuard();
    const file = fileOf(id, true);
    writeAtomic(file, t.data, `.tmp-${id}_t`);
    if (setThumb.run(t.data.length, id, me.id).changes !== 1) {
      rmSync(file, { force: true });
      throw notFound(TEXT.mediaGone);
    }
    return ok({ id, url: mediaUrl(id), thumb: thumbUrl(id, t.data.length), w: m.width, h: m.height });
  });

  // #15 — удалить своё неотправленное фото (не текущий аватар).
  inst.delete('/api/social/media/:id', async (req) => {
    const me = guard(req, 'S');
    bodyOf(req);
    const id = String(req.params.id || '');
    if (!MEDIA_ID_RE.test(id)) throw notFound(TEXT.mediaGone);
    limit('delete', 'u:' + me.id);
    if (dropFree.run(id, me.id).changes !== 1) throw notFound(TEXT.mediaGone);
    unlinkMedia([id]);
    return ok(null);
  });

  // #16 — выдача. Без ведёрка: имена не угадать, файлы не меняются.
  inst.get('/api/media/:file', async (req, reply) => {
    const gone = () => reply.code(404).header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
      .send({ ok: false, error: TEXT.mediaGone, code: 'not_found' });
    const f = String(req.params.file || '').match(FILE_RE);
    if (!f) return gone();
    const m = lookup.get(f[1]);
    if (!m) return gone();
    const thumb = !!f[2];
    if (thumb && !(Number(m.thumb_bytes) > 0)) return gone();

    const postPublic = m.post_id !== null && !m.deleted_at && !m.hidden && m.author_status === 'active';
    const avatarPublic = !!m.is_avatar && m.owner_status === 'active';
    const isPublic = postPublic || avatarPublic;
    // Фото момента — только автору, модератору и друзьям, пока момент не истёк (instant-access.js).
    if (m.instant_id) {
      const i = instantById(db, m.instant_id);
      if (!canSeeInstant(db, req.user, i, i && i.author_status)) return gone();
    } else if (!isPublic && !(req.user && (req.user.id === m.owner_id || isAdmin(req.user)))) {
      return gone();
    }

    let body;
    try {
      body = await readFile(fileOf(m.id, thumb));
    } catch {
      return gone();
    }
    reply
      .header('content-type', 'image/jpeg')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cross-origin-resource-policy', 'same-origin')
      .header('content-disposition', 'inline; filename="para.jpg"')
      .header('x-robots-tag', 'noindex')
      .header('cache-control', isPublic && !m.instant_id ? 'public, max-age=604800'
        : m.instant_id ? 'private, max-age=600' : 'private, no-store');
    return reply.send(body);
  });
}
