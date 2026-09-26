// Камера моментов (как «New instant» в Instagram): живая камера в форме суперэллипса, кнопка спуска,
// вспышка и смена камеры; снимок — квадрат до 1080 (JPEG) и миниатюра 640 → /api/social/media → /api/social/instants.
// Нет камеры (отказ в доступе, компьютер без камеры) — «Выбрать фото» из галереи.
// Вспышка: задняя камера — фонарик, где браузер его даёт (Android); передняя — белый экран, как в iPhone.
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../ui/icons';
import { toast } from '../../ui/Toast';
import { useHideTabBar } from '../../ui/bar';
import { useLayer } from '../../ui/layers';
import { socialApi } from '../api';
import { currentReturnTo, useSession } from '../session';
import { errText, handledBySession } from '../chat/PostCard';
import { installSquircle } from './squircle';
import './instants.css';

type Phase = 'starting' | 'live' | 'nocam' | 'shot' | 'sending';
interface Shot { full: Blob; thumb: Blob; url: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Квадрат из середины кадра: полный (до 1080) и миниатюра (до 640). mirror — передняя камера. */
async function squareFrom(src: CanvasImageSource, w: number, h: number, mirror: boolean): Promise<Shot> {
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  const out = (size: number, q: number) => new Promise<Blob>((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) { reject(new Error('Не получилось сохранить снимок')); return; }
    if (mirror) { ctx.translate(size, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, sx, sy, side, side, 0, 0, size, size);
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Не получилось сохранить снимок'))), 'image/jpeg', q);
  });
  const fullSide = Math.max(1, Math.min(1080, Math.round(side)));
  let full = await out(fullSide, 0.86);
  if (full.size > 860_000) full = await out(fullSide, 0.7);
  const thumb = await out(Math.min(640, fullSide), 0.8);
  return { full, thumb, url: URL.createObjectURL(full) };
}

function camError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Нет доступа к камере. Разреши его в настройках браузера или выбери фото.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Камера не найдена. Можно выбрать фото из галереи.';
  return 'Камера не включилась. Можно выбрать фото из галереи.';
}

export function InstantCamera(p: { onClose: () => void; onSent: () => void; onArchive: () => void }): JSX.Element {
  installSquircle();
  const s = useSession();
  useLayer(true, p.onClose, 'instant-camera');
  useHideTabBar(true, 'instant');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [torch, setTorch] = useState(false);       // фонарик у этой камеры есть
  const [flashOn, setFlashOn] = useState(false);
  const [screenFlash, setScreenFlash] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const shotUrl = useRef('');

  const noFriends = s.me ? s.me.counts.friends === 0 : false;

  // Камера включена, пока нет снимка; сменили камеру — перезапуск.
  useEffect(() => {
    if (shot) return;
    let cancelled = false;
    const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
    setPhase('starting');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPhase('nocam');
      setError('Камера здесь недоступна. Можно выбрать фото из галереи.');
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
      const caps = (track && typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as { torch?: boolean };
      setTorch(!!caps.torch);
      setPhase('live');
    }, (e: unknown) => {
      if (cancelled) return;
      setPhase('nocam');
      setError(camError(e));
    });
    return () => { cancelled = true; stop(); };
  }, [facing, shot]);

  useEffect(() => () => { if (shotUrl.current) URL.revokeObjectURL(shotUrl.current); }, []);

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
      const img = await squareFrom(v, v.videoWidth, v.videoHeight, front);
      if (useTorch) await track!.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => {});
      keep(img);
    } catch (e) {
      toast(errText(e), { kind: 'error' });
    } finally {
      setTimeout(() => setScreenFlash(false), 300);
    }
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      let bmp: ImageBitmap;
      try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(f); }
      keep(await squareFrom(bmp, bmp.width, bmp.height, false));
      bmp.close();
    } catch {
      toast('Не получилось открыть фото', { kind: 'error' });
    }
  };

  const retake = () => { setShot(null); setFlashOn(false); };

  const send = async () => {
    if (!shot || phase === 'sending') return;
    if (!(await s.ensure('post', currentReturnTo()))) return;
    setPhase('sending');
    try {
      const up = await socialApi.uploadMedia({ full: shot.full, thumb: shot.thumb }, { kind: 'post' });
      await socialApi.createInstant(up.id);
      toast(noFriends ? 'Момент сохранён в «Твоих моментах»' : 'Момент отправлен друзьям');
      p.onSent();
      p.onClose();
    } catch (e) {
      setPhase('shot');
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    }
  };

  const canFlash = facing === 'user' || torch;
  const live = phase === 'live' || phase === 'starting';

  return createPortal(
    <div className="ix ic" role="dialog" aria-modal="true" aria-label="Новый момент">
      <div className="ix__bar">
        <button type="button" className="ix__icon" aria-label="Закрыть" onClick={p.onClose}><Icon name="close" size={24} /></button>
        <h2 className="ix__title">Новый момент</h2>
        <button type="button" className="ix__icon" aria-label="Твои моменты" onClick={p.onArchive}><Icon name="grid" size={24} /></button>
      </div>

      <div className="ix__stage">
        <div className="ix__frame sq">
          {shot
            ? <img src={shot.url} alt="Снимок" />
            : <video ref={video} className={facing === 'user' ? 'is-mirror' : undefined} playsInline muted autoPlay />}
          {!shot && phase === 'nocam' && (
            <div className="ix__msg">
              <span>{error}</span>
              <button type="button" className="ic__btn ic__btn--primary" onClick={() => fileRef.current?.click()}>Выбрать фото</button>
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
            : (
              <button type="button" className="ic__side" aria-label="Выбрать фото" onClick={() => fileRef.current?.click()}>
                <Icon name="photo" size={24} />
              </button>
            )}
          <button type="button" className="ic__shutter" aria-label="Сделать снимок" disabled={phase !== 'live'}
            onClick={() => void capture()} />
          <button type="button" className="ic__side" aria-label="Сменить камеру" disabled={phase === 'nocam'}
            onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
            <Icon name="flip" size={24} />
          </button>
        </div>
      )}

      <div className="ic__aud"><span className="ic__aud-ico"><Icon name="people" size={18} /></span>Увидят друзья · сутки</div>
      {noFriends && <p className="ic__hint">У тебя пока нет друзей — момент увидишь только ты, в «Твоих моментах».</p>}

      <input ref={fileRef} type="file" accept="image/*" hidden tabIndex={-1}
        onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void pickFile(f); }} />
      {screenFlash && <div className="ic__flash" aria-hidden="true" />}
    </div>,
    document.body,
  );
}
