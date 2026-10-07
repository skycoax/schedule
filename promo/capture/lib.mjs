// Открыть настоящее приложение (локальный сервер Para) в «iPhone» 393×852 @3x с вырезом 59/34.
// now — подменить «сейчас» сервера (часы пары), prod — файлы с ответами прода (правки группы, активность вузов).
import { chromium } from 'playwright';
import fs from 'node:fs';
export const BASE = 'http://localhost:8792';
export const GROUP = '1 курс очное :: 1 курс Информационные системы и технологии 09.03.02';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export async function open({ now, time, theme = 'dark', uni = 'kfu', group = GROUP, extra = {}, path = '/', prod = {}, css = '', login, saved, offline } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--hide-scrollbars'] });
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    locale: 'ru-RU', timezoneId: 'Asia/Tashkent', colorScheme: theme === 'light' ? 'light' : 'dark',
  });
  const presets = { egg_hint: '9', coach_chat: '1', pushAsked: '1', reviewedAt: String(Date.parse('2026-10-01')),
    reviewPromptAt: String(Date.parse('2026-10-06')), agreed: '1', uni, group, role: 'student', theme, ...extra };
  await ctx.addInitScript(({ p, css }) => {
    for (const [k, v] of Object.entries(p)) { if (v === null) continue; try { localStorage.setItem(k, v); } catch {} }
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    if (css) document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); });
  }, { p: presets, css });
  if (time) await ctx.clock.install({ time: new Date(time) });
  const prodChanges = prod.schedule ? JSON.parse(fs.readFileSync(prod.schedule, 'utf8')).changes : null;
  // saved — как ответ, сохранённый service worker'ом без сети (заголовок x-para-saved): «сейчас» считает само приложение
  await ctx.route(/\/api\/(schedule|teacher)/, async (route) => {
    const r = await route.fetch(); const j = await r.json();
    const d = j && j.data && j.data.now ? j.data : j;
    if (d && d.now && now) d.now = { ...d.now, ...now };
    if (prodChanges && /\/api\/schedule/.test(route.request().url()) && /[?&]group=[^&]/.test(route.request().url())) d.changes = prodChanges;
    await route.fulfill({ response: r, json: j, headers: { ...r.headers(), ...(saved ? { 'x-para-saved': saved } : {}) } });
  });
  if (offline) await ctx.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  if (prod.unis) await ctx.route(/\/api\/universities/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(prod.unis, 'utf8') }));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
  await page.goto(BASE + path, { waitUntil: 'load' });
  if (login) {
    await page.evaluate(async (name) => { await fetch('/api/auth/dev?uni=kfu', { method: 'POST', headers: { 'X-Para': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); }, login);
    await page.reload({ waitUntil: 'load' });
  }
  await page.waitForTimeout(2000);
  return { browser, ctx, page, cdp };
}
