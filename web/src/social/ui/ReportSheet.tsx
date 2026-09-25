// Лист «Пожаловаться» (внутренний): его открывает useSocialActions().report, монтирует SessionProvider
// лениво — поэтому ни он, ни social-ui.css не попадают в основной бандл (CONTRACT.md §E.2 ReportSheet).
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { isApiError, socialApi } from '../api';
import { emit } from '../events';
import { textLength, textTooLong } from '../format';
import type { ReportSheetProps } from '../session';
import { REPORT_REASONS } from '../types';
import type { ReportReason, ReportResult } from '../types';
import './social-ui.css';

const SUBTITLE = {
  post: 'Что не так с этим постом?',
  reply: 'Что не так с этим ответом?',
  user: 'Что не так с этим профилем?',
} as const;

const NOTE_MAX = 300;
const OFFLINE = 'Нет интернета — жалоба не отправлена.';

export default function ReportSheet(p: ReportSheetProps): JSX.Element | null {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const noteId = useId();
  const errId = useId();
  const doneRef = useRef<HTMLDivElement>(null);
  const finished = useRef(false);

  const done = (r: ReportResult | null, block: boolean) => {
    if (finished.current) return;
    finished.current = true;
    p.onDone(r, block);
  };

  // После отправки фокус — на «Спасибо!», чтобы экранный чтец прочитал итог.
  useEffect(() => {
    if (result) doneRef.current?.focus({ preventScroll: true });
  }, [result]);

  const other = reason === 'other';
  const noteLen = textLength(note);
  const tooLong = textTooLong(note, NOTE_MAX);
  const canSend = !!reason && !busy && !tooLong && (!other || note.trim().length > 0);
  const left = NOTE_MAX - noteLen;

  const send = async () => {
    if (!canSend || !reason) return;
    if (!navigator.onLine) { setError(OFFLINE); return; }
    setBusy(true);
    setError('');
    try {
      const body = { target: p.target.type, id: p.target.id, reason, ...(note.trim() ? { note: note.trim() } : {}) };
      const r = await socialApi.report(body);
      setResult(r);
      emit({ type: 'reported', target: p.target, hidden: !!r.hidden });
    } catch (e) {
      if (isApiError(e, 'auth')) { done(null, false); return; }   // сессия истекла — об этом скажет сессия
      if (isApiError(e, 'network')) setError(navigator.onLine ? e.message : OFFLINE);
      else setError(e instanceof Error && e.message ? e.message : 'Не получилось отправить жалобу — попробуй ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const close = () => done(result, false);

  return (
    <Sheet
      open={p.open} onClose={close} variant="bottom" title="Пожаловаться"
      right={result ? null : <button type="button" className="ui-sheet__done report__cancel" onClick={close}>Отмена</button>}
    >
      {result ? (
        <>
          <div className="report__done" ref={doneRef} tabIndex={-1}>
            <span className="report__check" aria-hidden="true"><Icon name="check" size={28} /></span>
            <p className="report__thanks">Спасибо! Модератор проверит жалобу.</p>
            <p className="report__note">Автор не узнает, кто пожаловался.</p>
          </div>
          <div className="report__acts">
            {p.username && (
              <Button variant="tinted" size={50} full onClick={() => done(result, true)}>
                {'Заблокировать @' + p.username}
              </Button>
            )}
            <Button size={50} full onClick={close}>Готово</Button>
          </div>
        </>
      ) : (
        <>
          <p className="report__sub">{SUBTITLE[p.kind]}</p>
          <p className="report__note">Автор не узнает, кто пожаловался.</p>

          <div className="report__list" role="radiogroup" aria-label="Причина жалобы">
            {REPORT_REASONS.map((r) => (
              <label key={r.id} className={'report__opt' + (reason === r.id ? ' is-sel' : '')}>
                <input
                  className="report__radio" type="radio" name="report-reason" value={r.id}
                  checked={reason === r.id} onChange={() => { setReason(r.id); setError(''); }}
                />
                <span className="report__label">{r.label}</span>
                <span className="report__mark" aria-hidden="true"><Icon name="check" size={20} /></span>
              </label>
            ))}
          </div>

          <label className="report__field-label" htmlFor={noteId}>
            {other ? 'Опиши, что случилось' : 'Что случилось? (необязательно)'}
          </label>
          <textarea
            id={noteId} className="report__field" value={note} rows={3} required={other}
            aria-invalid={tooLong || undefined} aria-describedby={error ? errId : undefined}
            onChange={(e) => { setNote(e.currentTarget.value); setError(''); }}
          />
          {left <= 50 && (
            <p className={'report__count' + (left < 0 ? ' is-over' : '')} aria-live="polite">
              {left < 0 ? 'Комментарий к жалобе — не больше 300 символов' : 'Осталось символов: ' + left}
            </p>
          )}

          {error && <p id={errId} className="report__err" role="alert">{error}</p>}

          <div className="report__acts">
            <Button size={50} full busy={busy} disabled={!canSend} onClick={send}>Отправить жалобу</Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
