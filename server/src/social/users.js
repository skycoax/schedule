// Аккаунт и люди: свой профиль (Me), имена пользователей, поиск, профили, друзья, блокировки
// (CONTRACT.md §B.5 #17–#31, §C.3). Аккаунты, друзья и блокировки общие для всех вузов.
import { createHash } from 'node:crypto';
import { social } from '../config.js';
import { shortName } from '../tenants.js';
import { tx, nowIso, DAY } from './db.js';
import {
  SocialError, ok, invalid, notFound, blocked, guard, isAdmin, banOf, bodyOf, TEXT, userIdParam, cursorParam,
  notBanned, writable, clearCookie, web,
} from './http.js';
import { limit, keyOf, isNewAccount } from './limits.js';
import { cleanText, tooLong, isProfane, maskProfanity, fold, graphemes } from './text.js';
import { mediaUrl, thumbUrl, unlinkMedia, MEDIA_ID_RE } from './media.js';
import { audit } from './moderation.js';
import { postsOut, deleteAccount, viewerOf } from './posts.js';

// ─── Имя пользователя (§C.3, §B.4) ───

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const USERNAME_TEXT = {
  format: 'Имя пользователя — от 3 до 20 символов: латинские буквы, цифры и знак подчёркивания',
  digits: 'Имя пользователя не может состоять только из цифр',
  reserved: 'Это имя зарезервировано — выбери другое',
  taken: 'Это имя уже занято',
  often: 'Имя пользователя можно менять раз в 30 дней',
};

const RESERVED = new Set(`admin administrator root system support help helpdesk moderator moder mod mods staff team para
  paraapp para_app skycoax official api auth login logout signin signup register me my settings profile profiles user users
  account accounts policy privacy rules terms safety delete deleted delete_account null undefined anonymous anon guest test
  telegram instagram google youtube tiktok feed post posts search friends notifications media brand assets`
  .split(/\s+/).filter(Boolean));
const RESERVED_PARTS = ['admin', 'moderator', 'skycoax', 'official', 'rasmiy', 'support', 'dekanat', 'rektor', 'rector'];

/** Зарезервировано: точный список, id вузов, первая часть адреса Para, запретные части и мат. */
export function isReservedUsername(ctx, u) {
  if (RESERVED.has(u)) return true;
  if (ctx.tenants.some((t) => t.id === u)) return true;
  if (ctx.hub.hosts.some((h) => h.split('.')[0] === u)) return true;
  if (RESERVED_PARTS.some((p) => u.includes(p))) return true;
  return u.split(/[_\d]+/).some((tok) => tok && isProfane(tok));
}

/**
 * Можно ли занять имя (без правила «раз в 30 дней»). null — можно, иначе { status, message }.
 * selfId — кто спрашивает: своё текущее имя и своё удержанное имя ему доступны.
 */
export function usernameProblem(ctx, u, selfId = 0) {
  if (!USERNAME_RE.test(u)) return { status: 400, message: USERNAME_TEXT.format };
  if (/^\d+$/.test(u)) return { status: 400, message: USERNAME_TEXT.digits };
  if (isReservedUsername(ctx, u)) return { status: 400, message: USERNAME_TEXT.reserved };
  const owner = ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(u);
  if (owner && owner.id !== selfId) return { status: 409, message: USERNAME_TEXT.taken };
  const held = ctx.db.prepare('SELECT user_id FROM held_usernames WHERE username = ? AND until > ?').get(u, nowIso());
  if (held && held.user_id !== selfId) return { status: 409, message: USERNAME_TEXT.taken };
  return null;
}

/**
 * Когда снова можно сменить @имя (ISO), или null — можно сейчас (§B.5 #17): раз в 30 дней после смены;
 * первое имя (username_at = NULL) и всё окно «нового аккаунта» (24 ч) — свободно.
 */
export function usernameNextChange(u, now = Date.now()) {
  if (!u.username || !u.username_at) return null;
  if (isNewAccount(u)) return null;
  const next = Date.parse(u.username_at) + 30 * DAY;
  return next > now ? new Date(next).toISOString() : null;
}

/** Ввод @имени: без пробелов по краям и ведущей «@», в нижнем регистре. */
const usernameInput = (v) => String(v ?? '').trim().replace(/^@/, '').toLowerCase();

// ─── Подсказка @имени из имени (никогда не из почты) ───

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h', і: 'i', ї: 'yi', є: 'ye', ә: 'a', ө: 'o', ү: 'u', ң: 'ng',
};
export function translit(name) {
  return Array.from(String(name || '').toLocaleLowerCase('ru'))
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('')
    .normalize('NFKD').replace(/\p{M}/gu, '')        // é → e, ş → s
    .replace(/[ʻ‘’'`]/g, '')                          // oʻ → o
    .replace(/[\s.-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * me.suggestedUsername (§C.3): транслит имени, до 14 знаков, «_» и 2–4 цифры; до 5 попыток.
 * Цифры выводятся из id человека — подсказка одна и та же при каждом /api/auth/me.
 */
export function suggestUsername(ctx, user) {
  let base = translit(user.name).slice(0, 14).replace(/_+$/, '');
  if (base.length < 3) base = (base + 'student').slice(0, 14);
  for (let i = 0; i < 5; i++) {
    const h = createHash('sha256').update(`${social.salt}|${user.id}|${i}`).digest();
    const len = 2 + (h[0] % 3);
    const digits = String(h.readUInt32BE(1) % 10 ** len).padStart(len, '0');
    const u = `${base}_${digits}`;
    if (!usernameProblem(ctx, u, user.id)) return u;
  }
  return null;
}

// ─── Карточки и Me ───

/** Своя почта — только замаскированной: 'a•••@gmail.com'. */
export function maskEmail(email) {
  const s = String(email || '');
  const at = s.lastIndexOf('@');
  if (at < 1) return s ? Array.from(s)[0] + '•••' : '';
  return Array.from(s)[0] + '•••@' + s.slice(at + 1);
}

/** «КФУ · Джизак» для id вуза, или null. */
export const uniShortOf = (ctx, id) => {
  const t = id && ctx.tenants.find((x) => x.id === id);
  return t ? shortName(t) : null;
};

/** Аватар: миниатюра 128 (или полное фото без миниатюры) и полное 512. */
export function avatarOf(ctx, avatarId) {
  if (!avatarId) return { avatar: null, avatarFull: null };
  const m = ctx.db.prepare('SELECT id, thumb_bytes FROM media WHERE id = ?').get(avatarId);
  if (!m) return { avatar: null, avatarFull: null };
  return { avatar: thumbUrl(m.id, m.thumb_bytes), avatarFull: mediaUrl(m.id) };
}

/** Колонки для карточки (users AS u, LEFT JOIN media AS m ON m.id = u.avatar_id). */
export const CARD_COLS = `u.id, u.username, u.name, u.avatar_id, u.uni, u.email, u.email_verified, u.status,
  u.created_at, m.thumb_bytes AS av_thumb`;

/** Строки users для карточек: Map(id → строка). */
export function usersByIds(db, ids) {
  const list = [...new Set(ids)].filter((x) => Number.isInteger(x));
  const out = new Map();
  if (!list.length) return out;
  const rows = db.prepare(`SELECT ${CARD_COLS} FROM users u LEFT JOIN media m ON m.id = u.avatar_id
    WHERE u.id IN (${list.map(() => '?').join(',')})`).all(...list);
  for (const r of rows) out.set(r.id, r);
  return out;
}

/** UserCard (types.ts). guest — зрителю без аккаунта «мой вуз» не показываем (V7). */
export function userCardOf(ctx, u, guest = false) {
  return {
    id: u.id,
    username: u.username,
    name: maskProfanity(u.name),
    avatar: u.avatar_id ? thumbUrl(u.avatar_id, u.av_thumb) : null,
    uni: guest ? null : u.uni || null,
    uniShort: guest ? null : uniShortOf(ctx, u.uni),
    team: isAdmin(u),
  };
}

/** Сколько у человека друзей (подтверждённых, с активным аккаунтом). */
export function friendCount(db, id) {
  return db.prepare(`
    SELECT COUNT(*) n FROM friends f
    JOIN users o ON o.id = CASE WHEN f.user_lo = ? THEN f.user_hi ELSE f.user_lo END
    WHERE (f.user_lo = ? OR f.user_hi = ?) AND f.status = 'accepted' AND o.status = 'active' AND o.username IS NOT NULL
  `).get(id, id, id).n;
}

/** Me (types.ts) из строки users. */
export function meOf(ctx, u) {
  const db = ctx.db;
  const admin = isAdmin(u);
  const needsProfile = !u.username;
  // SOCIAL_MODE=off: фото не отдаются, друзей и жалоб в приложении нет — не показываем ни аватар, ни значки.
  const off = social.mode === 'off';
  const { avatar, avatarFull } = off ? { avatar: null, avatarFull: null } : avatarOf(ctx, u.avatar_id);
  const posts = db.prepare('SELECT COUNT(*) n FROM posts WHERE author_id = ? AND root_id IS NULL AND deleted_at IS NULL')
    .get(u.id).n;
  const requestsIn = off ? 0 : db.prepare(`
    SELECT COUNT(*) n FROM friends f
    JOIN users r ON r.id = f.requester_id
    WHERE (f.user_lo = ? OR f.user_hi = ?) AND f.status = 'pending' AND f.requester_id <> ?
      AND r.status = 'active' AND r.username IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = r.id) OR (b.blocker_id = r.id AND b.blocked_id = ?))
  `).get(u.id, u.id, u.id, u.id, u.id).n;
  const modQueue = admin && !off
    ? db.prepare("SELECT COUNT(DISTINCT target_key) n FROM reports WHERE status = 'open'").get().n
    : 0;
  return {
    id: u.id,
    username: u.username || null,
    name: maskProfanity(u.name),
    avatar,
    avatarFull,
    bio: maskProfanity(u.bio),
    links: { tg: u.tg || '', ig: u.ig || '' },
    uni: u.uni || null,
    uniShort: uniShortOf(ctx, u.uni),
    team: admin,
    isAdmin: admin,
    email: maskEmail(u.email),
    age: u.age_group,
    privacy: { links: u.links_vis, searchable: Number(u.searchable) === 1, friendRequests: u.friend_req },
    needsProfile,
    suggestedUsername: needsProfile ? suggestUsername(ctx, u) : null,
    rulesAccepted: Number(u.rules_version) === social.rulesVersion,
    banned: banOf(u),
    requestsIn,
    modQueue,
    counts: { friends: friendCount(db, u.id), posts },
    usernameNextChange: usernameNextChange(u),
    createdAt: u.created_at,
  };
}

// ─── Отношения ───

const pair = (a, b) => (a < b ? [a, b] : [b, a]);

/** Блокировка в любую сторону между a и b. */
export function blockedEither(db, a, b) {
  if (!a || !b) return false;
  return !!db.prepare(`SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
    .get(a, b, b, a);
}

/** Отношение me → other: 'self' | 'blocked' (я заблокировал) | 'friends' | 'outgoing' | 'incoming' | 'none'. */
export function relationOf(db, me, other) {
  if (me === other) return 'self';
  if (db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(me, other)) return 'blocked';
  const [lo, hi] = pair(me, other);
  const f = db.prepare('SELECT status, requester_id FROM friends WHERE user_lo = ? AND user_hi = ?').get(lo, hi);
  if (!f) return 'none';
  if (f.status === 'accepted') return 'friends';
  return f.requester_id === me ? 'outgoing' : 'incoming';
}

// ─── Поля профиля (§B.4) ───

const FIELD_TEXT = {
  name: 'Имя — от 1 до 40 символов',
  nameBad: 'Такое имя использовать нельзя',
  bio: 'О себе — не больше 160 символов',
  tg: 'Telegram: укажи имя пользователя, например @username',
  ig: 'Instagram: укажи имя пользователя, например @username',
  minorLinks: 'До 18 лет контакты видят только друзья',
  uni: 'Такого вуза нет в Para',
  avatar: 'Фото профиля не найдено — загрузи его ещё раз',
  rules: 'Правила обновились — прими новую версию',
  confirm: 'Подтверди удаление аккаунта',
  q: 'Введи хотя бы 2 символа',
  friendSelf: 'Нельзя добавить в друзья себя',
  friendNo: 'Нельзя добавить этого пользователя',
  friendClosed: 'Этот человек не принимает заявки в друзья',
  friendMany: 'Слишком много заявок — дождись ответов',
  blockSelf: 'Нельзя заблокировать себя',
  blockMany: 'Слишком много блокировок — сначала разблокируй кого-нибудь',
};

const IMPERSONATION = ['администрац', 'модератор', 'деканат', 'ректор', 'admin', 'moderator', 'dekanat', 'rektor', 'skycoax',
  'официальн', 'rasmiy'];

/** Имя выдаёт себя за администрацию/Para или содержит мат. */
export function nameForbidden(name) {
  const f = fold(name);
  if (IMPERSONATION.some((w) => f.includes(w))) return true;
  if (f === 'para' || f.includes('команда para') || f.includes('para team')) return true;
  return maskProfanity(name) !== name;
}

/** Имя (одна строка, 1–40 графем, есть буква или цифра). */
export function cleanName(v) {
  if (typeof v !== 'string') throw invalid(FIELD_TEXT.name, 'name');
  const n = cleanText(v, { multiline: false });
  if (!n || tooLong(n, 40) || !/[\p{L}\p{N}]/u.test(n)) throw invalid(FIELD_TEXT.name, 'name');
  if (nameForbidden(n)) throw invalid(FIELD_TEXT.nameBad, 'name');
  return n;
}

/** Ссылка или имя → голое имя: убрать схему, хост, «@», хвост «/», параметры. */
function stripLink(v, hosts) {
  let s = String(v).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  for (const h of hosts) if (s.toLowerCase().startsWith(h + '/')) { s = s.slice(h.length + 1); break; }
  return s.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^@/, '').toLowerCase();
}
export function normTg(v) {
  if (typeof v !== 'string') throw invalid(FIELD_TEXT.tg, 'tg');
  if (!v.trim()) return '';
  const s = stripLink(v, ['t.me', 'telegram.me']);
  if (!/^[a-z][a-z0-9_]{4,31}$/.test(s)) throw invalid(FIELD_TEXT.tg, 'tg');
  return s;
}
export function normIg(v) {
  if (typeof v !== 'string') throw invalid(FIELD_TEXT.ig, 'ig');
  if (!v.trim()) return '';
  const s = stripLink(v, ['instagram.com', 'instagr.am']);
  if (!/^[a-z0-9._]{1,30}$/.test(s) || s.startsWith('.') || s.endsWith('.') || s.includes('..')) {
    throw invalid(FIELD_TEXT.ig, 'ig');
  }
  return s;
}

// Ключи PATCH /me и значения, которые только уменьшают видимость (тогда N и M не проверяются).
const PATCH_KEYS = new Set(['username', 'name', 'bio', 'tg', 'ig', 'linksVisibility', 'searchable', 'friendRequests',
  'avatar', 'uni', 'age']);
const REDUCING = {
  linksVisibility: 'friends', searchable: false, friendRequests: 'none', avatar: null, bio: '', tg: '', ig: '', uni: '',
};
const onlyReduces = (b) => Object.keys(b).every((k) => Object.hasOwn(REDUCING, k) && b[k] === REDUCING[k]);

/** Свежая строка users. */
const userRow = (db, id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

// ─── Маршруты ───

/**
 * DELETE /api/social/me (#19) — есть во всех режимах, и в off тоже.
 * @param {import('fastify').FastifyInstance} inst
 */
export function accountRoutes(inst, ctx) {
  inst.delete('/api/social/me', async (req, reply) => {
    const me = guard(req, 'S');
    const b = bodyOf(req);
    if (b.confirm !== true) throw invalid(FIELD_TEXT.confirm, 'confirm');
    deleteAccount(ctx, me);
    clearCookie(reply, web.sid);
    req.user = null;
    return ok(null);
  });
}

/**
 * PATCH /me, правила, проверка имени, поиск, профили, друзья, блокировки (#17, #18, #20–#31).
 * @param {import('fastify').FastifyInstance} inst
 */
export function userRoutes(inst, ctx) {
  const db = ctx.db;

  // #17 — свой профиль.
  inst.patch('/api/social/me', async (req) => {
    const me = guard(req, 'S');
    const b = bodyOf(req);
    for (const k of Object.keys(b)) if (!PATCH_KEYS.has(k)) throw invalid();
    if (!onlyReduces(b)) { notBanned(req); writable(); }

    const set = {};
    let rename = null;         // новое @имя
    let newAvatar;             // undefined — не меняется; null — убрать; id — поставить

    if (b.username !== undefined) {
      if (typeof b.username !== 'string') throw invalid(USERNAME_TEXT.format, 'username');
      const u = usernameInput(b.username);
      if (u !== me.username) {
        const p = usernameProblem(ctx, u, me.id);
        if (p) {
          throw p.status === 409 ? new SocialError(409, 'conflict', p.message, { field: 'username' })
            : invalid(p.message, 'username');
        }
        if (me.username && usernameNextChange(me)) throw invalid(USERNAME_TEXT.often, 'username');
        rename = u;
      }
    } else if (!me.username) {
      throw invalid(USERNAME_TEXT.format, 'username');
    }

    if (b.name !== undefined) {
      const n = cleanName(b.name);
      set.name = n;
      set.name_fold = fold(n);
    } else if (!me.username) {
      throw invalid(FIELD_TEXT.name, 'name');
    }

    if (b.bio !== undefined) {
      if (typeof b.bio !== 'string') throw invalid(FIELD_TEXT.bio, 'bio');
      const bio = cleanText(b.bio, { maxLines: 4 });
      if (tooLong(bio, 160)) throw invalid(FIELD_TEXT.bio, 'bio');
      set.bio = bio;
    }
    if (b.tg !== undefined) set.tg = normTg(b.tg);
    if (b.ig !== undefined) set.ig = normIg(b.ig);

    let age = me.age_group;
    if (b.age !== undefined) {
      if (b.age !== 'adult' || me.age_group !== 'minor') throw invalid(TEXT.invalid, 'age');
      age = 'adult';
      set.age_group = 'adult';
    }
    if (b.linksVisibility !== undefined) {
      if (b.linksVisibility !== 'friends' && b.linksVisibility !== 'signed') throw invalid(TEXT.invalid, 'linksVisibility');
      if (b.linksVisibility === 'signed' && age !== 'adult') throw invalid(FIELD_TEXT.minorLinks, 'linksVisibility');
      set.links_vis = b.linksVisibility;
    }
    if (b.searchable !== undefined) {
      if (typeof b.searchable !== 'boolean') throw invalid(TEXT.invalid, 'searchable');
      set.searchable = b.searchable ? 1 : 0;
    }
    if (b.friendRequests !== undefined) {
      if (b.friendRequests !== 'all' && b.friendRequests !== 'none') throw invalid(TEXT.invalid, 'friendRequests');
      set.friend_req = b.friendRequests;
    }
    if (b.uni !== undefined) {
      if (typeof b.uni !== 'string') throw invalid(FIELD_TEXT.uni, 'uni');
      if (b.uni === '') set.uni = null;
      else if (ctx.tenants.some((t) => t.id === b.uni)) set.uni = b.uni;
      else throw invalid(FIELD_TEXT.uni, 'uni');
    }
    if (b.avatar !== undefined) {
      if (b.avatar === null) {
        if (me.avatar_id) newAvatar = null;
      } else {
        if (typeof b.avatar !== 'string' || !MEDIA_ID_RE.test(b.avatar)) throw invalid(FIELD_TEXT.avatar, 'avatar');
        if (b.avatar !== me.avatar_id) {
          const m = db.prepare("SELECT id FROM media WHERE id = ? AND owner_id = ? AND kind = 'avatar' AND post_id IS NULL")
            .get(b.avatar, me.id);
          if (!m) throw invalid(FIELD_TEXT.avatar, 'avatar');
          newAvatar = b.avatar;
        }
      }
    }

    limit('profile', 'u:' + me.id);

    const now = nowIso();
    const oldAvatar = newAvatar !== undefined ? me.avatar_id : null;
    try {
      tx(db, () => {
        if (rename) {
          set.username = rename;
          db.prepare('DELETE FROM held_usernames WHERE username = ? AND user_id = ?').run(rename, me.id);
          if (me.username) {
            set.username_at = now;
            db.prepare('INSERT OR REPLACE INTO held_usernames (username, user_id, until) VALUES (?,?,?)')
              .run(me.username, me.id, nowIso(Date.now() + 30 * DAY));
            audit(db, me.id, 'profile.username', 'u:' + me.id, null, { from: me.username, to: rename });
          }
        }
        if (newAvatar !== undefined) set.avatar_id = newAvatar;
        const cols = Object.keys(set);
        if (cols.length) {
          db.prepare(`UPDATE users SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE id = ?`)
            .run(...cols.map((c) => set[c]), me.id);
        }
        if (oldAvatar) db.prepare('DELETE FROM media WHERE id = ? AND owner_id = ?').run(oldAvatar, me.id);
      });
    } catch (err) {
      if (/UNIQUE constraint failed: users\.username/.test(String(err && err.message))) {
        throw new SocialError(409, 'conflict', USERNAME_TEXT.taken, { field: 'username' });
      }
      throw err;
    }
    if (oldAvatar) unlinkMedia([oldAvatar]);
    const fresh = userRow(db, me.id);
    req.user = fresh;
    return ok(meOf(ctx, fresh));
  });

  // #18 — принять текущие правила (после их обновления).
  inst.post('/api/social/me/rules', async (req) => {
    const me = guard(req, 'S');
    const b = bodyOf(req);
    if (b.version !== social.rulesVersion) throw invalid(FIELD_TEXT.rules, 'version');
    limit('profile', 'u:' + me.id);
    db.prepare('UPDATE users SET rules_version = ?, policy_version = ?, rules_at = ? WHERE id = ?')
      .run(social.rulesVersion, social.policyVersion, nowIso(), me.id);
    const fresh = userRow(db, me.id);
    req.user = fresh;
    return ok(meOf(ctx, fresh));
  });

  // #20 — свободно ли @имя.
  inst.get('/api/social/username', async (req) => {
    const me = guard(req, 'S');
    limit('search', 'u:' + me.id);
    const u = usernameInput((req.query || {}).u);
    if (me.username && u === me.username) return ok({ available: true });
    const p = usernameProblem(ctx, u, me.id);
    if (p) return ok({ available: false, error: p.message });
    if (me.username && usernameNextChange(me)) return ok({ available: false, error: USERNAME_TEXT.often });
    return ok({ available: true });
  });

  // #21 — поиск людей: POST, чтобы запрос не попадал в журналы. Свой вуз — выше.
  const search = db.prepare(`
    SELECT ${CARD_COLS} FROM users u LEFT JOIN media m ON m.id = u.avatar_id
    WHERE u.id <> $me AND u.username IS NOT NULL AND u.status = 'active'
      AND (u.username LIKE $prefix ESCAPE '\\' OR u.name_fold LIKE $contains ESCAPE '\\')
      AND (u.searchable = 1 OR u.username = $exact)
      AND NOT EXISTS (SELECT 1 FROM blocks b
                      WHERE (b.blocker_id = $me AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $me))
    ORDER BY (u.uni IS NOT NULL AND u.uni = $uni) DESC, (u.username LIKE $prefix ESCAPE '\\') DESC, u.id DESC
    LIMIT 20`);
  inst.post('/api/social/users/search', async (req) => {
    const me = guard(req, 'S');
    const b = bodyOf(req);
    if (typeof b.q !== 'string') throw invalid(FIELD_TEXT.q, 'q');
    let q = cleanText(b.q, { multiline: false }).replace(/^@/, '').trim();
    if (graphemes(q) < 2) throw invalid(FIELD_TEXT.q, 'q');
    if (graphemes(q) > 32) q = Array.from(new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(q), (s) => s.segment).slice(0, 32).join('');
    limit('search', 'u:' + me.id);
    const esc = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);
    const lower = q.toLowerCase();
    const rows = search.all({
      $me: me.id, $prefix: esc(lower) + '%', $contains: '%' + esc(fold(q)) + '%', $exact: lower,
      $uni: req.tenant ? req.tenant.id : (me.uni || ''),
    });
    return ok({ items: rows.map((u) => userCardOf(ctx, u, false)) });
  });

  // #22, #23 — профиль и его публикации.
  const byUsername = (raw) => {
    const s = String(raw ?? '');
    if (!/^[A-Za-z0-9_]{1,32}$/.test(s)) return null;
    return db.prepare('SELECT * FROM users WHERE username = ?').get(s.toLowerCase()) || null;
  };
  /** Профиль, который зритель может открыть, или 404 «Профиль не найден». */
  const visibleProfile = (viewer, raw) => {
    const t = byUsername(raw);
    const admin = isAdmin(viewer);
    const self = !!t && t.id === viewer.id;
    if (!t || !t.username) throw notFound(TEXT.profileGone);
    if (!self && !admin) {
      if (t.status !== 'active') throw notFound(TEXT.profileGone);
      if (db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(t.id, viewer.id)) {
        throw notFound(TEXT.profileGone);
      }
    }
    return t;
  };
  const PROFILE_PAGE = 10;
  const MORE_PAGE = 20;
  const profilePosts = db.prepare(`
    SELECT * FROM posts WHERE author_id = $id AND root_id IS NULL AND deleted_at IS NULL
      AND (hidden = 0 OR $all = 1) AND id < $cursor
    ORDER BY id DESC LIMIT $lim`);
  const postsPage = (viewer, t, cursor, size) => {
    const all = viewer.id === t.id || isAdmin(viewer) ? 1 : 0;
    const rows = profilePosts.all({ $id: t.id, $all: all, $cursor: cursor ?? 9e15, $lim: size + 1 });
    const more = rows.length > size;
    const page = rows.slice(0, size);
    return { items: postsOut(ctx, viewerOf(viewer), page), next: more ? String(page[page.length - 1].id) : null };
  };

  inst.get('/api/social/users/:username', async (req) => {
    const viewer = guard(req, 'S');
    limit('read', keyOf(req));
    const t = visibleProfile(viewer, req.params.username);
    const admin = isAdmin(viewer);
    const self = t.id === viewer.id;
    const rel = relationOf(db, viewer.id, t.id);
    const isBlocked = rel === 'blocked';
    const card = usersByIds(db, [t.id]).get(t.id);
    const { avatarFull } = avatarOf(ctx, t.avatar_id);
    const hasLinks = !!(t.tg || t.ig);
    const linksVisible = !isBlocked && (!hasLinks || self || rel === 'friends' || t.links_vis === 'signed');
    const postCount = db.prepare(`SELECT COUNT(*) n FROM posts WHERE author_id = ? AND root_id IS NULL
      AND deleted_at IS NULL AND (hidden = 0 OR ? = 1)`).get(t.id, self || admin ? 1 : 0).n;
    const user = {
      ...userCardOf(ctx, card, false),
      avatarFull,
      bio: isBlocked ? '' : maskProfanity(t.bio),
      links: linksVisible ? { tg: t.tg || '', ig: t.ig || '' } : null,
      linksHidden: linksVisible || isBlocked ? null : 'friends',
      counts: { friends: friendCount(db, t.id), posts: postCount },
      since: String(t.created_at).slice(0, 7),
      relation: rel,
      canFriend: rel === 'none' && t.friend_req === 'all',
      banned: admin ? banOf(t) : null,
    };
    if (isBlocked) return ok({ user, posts: [], next: null });
    const page = postsPage(viewer, t, null, PROFILE_PAGE);
    return ok({ user, posts: page.items, next: page.next });
  });

  inst.get('/api/social/users/:username/posts', async (req) => {
    const viewer = guard(req, 'S');
    const cursor = cursorParam((req.query || {}).cursor);
    limit('read', keyOf(req));
    const t = visibleProfile(viewer, req.params.username);
    if (relationOf(db, viewer.id, t.id) === 'blocked') return ok({ items: [], next: null });
    return ok(postsPage(viewer, t, cursor, MORE_PAGE));
  });

  // #24 — свои списки друзей и заявок (каждый ≤ 200, новые сверху).
  const friendRows = db.prepare(`
    SELECT ${CARD_COLS}, f.status AS f_status, f.requester_id AS f_requester, f.created_at AS f_created, f.updated_at AS f_updated
    FROM friends f
    JOIN users u ON u.id = CASE WHEN f.user_lo = $me THEN f.user_hi ELSE f.user_lo END
    LEFT JOIN media m ON m.id = u.avatar_id
    WHERE (f.user_lo = $me OR f.user_hi = $me) AND u.status = 'active' AND u.username IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b
                      WHERE (b.blocker_id = $me AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $me))
    ORDER BY f.updated_at DESC, u.id DESC`);
  inst.get('/api/social/friends', async (req) => {
    const me = guard(req, 'S');
    limit('read', keyOf(req));
    const out = { friends: [], incoming: [], outgoing: [] };
    for (const r of friendRows.all({ $me: me.id })) {
      const list = r.f_status === 'accepted' ? out.friends : r.f_requester === me.id ? out.outgoing : out.incoming;
      if (list.length >= 200) continue;
      list.push({ ...userCardOf(ctx, r, false), since: r.f_status === 'accepted' ? r.f_updated : r.f_created });
    }
    return ok(out);
  });

  const friendRow = (a, b) => {
    const [lo, hi] = pair(a, b);
    return db.prepare('SELECT * FROM friends WHERE user_lo = ? AND user_hi = ?').get(lo, hi) || null;
  };
  const accept = (me, other) => {
    const [lo, hi] = pair(me, other);
    return db.prepare(`UPDATE friends SET status = 'accepted', updated_at = ?
      WHERE user_lo = ? AND user_hi = ? AND status = 'pending' AND requester_id = ?`).run(nowIso(), lo, hi, other).changes;
  };

  // #25 — заявка (или сразу дружба, если человек уже просился).
  inst.post('/api/social/friends/:userId', async (req) => {
    const me = guard(req, 'SPNM');
    const id = userIdParam(req.params.userId);
    bodyOf(req);
    if (id === me.id) throw invalid(FIELD_TEXT.friendSelf);
    const t = userRow(db, id);
    if (!t) throw notFound(TEXT.profileGone);
    if (!t.username || t.status !== 'active' || blockedEither(db, me.id, id)) throw blocked(FIELD_TEXT.friendNo);
    const row = friendRow(me.id, id);
    if (row && row.status === 'accepted') return ok({ relation: 'friends' });
    if (row && row.requester_id === me.id) return ok({ relation: 'outgoing' });
    const incoming = !!row && row.requester_id === id;
    if (!incoming && t.friend_req !== 'all') throw blocked(FIELD_TEXT.friendClosed);
    limit('friend', 'u:' + me.id);
    if (incoming) {
      accept(me.id, id);
      return ok({ relation: 'friends' });
    }
    const pending = db.prepare(`SELECT COUNT(*) n FROM friends
      WHERE (user_lo = ? OR user_hi = ?) AND requester_id = ? AND status = 'pending'`).get(me.id, me.id, me.id).n;
    if (pending >= 50) throw new SocialError(429, 'rate', FIELD_TEXT.friendMany, { retryAfter: 3600 });
    const [lo, hi] = pair(me.id, id);
    const now = nowIso();
    db.prepare(`INSERT OR IGNORE INTO friends (user_lo, user_hi, requester_id, status, created_at, updated_at)
      VALUES (?,?,?,'pending',?,?)`).run(lo, hi, me.id, now, now);
    return ok({ relation: 'outgoing' });
  });

  // #26 — принять заявку.
  inst.post('/api/social/friends/:userId/accept', async (req) => {
    const me = guard(req, 'SPNM');
    const id = userIdParam(req.params.userId);
    bodyOf(req);
    const row = friendRow(me.id, id);
    if (row && row.status === 'accepted') return ok({ relation: 'friends' });
    const t = userRow(db, id);
    if (!row || row.requester_id !== id || !t || t.status !== 'active' || !t.username) throw notFound(TEXT.requestGone);
    limit('friend', 'u:' + me.id);
    if (accept(me.id, id) !== 1) throw notFound(TEXT.requestGone);
    return ok({ relation: 'friends' });
  });

  // #27 — отклонить заявку (без M: работает и в readonly).
  inst.post('/api/social/friends/:userId/decline', async (req) => {
    const me = guard(req, 'S');
    const id = userIdParam(req.params.userId);
    bodyOf(req);
    limit('unfriend', 'u:' + me.id);
    const [lo, hi] = pair(me.id, id);
    db.prepare(`DELETE FROM friends WHERE user_lo = ? AND user_hi = ? AND status = 'pending' AND requester_id = ?`)
      .run(lo, hi, id);
    return ok({ relation: id === me.id ? 'self' : relationOf(db, me.id, id) });
  });

  // #28 — удалить из друзей или отменить свою заявку.
  inst.delete('/api/social/friends/:userId', async (req) => {
    const me = guard(req, 'S');
    const id = userIdParam(req.params.userId);
    bodyOf(req);
    limit('unfriend', 'u:' + me.id);
    const [lo, hi] = pair(me.id, id);
    db.prepare(`DELETE FROM friends WHERE user_lo = ? AND user_hi = ? AND (status = 'accepted' OR requester_id = ?)`)
      .run(lo, hi, me.id);
    return ok({ relation: id === me.id ? 'self' : relationOf(db, me.id, id) });
  });

  // #29 — кого я заблокировал.
  const blockRows = db.prepare(`
    SELECT ${CARD_COLS} FROM blocks b JOIN users u ON u.id = b.blocked_id LEFT JOIN media m ON m.id = u.avatar_id
    WHERE b.blocker_id = ? AND u.username IS NOT NULL
    ORDER BY b.created_at DESC LIMIT 1000`);
  inst.get('/api/social/blocks', async (req) => {
    const me = guard(req, 'S');
    limit('read', keyOf(req));
    return ok({ items: blockRows.all(me.id).map((u) => userCardOf(ctx, u, false)) });
  });

  // #30 — заблокировать: дружба и заявки в обе стороны удаляются.
  inst.put('/api/social/blocks/:userId', async (req) => {
    const me = guard(req, 'S');
    const id = userIdParam(req.params.userId);
    bodyOf(req);
    if (id === me.id) throw invalid(FIELD_TEXT.blockSelf);
    if (!userRow(db, id)) throw notFound(TEXT.profileGone);
    limit('block', 'u:' + me.id);
    const already = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(me.id, id);
    if (!already && db.prepare('SELECT COUNT(*) n FROM blocks WHERE blocker_id = ?').get(me.id).n >= 1000) {
      throw new SocialError(429, 'rate', FIELD_TEXT.blockMany, { retryAfter: 3600 });
    }
    const [lo, hi] = pair(me.id, id);
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(me.id, id, nowIso());
      db.prepare('DELETE FROM friends WHERE user_lo = ? AND user_hi = ?').run(lo, hi);
    });
    return ok({ relation: 'blocked' });
  });

  // #31 — разблокировать.
  inst.delete('/api/social/blocks/:userId', async (req) => {
    const me = guard(req, 'S');
    const id = userIdParam(req.params.userId);
    bodyOf(req);
    limit('block', 'u:' + me.id);
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(me.id, id);
    return ok({ relation: id === me.id ? 'self' : relationOf(db, me.id, id) });
  });
}
