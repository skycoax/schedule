// Подготовка фото на телефоне: перекодируем в JPEG без метаданных (EXIF, GPS не уходят с телефона),
// уменьшаем до 1600 px и 880 КБ, делаем миниатюру до 640 px и 140 КБ. Сервер потом проверяет всё сам.
// Миниатюра считается из ИТОГОВОГО размера полного фото (сервер сверяет пропорции, §B.5 #14).

export interface PreparedImage { full: Blob; thumb: Blob | null; w: number; h: number; preview: string }

export class ImageError extends Error {
  code: 'type' | 'decode' | 'too_big';
  constructor(code: ImageError['code'], message: string) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
  }
}

const TEXT = {
  type: 'Это не фото',
  decode: 'Не удалось открыть фото. Попробуй другое.',
  too_big: 'Фото слишком большое',
} as const;

const MAX_FILE = 30 * 1024 * 1024;
const MAX_SOURCE_SIDE = 12000;
const EXT = /\.(jpe?g|png|webp|heic|heif|gif|avif|bmp)$/i;

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Source = ImageBitmap | HTMLImageElement | Canvas;

function makeCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function ctxOf(c: Canvas): Ctx {
  const ctx = c.getContext('2d') as Ctx | null;
  if (!ctx) throw new ImageError('decode', TEXT.decode);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

function sizeOf(src: Source): { w: number; h: number } {
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) {
    return { w: src.naturalWidth, h: src.naturalHeight };
  }
  return { w: (src as ImageBitmap).width, h: (src as ImageBitmap).height };
}

function free(c: Canvas) {
  c.width = 0; c.height = 0;
}

/** Рисуем src в w×h на белом фоне (прозрачный PNG не станет чёрным). Большое уменьшение — ступенями. */
function draw(src: Source, w: number, h: number, crop?: { x: number; y: number; size: number }): Canvas {
  let cur: Source = src;
  let { w: cw, h: ch } = crop ? { w: crop.size, h: crop.size } : sizeOf(src);
  let sx = crop ? crop.x : 0;
  let sy = crop ? crop.y : 0;
  const temps: Canvas[] = [];
  // Уменьшаем вдвое, пока до цели больше чем в два раза, — так меньше «лесенки».
  while (cw / 2 > w && ch / 2 > h) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const t = makeCanvas(nw, nh);
    ctxOf(t).drawImage(cur as CanvasImageSource, sx, sy, cw, ch, 0, 0, nw, nh);
    temps.push(t);
    cur = t; cw = nw; ch = nh; sx = 0; sy = 0;
  }
  const out = makeCanvas(w, h);
  const ctx = ctxOf(out);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(cur as CanvasImageSource, sx, sy, cw, ch, 0, 0, w, h);
  temps.forEach(free);
  return out;
}

async function encode(c: Canvas, q: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && c instanceof OffscreenCanvas) {
    return c.convertToBlob({ type: 'image/jpeg', quality: q });
  }
  return new Promise<Blob>((resolve, reject) => {
    (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new ImageError('decode', TEXT.decode))), 'image/jpeg', q);
  });
}

/** Декодирование с учётом поворота из EXIF. */
export async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* пробуем через <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty');
    return img;
  } catch {
    throw new ImageError('decode', TEXT.decode);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function releaseBitmap(b: ImageBitmap | HTMLImageElement): void {
  if (typeof ImageBitmap !== 'undefined' && b instanceof ImageBitmap) b.close();
  else if (typeof HTMLImageElement !== 'undefined' && b instanceof HTMLImageElement) b.src = '';
}

/** defaults: maxSide 1600, maxBytes 880_000, thumbSide 640, thumbBytes 140_000 */
export async function prepareImage(file: File,
  o?: { maxSide?: number; maxBytes?: number; thumbSide?: number; thumbBytes?: number }): Promise<PreparedImage> {
  const maxSide = o?.maxSide ?? 1600;
  const maxBytes = o?.maxBytes ?? 880_000;
  const thumbSide = o?.thumbSide ?? 640;
  const thumbBytes = o?.thumbBytes ?? 140_000;

  if (!(file.type || '').startsWith('image/') && !EXT.test(file.name || '')) throw new ImageError('type', TEXT.type);
  if (file.size > MAX_FILE) throw new ImageError('too_big', TEXT.too_big);

  const bmp = await loadBitmap(file);
  try {
    const { w: sw, h: sh } = sizeOf(bmp);
    if (!sw || !sh) throw new ImageError('decode', TEXT.decode);
    if (Math.max(sw, sh) > MAX_SOURCE_SIDE) throw new ImageError('too_big', TEXT.too_big);

    // Полное фото: качество 0.82 → 0.5 шагами по 0.08; не влезло — уменьшаем размер на 15 %.
    let scale = Math.min(1, maxSide / Math.max(sw, sh));
    let full: Blob | null = null;
    let fw = 0, fh = 0;
    let canvas: Canvas | null = null;
    for (let attempt = 0; attempt < 6 && !full; attempt++) {
      fw = Math.max(1, Math.round(sw * scale));
      fh = Math.max(1, Math.round(sh * scale));
      if (canvas) free(canvas);
      canvas = draw(bmp, fw, fh);
      for (let q = 0.82; q >= 0.5 - 1e-9; q -= 0.08) {
        const b = await encode(canvas, q);
        if (b.size <= maxBytes) { full = b; break; }
      }
      if (!full) scale *= 0.85;
    }
    if (!full || !canvas) {
      if (canvas) free(canvas);
      throw new ImageError('too_big', TEXT.too_big);
    }

    // Миниатюра: из итогового полного размера, уменьшаем только качество (до 0.4); не влезла — без неё.
    const s = Math.min(1, thumbSide / Math.max(fw, fh));
    const tw = Math.max(1, Math.round(fw * s));
    const th = Math.max(1, Math.round(fh * s));
    const tc = draw(canvas, tw, th);
    let thumb: Blob | null = null;
    for (let q = 0.72; q >= 0.4 - 1e-9; q -= 0.08) {
      const b = await encode(tc, q);
      if (b.size <= thumbBytes) { thumb = b; break; }
    }
    free(tc);
    free(canvas);

    return { full, thumb, w: fw, h: fh, preview: URL.createObjectURL(thumb || full) };
  } finally {
    releaseBitmap(bmp);
  }
}

/** Аватар: квадратная рамка → полное 512 (q .86) и миниатюра 128 (q .8). */
export async function cropSquare(src: ImageBitmap | HTMLImageElement, crop: { x: number; y: number; size: number },
  out = 512): Promise<{ full: Blob; thumb: Blob }> {
  const size = Math.max(1, Math.round(out));
  const c = draw(src, size, size, crop);
  try {
    const full = await encode(c, 0.86);
    const tc = draw(c, 128, 128);
    try {
      const thumb = await encode(tc, 0.8);
      return { full, thumb };
    } finally {
      free(tc);
    }
  } finally {
    free(c);
  }
}
