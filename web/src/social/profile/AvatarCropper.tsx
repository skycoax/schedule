// Кадрирование фото профиля (ux.md §6.5): квадрат, фото двигается пальцем и увеличивается щипком,
// колесом или ползунком. «Готово» → cropSquare (512 + 128, без метаданных) → onDone (загружает вызывающий).
// Грузится лениво: нужен редко, а в основном куске «Профиля» лишний вес.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, PointerEvent } from 'react';
import { cropSquare, loadBitmap, releaseBitmap } from '../../lib/image';
import { Sheet } from '../../ui/Sheet';
import { Spinner } from '../../ui/Spinner';
import { toast } from '../../ui/Toast';
import './profile.css';

type Bmp = ImageBitmap | HTMLImageElement;
const MAX_ZOOM = 4;

const sideOf = () => Math.max(160, Math.min(window.innerWidth - 32, 360));
const dimsOf = (b: Bmp) =>
  b instanceof HTMLImageElement ? { w: b.naturalWidth, h: b.naturalHeight } : { w: b.width, h: b.height };

export function AvatarCropper(p: {
  file: File | null;
  onCancel: () => void;
  /** Получает готовые JPEG; пока промис не выполнен, «Готово» занята. Отказ — окно остаётся открытым. */
  onDone: (img: { full: Blob; thumb: Blob }) => Promise<void>;
}): JSX.Element | null {
  const open = !!p.file;
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const [bmp, setBmp] = useState<Bmp | null>(null);
  const [side, setSide] = useState(sideOf);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  // Положение фото: левый верхний угол в пикселях окна кадра.
  const pos = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const onCancel = useRef(p.onCancel);
  onCancel.current = p.onCancel;

  // Файл → картинка (с учётом поворота из EXIF).
  useEffect(() => {
    if (!p.file) return;
    let alive = true;
    let got: Bmp | null = null;
    setBmp(null);
    setBusy(false);
    loadBitmap(p.file).then(
      (b) => { if (alive) { got = b; setBmp(b); } else releaseBitmap(b); },
      (e) => {
        if (!alive) return;
        toast(e instanceof Error && e.message ? e.message : 'Не удалось открыть фото. Попробуй другое.', { kind: 'error' });
        onCancel.current();
      },
    );
    return () => { alive = false; if (got) releaseBitmap(got); };
  }, [p.file]);

  useEffect(() => {
    if (!open) return;
    const on = () => setSide(sideOf());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [open]);

  const scaleOf = useCallback((z: number) => {
    if (!bmp) return 1;
    const { w, h } = dimsOf(bmp);
    return Math.max(side / w, side / h) * z;
  }, [bmp, side]);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c || !bmp) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const px = Math.round(side * dpr);
    if (c.width !== px) { c.width = px; c.height = px; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { w, h } = dimsOf(bmp);
    const s = scaleOf(zoomRef.current);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, px, px);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, pos.current.x * dpr, pos.current.y * dpr, w * s * dpr, h * s * dpr);
  }, [bmp, side, scaleOf]);

  /** Фото всегда закрывает кадр целиком — без пустых краёв. */
  const clamp = useCallback(() => {
    if (!bmp) return;
    const { w, h } = dimsOf(bmp);
    const s = scaleOf(zoomRef.current);
    pos.current.x = Math.min(0, Math.max(side - w * s, pos.current.x));
    pos.current.y = Math.min(0, Math.max(side - h * s, pos.current.y));
  }, [bmp, side, scaleOf]);

  /** Новый масштаб так, чтобы точка (cx, cy) кадра осталась на месте. */
  const zoomAt = useCallback((z: number, cx: number, cy: number) => {
    const z2 = Math.min(MAX_ZOOM, Math.max(1, z));
    const s1 = scaleOf(zoomRef.current);
    const s2 = scaleOf(z2);
    pos.current.x = cx - ((cx - pos.current.x) / s1) * s2;
    pos.current.y = cy - ((cy - pos.current.y) / s1) * s2;
    zoomRef.current = z2;
    clamp();
    setZoom(z2);
    draw();
  }, [scaleOf, clamp, draw]);

  // Новая картинка или размер кадра — по центру, без увеличения.
  useEffect(() => {
    if (!bmp) return;
    const { w, h } = dimsOf(bmp);
    zoomRef.current = 1;
    setZoom(1);
    const s = scaleOf(1);
    pos.current = { x: (side - w * s) / 2, y: (side - h * s) / 2 };
    draw();
  }, [bmp, side, scaleOf, draw]);

  // Колесо мыши: слушатель не пассивный, иначе страница прокрутится.
  useEffect(() => {
    const el = view.current;
    if (!el || !bmp) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(zoomRef.current * Math.exp(-e.deltaY / 400), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, [bmp, zoomAt]);

  const local = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!bmp || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    pinch.current = null;
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !bmp) return;
    const cur = local(e);
    pointers.current.set(e.pointerId, cur);
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      pos.current.x += cur.x - prev.x;
      pos.current.y += cur.y - prev.y;
      clamp();
      draw();
      return;
    }
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const last = pinch.current;
    pinch.current = { dist, mx, my };
    if (!last) return;
    pos.current.x += mx - last.mx;
    pos.current.y += my - last.my;
    zoomAt(zoomRef.current * (dist / last.dist), mx, my);
  };

  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 12;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
    };
    if (d[e.key]) {
      e.preventDefault();
      pos.current.x += d[e.key][0];
      pos.current.y += d[e.key][1];
      clamp();
      draw();
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(zoomRef.current + 0.25, side / 2, side / 2); }
    else if (e.key === '-') { e.preventDefault(); zoomAt(zoomRef.current - 0.25, side / 2, side / 2); }
  };

  const done = async () => {
    if (!bmp || busy) return;
    const { w, h } = dimsOf(bmp);
    const s = scaleOf(zoomRef.current);
    const size = Math.min(w, h, side / s);
    const x = Math.min(Math.max(0, -pos.current.x / s), w - size);
    const y = Math.min(Math.max(0, -pos.current.y / s), h - size);
    setBusy(true);
    try {
      const img = await cropSquare(bmp, { x, y, size }, 512);
      await p.onDone(img);
    } catch {
      /* ошибку показал вызывающий (или cropSquare) — остаёмся в окне */
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Sheet
      open onClose={p.onCancel} variant="full" title="Фото профиля" className="crop-sheet" dismissible={!busy}
      left={<button type="button" className="crop__bar-btn" onClick={p.onCancel} disabled={busy}>Отмена</button>}
      right={
        <button type="button" className="crop__bar-btn crop__bar-btn--done" onClick={() => void done()}
          disabled={!bmp || busy} aria-busy={busy || undefined}>
          {busy ? <Spinner size={18} /> : 'Готово'}
        </button>
      }
    >
      <div className="crop">
        <div
          ref={view} className="crop__view" style={{ width: side, height: side }}
          tabIndex={0} role="img" aria-label="Фото профиля: двигай стрелками, увеличивай клавишами плюс и минус"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
        >
          <canvas ref={canvas} className="crop__canvas" style={{ width: side, height: side }} />
          <span className="crop__mask" aria-hidden="true" />
          {!bmp && <span className="crop__load"><Spinner size={24} /></span>}
        </div>
        <div className="crop__zoom">
          <button type="button" className="crop__zbtn" aria-label="Уменьшить" disabled={!bmp || zoom <= 1}
            onClick={() => zoomAt(zoomRef.current - 0.5, side / 2, side / 2)}>
            <span aria-hidden="true">−</span>
          </button>
          <input
            type="range" className="crop__range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} disabled={!bmp}
            aria-label="Масштаб" onChange={(e) => zoomAt(Number(e.currentTarget.value), side / 2, side / 2)}
          />
          <button type="button" className="crop__zbtn" aria-label="Увеличить" disabled={!bmp || zoom >= MAX_ZOOM}
            onClick={() => zoomAt(zoomRef.current + 0.5, side / 2, side / 2)}>
            <span aria-hidden="true">+</span>
          </button>
        </div>
        <p className="crop__hint">Двигай и увеличивай фото</p>
      </div>
    </Sheet>
  );
}

export default AvatarCropper;
