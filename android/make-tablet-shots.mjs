// Скриншоты Para для планшетов (Play: 7" и 10") через Chrome headless + CDP.
// Запуск: node android/make-tablet-shots.mjs → android/play/tablet7-*.png, tablet10-*.png
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'C:/Users/user/a/android/play';
// Короткий путь: с длинным путём профиля Chrome молча передаёт запуск уже открытому окну (код 21).
const TMP = process.env.TMPDIR_SHOTS || 'C:/Users/user/AppData/Local/Temp/pshots';
const PORT = 9333;
const SITE = 'https://para.skycoax.uz';
const GROUP = '1 курс очное :: 1 курс Информационные системы и технологии 09.03.02';
const SIZES = [
  { tag: 'tablet7', w: 600, h: 960 },   // → 1200×1920
  { tag: 'tablet10', w: 800, h: 1280 }, // → 1600×2560
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

async function shoot(size) {
  const prof = join(TMP, 'prof-' + size.tag);
  rmSync(prof, { recursive: true, force: true });
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--lang=ru', 'about:blank'], { stdio: 'ignore' });
  try {
    let list;
    for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(200); } }
    const page = list.find((t) => t.type === 'page');
    const c = await cdp(page.webSocketDebuggerUrl);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 2, mobile: true });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await c.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', acceptLanguage: 'ru-RU,ru' });

    const go = async (url, ms = 5000) => { await c.send('Page.navigate', { url }); await sleep(ms); };
    const snap = async (name) => {
      const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
      const f = join(OUT, `${size.tag}-${name}.png`); writeFileSync(f, Buffer.from(data, 'base64')); console.log('saved', f);
    };
    const tab = async (label) => {
      const r = await c.send('Runtime.evaluate', { expression: `(() => { const b=[...document.querySelectorAll('button,[role=tab]')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); if(b){b.click();return true} return false })()`, returnByValue: true });
      if (!r.result.value) throw new Error('нет вкладки ' + label);
      await sleep(1500);
    };

    // 1. Первый экран «Где ты учишься?» — чистый профиль.
    await go(SITE + '/');
    await snap('01-вузы');

    // 2–4. Расписание группы КФУ: согласие и группу кладём в localStorage сами (#m= Para принимает только
    // от страницы-переезда старого адреса вуза и без согласия), потом открываем страницу заново.
    const m = { uni: 'kfu', agreed: '1', role: 'student', group: GROUP, homeShown: '1', reviewPromptAt: String(Date.now()), reviewedAt: String(Date.now()) };
    await go(SITE + '/?uni=kfu', 3000);
    await c.send('Runtime.evaluate', { expression: `(() => { const m = ${JSON.stringify(m)}; for (const k in m) localStorage.setItem(k, m[k]); })()` });
    await go(SITE + '/?uni=kfu', 7000);
    await snap('02-сегодня');
    await tab('Неделя'); await snap('03-неделя');
    await tab('Правки'); await snap('04-правки');
    c.close();
  } finally {
    chrome.kill();
    await sleep(800);
  }
}

mkdirSync(OUT, { recursive: true });
for (const s of SIZES) await shoot(s);
