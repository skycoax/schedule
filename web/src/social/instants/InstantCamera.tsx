// Камера моментов (как «New instant» в Instagram): живая камера в форме суперэллипса, кнопка спуска,
// вспышка и смена камеры; снимок — квадрат до 1080 (JPEG) и миниатюра 640 → /api/social/media → /api/social/instants.
// Кто увидит: «Все» (по умолчанию — вошедшие в «Обсуждениях» вуза) или «Только друзья»; выбор запоминается.
// Момент — только живой снимок: фото из галереи выбрать нельзя. Нет камеры (отказ в доступе, компьютер без
// камеры) — объяснение и «Повторить».
// Вспышка: задняя камера — фонарик, где браузер его даёт (Android); передняя — белый экран, как в iPhone.
// Зум: щипок двумя пальцами (колесо мыши) и кнопка «1× / 2×» внизу кадра. Где камера умеет зум сама (Android,
// новые iOS), зумирует камера; иначе — цифровой зум до 5×: снимок берётся из середины кадра.
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { chooseAction } from '../../ui/ActionSheet';
import { Icon } from '../../ui/icons';
import { toast } from '../../ui/Toast';
import { useHideTabBar } from '../../ui/bar';
import { useLayer } from '../../ui/layers';
import { ls } from '../../lib/store';
import { socialApi } from '../api';
import { currentReturnTo, useSession } from '../session';
import { errText, handledBySession } from '../chat/PostCard';
import type { InstantAudience } from '../types';
import { installSquircle } from './squircle';
import './instants.css';

type Phase = 'starting' | 'live' | 'nocam' | 'shot' | 'sending';
interface Shot { full: Blob; thumb: Blob | null; url: string }
interface ZoomRange { min: number; max: number; hw: boolean }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const AUD_KEY = 'instant_aud';
/** Сервер принимает фото до 900 КБ и миниатюру до 150 КБ — берём с запасом. */
const FULL_MAX = 880_000;
const THUMB_MAX = 140_000;
/** Цифровой зум (когда камера сама не умеет) — до 5×. */
const DIGITAL: ZoomRange = { min: 1, max: 5, hw: false };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** «1×», «1,5×», «2×». */
const zoomText = (z: number) => String(Math.round(z * 10) / 10).replace('.', ',') + '×';

const jpeg = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', q));

function paint(size: number, from: CanvasImageSource, side: number, x: number, y: number, mirror: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Не получилось сохранить снимок');
  ctx.imageSmoothingQuality = 'high';
  if (mirror) { ctx.translate(size, 0); ctx.scale(-1, 1); }
  ctx.drawImage(from, x, y, side, side, 0, 0, size, size);
  return c;
}

/**
 * Квадрат из середины кадра (при цифровом зуме — из меньшей середины): полное фото до 1080 и миниатюра до 640.
 * Качество подбирается под предел сервера (0,92 → 0,6), не влезло — размер чуть меньше; миниатюра не влезла —
 * без неё (сервер покажет полное). Снимок с любой камеры — хорошей или слабой — уходит без отказа.
 */
async function squareFrom(src: CanvasImageSource, w: number, h: number, mirror: boolean, zoom = 1): Promise<Shot> {
  const side = Math.min(w, h) / Math.max(1, zoom);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  let size = Math.max(1, Math.min(1080, Math.round(side)));
  let full: Blob | null = null;
  let canvas: HTMLCanvasElement | null = null;
  for (let attempt = 0; attempt < 5 && !full; attempt++) {
    canvas = paint(size, src, side, sx, sy, mirror);
    for (const q of [0.92, 0.85, 0.78, 0.7, 0.6]) {
      const b = await jpeg(canvas, q);
      if (b && b.size <= FULL_MAX) { full = b; break; }
    }
    if (!full) size = Math.max(1, Math.round(size * 0.85));
  }
  if (!full || !canvas) throw new Error('Не получилось сохранить снимок');
  const t = paint(Math.min(640, size), canvas, size, 0, 0, false);
  let thumb: Blob | null = null;
  for (const q of [0.82, 0.72, 0.62, 0.52, 0.42]) {
    const b = await jpeg(t, q);
    if (b && b.size <= THUMB_MAX) { thumb = b; break; }
  }
  return { full, thumb, url: URL.createObjectURL(full) };
}

function camError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Нет доступа к камере. Разреши его в настройках браузера — моменты снимаются только камерой.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Камера не найдена. Моменты снимаются только камерой.';
  return 'Камера не включилась. Закрой другие приложения с камерой и попробуй ещё раз.';
}

export function InstantCamera(p: { onClose: () => void; onSent: () => void; onArchive: () => void }): JSX.Element {
  installSquircle();
  const s = useSession();
  useLayer(true, p.onClose, 'instant-camera');
  useHideTabBar(true, 'instant');
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [torch, setTorch] = useState(false);       // фонарик у этой камеры есть
  const [flashOn, setFlashOn] = useState(false);
  const [screenFlash, setScreenFlash] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [attempt, setAttempt] = useState(0);        // «Повторить» — запросить камеру заново
  const [zoom, setZoom] = useState(1);
  const [zr, setZr] = useState<ZoomRange>(DIGITAL);
  const zoomNow = useRef({ zoom: 1, zr: DIGITAL, live: false });
  const shotUrl = useRef('');
  const [audience, setAudience] = useState<InstantAudience>(() => (ls(AUD_KEY) === 'friends' ? 'friends' : 'all'));

  const noFriends = s.me ? s.me.counts.friends === 0 : false;

  const pickAudience = async () => {
    const a = await chooseAction({
      title: 'Кто увидит момент',
      message: 'Сутки, потом он останется только у тебя в «Твоих моментах».',
      actions: [
        { id: 'all', label: 'Все в «Обсуждениях»', checked: audience === 'all' },
        { id: 'friends', label: 'Только друзья', checked: audience === 'friends' },
      ],
    });
    if (a !== 'all' && a !== 'friends') return;
    setAudience(a);
    ls(AUD_KEY, a);
  };

  // Камера включена, пока нет снимка; сменили камеру — перезапуск.
  useEffect(() => {
    if (shot) return;
    let cancelled = false;
    const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
    setPhase('starting');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPhase('nocam');
      setError('Камера здесь недоступна — моменты снимаются только камерой телефона.');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false,
    }).then((st) => {
      if (cancelled) { st.getTracks().forEach((t) => t.stop()); return; }
      stream.current = st;
      const v = video.current;
      if (v) { v.srcObject = st; void v.play().catch(() => {}); }
      const track = st.getVideoTracks()[0];
      const caps = (track && typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as
        { torch?: boolean; zoom?: { min?: number; max?: number } };
      const set = (track && typeof track.getSettings === 'function' ? track.getSettings() : {}) as { zoom?: number };
      setTorch(!!caps.torch);
      const hz = caps.zoom;
      if (hz && typeof hz.min === 'number' && typeof hz.max === 'number' && hz.max > hz.min) {
        const r = { min: hz.min, max: Math.min(hz.max, 10), hw: true };
        setZr(r);
        setZoom(clamp(typeof set.zoom === 'number' ? set.zoom : 1, r.min, r.max));
      } else {
        setZr(DIGITAL);
        setZoom(1);
      }
      setPhase('live');
    }, (e: unknown) => {
      if (cancelled) return;
      setPhase('nocam');
      setError(camError(e));
    });
    return () => { cancelled = true; stop(); };
  }, [facing, shot, attempt]);

  useEffect(() => () => { if (shotUrl.current) URL.revokeObjectURL(shotUrl.current); }, []);

  // Зум камеры (где браузер его даёт) — не чаще раза за кадр.
  useEffect(() => {
    if (!zr.hw || phase !== 'live') return;
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const f = requestAnimationFrame(() => {
      void track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] }).catch(() => {});
    });
    return () => cancelAnimationFrame(f);
  }, [zoom, zr.hw, phase]);

  // Щипок двумя пальцами и колесо мыши по кадру. Слушатели свои (не пассивные), чтобы щипок не зумил страницу.
  zoomNow.current = { zoom, zr, live: phase === 'live' };
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let start = 0;
    let from = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && zoomNow.current.live) { start = dist(e.touches); from = zoomNow.current.zoom; }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !start) return;
      e.preventDefault();
      const r = zoomNow.current.zr;
      setZoom(clamp(from * dist(e.touches) / start, r.min, r.max));
    };
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) start = 0; };
    const onWheel = (e: WheelEvent) => {
      if (!zoomNow.current.live) return;
      e.preventDefault();
      const { zoom: z, zr: r } = zoomNow.current;
      setZoom(clamp(z * Math.exp(-e.deltaY * 0.002), r.min, r.max));
    };
    const noGesture = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', noGesture);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', noGesture);
    };
  }, []);

  const toggleZoom = () => setZoom((z) => (z < 1.95 ? clamp(2, zr.min, zr.max) : clamp(1, zr.min, zr.max)));

  const keep = (img: Shot) => {
    if (shotUrl.current) URL.revokeObjectURL(shotUrl.current);
    shotUrl.current = img.url;
    setShot(img);
    setPhase('shot');
  };

  const capture = async () => {
    const v = video.current;
    if (!v || phase !== 'live' || !v.videoWidth) return;
    const track = stream.current?.getVideoTracks()[0];
    const front = facing === 'user';
    const useTorch = flashOn && !front && torch && !!track;
    try {
      if (flashOn && front) { setScreenFlash(true); await sleep(160); }
      if (useTorch) {
        await track!.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => {});
        await sleep(280);
      }
      const img = await squareFrom(v, v.videoWidth, v.videoHeight, front, zr.hw ? 1 : zoom);
      if (useTorch) await track!.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => {});
      keep(img);
    } catch (e) {
      toast(errText(e), { kind: 'error' });
    } finally {
      setTimeout(() => setScreenFlash(false), 300);
    }
  };

  const retake = () => { setShot(null); setFlashOn(false); };

  const send = async () => {
    if (!shot || phase === 'sending') return;
    if (!(await s.ensure('post', currentReturnTo()))) return;
    setPhase('sending');
    try {
      const up = await socialApi.uploadMedia({ full: shot.full, thumb: shot.thumb }, { kind: 'post' });
      await socialApi.createInstant(up.id, audience);
      toast(audience === 'all' ? 'Момент опубликован' : noFriends ? 'Момент сохранён в «Твоих моментах»' : 'Момент отправлен друзьям');
      p.onSent();
      p.onClose();
    } catch (e) {
      setPhase('shot');
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    }
  };

  const canFlash = facing === 'user' || torch;
  const live = phase === 'live' || phase === 'starting';
  const dz = zr.hw ? 1 : zoom;   // цифровой зум — увеличиваем само видео

  return createPortal(
    <div className="ix ic" role="dialog" aria-modal="true" aria-label="Новый момент">
      <div className="ix__bar">
        <button type="button" className="ix__icon" aria-label="Закрыть" onClick={p.onClose}><Icon name="close" size={24} /></button>
        <h2 className="ix__title">Новый момент</h2>
        <button type="button" className="ix__icon" aria-label="Твои моменты" onClick={p.onArchive}><Icon name="grid" size={24} /></button>
      </div>

      <div className="ix__stage">
        <div ref={frame} className={'ix__frame sq' + (shot ? '' : ' is-cam')}>
          {shot
            ? <img src={shot.url} alt="Снимок" />
            : <video ref={video} style={{ transform: `scale(${facing === 'user' ? -dz : dz}, ${dz})` }} playsInline muted autoPlay />}
          {!shot && phase === 'live' && (
            <button type="button" className={'ic__zoom' + (zoom > 1.04 ? ' is-on' : '')} onClick={toggleZoom}
              aria-label={'Зум ' + zoomText(zoom)}>{zoomText(zoom)}</button>
          )}
          {!shot && phase === 'nocam' && (
            <div className="ix__msg">
              <span>{error}</span>
              <button type="button" className="ic__btn ic__btn--primary" onClick={() => setAttempt((n) => n + 1)}>Повторить</button>
            </div>
          )}
        </div>
      </div>

      {shot ? (
        <div className="ic__after">
          <button type="button" className="ic__btn" disabled={phase === 'sending'} onClick={retake}>Переснять</button>
          <button type="button" className="ic__btn ic__btn--primary" disabled={phase === 'sending'} onClick={() => void send()}>
            {phase === 'sending' ? 'Отправляю…' : 'Отправить'}
          </button>
        </div>
      ) : (
        <div className="ic__controls">
          {canFlash
            ? (
              <button type="button" className={'ic__side' + (flashOn ? ' is-on' : '')} aria-pressed={flashOn}
                aria-label={flashOn ? 'Вспышка включена' : 'Вспышка выключена'} disabled={!live} onClick={() => setFlashOn((v) => !v)}>
                <Icon name={flashOn ? 'flash' : 'flashOff'} size={24} />
              </button>
            )
            : <span className="ic__side is-empty" aria-hidden="true" />}
          <button type="button" className="ic__shutter" aria-label="Сделать снимок" disabled={phase !== 'live'}
            onClick={() => void capture()} />
          <button type="button" className="ic__side" aria-label="Сменить камеру" disabled={phase === 'nocam'}
            onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
            <Icon name="flip" size={24} />
          </button>
        </div>
      )}

      <button type="button" className="ic__aud" aria-haspopup="menu" disabled={phase === 'sending'} onClick={() => void pickAudience()}>
        <span className="ic__aud-ico"><Icon name={audience === 'all' ? 'globe' : 'people'} size={18} /></span>
        {audience === 'all' ? 'Увидят все' : 'Увидят друзья'} · сутки
        <span className="ic__aud-chev"><Icon name="chevronDown" size={16} /></span>
      </button>
      {audience === 'friends' && noFriends && (
        <p className="ic__hint">У тебя пока нет друзей — момент увидишь только ты, в «Твоих моментах».</p>
      )}

      {screenFlash && <div className="ic__flash" aria-hidden="true" />}
    </div>,
    document.body,
  );
}
