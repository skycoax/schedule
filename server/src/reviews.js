// Отзывы: без регистрации, оценка 1-5 звёзд + необязательные имя и текст.
//
// Защита от XSS - НЕ регэксп-фильтр "для вида". Настоящая защита ниже, в
// React (web/src/components/reviews.tsx): текст выводится как обычный текст
// JSX ({text}), а не через innerHTML/dangerouslySetInnerHTML - движок сам
// экранирует <, >, &, кавычки при выводе, так что даже нетронутый <script>
// на экране становится просто буквами, а не кодом. То, что вырезается здесь,
// на сервере, - это подстраховка на случай, если данные когда-нибудь попадут
// в менее безопасное место (письмо, экспорт), а не единственная линия защиты.
//
// Антиспам: не чаще одного отзыва с этого браузера за 10 минут, не больше
// 5 отзывов в час с одного IP (IP не хранится сырым - см. analytics.js).
// Функции берут t — вуз: у каждого вуза свои отзывы в своей базе.
import { ipParts } from './analytics.js';

var CTRL_RE = new RegExp(
  '[' +
    '\\x00-\\x08' + // NUL..BS
    '\\x0B\\x0C' +  // VT, FF
    '\\x0E-\\x1F' + // SO..US
    '\\x7F' +       // DEL
  ']',
  'g'
);

function stripTags(s) {
  var out = String(s == null ? '' : s);
  out = out.replace(/<[^>]*>/g, '');   // теги целиком
  out = out.replace(CTRL_RE, '');      // управляющие символы (таб/перевод строки оставляем)
  out = out.replace(/\n{3,}/g, '\n\n'); // не растягивать отзыв пустыми строками
  return out.trim();
}

export class ReviewError extends Error {}

export function addReview(t, { cid, name, rating, text, ip }) {
  const r = Math.round(Number(rating));
  if (!(r >= 1 && r <= 5)) throw new ReviewError('Оценка должна быть от 1 до 5 звёзд');

  const cidClean = String(cid || '').slice(0, 32);
  const nameClean = stripTags(name).slice(0, 40) || 'Аноним';
  const textClean = stripTags(text).slice(0, 500);
  const ipHash = ipParts(ip).hash;
  const now = Date.now();

  if (cidClean) {
    const last = t.db.prepare('SELECT ts FROM reviews WHERE cid = ? ORDER BY id DESC LIMIT 1').get(cidClean);
    if (last && now - new Date(last.ts).getTime() < 10 * 60 * 1000) {
      throw new ReviewError('Можно оставить отзыв раз в 10 минут с одного устройства');
    }
  }
  if (ipHash) {
    const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const recent = t.db.prepare('SELECT COUNT(*) n FROM reviews WHERE ip_hash = ? AND ts > ?').get(ipHash, hourAgo);
    if (recent.n >= 5) throw new ReviewError('Слишком много отзывов подряд - попробуй позже');
  }

  t.db.prepare(`
    INSERT INTO reviews (ts, cid, name, rating, text, ip_hash) VALUES (?,?,?,?,?,?)
  `).run(new Date().toISOString(), cidClean, nameClean, r, textClean, ipHash);

  return { name: nameClean, rating: r, text: textClean };
}

export function listReviews(t, limit = 50) {
  const rows = t.db.prepare('SELECT ts, name, rating, text FROM reviews ORDER BY id DESC LIMIT ?').all(limit);
  const agg = t.db.prepare('SELECT COUNT(*) n, AVG(rating) a FROM reviews').get();
  // Разброс по звёздам для гистограммы: dist[0] — единицы, dist[4] — пятёрки.
  const dist = [0, 0, 0, 0, 0];
  t.db.prepare('SELECT rating, COUNT(*) n FROM reviews GROUP BY rating').all()
    .forEach((r) => { if (r.rating >= 1 && r.rating <= 5) dist[r.rating - 1] = r.n; });
  return {
    average: agg.n ? Math.round(agg.a * 10) / 10 : 0,
    count: agg.n,
    dist,
    items: rows,
  };
}
