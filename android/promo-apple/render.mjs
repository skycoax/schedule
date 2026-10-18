// Рендер картинок Para для Play в стиле Apple через Chrome headless + CDP.
// Запуск: node android/promo-apple/render.mjs [имя…] → android/play/apple/*.png
// Без аргументов — всё; с аргументами — только кадры, чьё имя файла содержит одно из них.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'play', 'apple');
// Короткий путь профиля: с длинным Chrome молча передаёт запуск уже открытому окну.
const TMP = process.env.TMPDIR_SHOTS || 'C:/Users/user/AppData/Local/Temp/pshots-apple';
const PORT = 9334;

const FRAMES = [
  { page: 'feature.html', w: 1024, h: 500, out: 'feature-1024x500.png' },
  ...['01-para', '02-сейчас', '03-неделя', '04-правки', '05-вузы', '06-главное'].map((out, i) => (
    { page: `shots.html?s=${i + 1}`, w: 1080, h: 1920, out: `${out}.png` })),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const wait = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r, j) => {
    const i = ++id; wait.set(i, (m) => (m.error ? j(new Error(method + ': ' + m.error.message)) : r(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, close: () => ws.close() };
}

const only = process.argv.slice(2);
const frames = only.length ? FRAMES.filter((f) => only.some((o) => f.out.includes(o))) : FRAMES;

mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${TMP}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
  '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
try {
  let list;
  for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(200); } }
  const { send, close } = await cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await send('Page.enable');
  for (const f of frames) {
    await send('Emulation.setDeviceMetricsOverride', { width: f.w, height: f.h, deviceScaleFactor: 1, mobile: false });
    const [file, query = ''] = f.page.split('?');
    await send('Page.navigate', { url: pathToFileURL(join(HERE, file)).href + (query && '?' + query) });
    await sleep(300);
    await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `new Promise((ok) => { const go = () => document.fonts.ready
        .then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))))
        .then(() => setTimeout(ok, 250)); document.readyState === 'complete' ? go() : addEventListener('load', go); })`,
    });
    const fonts = await send('Runtime.evaluate', { returnByValue: true, expression: `document.fonts.check('700 40px Inter')` });
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: f.w, height: f.h, scale: 1 } });
    writeFileSync(join(OUT, f.out), Buffer.from(shot.data, 'base64'));
    console.log(`${f.out}  ${f.w}×${f.h}  Inter: ${fonts.result.value ? 'да' : 'НЕТ'}`);
  }
  close();
} finally {
  chrome.kill();
}
