// Экран телефона — 2D-холст 1179×2556 (кадр записи + строка состояния + наложения), из него текстура для 3D.
// Кадры записей лежат в public/frames/<клип>/00001.jpg… (30 к/с), строки состояния — public/ui/statusbar-*.png.
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { continueRender, delayRender, staticFile } from 'remotion';

export const SW = 1179, SH = 2556;
export type Bar = 'dark' | 'light' | 'airplane' | 'cover' | 'none';
// circle — показать слой только внутри круга [x, y, r] (смена темы)
export type Layer = { clip: string; frame: number; alpha?: number; bar?: Bar; dy?: number; circle?: [number, number, number] };

const cache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise((ok, fail) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => fail(new Error('нет картинки ' + src));
      im.src = src;
    });
    cache.set(src, p);
    if (cache.size > 40) cache.delete(cache.keys().next().value!);
  }
  return p;
}
export const frameSrc = (clip: string, frame: number) => staticFile(`frames/${clip}/${String(Math.max(0, Math.round(frame)) + 1).padStart(5, '0')}.jpg`);
export const barSrc = (bar: Bar) => staticFile(`ui/statusbar-${bar}.png`);

// draw — дорисовать поверх (уведомление, касание…), extra — картинки для draw; key — всё, от чего зависит картинка
export type Draw = (ctx: CanvasRenderingContext2D, extra: HTMLImageElement[], canvas: HTMLCanvasElement) => void;
export function useScreenTexture(layers: Layer[], draw?: Draw, key = '', extra: string[] = []) {
  const canvas = useMemo(() => { const c = document.createElement('canvas'); c.width = SW; c.height = SH; return c; }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    return t;
  }, [canvas]);
  const { advance } = useThree();
  const k = JSON.stringify(layers) + '|' + key + '|' + extra.join(',');
  useEffect(() => {
    const h = delayRender('экран ' + k.slice(0, 80));
    let alive = true, done = false;
    const finish = () => { if (!done) { done = true; continueRender(h); } };
    const srcs = layers.flatMap((l) => [frameSrc(l.clip, l.frame), ...(l.bar && l.bar !== 'none' ? [barSrc(l.bar)] : [])]);
    const nBase = srcs.length;
    srcs.push(...extra);
    Promise.all(srcs.map(loadImage)).then((imgs) => {
      if (!alive) { finish(); return; }
      const ctx = canvas.getContext('2d')!;
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, SW, SH);
      let i = 0;
      for (const l of layers) {
        const im = imgs[i++];
        ctx.save();
        if (l.circle) { ctx.beginPath(); ctx.arc(l.circle[0], l.circle[1], l.circle[2], 0, Math.PI * 2); ctx.clip(); }
        ctx.globalAlpha = l.alpha ?? 1;
        // запись может быть чуть другой пропорции (видео владельца) — вписываем по ширине, лишнее сверху срезаем
        const scale = SW / im.width;
        const h2 = im.height * scale;
        ctx.drawImage(im, 0, SH - h2 + (l.dy ?? 0), SW, h2);
        if (l.bar && l.bar !== 'none') ctx.drawImage(imgs[i++], 0, 0, SW, 177);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (draw) draw(ctx, imgs.slice(nBase), canvas);
      tex.needsUpdate = true;
      advance(performance.now());
      finish();
    }).catch((e) => { console.error(e); finish(); });
    return () => { alive = false; finish(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return tex;
}
