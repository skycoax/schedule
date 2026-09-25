// Новый пост (лист во весь экран): текст, до 4 фото, черновик на телефоне. Тем нет — как в Threads
// (сервер по-прежнему ждёт тему: посты уходят с темой «Разное»).
// Фото: подготовка по одному (lib/image: JPEG без метаданных), загрузка по два сразу, сразу после выбора —
// к нажатию «Опубликовать» они уже на сервере. Здесь же usePhotoTiles — общий для строки ответа в ветке.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { JSX } from 'react';
import { prepareImage } from '../../lib/image';
import { chooseAction, confirmDialog } from '../../ui/ActionSheet';
import { Icon } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { Spinner } from '../../ui/Spinner';
import { toast } from '../../ui/Toast';
import { socialApi } from '../api';
import { emit } from '../events';
import { countLinks, hasPhone, textLength, textTooLong } from '../format';
import { useSession } from '../session';
import type { CategoryId, Post, UploadedMedia } from '../types';
import { Avatar } from '../ui/Avatar';
import { clearDraft, draftWriter, readDraft } from './drafts';
import { errText, handledBySession, isAbortError, uniShort } from './PostCard';
import './chat.css';

// ─── Фото: подготовка и загрузка ───

export type TileStatus = 'preparing' | 'waiting' | 'uploading' | 'done' | 'failed' | 'stale';

export interface Tile {
  key: number;
  status: TileStatus;
  progress: number;                       // 0..1 во время загрузки
  preview: string | null;                 // object URL миниатюры или адрес с сервера (черновик)
  ownUrl: boolean;                        // preview — наш object URL (освободить)
  media: UploadedMedia | null;
  file: File | null;
  prepared: { full: Blob; thumb: Blob | null } | null;
  error: string;
  ctrl: AbortController | null;
}

export interface PhotoTiles {
  tiles: Tile[];
  /** Загруженные фото по порядку (без устаревших). */
  done: UploadedMedia[];
  /** Что-то ещё готовится или загружается. */
  busy: boolean;
  failed: boolean;
  add(files: File[]): void;
  remove(key: number): void;
  retry(key: number): void;
  stale(key: number): void;
  /** «Удалить черновик»: убрать всё, загруженное — удалить и с сервера. */
  discard(): void;
  /** Опубликовано: забыть фото, не удаляя их с сервера. */
  release(): void;
}

const UPLOADS_AT_ONCE = 2;
let tileSeq = 0;

export function usePhotoTiles(o: { initial?: UploadedMedia[]; cleanupRemote: boolean; onError?: (text: string) => void }): PhotoTiles {
  const list = useRef<Tile[] | null>(null);
  if (!list.current) {
    list.current = (o.initial || []).map((m) => ({
      key: ++tileSeq, status: 'done' as const, progress: 1, preview: m.thumb || m.url, ownUrl: false, media: m,
      file: null, prepared: null, error: '', ctrl: null,
    }));
  }
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const alive = useRef(true);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const raf = useRef(0);
  const opts = useRef(o);
  opts.current = o;

  const api = useMemo(() => {
    const all = () => list.current as Tile[];
    const has = (t: Tile) => all().includes(t);
    const commit = () => { list.current = [...all()]; bump(); };
    const commitSoon = () => {
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => { raf.current = 0; if (alive.current) commit(); });
    };
    const drop = (t: Tile, deleteRemote: boolean) => {
      t.ctrl?.abort();
      t.ctrl = null;
      if (t.ownUrl && t.preview) URL.revokeObjectURL(t.preview);
      if (deleteRemote && t.media) void socialApi.deleteMedia(t.media.id).catch(() => {});
    };

    const upload = async (t: Tile) => {
      const c = new AbortController();
      t.ctrl = c;
      t.status = 'uploading';
      t.progress = 0;
      commit();
      try {
        const m = await socialApi.uploadMedia(t.prepared as { full: Blob; thumb: Blob | null }, {
          kind: 'post', signal: c.signal,
          onProgress: (x) => { t.progress = x; commitSoon(); },
        });
        t.ctrl = null;
        if (!alive.current || !has(t)) { void socialApi.deleteMedia(m.id).catch(() => {}); return; }
        t.media = m;
        t.status = 'done';
        t.progress = 1;
      } catch (e) {
        t.ctrl = null;
        if (isAbortError(e) || !alive.current || !has(t)) return;
        t.status = 'failed';
        t.error = handledBySession(e) ? '' : errText(e);
        if (t.error) opts.current.onError?.(t.error);
      }
      commit();
      pump();
    };

    const pump = () => {
      if (!alive.current) return;
      let room = UPLOADS_AT_ONCE - all().filter((t) => t.status === 'uploading').length;
      for (const t of all()) {
        if (room <= 0) break;
        if (t.status === 'waiting') { room--; void upload(t); }
      }
    };

    const prepare = async (t: Tile) => {
      if (!alive.current || !has(t) || t.status !== 'preparing' || !t.file) return;
      try {
        const img = await prepareImage(t.file);
        if (!alive.current || !has(t)) { URL.revokeObjectURL(img.preview); return; }
        t.prepared = { full: img.full, thumb: img.thumb };
        t.preview = img.preview;
        t.ownUrl = true;
        t.status = 'waiting';
      } catch (e) {
        if (!alive.current || !has(t)) return;
        t.status = 'failed';
        t.error = errText(e);
        opts.current.onError?.(t.error);
      }
      commit();
      pump();
    };
    // По одному: на слабом телефоне несколько больших фото сразу не помещаются в память.
    const queuePrepare = (t: Tile) => { chain.current = chain.current.then(() => prepare(t)); };

    return {
      add(files: File[]) {
        for (const file of files) {
          const t: Tile = {
            key: ++tileSeq, status: 'preparing', progress: 0, preview: null, ownUrl: false, media: null,
            file, prepared: null, error: '', ctrl: null,
          };
          list.current = [...all(), t];
          queuePrepare(t);
        }
        commit();
      },
      remove(key: number) {
        const t = all().find((x) => x.key === key);
        if (!t) return;
        list.current = all().filter((x) => x !== t);
        drop(t, true);
        commit();
        pump();
      },
      retry(key: number) {
        const t = all().find((x) => x.key === key);
        if (!t || t.status !== 'failed') return;
        t.error = '';
        if (t.prepared) { t.status = 'waiting'; commit(); pump(); }
        else if (t.file) { t.status = 'preparing'; commit(); queuePrepare(t); }
      },
      stale(key: number) {
        const t = all().find((x) => x.key === key);
        if (!t || t.status !== 'done' || t.ownUrl) return;
        t.status = 'stale';
        t.error = 'Фото устарело';
        commit();
      },
      discard() {
        for (const t of all()) drop(t, true);
        list.current = [];
        commit();
      },
      release() {
        for (const t of all()) drop(t, false);
        list.current = [];
        commit();
      },
      /** При закрытии: остановить загрузки, освободить память; незаконченное с сервера — убрать. */
      unmount() {
        alive.current = false;
        cancelAnimationFrame(raf.current);
        for (const t of all()) drop(t, opts.current.cleanupRemote);
      },
    };
  }, []);

  useEffect(() => { alive.current = true; return () => api.unmount(); }, [api]);

  const tiles = list.current;
  return {
    tiles,
    done: tiles.filter((t) => t.status === 'done' && t.media).map((t) => t.media as UploadedMedia),
    busy: tiles.some((t) => t.status === 'preparing' || t.status === 'waiting' || t.status === 'uploading'),
    failed: tiles.some((t) => t.status === 'failed'),
    add: api.add, remove: api.remove, retry: api.retry, stale: api.stale, discard: api.discard, release: api.release,
  };
}

const RING_C = 2 * Math.PI * 12;

/** Плитка фото: подготовка (крутилка), загрузка (кольцо), ошибка (повтор), устарело. */
export function TileView(p: { t: Tile; small?: boolean; onRemove: () => void; onRetry: () => void; onStale: () => void }): JSX.Element {
  const { t } = p;
  return (
    <div className={'cmp__tile cmp__tile--' + t.status + (p.small ? ' cmp__tile--sm' : '')}>
      {t.preview && t.status !== 'stale' && (
        <img className="cmp__img" src={t.preview} alt="" onError={() => { if (!t.ownUrl) p.onStale(); }} />
      )}
      {t.status === 'preparing' && <span className="cmp__state"><Spinner size={20} /></span>}
      {(t.status === 'waiting' || t.status === 'uploading') && (
        <span className="cmp__state" role="progressbar" aria-label="Загрузка фото" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(t.progress * 100)}>
          <svg className="cmp__prog" viewBox="0 0 30 30" width="30" height="30" aria-hidden="true">
            <circle cx="15" cy="15" r="12" className="cmp__prog-bg" />
            <circle cx="15" cy="15" r="12" className="cmp__prog-fg" transform="rotate(-90 15 15)"
              strokeDasharray={`${Math.max(0.04, t.progress) * RING_C} ${RING_C}`} />
          </svg>
        </span>
      )}
      {t.status === 'failed' && (
        <button type="button" className="cmp__state cmp__retry" aria-label="Фото не загрузилось — повторить" onClick={p.onRetry}>
          <Icon name="warning" size={22} />
        </button>
      )}
      {t.status === 'stale' && <span className="cmp__state cmp__stale">Фото устарело</span>}
      <button type="button" className="cmp__x" aria-label="Убрать фото" onClick={p.onRemove}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

// ─── Счётчик длины ───

function Ring({ len, limit, over }: { len: number; limit: number; over: boolean }): JSX.Element {
  const left = limit - len;
  const c = 2 * Math.PI * 9;
  const frac = Math.min(1, len / limit);
  // Экранный чтец слышит только пороги: 200, 50, предел и «длиннее предела».
  const say = left < 0 ? `Текст длиннее ${limit} символов`
    : left === 0 ? `Это предел — ${limit} символов`
    : left <= 50 ? 'Осталось меньше 50 символов'
    : left <= 200 ? 'Осталось меньше 200 символов' : '';
  return (
    <span className="cmp__count-wrap">
      {left <= 200 && <span className={'cmp__left' + (left < 0 ? ' is-over' : '')}>{left}</span>}
      <svg className={'cmp__ring' + (over || left < 0 ? ' is-over' : left <= 20 ? ' is-warn' : '')} viewBox="0 0 22 22"
        width="22" height="22" aria-hidden="true">
        <circle cx="11" cy="11" r="9" className="cmp__ring-bg" />
        {len > 0 && <circle cx="11" cy="11" r="9" className="cmp__ring-fg" transform="rotate(-90 11 11)" strokeDasharray={`${frac * c} ${c}`} />}
      </svg>
      <span className="chat-sr" aria-live="polite">{say}</span>
    </span>
  );
}

// ─── Лист ───

export function Composer(p: {
  onClose: () => void;
  onPublished: (post: Post) => void;
}): JSX.Element {
  const session = useSession();
  const me = session.me;
  const lim = session.config?.limits;
  const LIM = { text: lim?.text ?? 1000, lines: lim?.lines ?? 30, links: lim?.links ?? 3, media: lim?.media ?? 4 };
  const [draft0] = useState(readDraft);
  const [text, setText] = useState(draft0?.text ?? '');
  const category: CategoryId = 'other';
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // Ошибка фото показывается, пока на экране есть плитка с этой ошибкой (убрали плитку — ушла и строка).
  const tiles = usePhotoTiles({ initial: draft0?.media, cleanupRemote: false });
  const writer = useMemo(draftWriter, []);
  const discarded = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const hintId = useId();

  // Черновик: через 500 мс после изменения; сразу — при уходе со страницы и при закрытии.
  const doneKey = tiles.done.map((m) => m.id).join(',');
  const latest = useRef({ text, category, media: tiles.done });
  latest.current = { text, category, media: tiles.done };
  useEffect(() => {
    if (!discarded.current) writer.schedule(latest.current);
  }, [text, category, doneKey, writer]);
  useEffect(() => {
    const flush = () => { if (!discarded.current) { writer.schedule(latest.current); writer.flush(); } };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, [writer]);

  // Сразу печатать: фокус в поле, курсор в конец восстановленного текста.
  useEffect(() => {
    const t = taRef.current;
    if (!t) return;
    t.focus({ preventScroll: true });
    const n = t.value.length;
    try { t.setSelectionRange(n, n); } catch { /* старый браузер */ }
  }, []);

  // Поле растёт вместе с текстом (прокручивается весь лист, а не поле). Пока фото нет — место
  // под несколько строк; с фото поле по тексту, чтобы превью стояли сразу под ним.
  const tileCount = tiles.tiles.length;
  const minH = tileCount ? 44 : 96;
  const fit = useCallback(() => {
    const t = taRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.max(minH, t.scrollHeight) + 'px';
  }, [minH]);
  useLayoutEffect(fit, [text, fit]);
  // Лист открывается с анимацией: при первом измерении ширина поля может быть ещё не та — перемеряем,
  // когда она меняется (и при повороте экрана).
  useEffect(() => {
    const t = taRef.current;
    if (!t || typeof ResizeObserver === 'undefined') return;
    let w = t.offsetWidth;
    const ro = new ResizeObserver(() => { if (t.offsetWidth !== w) { w = t.offsetWidth; fit(); } });
    ro.observe(t);
    return () => ro.disconnect();
  }, [fit]);

  const len = textLength(text);
  const tooLong = textTooLong(text, LIM.text);
  const tooManyLines = text.split('\n').length > LIM.lines;
  const tooManyLinks = countLinks(text) > LIM.links;
  const count = tiles.tiles.length;
  const hasContent = text.trim().length > 0 || tiles.done.length > 0;
  const canPublish = hasContent && !tooLong && !tooManyLines && !tooManyLinks && !tiles.busy && !tiles.failed
    && session.online && session.mode === 'on' && !sending;
  const dirty = text.trim().length > 0 || count > 0;

  const hint = tooLong ? `Слишком длинный текст — максимум ${LIM.text} символов`
    : tooManyLines ? `Слишком много строк — максимум ${LIM.lines}`
    : tooManyLinks ? `Не больше ${LIM.links} ${LIM.links === 1 ? 'ссылки' : 'ссылок'} в одном сообщении`
    : '';

  const close = () => { p.onClose(); };

  const cancel = async () => {
    if (sending) return;
    if (!dirty) {
      discarded.current = true;
      writer.cancel();
      clearDraft();
      tiles.discard();
      p.onClose();
      return;
    }
    const r = await chooseAction({
      title: 'Удалить черновик?',
      actions: [
        { id: 'delete', label: 'Удалить', role: 'destructive' },
        { id: 'save', label: 'Сохранить черновик' },
      ],
    });
    if (r === 'delete') {
      discarded.current = true;
      writer.cancel();
      clearDraft();
      tiles.discard();
      p.onClose();
    } else if (r === 'save') {
      p.onClose();
    }
  };

  const publish = async () => {
    if (!canPublish) return;
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
    setError('');
    try {
      const post = await socialApi.createPost({ text: body, category, media: tiles.done.map((m) => m.id) });
      discarded.current = true;
      writer.cancel();
      clearDraft();
      tiles.release();
      emit({ type: 'post-created', post });
      toast('Опубликовано');
      p.onPublished(post);
    } catch (e) {
      setSending(false);
      if (handledBySession(e)) return;
      setError(errText(e));
      bodyRef.current?.scrollTo({ top: 0 });
    }
  };

  const onFiles = (fl: FileList | null) => {
    const files = Array.from(fl || []);
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length) return;
    const room = LIM.media - count;
    if (files.length > room) toast(`Можно добавить до ${LIM.media} фото`);
    if (room > 0) tiles.add(files.slice(0, room));
  };

  const shown = tiles.tiles.find((t) => t.status === 'failed' && t.error)?.error || '';

  return (
    <Sheet open onClose={close} variant="full" right={null} labelledBy={titleId} className="cmp">
      <div className="cmp__col">
        <div className="cmp__bar">
          <button type="button" className="cmp__cancel" disabled={sending} onClick={() => void cancel()}>Отмена</button>
          <h2 id={titleId} className="cmp__title">Новый пост</h2>
          <button type="button" className="cmp__pub" disabled={!canPublish} aria-busy={sending || undefined} onClick={() => void publish()}>
            {sending ? 'Публикую…' : 'Опубликовать'}
          </button>
        </div>

        <div ref={bodyRef} className="cmp__scroll">
          {error && (
            <div className="alert is-on cmp__err" role="alert">
              <span className="dot dot--bad" />
              <div className="alert__text"><span>{error}</span></div>
            </div>
          )}
          {!session.online && (
            <div className="offline cmp__off" role="status">
              <Icon name="wifiOff" size={20} />
              <span><b>Без интернета.</b> Черновик сохранится — опубликуешь, когда появится связь.</span>
            </div>
          )}

          <div className="cmp__main">
            <Avatar user={me} size={40} />
            <textarea
              ref={taRef} className="cmp__text" value={text} rows={1} aria-label="Текст поста"
              placeholder="Что нового?" aria-describedby={hint ? hintId : undefined} aria-invalid={!!hint || undefined}
              onChange={(e) => { setText(e.currentTarget.value); if (error) setError(''); }}
            />
          </div>
          {hint && <p id={hintId} className="cmp__warn">{hint}</p>}

          {count > 0 && (
            <div className="cmp__tiles">
              {tiles.tiles.map((t) => (
                <TileView key={t.key} t={t} onRemove={() => tiles.remove(t.key)} onRetry={() => tiles.retry(t.key)} onStale={() => tiles.stale(t.key)} />
              ))}
            </div>
          )}
          {shown && <p className="cmp__warn">{shown}</p>}

          <p className="cmp__aud"><Icon name="globe" size={16} />Увидят все в {uniShort()}</p>
        </div>

        <div className="cmp__tools">
          <button
            type="button" className="cmp__photo" aria-label={`Добавить фото, ${count} из ${LIM.media}`}
            disabled={count >= LIM.media} onClick={() => fileRef.current?.click()}
          >
            <Icon name="photo" size={22} />
            <span aria-hidden="true">Фото</span>
          </button>
          <span className="cmp__num" aria-hidden="true">{count}/{LIM.media}</span>
          <span className="cmp__spacer" />
          <Ring len={len} limit={LIM.text} over={tooLong} />
        </div>
        <input
          ref={fileRef} type="file" accept="image/*" multiple hidden tabIndex={-1}
          onChange={(e) => onFiles(e.currentTarget.files)}
        />
      </div>
    </Sheet>
  );
}
