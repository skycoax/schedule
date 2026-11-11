// Расширенная статистика заходов — только модератору (SOCIAL_ADMIN_EMAILS).
// Всем открыта общая картина (/api/stats, analytics.js → publicStats); здесь — всё, включая устройства,
// марки и модели телефонов, браузеры, системы, язык, а ещё дни недели, верность, экраны и сравнение вузов.
// Рисует это src/stats/admin.js внутри «Статистики» приложения.
import { ok, guard } from './http.js';
import { limit, keyOf } from './limits.js';
import { fullStats, deepAnalytics, pulse } from '../analytics.js';
import { getLatestSchedule } from '../store.js';
import { listReviews } from '../reviews.js';
import { shortName } from '../tenants.js';

export function statsRoutes(inst, ctx) {
  inst.get('/api/social/stats/full', async (req) => {
    guard(req, 'SAU');
    limit('read', keyOf(req));
    const t = req.tenant;
    const reviews = listReviews(t, 0);
    return ok({
      ...fullStats(t),
      uni: shortName(t),
      reviews: { average: reviews.average, count: reviews.count, dist: reviews.dist },
      // Люди по вузам — для доли выбранного вуза среди всех (pulse кеширован на 5 минут).
      byUni: ctx.tenants
        .map((x) => ({ name: shortName(x), n: pulse(x).people, current: x.id === t.id }))
        .filter((x) => x.n)
        .sort((a, b) => b.n - a.n),
    });
  });

  // Страница /analytics: охват групп и курсов, постоянство, полные списки.
  inst.get('/api/social/stats/analytics', async (req) => {
    guard(req, 'SAU');
    limit('read', keyOf(req));
    const t = req.tenant;
    return ok({
      uni: { id: t.id, label: shortName(t), university: t.brand.university },
      unis: ctx.tenants.map((x) => ({ id: x.id, label: shortName(x) })),
      ...deepAnalytics(t, getLatestSchedule(t)),
    });
  });
}
