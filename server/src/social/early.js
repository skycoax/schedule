// Ранний доступ в Google Play (CONTRACT.md §L). Человек сам нажимает «Хочу» в карточке «Ранний доступ» и соглашается,
// чтобы почту его аккаунта Google добавили в список тестеров Para в Google Play. Почта не копируется: выгрузка берёт
// её из users, поэтому удаление аккаунта (каскад) и «Выйти из списка» убирают человека из выгрузки сами.
// Выгрузка — только модератору: почты через запятую, как их принимает Play Console.
import { nowIso } from './db.js';
import { bodyOf, guard, invalid, ok } from './http.js';
import { keyOf, limit } from './limits.js';

/** Записан ли человек на ранний доступ — для Me. */
export const earlyOf = (db, userId) => !!db.prepare('SELECT 1 FROM early_access WHERE user_id = ?').get(userId);

/**
 * POST /api/social/early         — { consent: true }: записаться (только вошедшему; без согласия — 400).
 * POST /api/social/early/remove  — выйти из списка.
 * GET  /api/social/admin/early   — модератору: { count, emails } — почты через запятую, в порядке записи.
 * Работают во всех режимах SOCIAL_MODE: к «Обсуждениям» отношения не имеют.
 */
export function earlyRoutes(inst, ctx) {
  const db = ctx.db;
  const st = {
    join: db.prepare('INSERT OR IGNORE INTO early_access (user_id, created_at) VALUES (?, ?)'),
    leave: db.prepare('DELETE FROM early_access WHERE user_id = ?'),
    emails: db.prepare(`SELECT u.email FROM early_access e JOIN users u ON u.id = e.user_id
      ORDER BY e.created_at, e.user_id`),
  };

  inst.post('/api/social/early', async (req) => {
    const u = guard(req, 'S');
    const b = bodyOf(req);
    limit('profile', keyOf(req));
    if (b.consent !== true) throw invalid('Нужно согласие на передачу почты в Google Play', 'consent');
    st.join.run(u.id, nowIso());
    return ok({ earlyAccess: true });
  });

  inst.post('/api/social/early/remove', async (req) => {
    const u = guard(req, 'S');
    limit('profile', keyOf(req));
    st.leave.run(u.id);
    return ok({ earlyAccess: false });
  });

  inst.get('/api/social/admin/early', async (req) => {
    guard(req, 'SA');
    limit('admin', keyOf(req));
    const emails = st.emails.all().map((r) => r.email).filter(Boolean);
    return ok({ count: emails.length, emails: emails.join(', ') });
  });
}
