// Ненавязчивое приглашение оценить — выскакивает само (после конца пары или
// в случайный момент, см. App.tsx), но ничего не загораживает и легко закрыть.
import { useState } from 'react';
import { submitReview } from '../api';
import { store } from '../lib/store';
import { StarPicker } from './stars';

export function ReviewPrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;

  const send = () => {
    setSending(true); setErr('');
    submitReview({ cid: store('cid') || '', rating, text })
      .then(() => {
        store('reviewedAt', String(Date.now()));
        store('myRating', String(rating));
        setDone(true);
        setTimeout(onClose, 1300);
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setSending(false));
  };

  return (
    <div className="nudge">
      <button className="nudge__x" aria-label="Закрыть" onClick={onClose}>×</button>
      {done ? (
        <div className="nudge__thanks">Спасибо! 🎉</div>
      ) : (
        <>
          <div className="nudge__title">Как прошла пара?</div>
          <div className="nudge__sub">Оцени приложение — займёт секунду</div>
          <StarPicker value={rating} onChange={setRating} size={28} />
          {rating > 0 && (
            <>
              <textarea className="rev-field" value={text} onChange={(e) => setText(e.target.value)}
                placeholder="Что скажешь? (необязательно)" maxLength={500} rows={2} />
              <button className="modal__ok" disabled={sending} onClick={send} style={{ opacity: sending ? .6 : 1 }}>
                {sending ? 'Отправляю…' : 'Отправить'}
              </button>
              {err && <div className="nudge__err">{err}</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}
