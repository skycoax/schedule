// Покадровая съёмка: часы страницы (Playwright clock) и все CSS-анимации сдвигаются ровно на 1/fps за кадр,
// кадр — скриншот 1179×2556. Анимации, таймеры и экраны — настоящие, из кода приложения.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export class Shooter {
  constructor(page, dir, fps = 30) {
    this.page = page; this.dir = dir; this.fps = fps; this.n = 0; this.v = 0; this.taps = [];
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  }
  async start(at) { await this.page.clock.pauseAt(new Date(at)); this.v = 0; await this.sync(); }
  async sync() {
    await this.page.evaluate((v) => {
      for (const a of document.getAnimations()) {
        if (a.__t0 === undefined) a.__t0 = v - (a.currentTime || 0);
        a.pause(); a.currentTime = Math.max(0, v - a.__t0);
      }
    }, this.v);
  }
  async frame(before) {
    await this.page.clock.runFor(1000 / this.fps); this.v += 1000 / this.fps;
    await this.page.waitForTimeout(30);
    if (before) await before();
    await this.sync();
    await this.page.screenshot({ path: path.join(this.dir, `f${String(this.n++).padStart(5, '0')}.png`), caret: 'hide' });
  }
  async hold(sec, each) { const k = Math.max(1, Math.round(sec * this.fps)); for (let i = 0; i < k; i++) await this.frame(each ? () => each((i + 1) / k) : undefined); }
  // плавная прокрутка документа до y за sec секунд
  async scroll(y, sec) {
    const y0 = await this.page.evaluate(() => window.scrollY);
    await this.hold(sec, (t) => this.page.evaluate((yy) => window.scrollTo(0, yy), y0 + (y - y0) * ease(t)));
  }
  async scrollEl(sel, y, sec) {
    const y0 = await this.page.evaluate((s) => document.querySelector(s).scrollTop, sel);
    await this.hold(sec, (t) => this.page.evaluate(([s, yy]) => { document.querySelector(s).scrollTop = yy; }, [sel, y0 + (y - y0) * ease(t)]));
  }
  // касание: отметка для ролика (кружок) + настоящее касание
  async tap(target) {
    const box = typeof target === 'string' ? await this.page.locator(target).first().boundingBox()
      : target.x !== undefined ? { x: target.x - 1, y: target.y - 1, width: 2, height: 2 } : await target.boundingBox();
    if (!box) throw new Error('нет элемента для касания: ' + target);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    this.taps.push({ frame: this.n, x, y });
    await this.page.touchscreen.tap(x, y);
  }
  encode() {
    const out = this.dir + '.mp4';
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(this.fps), '-i', path.join(this.dir, 'f%05d.png'),
      '-vf', 'scale=1180:2556:flags=lanczos', '-c:v', 'libx264', '-crf', '12', '-preset', 'slow', '-pix_fmt', 'yuv420p', out]);
    fs.writeFileSync(this.dir + '.json', JSON.stringify({ frames: this.n, fps: this.fps, taps: this.taps }));
    console.log(path.basename(out), this.n, 'кадров', this.taps.length, 'касаний');
    fs.rmSync(this.dir, { recursive: true, force: true });
    return out;
  }
}
