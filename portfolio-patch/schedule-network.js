(() => {
  'use strict';

  const universities = [
    ['kfu', 'KFU'], ['tsue', 'TSUE'], ['iut', 'IUT'], ['tiue', 'TIUE'],
    ['tdtu', 'TDTU'], ['tiiame', 'TIIAME'], ['taqu', 'TAQU'], ['newuu', 'NewUU'],
    ['tmuni', 'TMU'], ['emu', 'EMU'], ['utas', 'UTAS'], ['time', 'TIME'],
    ['nordic', 'Nordic'], ['tkti', 'TKTI'],
  ];
  const colors = {
    kfu: '#2997ff', tsue: '#ffd60a', iut: '#ff6482', tiue: '#43d6a6',
    tdtu: '#bf9bff', tiiame: '#ff9f6e', taqu: '#55d4d0', newuu: '#f07bcc',
    tmuni: '#7f9fff', emu: '#b6d957', utas: '#e5c875', time: '#64c7ff',
    nordic: '#ff887c', tkti: '#aaa2ff',
  };
  const copy = {
    en: {
      title: 'University schedules', status: '14 universities',
      headline: 'One system for every campus.',
      description: 'Classes, a next-lesson countdown and schedule updates in one phone-first network.',
      platform: 'Web', platformLabel: 'Platform', sites: '14', sitesLabel: 'Live sites',
      top: 'Visit activity', all: 'All 14 universities', close: 'Hide list', visits: 'visits', project: 'View the network', coverAlt: 'University Schedules network on a phone', range: 'Last 14 days', loading: 'Loading visit data…',
    },
    ru: {
      title: 'Расписания вузов', status: '14 вузов',
      headline: 'Одна система для каждого кампуса.',
      description: 'Пары, отсчёт до следующего занятия и изменения расписания в единой сети для телефона.',
      platform: 'Веб', platformLabel: 'Платформа', sites: '14', sitesLabel: 'Работающих сайтов',
      top: 'Активность посещений', all: 'Все 14 вузов', close: 'Скрыть список', visits: 'посещений', project: 'Открыть проект', coverAlt: 'Сеть расписаний вузов на телефоне', range: 'Последние 14 дней', loading: 'Загружаю посещения…',
    },
    uz: {
      title: 'Universitet jadvallari', status: '14 ta universitet',
      headline: 'Har bir kampus uchun bitta tizim.',
      description: 'Darslar, keyingi mashg‘ulotgacha hisoblagich va o‘zgarishlar telefon uchun yagona tarmoqda.',
      platform: 'Veb', platformLabel: 'Platforma', sites: '14', sitesLabel: 'Ishlayotgan saytlar',
      top: 'Tashriflar faolligi', all: 'Barcha 14 universitet', close: 'Yashirish', visits: 'tashrif', project: 'Loyihani ochish', coverAlt: 'Telefon ekranidagi universitet jadvallari tarmog‘i', range: 'So‘nggi 14 kun', loading: 'Tashriflar yuklanmoqda…',
    },
  };

  function locale() {
    return copy[(document.documentElement.lang || 'en').slice(0, 2)] || copy.en;
  }

  function projectHref() {
    const lang = (document.documentElement.lang || 'en').slice(0, 2);
    return lang === 'ru' ? '/ru/work/university-schedules/' : lang === 'uz' ? '/uz/work/university-schedules/' : '/work/university-schedules/';
  }

  function replaceOldProjectPath(value) {
    try {
      const url = new URL(value, window.location.href);
      url.pathname = url.pathname.replace(/\/work\/kfu-schedule\/?$/, '/work/university-schedules/');
      return url.href;
    } catch (_) {
      return projectHref();
    }
  }

  function redirectOldProjectPage() {
    if (/\/work\/kfu-schedule\/?$/.test(window.location.pathname)) {
      window.location.replace(replaceOldProjectPath(window.location.href));
      return true;
    }
    return false;
  }

  function makeCard(card, t) {
    if (card.dataset.networkReady === '1' && card.querySelector('.schedule-network-chart')) return;
    card.dataset.networkReady = '1';
    card.dataset.scheduleNetwork = '1';
    card.classList.add('schedule-network-card');
    let surface = card.querySelector('.project-card__link');
    let content = card.querySelector('.project-card__content');
    if (!surface || !content) return;
    // The chart has its own button, so the whole card cannot remain a nested link.
    if (surface.tagName === 'A') {
      const media = surface.querySelector('.project-card__media');
      const replacement = document.createElement('div');
      replacement.className = surface.className;
      surface.replaceWith(replacement);
      if (media) replacement.append(media);
      replacement.append(content);
      surface = replacement;
    }
    const cover = card.querySelector('.project-card__img');
    if (cover) {
      cover.removeAttribute('srcset');
      cover.removeAttribute('sizes');
      cover.src = '/projects/university-schedules-cover-v2.png';
      cover.alt = t.coverAlt;
      cover.style.objectPosition = '50% 50%';
    }
    content.innerHTML = `
      <div class="schedule-network-copy">
        <div class="project-card__top">
          <div class="project-card__head"><h3 class="project-card__title">${t.title}</h3><span class="project-card__status">${t.status}</span></div>
          <div class="project-card__textgroup"><p class="project-card__headline">${t.headline}</p><p class="project-card__desc">${t.description}</p></div>
        </div>
        <div class="project-card__bottom"><div class="project-card__metrics">
          <div class="project-card__stat"><div class="project-card__stat-value">${t.platform}</div><div class="project-card__stat-label">${t.platformLabel}</div></div>
          <div class="project-card__stat"><div class="project-card__stat-value">${t.sites}</div><div class="project-card__stat-label">${t.sitesLabel}</div></div>
        </div></div>
        <a class="schedule-network-copy__link" href="${projectHref()}">${t.project}</a>
      </div>
      <section class="schedule-network-chart" aria-label="${t.top}">
        <div class="schedule-network-chart__top"><div class="schedule-network-chart__heading"><strong>${t.top}</strong><span>${t.range}</span></div><button class="schedule-network-chart__more" type="button" aria-expanded="false">${t.all}</button></div>
        <div class="schedule-network-chart__legend"></div>
        <div class="schedule-network-chart__stage"><div class="schedule-network-chart__plot"><div class="schedule-network-chart__grid" aria-hidden="true"><i></i><i></i><i></i></div></div><div class="schedule-network-chart__empty">${t.loading}</div></div>
        <div class="schedule-network-chart__all" hidden></div>
      </section>`;
    const more = card.querySelector('.schedule-network-chart__more');
    const all = card.querySelector('.schedule-network-chart__all');
    if (card.dataset.networkEvents !== '1') {
      card.dataset.networkEvents = '1';
      card.addEventListener('click', (event) => {
        if (event.target.closest('.schedule-network-chart')) event.preventDefault();
      }, true);
    }
    more?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? t.close : t.all;
      if (all) all.hidden = !open;
    });
    loadChart(card, t);
  }

  function points(values, max) {
    return values.map((value, i) => ({
      x: values.length === 1 ? 50 : (i / (values.length - 1)) * 100,
      // Traffic is strongly skewed. A square-root scale keeps the ranking true
      // while allowing smaller campuses to remain visible in the same chart.
      y: 92 - (Math.sqrt(value || 0) / Math.sqrt(Math.max(1, max))) * 84,
    }));
  }

  function smoothPath(series) {
    if (!series.length) return '';
    if (series.length === 1) return `M ${series[0].x.toFixed(2)} ${series[0].y.toFixed(2)}`;
    let d = `M ${series[0].x.toFixed(2)} ${series[0].y.toFixed(2)}`;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    for (let i = 0; i < series.length - 1; i++) {
      const previous = series[Math.max(0, i - 1)];
      const current = series[i];
      const next = series[i + 1];
      const after = series[Math.min(series.length - 1, i + 2)];
      const low = Math.min(current.y, next.y);
      const high = Math.max(current.y, next.y);
      const c1x = current.x + (next.x - previous.x) * .12;
      const c1y = clamp(current.y + (next.y - previous.y) * .12, low, high);
      const c2x = next.x - (after.x - current.x) * .12;
      const c2y = clamp(next.y - (after.y - current.y) * .12, low, high);
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
    }
    return d;
  }

  function drawChart(card, t, rows) {
    const stage = card.querySelector('.schedule-network-chart__stage');
    if (!stage) return;
    const full = rows.filter((row) => row && Array.isArray(row.trend) && row.trend.length);
    if (!full.length) { stage.innerHTML = `<div class="schedule-network-chart__empty">${t.loading}</div>`; return; }
    const ranked = full.map((row) => ({
      ...row,
      total: row.trend.reduce((sum, point) => sum + (point.hits || 0), 0),
    })).sort((a, b) => b.total - a.total);
    const top = ranked.slice(0, 4);
    const dates = top[0].trend.map((x) => x.date);
    const max = Math.max(1, ...top.flatMap((row) => row.trend.map((point) => point.hits || 0)));
    const series = top.map((row) => ({ ...row, color: colors[row.id] || '#8c9cab', path: smoothPath(points(row.trend.map((point) => point.hits || 0), max)) }));
    const leader = series[0];
    const area = `${leader.path} L 100 96 L 0 96 Z`;
    const lines = series.map((row) => `<path class="is-series" style="--series-color:${row.color}" d="${row.path}"/>`).join('');
    const endpoints = series.map((row) => {
      const point = points(row.trend.map((item) => item.hits || 0), max).at(-1);
      return `<i style="--series-color:${row.color};left:${point.x}%;top:${point.y}%"></i>`;
    }).join('');
    stage.innerHTML = `<div class="schedule-network-chart__plot"><div class="schedule-network-chart__grid" aria-hidden="true"><i></i><i></i><i></i></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${t.top}: ${series.map((row) => row.label).join(', ')}"><defs><linearGradient id="network-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${leader.color}" stop-opacity=".17"/><stop offset=".72" stop-color="${leader.color}" stop-opacity=".025"/><stop offset="1" stop-color="${leader.color}" stop-opacity="0"/></linearGradient></defs><path class="is-area" d="${area}" fill="url(#network-area)"/>${lines}</svg><div class="schedule-network-chart__endpoints" aria-hidden="true">${endpoints}</div></div><div class="schedule-network-chart__axis"><span>${dates[0] || ''}</span><span>${dates[dates.length - 1] || ''}</span></div>`;
    const legend = card.querySelector('.schedule-network-chart__legend');
    const number = new Intl.NumberFormat(document.documentElement.lang || 'en', { notation: 'compact', maximumFractionDigits: 1 });
    if (legend) legend.innerHTML = series.map((row) => `<span style="--series-color:${row.color}"><i></i><b>${row.label}</b><em>${number.format(row.total)}</em></span>`).join('');
    const all = card.querySelector('.schedule-network-chart__all');
    if (all) all.innerHTML = ranked.map((row) => `<div class="schedule-network-chart__item" style="--series-color:${colors[row.id] || '#8c9cab'}"><i></i><b>${row.label}</b><span>${new Intl.NumberFormat(document.documentElement.lang || 'en').format(row.total)} ${t.visits}</span></div>`).join('');
  }

  async function loadChart(card, t) {
    const promises = universities.map(async ([id, label]) => {
      try {
        const response = await fetch(`https://${id}.skycoax.uz/api/stats/summary`, { cache: 'no-store' });
        const json = await response.json();
        return json && json.ok && json.data && Array.isArray(json.data.trend) ? { id, label, trend: json.data.trend } : null;
      } catch (_) { return null; }
    });
    drawChart(card, t, await Promise.all(promises));
  }

  function apply() {
    const t = locale();
    document.querySelectorAll('.project-card').forEach((card) => {
      const href = card.querySelector('.project-card__link')?.getAttribute('href') || '';
      const title = card.querySelector('.project-card__title')?.textContent || '';
      if (card.dataset.scheduleNetwork === '1' || href.includes('kfu-schedule') || /KFU\s+Schedule/i.test(title)) makeCard(card, t);
    });
  }

  function start() {
    if (redirectOldProjectPage()) return;
    // Next.js can restore exported markup during an internal route transition.
    // Keep the adapter alive for the lifetime of the SPA instead of only at boot.
    document.addEventListener('click', (event) => {
      const anchor = event.target.closest?.('a[href*="/work/kfu-schedule"]');
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(replaceOldProjectPath(anchor.href));
    }, true);
    window.addEventListener('popstate', redirectOldProjectPage);
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
