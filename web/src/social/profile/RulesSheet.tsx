// Правила обсуждений в приложении: mode="accept" — после повышения версии правил (Принимаю / Не сейчас),
// mode="read" — из «Профиля» и из окна входа (только «Готово»). Текст — web/src/social/rules.ts (POLICY).
import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { DocSheet } from '../../components/DocSheet';
import { useLayer } from '../../ui/layers';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { LINKS, RULES_INTRO, RULES_POINTS, RULES_TITLE } from '../rules';
import './profile.css';

export function RulesSheet(p: {
  open: boolean;
  mode: 'accept' | 'read';
  onAccept?: () => void;
  onClose: () => void;
}): JSX.Element | null {
  const titleId = useId();
  const accept = p.mode === 'accept';
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!p.open) setBusy(false); }, [p.open]);

  // onAccept может вернуть промис (AuthHost ждёт сервер) — тогда кнопка занята, пока он не выполнится.
  const onAccept = () => {
    if (busy || !p.onAccept) return;
    const r = (p.onAccept as () => unknown)();
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      setBusy(true);
      (r as Promise<unknown>).then(() => setBusy(false), () => setBusy(false));
    }
  };

  return (
    <Sheet
      open={p.open} onClose={p.onClose} variant="bottom" labelledBy={titleId} className="rules-sheet"
      right={accept ? null : undefined}
    >
      <div className="rules">
        {accept && <p className="eyebrow rules__eyebrow">Мы обновили правила</p>}
        <h2 className="rules__t" id={titleId}>{RULES_TITLE}</h2>
        <p className="rules__intro">{RULES_INTRO}</p>
        <ol className="rules__list">
          {RULES_POINTS.map((t, i) => <li key={i} className="rules__item">{t}</li>)}
        </ol>
        <a className="rules__full" href={LINKS.rules} target="_blank" rel="noopener">Полный текст правил</a>
        {accept && (
          <div className="rules__acts">
            <Button full size={50} busy={busy} onClick={onAccept}>Принимаю</Button>
            <Button full variant="plain" size={44} disabled={busy} onClick={p.onClose}>Не сейчас</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Политика (существующий DocSheet) поверх всего: портал в body (лист может открываться из другого листа)
 *  и слой истории — «Назад» закрывает её, а не вкладку. Фокус и Esc DocSheet обрабатывает сам. */
export function PolicySheet(p: { open: boolean; onClose: () => void }): JSX.Element | null {
  useLayer(p.open, p.onClose, 'doc');
  if (!p.open) return null;
  return createPortal(<DocSheet open onClose={p.onClose} />, document.body);
}
