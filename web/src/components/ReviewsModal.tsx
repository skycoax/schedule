// Отзывы — открыты всем, без регистрации. Текст выводится как обычный текст
// JSX ({r.text}) — React экранирует его сам, поэтому даже вставленный <script>
// становится просто буквами на экране, а не кодом. Это и есть защита от XSS.
import { useEffect, useState } from 'react';
import { getReviews, submitReview, type ReviewsData } from '../api';
import { store } from '../lib/store';
import { plural } from '../lib/plural';
import { StarPicker, Stars } from './stars';

const RATINGS: [string, string, string] = ['оценка', 'оценки', 'оценок'];

export function fmtDate(ts: string): string {
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// initialRating — звезда, которую уже нажали в блоке на главном экране:
// модал открывается сразу с ней и полем для текста, без второго нажатия.
export function ReviewsModal({ open, initialRating = 0, onClose }: {
  open: boolean; initialRating?: number; onClose: () => void;
}) {
  const [data, setData] = useState<ReviewsData | null>(null);
  const [err, setErr] = useState('');
  const [rating, setRating] = useState(0);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const load = () => { getReviews().then(setData).catch((e) => setErr(String(e.message || e))); };

  useEffect(() => {
    if (!open) return;
    load();
    setSent(false); setErr(''); setRating(initialRating);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRating]);

  const send = () => {
    if (!rating) return;
    setSending(true); setErr('');
    submitReview({ cid: store('cid') || '', name, rating, text })
      .then(() => {
        store('reviewedAt', String(Date.now()));
        store('myRating', String(rating));
        setSent(true); setRating(0); setName(''); setText('');
        load();
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setSending(false));
  };

  // Оценка без текста ничего не рассказывает, поэтому такие не перечисляем по одной
  // («Аноним», «Аноним», «Макс»…), а сворачиваем в одну строку: «Ещё 3 оценки без комментария».
  const items = data?.items || [];
  const withText = items.filter((r) => r.text);
  const quiet = items.filter((r) => !r.text);
  const quietAvg = quiet.length ? quiet.reduce((s, r) => s + r.rating, 0) / quiet.length : 0;

  return (
    <div className={'modal' + (open ? ' open' : '')}>
      <div className="modal__c" style={{ maxWidth: 440 }}>
        <div className="eyebrow">Открыто для всех · без регистрации</div>
        <div className="modal__h">Отзывы</div>

        {data && data.count > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <Stars value={data.average} size={17} />
            <span style={{ fontSize: 14, color: 'var(--ink-60)' }}>
              {data.average.toFixed(1).replace('.', ',')} · {data.count} {plural(data.count, RATINGS)}
            </span>
          </div>
        )}

        {sent ? (
          <div className="modal__sub" style={{ marginTop: 14 }}>Спасибо! Отзыв опубликован 🎉</div>
        ) : (
          <div style={{ marginTop: 16 }}>
            {!rating && <div className="rev-hint">Нажми на звезду, чтобы оценить</div>}
            <StarPicker value={rating} onChange={setRating} />
            {rating > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input className="rev-field" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Имя (необязательно)" maxLength={40} />
                <textarea className="rev-field" value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="Что скажешь? (необязательно)" maxLength={500} rows={3} />
                <button className="modal__ok" disabled={sending} onClick={send} style={{ opacity: sending ? .6 : 1 }}>
                  {sending ? 'Отправляю…' : 'Отправить'}
                </button>
              </div>
            )}
          </div>
        )}

        {err && <div className="modal__sub" style={{ color: 'var(--red-ink)', marginTop: 8 }}>{err}</div>}

        {(withText.length > 0 || quiet.length > 0) && (
          <div className="rev-list">
            {withText.map((r, i) => (
              <div key={i} className="rev">
                <div className="rev__top">
                  <Stars value={r.rating} />
                  <span className="rev__name">{r.name}</span>
                  <span className="rev__date">{fmtDate(r.ts)}</span>
                </div>
                <div className="rev__text">{r.text}</div>
              </div>
            ))}
            {quiet.length > 0 && (
              <div className="rev rev--quiet">
                <span>{withText.length ? 'Ещё ' : ''}{quiet.length} {plural(quiet.length, RATINGS)} без комментария</span>
                <Stars value={quietAvg} size={13} />
              </div>
            )}
          </div>
        )}

        <button className="modal__doc" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}
