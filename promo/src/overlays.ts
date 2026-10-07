// Наложения на экран телефона (рисуются в 2D-холсте экрана, 1179×2556 = 393×852 pt @3x).
import { SW } from './screen';

const P = 3; // точек на pt

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Баннер уведомления iOS. Тексты — как их собирает server/src/social/push.js (schedText) для настоящей правки.
export function drawBanner(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, icon: HTMLImageElement,
  y: number, alpha: number, title: string, body: string) {
  if (alpha <= 0) return;
  const x = 8 * P, w = SW - 16 * P, h = 86 * P, r = 26 * P;
  ctx.save();
  ctx.globalAlpha = alpha;
  // размытая подложка (материал iOS)
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const t = tmp.getContext('2d')!;
  t.filter = 'blur(40px) saturate(1.4)';
  t.drawImage(canvas, x - 60, y - 60, w + 120, h + 120, -60, -60, w + 120, h + 120);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 18;
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = 'rgba(30,30,32,1)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(tmp, x, y);
  ctx.fillStyle = 'rgba(38,38,40,0.72)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  // значок приложения
  const is = 38 * P, ix = x + 14 * P, iy = y + (h - is) / 2;
  ctx.save();
  rr(ctx, ix, iy, is, is, 9 * P);
  ctx.clip();
  ctx.drawImage(icon, ix, iy, is, is);
  ctx.restore();
  // тексты
  const tx = ix + is + 11 * P, tw = x + w - tx - 14 * P;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${15 * P}px "Inter"`;
  ctx.fillText(title, tx, y + 30 * P, tw - 50 * P);
  ctx.fillStyle = 'rgba(235,235,245,0.6)';
  ctx.font = `400 ${13 * P}px "Inter"`;
  const now = 'сейчас';
  ctx.fillText(now, x + w - 14 * P - ctx.measureText(now).width, y + 29 * P);
  ctx.fillStyle = '#ffffff';
  ctx.font = `400 ${15 * P}px "Inter"`;
  // перенос тела на две строки
  const words = body.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const wd of words) {
    const test = cur ? cur + ' ' + wd : wd;
    if (ctx.measureText(test).width > tw && cur) { lines.push(cur); cur = wd; } else cur = test;
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].replace(/\s*\S*$/, '') + '…'; }
  lines.forEach((ln, i) => ctx.fillText(ln, tx, y + (50 + i * 19) * P));
  ctx.restore();
}

// Касание: мягкий круг, который сжимается и гаснет (как в демонстрациях iOS). age — кадров с касания.
export function drawTap(ctx: CanvasRenderingContext2D, x: number, y: number, age: number, light = false) {
  if (age < -6 || age > 16) return;
  const t = (age + 6) / 22;
  const a = age < 0 ? (age + 6) / 6 : Math.max(0, 1 - age / 16);
  const r = (22 + 10 * Math.sin(Math.min(1, t) * Math.PI)) * P * (age < 0 ? 1.15 - (age + 6) / 40 : 1);
  ctx.save();
  ctx.globalAlpha = 0.42 * a;
  ctx.fillStyle = light ? '#000000' : '#ffffff';
  ctx.beginPath();
  ctx.arc(x * P, y * P, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.65 * a;
  ctx.lineWidth = 2 * P;
  ctx.strokeStyle = light ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)';
  ctx.stroke();
  ctx.restore();
}
