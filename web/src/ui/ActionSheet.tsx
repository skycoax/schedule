// Меню действий, подтверждение и ввод строки — по одному за раз, в очереди.
// Каждое окно — слой истории («Назад» закрывает его). Промис выполняется ПОСЛЕ того, как окно
// убрало свою запись из истории, поэтому следующее окно («Удалить пост?» после меню) не теряется.
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { pushLayer } from './layers';
import './ui.css';

export interface SheetAction { id: string; label: string; role?: 'default' | 'destructive' | 'cancel'; disabled?: boolean }

type Req =
  | { kind: 'choose'; title?: string; message?: string; actions: SheetAction[]; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message?: string; confirm: string; destructive?: boolean; cancel?: string; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; message?: string; placeholder?: string; confirm: string; maxLength?: number; required?: boolean; resolve: (v: string | null) => void };

interface Active { id: number; req: Req; close: () => Promise<void>; opener: HTMLElement | null; done: boolean }

const LEAVE_MS = 180;

const pending: Req[] = [];
let active: Active | null = null;
/** Только что закрытое окно: ещё доигрывает анимацию ухода. */
let leaving: Active | null = null;
let leaveTimer = 0;
let seq = 0;
let version = 0;
const subs = new Set<() => void>();
const notify = () => { version++; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => version;

function activate() {
  if (active || !pending.length || typeof document === 'undefined') return;
  const req = pending.shift()!;
  const a: Active = {
    id: ++seq, req, done: false,
    opener: document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : null,
    close: () => Promise.resolve(),
  };
  a.close = pushLayer('dialog', () => { void finish(a, null, true); });
  active = a;
  notify();
}

/** value: id действия / true для подтверждения / строка для ввода; null — отмена. */
async function finish(a: Active, value: string | true | null, popped: boolean) {
  if (a.done) return;
  a.done = true;
  if (active === a) {
    active = null;
    leaving = a;
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => { if (leaving === a) { leaving = null; notify(); } }, LEAVE_MS);
    notify();
  }
  if (!popped) await a.close();
  if (a.opener && a.opener.isConnected) {
    try { a.opener.focus({ preventScroll: true }); } catch { /* уже не в документе */ }
  }
  const r = a.req;
  if (r.kind === 'confirm') r.resolve(value === true);
  else r.resolve(typeof value === 'string' ? value : null);
  activate();
}

function enqueue(r: Req) {
  pending.push(r);
  activate();
}

/** Меню действий снизу. Без действия с ролью cancel добавляется «Отмена». Отмена/«Назад» → null. */
export function chooseAction(o: { title?: string; message?: string; actions: SheetAction[] }): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: 'choose', ...o, resolve }));
}

/** Подтверждение: true — нажали confirm; отмена, затемнение, Esc, «Назад» — false. */
export function confirmDialog(o: { title: string; message?: string; confirm: string; destructive?: boolean; cancel?: string }): Promise<boolean> {
  return new Promise((resolve) => enqueue({ kind: 'confirm', ...o, resolve }));
}

/** Ввод одной строки (например, причина ограничения). Отмена → null. */
export function promptText(o: { title: string; message?: string; placeholder?: string; confirm: string; maxLength?: number; required?: boolean }): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: 'prompt', ...o, resolve }));
}

function PromptBody({ a, req, off }: { a: Active; req: Extract<Req, { kind: 'prompt' }>; off: boolean }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const ok = !req.required || text.trim().length > 0;
  useEffect(() => { if (!off) input.current?.focus({ preventScroll: true }); }, [off]);
  const submit = () => { if (ok && !off) void finish(a, text.trim(), false); };
  return (
    <>
      <input
        ref={input} className="ui-as__input" type="text" value={text} placeholder={req.placeholder}
        maxLength={req.maxLength} aria-label={req.title} enterKeyHint="done" autoComplete="off"
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      <div className="ui-as__row">
        <button type="button" className="ui-as__btn ui-as__btn--cancel" onClick={() => void finish(a, null, false)}>Отмена</button>
        <button type="button" className="ui-as__btn ui-as__btn--accent" disabled={!ok} onClick={submit}>{req.confirm}</button>
      </div>
    </>
  );
}

function Dialog({ a, off }: { a: Active; off: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const msgId = useId();
  const r = a.req;

  // Фокус — на первую кнопку; у подтверждения необратимого действия — на «Отмену»,
  // чтобы Enter с клавиатуры ничего не удалил случайно.
  const safeFocus = r.kind === 'confirm' && !!r.destructive;
  useEffect(() => {
    if (off || r.kind === 'prompt') return;
    const sel = safeFocus ? '.ui-as__btn--cancel' : 'button:not([disabled])';
    const first = ref.current?.querySelector<HTMLButtonElement>(sel);
    (first || ref.current)?.focus({ preventScroll: true });
  }, [off, r.kind, safeFocus]);

  const cancel = () => { if (!off) void finish(a, null, false); };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (off) return;
    if (e.key === 'Escape') { e.stopPropagation(); cancel(); return; }
    if (e.key !== 'Tab') return;
    e.stopPropagation();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input') || []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
    e.preventDefault();
    items[next].focus();
  };

  const title = r.title;
  const head = (title || r.message) && (
    <div className="ui-as__head">
      {title && <p id={titleId} className="ui-as__title">{title}</p>}
      {r.message && <p id={msgId} className="ui-as__msg">{r.message}</p>}
    </div>
  );

  let body: JSX.Element;
  if (r.kind === 'prompt') {
    body = (
      <div className="ui-as__group ui-as__group--alert">
        {head}
        <PromptBody a={a} req={r} off={off} />
      </div>
    );
  } else {
    const actions: SheetAction[] = r.kind === 'choose'
      ? r.actions
      : [
        { id: 'ok', label: r.confirm, role: r.destructive ? 'destructive' : 'default' },
        { id: 'cancel', label: r.cancel || 'Отмена', role: 'cancel' },
      ];
    const main = actions.filter((x) => x.role !== 'cancel');
    const cancelAction = actions.find((x) => x.role === 'cancel') || { id: '', label: 'Отмена', role: 'cancel' as const };
    const pick = (x: SheetAction) => {
      if (off) return;
      if (r.kind === 'confirm') void finish(a, x.id === 'ok' ? true : null, false);
      else void finish(a, x.role === 'cancel' ? null : x.id, false);
    };
    body = (
      <>
        <div className="ui-as__group">
          {head}
          {main.map((x) => (
            <button
              key={x.id} type="button" disabled={x.disabled}
              className={'ui-as__btn' + (x.role === 'destructive' ? ' ui-as__btn--destructive' : '')}
              onClick={() => pick(x)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="ui-as__group">
          <button type="button" className="ui-as__btn ui-as__btn--cancel" onClick={() => pick(cancelAction)}>
            {cancelAction.label}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className={'ui-as-layer' + (off ? ' is-leaving' : '')} inert={off || undefined}>
      <div className="ui-scrim" aria-hidden="true" onClick={cancel} />
      <div
        ref={ref} role={r.kind === 'choose' ? 'dialog' : 'alertdialog'} aria-modal="true"
        aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : 'Действия'}
        aria-describedby={r.message ? msgId : undefined}
        className={'ui-as' + (r.kind === 'prompt' ? ' ui-as--alert' : ' ui-as--sheet')}
        tabIndex={-1} onKeyDown={onKeyDown}
      >
        {body}
      </div>
    </div>
  );
}

/** Монтируется один раз (AppShell). Показывает текущее окно из очереди. */
export function DialogHost(): JSX.Element {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const a = active;
  const l = leaving;
  if (!a && !l) return <></>;
  return createPortal(
    a ? <Dialog key={a.id} a={a} off={false} /> : <Dialog key={l!.id} a={l!} off />,
    document.body,
  );
}
