// «Оценки и отзывы» на главном экране — по мотивам App Store: крупная средняя,
// разброс по звёздам, «нажми, чтобы оценить» и карусель свежих комментариев.
// Текст отзывов выводится обычным JSX ({r.text}) — React экранирует его сам (см. ReviewsModal).
import type { ReviewsData } from '../api';
import { plural } from '../lib/plural';
import { StarPicker, Stars } from './stars';
import { fmtDate } from './ReviewsModal';

export function ReviewsBlock({ data, myRating, onOpen, onRate }: {
  data: ReviewsData | null;
  myRating: number;
  onOpen: () => void;
  onRate: (rating: number) => void;
}) {
  const count = data?.count || 0;
  const dist = data?.dist || [0, 0, 0, 0, 0];
  // Карусель — только отзывы с текстом: строка из одних звёзд ничего не рассказывает,
  // а в средней оценке и гистограмме они и так учтены.
  const comments = (data?.items || []).filter((r) => r.text).slice(0, 3);

  return (
    <section className="sec">
      <div className="sec__h">
        <h2 className="sec__t">Оценки и отзывы</h2>
        <button className="sec__a" onClick={onOpen}>Все</button>
      </div>

      <div className="panel rate">
        <button className="rate__sum" onClick={onOpen}>
          <span className="rate__avg">
            <b>{count ? (data?.average ?? 0).toFixed(1).replace('.', ',') : '—'}</b>
            <span>из 5</span>
          </span>
          <span className="rate__dist" aria-hidden="true">
            {[5, 4, 3, 2, 1].map((s) => (
              <span className="rate__line" key={s}>
                <span className="rate__stars">{'★'.repeat(s)}</span>
                <span className="rate__bar"><i style={{ width: (count ? (dist[s - 1] / count) * 100 : 0) + '%' }} /></span>
              </span>
            ))}
            <span className="rate__count">
              {count ? `${count} ${plural(count, ['оценка', 'оценки', 'оценок'])}` : 'Оценок пока нет'}
            </span>
          </span>
        </button>
        <div className="rate__tap">
          <span className="rate__hint">{myRating ? 'Твоя оценка' : 'Нажми, чтобы оценить'}</span>
          <StarPicker value={myRating} onChange={onRate} size={25} emptyColor="var(--c2)" />
        </div>
      </div>

      {data && (comments.length ? (
        <div className="revs">
          {comments.map((r, i) => (
            <button className="revc" key={i} onClick={onOpen}>
              <span className="revc__top">
                <Stars value={r.rating} size={12} />
                <span className="revc__date">{fmtDate(r.ts)}</span>
              </span>
              <span className="revc__text">{r.text}</span>
              <span className="revc__name">{r.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="revs-empty">
          Комментариев пока нет. Поставь оценку и напиши пару слов — твой отзыв появится здесь первым.
        </p>
      ))}
    </section>
  );
}
