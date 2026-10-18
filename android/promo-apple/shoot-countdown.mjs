// Живые экраны Para для промо-картинок: выбор вуза, «Сегодня» с идущей парой и отсчётом до конца, «Неделя», «Правки».
// Снимается с para.skycoax.uz (та же группа КФУ, что в android/make-tablet-shots.mjs); подменяется только «сейчас»
// в ответе /api/schedule, чтобы снимать в любое время, а не только во время пары. Расписание и вид — настоящие.
// Запуск: node android/promo-apple/shoot-countdown.mjs [день] [ЧЧ:ММ] → android/promo-apple/live/*.png
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'live');
const TMP = process.env.TMPDIR_SHOTS || 'C:/Users/user/AppData/Local/Temp/pshots-now';
const PORT = 9335;
const SITE = 'https://para.skycoax.uz';
const GROUP = '1 курс очное :: 1 курс Информационные системы и технологии 09.03.02';
const [DAY = 'Пн', HM = '09:27'] = process.argv.slice(2);
const [hh, mm] = HM.split(':').map(Number);
const NOW = { day: DAY, minutes: hh * 60 + mm, dateLabel: '19.10', stamp: HM };

// Правки web/src/index.css, которых ещё нет на сайте: часы на всю ширину карточки. После выкладки — ничего не меняют.
const PREVIEW_CSS = `.clk__d,.clk__lbls{max-width:none}.clk__d{container-type:inline-size}
@supports (container-type: inline-size){.clk__d .fl{font-size:clamp(42px, 18.5cqw, 150px)}}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const wait = new Map(); const on = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
    else if (m.method && on.has(m.method)) on.get(m.method)(m.params);
  };
  const send = (method, params = {}) => new Promise((r, j) => {
    const i = ++id; wait.set(i, (m) => (m.error ? j(new Error(method + ': ' + m.error.message)) : r(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, on: (ev, fn) => on.set(ev, fn), close: () => ws.close() };
}

mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${TMP}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--lang=ru', 'about:blank'], { stdio: 'ignore' });
try {
  let list;
  for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(200); } }
  const c = await cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable');
  await c.send('Network.setBypassServiceWorker', { bypass: true });
  await c.send('Emulation.setDeviceMetricsOverride', { width: 540, height: 960, deviceScaleFactor: 2, mobile: true });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await c.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36', acceptLanguage: 'ru-RU,ru' });

  // Подмена «сейчас» в ответе расписания
  let patched = 0;
  c.on('Fetch.requestPaused', async (p) => {
    try {
      const r = await c.send('Fetch.getResponseBody', { requestId: p.requestId });
      const d = JSON.parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body);
      d.now = NOW; patched++;
      await c.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: p.responseStatusCode,
        responseHeaders: p.responseHeaders, body: Buffer.from(JSON.stringify(d)).toString('base64') });
    } catch (e) { console.error('подмена:', e.message); await c.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); }
  });
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/schedule*', requestStage: 'Response' }] });

  const go = async (url, ms) => { await c.send('Page.navigate', { url }); await sleep(ms); };
  const js = async (expression) => (await c.send('Runtime.evaluate', { returnByValue: true, expression })).result.value;
  const click = async (sel, text) => {
    const ok = await js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})]
      .find((x) => ${text ? `x.textContent.trim() === ${JSON.stringify(text)}` : 'true'}); if (b) { b.click(); return true; } return false; })()`);
    if (!ok) throw new Error('не нашёл ' + (text || sel));
    await sleep(1600);
  };
  const snap = async (name) => {
    await js(`(() => { if (document.getElementById('promo-css')) return; const s = document.createElement('style');
      s.id = 'promo-css'; s.textContent = ${JSON.stringify(PREVIEW_CSS)}; document.head.appendChild(s); })()`);
    // Плашка-объявление в Shadow DOM («Психологический тест … Пройти») в промо не нужна — прячем только в кадре
    await js(`(() => { for (const el of document.querySelectorAll('*'))
      if (el.shadowRoot && /Пройти|position:fixed/.test(el.shadowRoot.innerHTML)) el.style.setProperty('display', 'none', 'important'); })()`);
    await sleep(300);
    // Снимаем, когда флип-часы и листы не в середине анимации
    for (let i = 0; i < 40; i++) {
      if (await js(`document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity).length`) === 0) break;
      await sleep(60);
    }
    const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('saved', name);
  };

  // 1. Первый экран «Где ты учишься?» — чистый профиль
  await go(SITE + '/', 5000);
  await snap('вузы');

  // 2–4. Расписание группы КФУ: согласие, группу и закрытые подсказки кладём в localStorage, потом открываем заново
  const m = { uni: 'kfu', agreed: '1', role: 'student', group: GROUP, homeShown: '1', egg_hint: '3', pushAsked: '1', coach_chat: '1',
    reviewPromptAt: String(Date.now()), reviewedAt: String(Date.now()) };
  await go(SITE + '/?uni=kfu', 3000);
  await js(`(() => { const m = ${JSON.stringify(m)}; for (const k in m) localStorage.setItem(k, m[k]); })()`);
  await go(SITE + '/?uni=kfu', 7000);
  await snap('сейчас');
  await click('button,[role=tab]', 'Неделя'); await snap('неделя');
  await click('button,[role=tab]', 'Сегодня');
  await click('[aria-label^="Правки расписания"]'); await snap('правки');

  console.log('подмен «сейчас»:', patched, '·', DAY, HM);
  c.close();
} finally {
  chrome.kill();
}
