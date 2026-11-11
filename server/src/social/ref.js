// «Позови друга»: у каждого аккаунта своя ссылка. Новое устройство, пришедшее по ней и открывшее расписание
// два разных дня, приносит пригласившему баллы; набранные баллы открывают значки у имени (users.badge).
// Окно приглашения — src/ref/ref.js (сервер добавляет его в страницу, site.js). Друг получает просто ссылку:
// ни приветствия, ни мема у него нет. Столбец ref_codes.style от прежнего выбора мема больше не читается.
//
// Защита от накрутки без лишних данных:
//   • устройство (cid браузера) засчитывается одному пригласившему и только если до перехода оно Para не открывало;
//   • балл — только когда устройство заходило два разных дня (по журналу заходов вуза);
//   • с одного IP (солёный хеш) одному пригласившему — не больше IP_CAP устройств; себя пригласить нельзя.
import { randomBytes } from 'node:crypto';
import { tx, nowIso } from './db.js';
import { ok, invalid, guard, bodyOf, clientIp } from './http.js';
import { limit, keyOf, ipKey } from './limits.js';
import { ipParts } from '../analytics.js';
import { shortName } from '../tenants.js';

export const POINTS_PER_FRIEND = 10;
const IP_CAP = 3;
const NEW_WINDOW_MS = 15 * 60 * 1000;   // заходы раньше этого до перехода — устройство уже пользовалось Para

// Значки за баллы (id — как в users.js BADGES и в приложении). Золотая и серая галочки — только от модератора.
export const REWARDS = [
  { badge: 'blue', label: 'Синяя галочка', points: 30 },
  { badge: 'heart', label: 'Сердечко', points: 40 },
  { badge: 'green', label: 'Зелёная галочка', points: 50 },
  { badge: 'fire', label: 'Огонь', points: 70 },
  { badge: 'purple', label: 'Фиолетовая галочка', points: 80 },
  { badge: 'star', label: 'Звезда', points: 100 },
  { badge: 'bolt', label: 'Молния', points: 120 },
  { badge: 'gem', label: 'Кристалл', points: 150 },
  { badge: 'crown', label: 'Корона', points: 300 },
];
// Пол — только чтобы выбрать мем в окне приглашения (котик девушке, обнимашки парню). Смотрим окончание фамилии
// или отчества: Каримова / Karimova / Alisherovna / Rustam qizi — у нас они почти всегда по полу. По одному имени
// не гадаем; не понятно — null, тогда окно само спросит человека. Нигде не хранится.
const FEM = /(ова|ева|ёва|ина|ская|цкая|овна|евна|ична|кизи|кизы|қизи|qizi|kizi|ova|eva|yeva|ina|skaya|ovna|evna|ichna)$/;
const MASC = /(ов|ев|ёв|ский|цкий|ович|евич|оглы|угли|ўғли|ogli|ugli|ov|ev|yev|skiy|skij|ovich|evich)$/;
function genderOf(u) {
  let f = 0, m = 0;
  for (const w of `${u.google_name || ''} ${u.name || ''}`.toLowerCase().replace(/[ʻʼ'`’‘]/g, '').split(/[\s\-.,]+/)) {
    if (w.length < 4) continue;
    if (FEM.test(w)) f++;
    else if (MASC.test(w)) m++;
  }
  return f && !m ? 'f' : m && !f ? 'm' : null;
}

const CODE_RE = /^[a-z0-9]{6,12}$/;
const CID_RE = /^[a-z0-9]{6,32}$/i;

const newCode = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = randomBytes(7);
  let s = '';
  for (const x of b) s += abc[x % abc.length];
  return s;
};
const dayCount = (t, cid) => t.db.prepare(
  "SELECT COUNT(DISTINCT substr(datetime(ts,'+5 hours'),1,10)) d, MIN(ts) first FROM hits WHERE cid = ?").get(cid);

export function refRoutes(inst, ctx) {
  const db = ctx.db;
  const tenantOf = (id) => ctx.tenants.find((t) => t.id === id) || null;

  const codeOf = db.prepare('SELECT * FROM ref_codes WHERE user_id = ?');
  const byCode = db.prepare('SELECT r.user_id, u.status FROM ref_codes r JOIN users u ON u.id = r.user_id WHERE r.code = ?');
  const insCode = db.prepare('INSERT OR IGNORE INTO ref_codes (user_id, code, created_at) VALUES (?,?,?)');
  const pending = db.prepare('SELECT id, uni, cid FROM ref_visits WHERE owner_id = ? AND confirmed_at IS NULL');
  const confirm = db.prepare('UPDATE ref_visits SET confirmed_at = ? WHERE id = ?');
  const counts = db.prepare(`SELECT COUNT(confirmed_at) confirmed, COUNT(*) - COUNT(confirmed_at) waiting
    FROM ref_visits WHERE owner_id = ?`);
  const seenCid = db.prepare('SELECT 1 FROM ref_visits WHERE cid = ?');
  const sameIp = db.prepare('SELECT COUNT(*) n FROM ref_visits WHERE owner_id = ? AND ip_hash = ?');
  const insVisit = db.prepare('INSERT OR IGNORE INTO ref_visits (owner_id, uni, cid, ip_hash, created_at) VALUES (?,?,?,?,?)');
  const setBadge = db.prepare('UPDATE users SET badge = ? WHERE id = ?');

  function ensureCode(u) {
    let row = codeOf.get(u.id);
    for (let i = 0; !row && i < 5; i++) {
      insCode.run(u.id, newCode(), nowIso());
      row = codeOf.get(u.id);
    }
    return row;
  }

  // Ожидающие устройства: заходили два разных дня — засчитываем.
  function settle(userId) {
    const now = nowIso();
    for (const v of pending.all(userId)) {
      const t = tenantOf(v.uni);
      if (t && dayCount(t, v.cid).d >= 2) confirm.run(now, v.id);
    }
    const c = counts.get(userId);
    return { confirmed: c.confirmed, waiting: c.waiting, points: c.confirmed * POINTS_PER_FRIEND };
  }

  const linkFor = (req, code) => {
    const host = req.headers.host;
    const uni = req.hub && req.tenant ? 'uni=' + encodeURIComponent(req.tenant.id) + '&' : '';
    return `https://${host}/?${uni}r=${code}&from=ref`;
  };

  // Своя ссылка, баллы и значки.
  inst.get('/api/social/ref/me', async (req) => {
    const u = guard(req, 'SU');
    limit('read', keyOf(req));
    const row = ensureCode(u);
    const s = settle(u.id);
    return ok({
      code: row.code,
      link: linkFor(req, row.code),
      uni: shortName(req.tenant),
      name: u.name || u.google_name || '',
      gender: genderOf(u),
      perFriend: POINTS_PER_FRIEND,
      ...s,
      badge: u.badge || null,
      rewards: REWARDS.map((r) => ({ ...r, unlocked: s.points >= r.points })),
    });
  });

  // Поставить открытый значок (или снять: badge = null).
  inst.post('/api/social/ref/badge', async (req) => {
    const u = guard(req, 'SN');
    limit('ref', keyOf(req));
    const badge = bodyOf(req).badge;
    if (badge !== null) {
      const r = REWARDS.find((x) => x.badge === badge);
      if (!r) throw invalid('Такого значка нет', 'badge');
      if (settle(u.id).points < r.points) throw invalid('Не хватает баллов — позови ещё друзей', 'badge');
    }
    setBadge.run(badge, u.id);
    return ok({ badge });
  });

  // Устройство открыло ссылку: запоминаем, если оно новое. Балл придёт, когда оно зайдёт второй день.
  inst.post('/api/social/ref/visit', async (req) => {
    guard(req, 'U');
    limit('ref', ipKey(req));
    const b = bodyOf(req);
    const code = String(b.code || '').toLowerCase();
    const cid = String(b.cid || '');
    if (!CODE_RE.test(code) || !CID_RE.test(cid)) throw invalid();
    const owner = byCode.get(code);
    if (!owner || owner.status !== 'active') return ok({ counted: false, reason: 'code' });
    if (req.user && req.user.id === owner.user_id) return ok({ counted: false, reason: 'self' });
    const t = req.tenant;
    const hist = dayCount(t, cid);
    if (hist.first && Date.parse(hist.first) < Date.now() - NEW_WINDOW_MS) return ok({ counted: false, reason: 'old' });
    const ip = ipParts(clientIp(req)).hash;
    const counted = tx(db, () => {
      if (seenCid.get(cid)) return false;
      if (ip && sameIp.get(owner.user_id, ip).n >= IP_CAP) return false;
      return insVisit.run(owner.user_id, t.id, cid, ip, nowIso()).changes === 1;
    });
    return ok({ counted });
  });
}
