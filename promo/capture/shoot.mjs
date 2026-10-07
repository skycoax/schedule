// Съёмка экранов для ролика из настоящего приложения (локальный сервер, см. lib.mjs).
// node promo/capture/shoot.mjs <папка> <клип…>   — клипы: clock, clocklight, today, week, changes, unis, teacher,
// offline, feed, moments, profile, egg. Кадры → <папка>/<клип>.mp4 и .json (касания).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './lib.mjs';
import { Shooter } from './shooter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const prod = { schedule: path.join(here, 'prod-kfu.json'), unis: path.join(here, 'prod-unis.json') };
const [out, ...want] = process.argv.slice(2);
const DAY = '2026-10-07';
const at = (hms) => `${DAY}T${hms}+05:00`;
const NOW = (hm) => { const [h, m] = hm.split(':').map(Number); return { day: 'Ср', minutes: h * 60 + m, dateLabel: '07.10', stamp: hm }; };
const HIDE_LOGOS = '.umenu__logo{display:none!important}';

const clips = {
  // часы «Сейчас»: идут секунды, 44:59 → 44:52
  async clock(theme = 'dark', name = 'clock') {
    const { browser, page } = await open({ time: at('15:45:00'), now: NOW('15:45'), theme, prod });
    const s = new Shooter(page, path.join(out, name));
    await s.start(at('15:45:02.600'));
    await s.hold(name === 'clock' ? 21.6 : 4);
    s.encode(); await browser.close();
  },
  clocklight() { return clips.clock('light', 'clocklight'); },
  // день: от часов вниз — карточка среды и четверга (там «изменено»)
  async today() {
    const { browser, page } = await open({ time: at('15:45:00'), now: NOW('15:45'), prod });
    const s = new Shooter(page, path.join(out, 'today'));
    await s.start(at('15:45:10.600'));
    await s.hold(0.8);
    await s.scroll(520, 2.4);
    await s.hold(1.4);
    const ch = await page.evaluate(() => { const e = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'изменено'); return e ? e.getBoundingClientRect().top + window.scrollY : 1240; });
    await s.scroll(ch - 560, 2.6);
    await s.hold(2.3);
    s.encode(); await browser.close();
  },
  // неделя: сетка, цифры недели, предметы, дни с «Вместе с …»
  async week() {
    const { browser, page } = await open({ time: at('15:45:00'), now: NOW('15:45'), prod });
    const s = new Shooter(page, path.join(out, 'week'));
    await s.start(at('15:45:20.600'));
    await s.hold(0.5);
    await s.tap(page.getByRole('tab', { name: 'Неделя' }).or(page.getByRole('radio', { name: 'Неделя' })).or(page.getByText('Неделя', { exact: true })).first());
    await s.hold(2.8);
    await s.scroll(560, 2.2);
    await s.hold(0.8);
    await s.scroll(1700, 1.4);
    const fri = await page.evaluate(() => {
      const el = [...document.querySelectorAll('span')].find((e) => e.children.length === 0 && e.textContent.startsWith('Вместе с'));
      return el ? el.getBoundingClientRect().top + window.scrollY - 470 : 1800;
    });
    await s.scroll(fri, 1.4);
    await s.hold(3.0);
    s.encode(); await browser.close();
  },
  // правки: кнопка истории → лист с изменениями
  async changes() {
    const { browser, page } = await open({ time: at('15:45:00'), now: NOW('15:45'), prod });
    const s = new Shooter(page, path.join(out, 'changes'));
    await s.start(at('15:45:30.600'));
    await s.hold(2.2);
    await s.tap(page.locator('button.navbtn[aria-label*="равк"]').first());
    await s.hold(4.8);
    s.encode(); await browser.close();
  },
  // меню вузов (без эмблем)
  async unis() {
    const { browser, page } = await open({ time: at('15:45:00'), now: NOW('15:45'), prod, css: HIDE_LOGOS });
    const s = new Shooter(page, path.join(out, 'unis'));
    await s.start(at('15:45:40.600'));
    await s.hold(0.6);
    await s.tap(page.locator('button.navbtn[aria-haspopup="menu"]').first());
    await s.hold(3.2);
    s.encode(); await browser.close();
  },
  // режим преподавателя: его пары и отсчёт
  async teacher() {
    const { browser, page } = await open({ time: at('15:45:00'), now: NOW('15:45'), prod, extra: { role: 'teacher', teacher: 'хасановзш' } });
    const s = new Shooter(page, path.join(out, 'teacher'));
    await s.start(at('15:45:50.600'));
    await s.hold(1.2);
    await s.scroll(300, 1.6);
    await s.hold(1.2);
    s.encode(); await browser.close();
  },
  // без сети: расписание остаётся, появляется пометка
  async offline() {
    const { browser, page } = await open({ time: at('15:46:00'), prod, saved: '2026-10-07T07:30:00.000Z', offline: true });
    const s = new Shooter(page, path.join(out, 'offline'));
    await s.start(at('15:46:10.600'));
    await s.hold(4);
    s.encode(); await browser.close();
  },
  // «Обсуждения»: лента, «нравится», прокрутка
  async feed() {
    const { browser, page } = await open({ login: 'madina' });
    // у Мадины «нравится» под постом Камолы уже стоит — снимаем через API, чтобы в кадре поставить заново
    await page.evaluate(async () => {
      const f = await (await fetch('/api/social/feed?uni=kfu')).json();
      const post = (f.data.items || f.data.posts || f.data).find((p) => p.text.startsWith('Новая читалка'));
      await fetch(`/api/social/posts/${post.id}/like?uni=kfu`, { method: 'DELETE', headers: { 'X-Para': '1' } });
    });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.getByText('Обсуждения', { exact: true }).last().click();
    await page.waitForTimeout(2500);
    await page.clock.install({ time: new Date() });
    const s = new Shooter(page, path.join(out, 'feed'));
    await s.start(new Date(Date.now() + 1000));
    await s.hold(1.0);
    await s.tap(page.locator('button.post__act--like').nth(1));
    await s.hold(1.0);
    await s.scroll(900, 3.0);
    await s.hold(1.0);
    s.encode(); await browser.close();
  },
  // моменты: карточка у края ленты → просмотр
  async moments() {
    const { browser, page } = await open({ login: 'madina' });
    await page.getByText('Обсуждения', { exact: true }).last().click();
    await page.waitForTimeout(2500);
    await page.clock.install({ time: new Date() });
    const s = new Shooter(page, path.join(out, 'moments'));
    await s.start(new Date(Date.now() + 1000));
    await s.hold(0.5);
    await s.tap({ x: 378, y: 528 });
    await s.hold(3.0);
    s.encode(); await browser.close();
  },
  // профиль
  async profile() {
    const { browser, page } = await open({ login: 'madina' });
    await page.clock.install({ time: new Date() });
    const s = new Shooter(page, path.join(out, 'profile'));
    await s.start(new Date(Date.now() + 1000));
    await s.hold(0.3);
    await s.tap(page.getByText('Профиль', { exact: true }).last());
    await s.hold(2.4);
    s.encode(); await browser.close();
  },
  // пасхалка: 5 касаний по часам → покер
  async egg() {
    const { browser, page } = await open({ time: at('15:45:00'), now: NOW('15:45'), prod });
    const s = new Shooter(page, path.join(out, 'egg'));
    await s.start(at('15:47:00.600'));
    await s.hold(0.5);
    for (let i = 0; i < 5; i++) { await s.tap('.hero'); await s.hold(0.2); }
    await s.hold(2.8);
    s.encode(); await browser.close();
  },
};

for (const name of want) {
  const t = Date.now();
  try { await clips[name](); console.log(name, ((Date.now() - t) / 1000).toFixed(0) + ' с'); }
  catch (e) { console.error(name, 'ОШИБКА', e.message.split('\n')[0]); }
}
