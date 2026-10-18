// Психологический паспорт студента (страница /psy): прохождение теста, результаты и доступ к ним.
// Тест проходит вошедший человек (аккаунт Para) — по одному ответу на аккаунт в вузе, повтор заменяет прежний.
// Результаты вуза видят модератор (SOCIAL_ADMIN_EMAILS) и те, кого он отметил (psy_viewers, по вузу).
// Сам человек видит только свой результат. Вопросы и подсчёт — src/psy/test.js.
import { social, googleConfigured } from '../config.js';
import { tx, nowIso } from './db.js';
import { SocialError, ok, invalid, notFound, forbidden, guard, isAdmin, bodyOf, userIdParam, TEXT } from './http.js';
import { limit, keyOf } from './limits.js';
import { cleanText, fold } from './text.js';
import { audit } from './moderation.js';
import { maskEmail } from './users.js';
import { shortName } from '../tenants.js';
import { testForPage, validateAnswers, scoreAnswers, PsyError, PERSONAL, FIGURE, AXES } from '../psy/test.js';

const likeEsc = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export function psyRoutes(inst, ctx) {
  const db = ctx.db;

  const isViewer = db.prepare('SELECT 1 FROM psy_viewers WHERE user_id = ? AND uni = ?');
  const canView = (u, t) => !!u && (isAdmin(u) || !!isViewer.get(u.id, t.id));
  const needViewer = (req) => {
    const u = guard(req, 'SU');
    if (!canView(u, req.tenant)) throw forbidden();
    return u;
  };

  const mine = db.prepare('SELECT * FROM psy_results WHERE user_id = ? AND uni = ?');
  const own = (row) => (!row ? null : {
    id: row.id,
    answers: JSON.parse(row.answers),
    result: JSON.parse(row.result),
    attempts: row.attempts,
    updatedAt: row.updated_at,
  });

  // Всё для страницы: кто вошёл, вопросы, свой результат и права.
  inst.get('/api/social/psy/me', async (req) => {
    const u = req.user;
    guard(req, 'U');                     // возвращает пользователя (у гостя null), вуз — req.tenant
    const t = req.tenant;
    limit('read', keyOf(req));
    return ok({
      uni: { id: t.id, label: shortName(t), university: t.brand.university },
      user: u ? { id: u.id, name: u.name || u.google_name || '', email: maskEmail(u.email) } : null,
      google: googleConfigured(),
      signin: social.mode !== 'off',
      minAge: social.minAge,
      test: testForPage(),
      mine: u ? own(mine.get(u.id, t.id)) : null,
      canView: canView(u, t),
      isAdmin: isAdmin(u),
    });
  });

  // Для приглашения в приложении (psy/nudge.js): прошёл ли человек тест — без вопросов и ответов.
  const passed = db.prepare('SELECT 1 FROM psy_results WHERE user_id = ? AND uni = ?');
  inst.get('/api/social/psy/status', async (req) => {
    const u = req.user;
    guard(req, 'U');
    limit('read', keyOf(req));
    return ok({ signedIn: !!u, passed: !!u && !!passed.get(u.id, req.tenant.id) });
  });

  // Пример результата для главной страницы теста — без входа, ответы выдуманные.
  const sample = scoreAnswers({ q: [0, 1, 0, 0, 1, 1, 0, 2, 0, 1, 1, 0], figure: 'triangle',
    lateral: { fingers: 'R', eye: 'L', arms: 'L', clap: 'R' } });
  inst.get('/api/social/psy/sample', async (req) => {
    guard(req, 'U');
    limit('read', keyOf(req));
    return ok(sample);
  });

  // Прохождение: ответы проверяются и считаются здесь, страница получает готовый итог.
  const upsert = db.prepare(`
    INSERT INTO psy_results (user_id, uni, fio, fio_fold, grp, birth, answers, result, temperament, figure, profile, created_at, updated_at)
    VALUES ($user, $uni, $fio, $fold, $grp, $birth, $answers, $result, $temp, $figure, $profile, $now, $now)
    ON CONFLICT (user_id, uni) DO UPDATE SET
      fio = excluded.fio, fio_fold = excluded.fio_fold, grp = excluded.grp, birth = excluded.birth,
      answers = excluded.answers, result = excluded.result, temperament = excluded.temperament,
      figure = excluded.figure, profile = excluded.profile, attempts = attempts + 1, updated_at = excluded.updated_at`);
  inst.post('/api/social/psy/submit', async (req) => {
    const u = guard(req, 'SU');
    const t = req.tenant;
    limit('profile', keyOf(req));
    let a;
    try {
      a = validateAnswers(bodyOf(req), cleanText);
    } catch (err) {
      if (err instanceof PsyError) throw invalid(err.message);
      throw err;
    }
    const result = scoreAnswers(a);
    upsert.run({
      $user: u.id, $uni: t.id, $fio: a.fio, $fold: fold(a.fio), $grp: a.group, $birth: a.birth,
      $answers: JSON.stringify(a), $result: JSON.stringify(result), $temp: result.temperament.lead,
      $figure: a.figure, $profile: result.lateral.code, $now: nowIso(),
    });
    return ok(own(mine.get(u.id, t.id)));
  });

  // ─── Результаты вуза (модератор и отмеченные им) ───

  const listAll = db.prepare(`
    SELECT r.id, r.fio, r.grp, r.birth, r.temperament, r.figure, r.profile, r.result, r.attempts, r.updated_at
    FROM psy_results r WHERE r.uni = $uni
      AND ($q = '' OR r.fio_fold LIKE $like ESCAPE '\\' OR lower(r.grp) LIKE $like ESCAPE '\\')
    ORDER BY r.updated_at DESC LIMIT 5000`);
  const rowItem = (r) => {
    const res = JSON.parse(r.result);
    return {
      id: r.id, fio: r.fio, group: r.grp, birth: r.birth, updatedAt: r.updated_at, attempts: r.attempts,
      temperament: r.temperament, archetype: res.headline.archetype, subtitle: res.headline.subtitle,
      figure: r.figure, profile: r.profile, style: res.lateral.style.name,
      axes: res.axes.map((x) => x.value),
    };
  };
  inst.get('/api/social/psy/results', async (req) => {
    needViewer(req);
    limit('read', keyOf(req));
    const q0 = (req.query || {}).q;
    const q = fold(cleanText(typeof q0 === 'string' ? q0 : '', { multiline: false })).slice(0, 60);
    const items = listAll.all({ $uni: req.tenant.id, $q: q, $like: `%${likeEsc(q)}%` }).map(rowItem);
    return ok({ items });
  });

  const one = db.prepare(`SELECT r.*, u.username, u.name AS account_name FROM psy_results r
    LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ? AND r.uni = ?`);
  inst.get('/api/social/psy/results/:id', async (req) => {
    needViewer(req);
    limit('read', keyOf(req));
    const r = one.get(userIdParam(req.params.id), req.tenant.id);
    if (!r) throw notFound('Результат не найден');
    return ok({
      id: r.id, fio: r.fio, group: r.grp, birth: r.birth, createdAt: r.created_at, updatedAt: r.updated_at, attempts: r.attempts,
      account: { username: r.username || null, name: r.account_name || '' },
      answers: JSON.parse(r.answers),
      result: JSON.parse(r.result),
    });
  });

  inst.delete('/api/social/psy/results/:id', async (req) => {
    const me = guard(req, 'SUA');
    limit('admin', keyOf(req));
    const id = userIdParam(req.params.id);
    const r = db.prepare('DELETE FROM psy_results WHERE id = ? AND uni = ? RETURNING user_id').get(id, req.tenant.id);
    if (!r) throw notFound('Результат не найден');
    audit(db, me.id, 'psy.result.delete', 'u:' + r.user_id, req.tenant.id, { id });
    return ok(null);
  });

  // Полный список таблицей (Excel открывает CSV с BOM как UTF-8).
  inst.get('/api/social/psy/export.csv', async (req, reply) => {
    needViewer(req);
    limit('read', keyOf(req));
    const rows = db.prepare('SELECT * FROM psy_results WHERE uni = ? ORDER BY grp, fio').all(req.tenant.id);
    const head = ['Ф.И.О.', 'Группа', 'Дата рождения', 'Семейное положение', 'Семейная ситуация', 'Проживание',
      'Свободное время', 'Интересы', 'Тип', 'Темперамент', 'Сангвиник %', 'Холерик %', 'Флегматик %', 'Меланхолик %',
      'Фигура', 'Латеральный профиль', 'Стиль', ...AXES.map((x) => x.label), 'Пройден', 'Попыток'];
    const plain = (s) => String(s).split(' · ')[0];
    const lines = [head];
    for (const r of rows) {
      const a = JSON.parse(r.answers);
      const res = JSON.parse(r.result);
      lines.push([
        r.fio, r.grp, r.birth, plain(PERSONAL.family[a.family]),
        a.upbringing === -1 ? a.upbringingOther : plain(PERSONAL.upbringing[a.upbringing]),
        a.living === -1 ? a.livingOther : plain(PERSONAL.living[a.living]),
        a.freeTime, a.interests, res.headline.archetype, res.headline.subtitle,
        ...res.temperament.list.map((x) => x.pct),
        FIGURE[r.figure].name, r.profile, res.lateral.style.name,
        ...res.axes.map((x) => x.value),
        r.updated_at.slice(0, 16).replace('T', ' '), r.attempts,
      ]);
    }
    // Ячейка, начинающаяся с = + - @, в Excel станет формулой — экранируем апострофом.
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + lines.map((l) => l.map(cell).join(';')).join('\r\n');
    const name = `psy-${req.tenant.id}-${nowIso().slice(0, 10)}.csv`;
    reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`);
    return csv;
  });

  // ─── Доступ к результатам (только модератор) ───

  const viewersOf = db.prepare(`SELECT v.user_id, v.created_at, u.name, u.username, u.email FROM psy_viewers v
    JOIN users u ON u.id = v.user_id WHERE v.uni = ? ORDER BY v.created_at`);
  const person = (u) => ({ id: u.user_id ?? u.id, name: u.name || '', username: u.username || null, email: u.email });
  inst.get('/api/social/psy/viewers', async (req) => {
    guard(req, 'SUA');
    limit('read', keyOf(req));
    return ok(viewersOf.all(req.tenant.id).map((v) => ({ ...person(v), since: v.created_at })));
  });

  const findUsers = db.prepare(`SELECT id, name, username, email FROM users
    WHERE name_fold LIKE $like ESCAPE '\\' OR username LIKE $like ESCAPE '\\' OR lower(email) LIKE $like ESCAPE '\\'
       OR lower(google_name) LIKE $like ESCAPE '\\'
    ORDER BY id DESC LIMIT 20`);
  inst.get('/api/social/psy/accounts', async (req) => {
    guard(req, 'SUA');
    limit('search', keyOf(req));
    const q0 = (req.query || {}).q;
    const q = fold(cleanText(typeof q0 === 'string' ? q0 : '', { multiline: false })).replace(/^@/, '').slice(0, 60);
    if (q.length < 2) return ok([]);
    const granted = new Set(viewersOf.all(req.tenant.id).map((v) => v.user_id));
    return ok(findUsers.all({ $like: `%${likeEsc(q)}%` }).map((u) => ({ ...person(u), viewer: granted.has(u.id), team: isAdmin(u) })));
  });

  inst.post('/api/social/psy/viewers', async (req) => {
    const me = guard(req, 'SUA');
    limit('admin', keyOf(req));
    const id = userIdParam(bodyOf(req).userId);
    tx(db, () => {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw new SocialError(404, 'not_found', TEXT.profileGone);
      db.prepare('INSERT OR IGNORE INTO psy_viewers (user_id, uni, granted_by, created_at) VALUES (?,?,?,?)')
        .run(id, req.tenant.id, me.id, nowIso());
      audit(db, me.id, 'psy.viewer.grant', 'u:' + id, req.tenant.id);
    });
    return ok(null);
  });

  inst.delete('/api/social/psy/viewers/:id', async (req) => {
    const me = guard(req, 'SUA');
    limit('admin', keyOf(req));
    const id = userIdParam(req.params.id);
    db.prepare('DELETE FROM psy_viewers WHERE user_id = ? AND uni = ?').run(id, req.tenant.id);
    audit(db, me.id, 'psy.viewer.revoke', 'u:' + id, req.tenant.id);
    return ok(null);
  });
}
