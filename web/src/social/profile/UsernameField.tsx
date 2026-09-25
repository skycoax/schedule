// Поле «@имя пользователя» с проверкой на сервере (SetupSheet, EditProfileSheet) и общие помощники форм
// «Профиля»: текст ошибки, тост об ошибке, проверки полей как на сервере (CONTRACT.md §B.4).
import { useEffect, useRef, useState } from 'react';
import type { JSX, Ref } from 'react';
import { isApiError, socialApi } from '../api';
import { textLength } from '../format';
import { toast } from '../../ui/Toast';
import { Icon } from '../../ui/icons';
import { Spinner } from '../../ui/Spinner';
import './profile.css';

// ─── Ошибки ───

/** Эти ошибки показывает сама сессия (лист входа, «Сессия истекла»…) — тостить их нельзя. */
const SESSION_CODES = new Set(['auth', 'profile', 'rules', 'banned']);

export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/** Ошибку уже показала сессия, или запрос отменили — молчим. */
export function isQuiet(e: unknown): boolean {
  return isAbort(e) || (isApiError(e) && SESSION_CODES.has(e.code));
}

export const FAIL = 'Не получилось — попробуй ещё раз';

/** Часть экрана (файл) не загрузилась при живой сети — скорее всего, вышла новая версия и старых файлов уже нет. */
export const OPEN_FAIL = 'Не получилось открыть — обнови страницу';

/** Текст ошибки для человека: текст сервера, «Нет интернета» или общий. */
export function failText(e: unknown, fallback = FAIL): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Тост об ошибке, кроме тех, что показывает сессия. */
export function toastFail(e: unknown, fallback?: string): void {
  if (isQuiet(e)) return;
  toast(failText(e, fallback), { kind: 'error' });
}

/** Ошибка поля от сервера (400 invalid + field, 409 conflict — это @имя). */
export function fieldOf(e: unknown): { field: string; text: string } | null {
  if (!isApiError(e)) return null;
  if (e.code === 'conflict') return { field: 'username', text: e.message };
  if (e.code === 'invalid' && e.field) return { field: e.field, text: e.message };
  return null;
}

// ─── Фото профиля: выбор файла → кадрирование (AvatarCropper грузится лениво) ───

type CropperComp = typeof import('./AvatarCropper').AvatarCropper;
let cropperMod: Promise<CropperComp> | null = null;
const loadCropper = () => {
  cropperMod ??= import('./AvatarCropper').then((m) => m.AvatarCropper, (e) => { cropperMod = null; throw e; });
  return cropperMod;
};

/** pick() открывает выбор фото; после кадрирования вызывается onCropped (ошибка — окно остаётся). */
export function useAvatarPicker(onCropped: (img: { full: Blob; thumb: Blob }) => Promise<void>): {
  pick: () => void; element: JSX.Element;
} {
  const input = useRef<HTMLInputElement>(null);
  const [Cropper, setCropper] = useState<CropperComp | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const cb = useRef(onCropped);
  cb.current = onCropped;

  const pick = () => {
    void loadCropper().catch(() => {});   // пока человек выбирает фото, окно кадрирования успеет загрузиться
    input.current?.click();
  };

  const onFile = async (f: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    try {
      const C = await loadCropper();
      setCropper(() => C);
      setFile(f);
    } catch {
      toast(navigator.onLine ? OPEN_FAIL : 'Нет интернета', { kind: 'error' });
    }
  };

  const element = (
    <>
      <input ref={input} type="file" accept="image/*" hidden tabIndex={-1} aria-hidden="true"
        onChange={(e) => void onFile(e.currentTarget.files?.[0])} />
      {Cropper && (
        <Cropper file={file} onCancel={() => setFile(null)}
          onDone={async (img) => { await cb.current(img); setFile(null); }} />
      )}
    </>
  );
  return { pick, element };
}

// ─── Проверки полей (зеркало сервера; окончательно решает сервер) ───

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const USERNAME_HINT = '3–20 символов: латинские буквы, цифры и знак подчёркивания';
const USERNAME_DIGITS = 'Имя пользователя не может состоять только из цифр';
const NAME_TEXT = 'Имя — от 1 до 40 символов';

/** null — имя подходит. */
export function nameError(name: string, max = 40): string | null {
  const s = name.trim();
  if (!s || textLength(s) > max || !/[\p{L}\p{N}]/u.test(s)) return NAME_TEXT;
  return null;
}

/** Что человек ввёл в поле @имени → как хранит сервер: строчные, без @ и пробелов. */
export function cleanUsername(s: string): string {
  return s.replace(/^\s*@+/, '').replace(/\s+/g, '').toLowerCase();
}

function localUsernameError(u: string): string | null {
  if (!USERNAME_RE.test(u)) return USERNAME_HINT;
  if (/^\d+$/.test(u)) return USERNAME_DIGITS;
  return null;
}

// ─── Проверка @имени ───

export type UnameState =
  | { kind: 'idle' }                       // не менялось или пусто — не проверяем
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'bad'; text: string }          // своё правило или ответ сервера
  | { kind: 'unknown' };                   // сервер не ответил — решит при сохранении

/** Проверка с паузой 400 мс; прошлый запрос отменяется. current — нынешнее @имя (его не проверяем). */
export function useUsernameCheck(value: string, current: string | null): UnameState {
  const [state, setState] = useState<UnameState>({ kind: 'idle' });
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    if (!value || (current && value === current)) { setState({ kind: 'idle' }); return; }
    const bad = localUsernameError(value);
    if (bad) { setState({ kind: 'bad', text: bad }); return; }
    setState({ kind: 'checking' });
    const c = new AbortController();
    ctrl.current = c;
    const t = window.setTimeout(() => {
      socialApi.checkUsername(value, c.signal).then(
        (r) => { if (!c.signal.aborted) setState(r.available ? { kind: 'ok' } : { kind: 'bad', text: r.error || 'Это имя уже занято' }); },
        (e) => { if (!c.signal.aborted && !isAbort(e)) setState({ kind: 'unknown' }); },
      );
    }, 400);
    return () => { clearTimeout(t); c.abort(); };
  }, [value, current]);

  return state;
}

/** Можно ли сохранять с таким состоянием проверки. */
export const unameOk = (s: UnameState): boolean => s.kind === 'ok' || s.kind === 'idle' || s.kind === 'unknown';

/** Строка под полем: «Проверяю…», «Свободно», текст сервера или правило. serverError — ошибка после сохранения. */
export function UsernameStatus(p: { state: UnameState; serverError?: string | null; hint?: string | null; id?: string }): JSX.Element {
  const s = p.state;
  let cls = 'uname-st';
  let text = '';
  if (p.serverError) { cls += ' is-bad'; text = p.serverError; }
  else if (s.kind === 'checking') text = 'Проверяю…';
  else if (s.kind === 'ok') { cls += ' is-ok'; text = 'Свободно'; }
  else if (s.kind === 'bad') { cls += ' is-bad'; text = s.text; }
  else if (p.hint) text = p.hint;
  return <p className={cls} id={p.id} aria-live="polite">{text}</p>;
}

/** Строка ввода «@ имя» для группы полей; справа — галочка или индикатор проверки. */
export function UsernameField(p: {
  value: string;
  onChange: (v: string) => void;
  state: UnameState;
  describedBy?: string;
  invalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  id?: string;
  disabled?: boolean;
}): JSX.Element {
  const s = p.state;
  return (
    <label className="uname">
      <span className="uname__at" aria-hidden="true">@</span>
      <input
        ref={p.inputRef} id={p.id} className="uname__in" type="text" value={p.value}
        aria-label="Имя пользователя" aria-describedby={p.describedBy}
        aria-invalid={p.invalid || s.kind === 'bad' || undefined}
        autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
        inputMode="text" enterKeyHint="next" maxLength={24} disabled={p.disabled}
        onChange={(e) => p.onChange(cleanUsername(e.currentTarget.value))}
      />
      <span className="uname__mark" aria-hidden="true">
        {s.kind === 'checking' && <Spinner size={16} />}
        {s.kind === 'ok' && !p.invalid && <Icon name="check" size={18} className="uname__ok" />}
      </span>
    </label>
  );
}
