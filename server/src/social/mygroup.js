// «Моя группа»: человек сам говорит, где учится, — отвечает на «Ты учишься в группе …?» (src/me/group.js
// предлагает группу, открытую в приложении) или выбирает её в профиле. «Не скажу» — тоже ответ, больше не спрашиваем.
// Группу видят только разработчик и модераторы: аудит аккаунтов на /analytics — сколько людей с каких факультетов
// и курсов, у кого какой аккаунт Google, кто давно не заходил. Со статистикой заходов (cid) это не связывается:
// что человек смотрит в расписании, остаётся обезличенным (политика, «Моя группа»).
import { nowIso } from './db.js';
import { ok, invalid, guard, bodyOf } from './http.js';
import { limit, keyOf } from './limits.js';
import { courseLabel, facultyLabel } from '../analytics.js';
import { getLatestSchedule } from '../store.js';
import { shortName } from '../tenants.js';

const MAX_GRP = 200;

// Группы вуза из последнего снимка расписания: название, курс, факультет.
function groupsOf(t) {
  const s = t && getLatestSchedule(t);
  return ((s && s.groups) || []).map((g) => ({ key: g.key, name: g.name, course: courseLabel(g), faculty: facultyLabel(g) }));
}
const fold = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export function mygroupRoutes(inst, ctx) {
  const db = ctx.db;
  const tenantOf = (id) => ctx.tenants.find((t) => t.id === id) || null;
  const save = db.prepare('UPDATE users SET grp = ?, grp_uni = ?, grp_at = ? WHERE id = ?');

  // Своя группа и, по ?list=1, все группы выбранного вуза — для выбора.
  inst.get('/api/social/mygroup', async (req) => {
    const u = guard(req, 'SU');
    limit('read', keyOf(req));
    const t = req.tenant;
    const own = u.grp ? groupsOf(tenantOf(u.grp_uni)).find((g) => g.name === u.grp) : null;
    return ok({
      grp: u.grp || null,
      grpUni: u.grp_uni || null,
      grpUniLabel: u.grp_uni && tenantOf(u.grp_uni) ? shortName(tenantOf(u.grp_uni)) : null,
      course: own ? own.course : null,
      faculty: own ? own.faculty : null,
      answered: !!u.grp_at,
      uni: t.id,
      uniLabel: shortName(t),
      groups: req.query && req.query.list === '1' ? groupsOf(t).map(({ name, course, faculty }) => ({ name, course, faculty })) : undefined,
    });
  });

  // grp — название или ключ группы выбранного вуза; null — «не скажу» / убрать.
  inst.post('/api/social/mygroup', async (req) => {
    const u = guard(req, 'SU');
    limit('profile', keyOf(req));
    const raw = bodyOf(req).grp;
    if (raw === null) {
      save.run(null, null, nowIso(), u.id);
      return ok({ grp: null });
    }
    if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_GRP) throw invalid('Выбери группу из списка', 'grp');
    const want = fold(raw);
    const g = groupsOf(req.tenant).find((x) => x.key === raw || fold(x.name) === want);
    if (!g) throw invalid('Такой группы в расписании нет', 'grp');
    save.run(g.name, req.tenant.id, nowIso(), u.id);
    return ok({ grp: g.name, course: g.course, faculty: g.faculty });
  });

  // Аудит аккаунтов — только модератору. Вуз — выбранный (аккаунты с этим «моим вузом», группой или тестом в нём),
  // ?all=1 — все вузы. Группа: сам указал (self), иначе из психотеста (test) — её человек тоже вписал сам.
  const people = db.prepare(`
    SELECT u.id, u.username, u.name, u.google_name, u.email, u.email_verified, u.age_group, u.uni, u.grp, u.grp_uni, u.grp_at,
      u.google_hd, u.google_locale, u.signup_host, u.signup_device, u.created_at, u.last_login_at, u.login_count,
      u.status, u.badge, u.google_sub LIKE 'dev:%' AS dev,
      (SELECT MAX(s.seen_at) FROM sessions s WHERE s.user_id = u.id) AS seen,
      (SELECT GROUP_CONCAT(DISTINCT s.device) FROM sessions s WHERE s.user_id = u.id AND s.device <> '') AS devices,
      (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS posts,
      (SELECT COUNT(*) FROM friends f WHERE (f.user_lo = u.id OR f.user_hi = u.id) AND f.status = 'accepted') AS friends,
      (SELECT r.grp FROM psy_results r WHERE r.user_id = u.id ORDER BY r.updated_at DESC LIMIT 1) AS psy_grp,
      (SELECT r.uni FROM psy_results r WHERE r.user_id = u.id ORDER BY r.updated_at DESC LIMIT 1) AS psy_uni
    FROM users u
    WHERE ? = '' OR u.uni = ? OR u.grp_uni = ? OR EXISTS (SELECT 1 FROM psy_results r WHERE r.user_id = u.id AND r.uni = ?)
    ORDER BY u.created_at DESC`);

  inst.get('/api/social/stats/people', async (req) => {
    guard(req, 'SAU');
    limit('read', keyOf(req));
    const all = req.query && req.query.all === '1';
    const uni = all ? '' : req.tenant.id;
    const maps = new Map();   // вуз → (название без регистра → группа)
    const lookup = (uniId, name) => {
      if (!uniId || !name) return null;
      if (!maps.has(uniId)) maps.set(uniId, new Map(groupsOf(tenantOf(uniId)).map((g) => [fold(g.name), g])));
      return maps.get(uniId).get(fold(name)) || null;
    };
    const label = (id) => (id && tenantOf(id) ? shortName(tenantOf(id)) : id || '');
    const list = people.all(uni, uni, uni, uni).map((r) => {
      const self = r.grp ? lookup(r.grp_uni, r.grp) : null;
      const test = r.psy_grp ? lookup(r.psy_uni, r.psy_grp) : null;
      const g = self || (r.grp ? null : test);
      return {
        id: r.id,
        username: r.username || '',
        name: r.name || '',
        googleName: r.google_name || '',
        email: r.email || '',
        verified: !!r.email_verified,
        minor: r.age_group === 'minor',
        uni: r.uni || '', uniLabel: label(r.uni),
        grp: r.grp || (test ? test.name : r.psy_grp || ''),
        grpUni: label(r.grp ? r.grp_uni : r.psy_uni),
        source: r.grp ? 'self' : r.psy_grp ? 'test' : r.grp_at ? 'declined' : 'none',
        testGrp: r.psy_grp || '',
        course: g ? g.course : '',
        faculty: g ? g.faculty : '',
        inSchedule: !!g,
        answeredAt: r.grp_at || null,
        workspace: r.google_hd || '',
        locale: r.google_locale || '',
        signupHost: r.signup_host || '',
        signupDevice: r.signup_device || '',
        created: r.created_at,
        lastLogin: r.last_login_at || null,
        logins: r.login_count || 0,
        seen: r.seen || (r.last_login_at ? String(r.last_login_at).slice(0, 10) : null),
        devices: r.devices ? String(r.devices).split(',') : [],
        posts: r.posts, friends: r.friends,
        status: r.status, badge: r.badge || null, dev: !!r.dev,
      };
    });
    return ok({ uni: all ? null : { id: req.tenant.id, label: shortName(req.tenant) }, people: list });
  });
}
