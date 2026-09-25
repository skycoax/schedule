// Просмотр фото во весь экран (ux.md §5.9): листание вбок, «N из M», точки, закрытие крестиком,
// Esc, «Назад» и смахиванием вниз; двойное касание — увеличение ×2 в точке касания (двигается пальцем),
// одно касание прячет и показывает кнопки. Пока полное фото грузится, под ним видна миниатюра.
// Слой истории; пока открыт, панель вкладок скрыта.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { MediaRef } from '../types';
import { useLayer } from '../../ui/layers';
import { useHideTabBar } from '../../ui/bar';
import { Icon } from '../../ui/icons';
import './social-ui.css';

const CLOSE_DY = 90;          // px вниз — закрыть
const CLOSE_V = 0.5;          // px/мс — или смахнуть быстро
const TAP_MS = 280;           // два касания за это время — двойное
const ZOOM = 2;

interface Zoom { tx: number; ty: number }

function Frame({ m, onReady }: { m: MediaRef; onReady?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const ratio = m.w > 0 && m.h > 0 ? m.w / m.h : 1;
  const thumb = m.thumb && m.thumb !== m.url ? m.thumb : '';
  return (
    <div
      className="pview__frame"
      style={{ aspectRatio: String(ratio), '--pv-r': ratio.toFixed(4) } as CSSProperties}
    >
      {thumb && !loaded && <img className="pview__img pview__img--thumb" src={thumb} alt="" decoding="async" />}
      {failed
        ? <span className="pview__fail"><Icon name="photo" size={36} /><span>Фото не загрузилось</span></span>
        : (
          <img
            className={'pview__img' + (loaded ? ' is-loaded' : '')} src={m.url} alt="" decoding="async" draggable={false}
            onLoad={() => { setLoaded(true); onReady?.(); }}
            onError={() => setFailed(true)}
          />
        )}
    </div>
  );
}

export function PhotoViewer(p: { media: MediaRef[]; index: number; open: boolean; onClose: () => void }): JSX.Element | null {
  const n = p.media.length;
  const [cur, setCur] = useState(p.index);
  const [bare, setBare] = useState(false);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(p.onClose);
  onCloseRef.current = p.onClose;

  useLayer(p.open && n > 0, p.onClose, 'viewer');
  useHideTabBar(p.open && n > 0, 'viewer');

  // Открыли — встаём на нужное фото без анимации, фокус внутрь; закрыли — фокус обратно.
  useLayoutEffect(() => {
    if (!p.open || !n) return;
    const opener = document.activeElement as HTMLElement | null;
    const i = Math.max(0, Math.min(n - 1, p.index));
    setCur(i);
    setZoom(null);
    setBare(false);
    const el = track.current;
    if (el) el.scrollLeft = i * el.clientWidth;
    root.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener !== document.body && opener.isConnected) {
        try { opener.focus({ preventScroll: true }); } catch { /* уже не в документе */ }
      }
    };
  }, [p.open, p.index, n]);

  // Колесо мыши не прокручивает страницу под просмотром.
  useEffect(() => {
    const el = root.current;
    if (!p.open || !el) return;
    const onWheel = (e: WheelEvent) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.preventDefault(); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [p.open]);

  // Жесты: смахнуть вниз, двойное касание, перемещение увеличенного фото.
  const g = useRef({
    id: -1, x0: 0, y0: 0, lastY: 0, lastT: 0, vel: 0, mode: '' as '' | 'drag' | 'pan' | 'none',
    startZoom: null as Zoom | null, tapAt: 0, tapX: 0, tapY: 0, tapTimer: 0,
  });
  useEffect(() => () => clearTimeout(g.current.tapTimer), []);

  if (!p.open || !n) return null;

  const go = (i: number) => {
    const el = track.current;
    const j = Math.max(0, Math.min(n - 1, i));
    setZoom(null);
    if (el) el.scrollTo({ left: j * el.clientWidth, behavior: 'smooth' });
    setCur(j);
  };

  const page = () => track.current?.children[cur] as HTMLElement | undefined;
  const frame = () => page()?.querySelector<HTMLElement>('.pview__frame') || null;

  const clampZoom = (z: Zoom): Zoom => {
    const f = frame();
    const w = f?.offsetWidth || 0, h = f?.offsetHeight || 0;
    const mx = Math.max(0, (w * ZOOM - innerWidth) / 2);
    const my = Math.max(0, (h * ZOOM - innerHeight) / 2);
    return { tx: Math.max(-mx, Math.min(mx, z.tx)), ty: Math.max(-my, Math.min(my, z.ty)) };
  };

  const setDrag = (dy: number, animate: boolean) => {
    const t = track.current;
    if (t) {
      t.style.transition = animate ? 'transform 220ms cubic-bezier(.2,.85,.3,1)' : 'none';
      t.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
    }
    if (bg.current) {
      bg.current.style.transition = animate ? 'opacity 220ms ease' : 'none';
      bg.current.style.opacity = dy ? String(Math.max(0, 1 - Math.abs(dy) / 300)) : '';
    }
    root.current?.classList.toggle('is-dragging', !!dy);
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as Element).closest('.pview__top, .pview__dots')) return;
    const s = g.current;
    s.id = e.pointerId; s.x0 = e.clientX; s.y0 = e.clientY; s.lastY = e.clientY; s.lastT = e.timeStamp; s.vel = 0;
    s.mode = zoom ? 'pan' : '';
    s.startZoom = zoom;
    if (zoom) e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (e.pointerId !== s.id || s.mode === 'none') return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (s.mode === 'pan' && s.startZoom) {
      setZoom(clampZoom({ tx: s.startZoom.tx + dx, ty: s.startZoom.ty + dy }));
      return;
    }
    if (!s.mode) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { s.mode = 'none'; return; }   // листает вбок
      if (Math.abs(dy) < 10) return;
      s.mode = 'drag';
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = e.timeStamp - s.lastT;
    if (dt > 0) s.vel = 0.7 * ((e.clientY - s.lastY) / dt) + 0.3 * s.vel;
    s.lastY = e.clientY; s.lastT = e.timeStamp;
    setDrag(dy, false);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (e.pointerId !== s.id) return;
    s.id = -1;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (s.mode === 'drag') {
      if (Math.abs(dy) > CLOSE_DY || Math.abs(s.vel) > CLOSE_V) {
        onCloseRef.current();
      } else {
        setDrag(0, true);
      }
      s.mode = '';
      return;
    }
    const moved = Math.abs(dx) > 10 || Math.abs(dy) > 10;
    s.mode = '';
    if (moved || e.type === 'pointercancel') return;
    // Касание: двойное — увеличить/уменьшить, одиночное — спрятать/показать кнопки.
    if (e.timeStamp - s.tapAt < TAP_MS && Math.hypot(e.clientX - s.tapX, e.clientY - s.tapY) < 30) {
      clearTimeout(s.tapTimer);
      s.tapAt = 0;
      if (zoom) { setZoom(null); return; }
      const f = frame();
      if (!f) return;
      const r = f.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      setZoom(clampZoom({ tx: -(e.clientX - cx) * (ZOOM - 1), ty: -(e.clientY - cy) * (ZOOM - 1) }));
      return;
    }
    s.tapAt = e.timeStamp; s.tapX = e.clientX; s.tapY = e.clientY;
    clearTimeout(s.tapTimer);
    s.tapTimer = window.setTimeout(() => setBare((b) => !b), TAP_MS);
  };

  return createPortal(
    <div
      ref={root}
      className={'pview' + (bare ? ' is-bare' : '') + (zoom ? ' is-zoomed' : '')}
      role="dialog" aria-modal="true" aria-label="Просмотр фото" tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
        else if (e.key === 'Tab') {
          // Внутри просмотра одна кнопка — фокус остаётся здесь.
          e.preventDefault();
          root.current?.querySelector<HTMLElement>('.pview__close')?.focus();
        }
      }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    >
      <div ref={bg} className="pview__bg" aria-hidden="true" />
      <div
        ref={track} className="pview__track"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (!el.clientWidth) return;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== cur) { setCur(i); setZoom(null); }
        }}
      >
        {p.media.map((m, i) => (
          <div key={m.id} className="pview__page" aria-hidden={i !== cur || undefined}>
            <div
              className="pview__zoom"
              style={i === cur && zoom ? { transform: 'translate(' + zoom.tx + 'px,' + zoom.ty + 'px) scale(' + ZOOM + ')' } : undefined}
            >
              <Frame m={m} />
            </div>
          </div>
        ))}
      </div>
      <div className="pview__top">
        <button type="button" className="pview__close" aria-label="Закрыть" onClick={() => onCloseRef.current()}>
          <Icon name="close" size={22} />
        </button>
        {n > 1 ? <span className="pview__count" aria-live="polite">{cur + 1} из {n}</span> : <span />}
        <span className="pview__spacer" />
      </div>
      {n > 1 && (
        <div className="pview__dots" aria-hidden="true">
          {p.media.map((m, i) => <span key={m.id} className={'pview__dot' + (i === cur ? ' is-on' : '')} />)}
        </div>
      )}
    </div>,
    document.body,
  );
}
