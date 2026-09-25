// Строка ответа внизу ветки (.rcmp): поле растёт до 5 строк, одно фото, «Отправить».
// Закреплена над клавиатурой (--kb), высоту сообщает ветке (--rcmp-h), чтобы последний ответ не прятался.
// Гостю, при ограничении, в «только чтении» и под удалённым постом — строка с пояснением вместо поля.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { confirmDialog } from '../../ui/ActionSheet';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Spinner } from '../../ui/Spinner';
import { toast } from '../../ui/Toast';
import { socialApi } from '../api';
import { emit } from '../events';
import { banText, hasPhone, textLength, textTooLong } from '../format';
import { useSession } from '../session';
import type { Post } from '../types';
import { TileView, usePhotoTiles } from './Composer';
import { errText, handledBySession } from './PostCard';
import './chat.css';

const MAX_H = 5 * 21 + 16;            // 5 строк по 21 px + отступы поля
/** Неотправленные ответы, пока открыто приложение (ветку закрыли и открыли снова — текст на месте). */
const unsent = new Map<number, string>();

function Shell({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const host = el.closest<HTMLElement>('.thr');
    let prev = 0;
    const set = () => {
      const h = el.offsetHeight;
      if (h <= 0 || !host) return;
      const grow = prev ? h - prev : 0;
      prev = h;
      host.style.setProperty('--rcmp-h', h + 'px');
      // Строка выросла («Ответ @u», фото, новая строка текста), а ветка была прокручена до конца —
      // сдвигаем вслед, чтобы последний ответ не ушёл под строку.
      if (grow > 0 && host.getClientRects().length) {
        const end = document.documentElement.scrollHeight - grow - 4;
        if (window.scrollY + window.innerHeight >= end) window.scrollBy(0, grow);
      }
    };
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className="rcmp" data-no-ptr="">{children}</div>;
}

function Form(p: {
  root: Post;
  replyTo: { id: number; username: string } | null;
  onClearReplyTo: () => void;
  onSent: (reply: Post) => void;
  focusSignal: number;
  returnTo: string;
}): JSX.Element {
  const s = useSession();
  const [text, setTextState] = useState(() => unsent.get(p.root.id) || '');
  const [sending, setSending] = useState(false);
  const tiles = usePhotoTiles({ cleanupRemote: true, onError: (t) => toast(t, { kind: 'error' }) });
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const limit = s.config?.limits.text ?? 1000;
  const company = p.root.category === 'company';
  const tile = tiles.tiles[0];

  const setText = (v: string) => {
    setTextState(v);
    if (v) unsent.set(p.root.id, v); else unsent.delete(p.root.id);
  };

  useEffect(() => {
    if (p.focusSignal) taRef.current?.focus({ preventScroll: true });
  }, [p.focusSignal]);

  // Поле растёт до 5 строк; перемеряем и когда меняется его ширина (поворот, ветка была скрыта).
  const fit = useCallback(() => {
    const t = taRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(MAX_H, t.scrollHeight) + 'px';
    t.style.overflowY = t.scrollHeight > MAX_H ? 'auto' : 'hidden';
  }, []);
  useLayoutEffect(fit, [text, fit]);
  useEffect(() => {
    const t = taRef.current;
    if (!t || typeof ResizeObserver === 'undefined') return;
    let w = t.offsetWidth;
    const ro = new ResizeObserver(() => { if (t.offsetWidth !== w) { w = t.offsetWidth; fit(); } });
    ro.observe(t);
    return () => ro.disconnect();
  }, [fit]);

  const len = textLength(text);
  const left = limit - len;
  const over = textTooLong(text, limit);
  const can = (text.trim().length > 0 || tiles.done.length > 0) && !over && !tiles.busy && !tiles.failed && s.online && !sending;

  const send = async () => {
    if (!can) return;
    if (!(await s.ensure('reply', p.returnTo))) return;
    const body = text.trim();
    if (hasPhone(body)) {
      const ok = await confirmDialog({
        title: 'В тексте есть номер телефона',
        message: 'Его увидят все, даже без аккаунта. Всё равно опубликовать?',
        confirm: 'Опубликовать',
        cancel: 'Изменить',
      });
      if (!ok) { taRef.current?.focus({ preventScroll: true }); return; }
    }
    setSending(true);
    try {
      const reply = await socialApi.createReply(p.root.id, {
        text: body, media: tiles.done.map((m) => m.id), ...(p.replyTo ? { replyTo: p.replyTo.id } : {}),
      });
      tiles.release();
      setText('');
      p.onClearReplyTo();
      emit({ type: 'reply-created', reply });
      p.onSent(reply);
      taRef.current?.focus({ preventScroll: true });
    } catch (e) {
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    } finally {
      setSending(false);
    }
  };

  const onFiles = (fl: FileList | null) => {
    const f = fl && fl[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f || tiles.tiles.length) return;
    tiles.add([f]);
  };

  const place = p.replyTo ? `Ответ @${p.replyTo.username}…` : 'Ответить…';
  return (
    <>
      {p.replyTo && (
        <div className="rcmp__to">
          <span>Ответ <b>@{p.replyTo.username}</b></span>
          <button type="button" className="rcmp__tox" aria-label="Отменить ответ" onClick={p.onClearReplyTo}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {tile && (
        <div className="rcmp__tiles">
          <TileView t={tile} small onRemove={() => tiles.remove(tile.key)} onRetry={() => tiles.retry(tile.key)} onStale={() => tiles.stale(tile.key)} />
        </div>
      )}
      <div className="rcmp__row">
        <button
          type="button" className="rcmp__btn" aria-label="Добавить фото" disabled={!!tile || company || sending}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="photo" size={22} />
        </button>
        <textarea
          ref={taRef} className="rcmp__field" rows={1} value={text} aria-label="Текст ответа" placeholder={place}
          enterKeyHint="enter"
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
        />
        <div className="rcmp__side">
          {left <= 100 && <span className={'rcmp__left' + (left < 0 || over ? ' is-over' : '')}>{left}</span>}
          <button type="button" className="rcmp__send" aria-label="Отправить" disabled={!can} onClick={() => void send()}>
            <span className="rcmp__send-c">{sending ? <Spinner size={16} /> : <Icon name="send" size={18} />}</span>
          </button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden tabIndex={-1} onChange={(e) => onFiles(e.currentTarget.files)} />
    </>
  );
}

export function ReplyComposer(p: {
  root: Post;
  replyTo: { id: number; username: string } | null;
  onClearReplyTo: () => void;
  onSent: (reply: Post) => void;
  /** Растёт — поставить фокус в поле. */
  focusSignal: number;
  returnTo: string;
}): JSX.Element {
  const s = useSession();
  const guest = s.status === 'guest' || (s.status === 'loading' && !s.me);
  let note = '';
  if (s.mode === 'off') note = 'Обсуждения временно недоступны';
  else if (p.root.deleted) note = 'Ответить на удалённый пост нельзя';
  // Скрытый пост видят только автор и модераторы, а сервер отвечает на него 404 — поле не показываем.
  else if (p.root.hidden) note = 'Ответить на скрытый пост нельзя';
  else if (s.mode === 'readonly') note = 'Сейчас обсуждения доступны только для чтения.';
  else if (!guest && s.me?.banned) note = banText(s.me.banned);

  if (note) {
    return <Shell><p className="rcmp__note">{note}</p></Shell>;
  }
  if (guest) {
    return (
      <Shell>
        <div className="rcmp__guest">
          <span>Войди, чтобы ответить</span>
          <Button size={32} variant="filled" onClick={() => void s.ensure('reply', p.returnTo)}>Войти</Button>
        </div>
      </Shell>
    );
  }
  return <Shell><Form {...p} /></Shell>;
}
