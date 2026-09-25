// Черновик нового поста на телефоне: localStorage 'draft_post_<вуз>' = { text, category, media }.
// media — уже загруженные фото (UploadedMedia): сервер хранит их сутки, поэтому черновик переживает
// перезагрузку и вход через Google. Пишем с задержкой 500 мс, сразу — при уходе со страницы.
// Ключ снимает clearSocialLocal() при выходе из аккаунта.
import { brand } from '../../brand';
import { ls } from '../../lib/store';
import { categoryOf } from '../types';
import type { CategoryId, UploadedMedia } from '../types';

export interface PostDraft { text: string; category: CategoryId | null; media: UploadedMedia[] }

const DELAY = 500;
const MEDIA_ID = /^[A-Za-z0-9_-]{22}$/;
const MEDIA_URL = /^\/api\/media\/[A-Za-z0-9_-]{22}(_t)?\.jpg$/;

const key = () => 'draft_post_' + brand.id;

function cleanMedia(v: unknown): UploadedMedia | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== 'string' || !MEDIA_ID.test(m.id)) return null;
  if (typeof m.url !== 'string' || !MEDIA_URL.test(m.url)) return null;
  const thumb = typeof m.thumb === 'string' && MEDIA_URL.test(m.thumb) ? m.thumb : m.url;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
  return { id: m.id, url: m.url, thumb, w: num(m.w), h: num(m.h), bytes: num(m.bytes) };
}

/** Черновик этого вуза или null. Всё, что не похоже на наш формат, отбрасываем. */
export function readDraft(): PostDraft | null {
  if (!brand.id) return null;
  const raw = ls(key());
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return null;
    const text = typeof v.text === 'string' ? v.text : '';
    const category = categoryOf(typeof v.category === 'string' ? v.category : null)?.id ?? null;
    const media = (Array.isArray(v.media) ? v.media : []).map(cleanMedia).filter((m): m is UploadedMedia => !!m).slice(0, 4);
    if (!text.trim() && !media.length) return null;
    return { text, category, media };
  } catch {
    return null;
  }
}

/** Пустой черновик (ни текста, ни фото) не храним. */
export function writeDraft(d: PostDraft): void {
  if (!brand.id) return;
  if (!d.text.trim() && !d.media.length) { clearDraft(); return; }
  ls(key(), JSON.stringify({ text: d.text, category: d.category, media: d.media }));
}

export function clearDraft(): void {
  if (!brand.id) return;
  try { localStorage.removeItem(key()); } catch { /* приватный режим */ }
}

/** Отложенная запись: schedule() при каждом изменении, flush() — записать сейчас, cancel() — забыть. */
export function draftWriter(): { schedule(d: PostDraft): void; flush(): void; cancel(): void } {
  let timer = 0;
  let pending: PostDraft | null = null;
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (pending) writeDraft(pending);
    pending = null;
  };
  return {
    schedule(d) {
      pending = d;
      clearTimeout(timer);
      timer = window.setTimeout(flush, DELAY);
    },
    flush,
    cancel() {
      clearTimeout(timer);
      timer = 0;
      pending = null;
    },
  };
}
