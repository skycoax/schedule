// Короткое сообщение внизу экрана. Одно за раз: новое заменяет старое. role="status".
// Над панелью вкладок — правило html.has-tabbar .ui-toasts в ui.css.
import { useEffect, useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import './ui.css';

interface ToastItem {
  id: number;
  text: string;
  kind: 'default' | 'error';
  ms: number;
  action?: { label: string; onClick: () => void };
  leaving: boolean;
}

const LEAVE_MS = 180;

let current: ToastItem | null = null;
let seq = 0;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => current;

/** Показать сообщение (по умолчанию 2,6 с). kind 'error' — с красной точкой. */
export function toast(text: string, o?: { kind?: 'default' | 'error'; ms?: number; action?: { label: string; onClick: () => void } }): void {
  if (!text) return;
  current = { id: ++seq, text, kind: o?.kind ?? 'default', ms: o?.ms ?? 2600, action: o?.action, leaving: false };
  notify();
}

function dismiss(id: number) {
  if (!current || current.id !== id || current.leaving) return;
  current = { ...current, leaving: true };
  notify();
  window.setTimeout(() => {
    if (current && current.id === id) { current = null; notify(); }
  }, LEAVE_MS);
}

export function ToastHost(): JSX.Element {
  const t = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!t || t.leaving) return;
    const timer = window.setTimeout(() => dismiss(t.id), t.ms);
    return () => clearTimeout(timer);
  }, [t]);

  return createPortal(
    <div className="ui-toasts" role="status" aria-live="polite" aria-atomic="true">
      {t && (
        <div
          key={t.id}
          className={'ui-toast' + (t.kind === 'error' ? ' ui-toast--error' : '') + (t.leaving ? ' is-leaving' : '')}
        >
          <span className="ui-toast__text">{t.text}</span>
          {t.action && !t.leaving && (
            <button
              type="button" className="ui-toast__action"
              onClick={() => { const a = t.action; dismiss(t.id); a?.onClick(); }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
