(() => {
  'use strict';

  const universities = [
    ['emu', 'EMU', 'EMU University'],
    ['iut', 'IUT', 'Inha University in Tashkent'],
    ['kfu', 'KFU', 'Kazan Federal University'],
    ['newuu', 'NewUU', 'New Uzbekistan University'],
    ['nordic', 'Nordic', 'Nordic International University'],
    ['taqu', 'TAQU', 'Tashkent University of Architecture and Civil Engineering'],
    ['tdtu', 'TDTU', 'Tashkent State Technical University'],
    ['tiiame', 'TIIAME', 'TIIAME National Research University'],
    ['time', 'TIME', 'Tashkent Institute of Management and Economics'],
    ['tiue', 'TIUE', 'Tashkent International University of Education'],
    ['tkti', 'TKTI', 'Tashkent Institute of Chemical Technology'],
    ['tmuni', 'TMU', 'Tashkent Metropolitan University'],
    ['tsue', 'TSUE', 'Tashkent State University of Economics'],
    ['utas', 'UTAS', 'University of Tashkent for Applied Sciences'],
  ];

  const translations = {
    en: {
      eyebrow: 'University schedules · Web network',
      title: 'One schedule network for 14 universities',
      lead: 'A shared phone-first schedule system for students across Uzbekistan, with independent data and branding for every university.',
      type: 'Type', typeValue: 'University network', platform: 'Platform', platformValue: 'Web · installable', coverage: 'Coverage', coverageValue: '14 universities', status: 'Status', statusValue: 'Live',
      network: 'The network', overview: 'Overview', features: 'What it does',
      ratingsLoading: 'Loading ratings…', ratingsUnavailable: 'Ratings unavailable', noRatings: 'No ratings yet', reviewsEmpty: 'No written reviews for this university yet.', anonymous: 'Anonymous', ratingLabel: 'out of 5', closeReviews: 'Close reviews',
      ratingCount: (count) => `${count} rating${count === 1 ? '' : 's'}`, showReviews: (name) => `Show all ${name} reviews`, reviewsTitle: (name) => `${name} reviews`,
      overviewA: 'Students choose their university and group once. After that, the app opens directly to today’s classes, rooms and teachers, shows the full week and counts down to the next class.',
      overviewB: 'One server powers the whole network while each university keeps its own schedule source, database, address and visual identity. New universities can be connected without rebuilding the interface.',
      featureTitles: ['Today and the week', 'Next-class countdown', 'Schedule changes', 'Made for every university'],
      featureTexts: ['Group classes with rooms and teachers.', 'A live timer until the next lesson starts.', 'Recent edits shown in a separate view.', 'Its own domain, logo, source and data.'],
      metaTitle: 'University Schedules — network for 14 universities',
      metaDescription: 'A shared schedule network for 14 universities in Uzbekistan.',
    },
    ru: {
      eyebrow: 'Расписания вузов · Веб-сеть',
      title: 'Единая сеть расписаний для 14 вузов',
      lead: 'Общая система расписаний для студентов Узбекистана с отдельными данными и брендом каждого университета.',
      type: 'Тип', typeValue: 'Сеть вузов', platform: 'Платформа', platformValue: 'Веб · устанавливается', coverage: 'Охват', coverageValue: '14 вузов', status: 'Статус', statusValue: 'Работает',
      network: 'Участники сети', overview: 'О проекте', features: 'Что умеет',
      ratingsLoading: 'Загружаю оценки…', ratingsUnavailable: 'Оценки недоступны', noRatings: 'Пока нет оценок', reviewsEmpty: 'У этого вуза пока нет текстовых отзывов.', anonymous: 'Аноним', ratingLabel: 'из 5', closeReviews: 'Закрыть отзывы',
      ratingCount: (count) => `Оценок: ${count}`, showReviews: (name) => `Показать все отзывы ${name}`, reviewsTitle: (name) => `Отзывы ${name}`,
      overviewA: 'Студент один раз выбирает вуз и группу. После этого приложение сразу открывает сегодняшние пары, аудитории и преподавателей, показывает неделю и отсчитывает время до следующего занятия.',
      overviewB: 'Один сервер обслуживает всю сеть, но у каждого вуза остаются собственные источник расписания, база, адрес и визуальный стиль. Новый университет подключается без новой сборки интерфейса.',
      featureTitles: ['Сегодня и неделя', 'Отсчёт до пары', 'Изменения расписания', 'Свой бренд каждого вуза'],
      featureTexts: ['Пары группы с аудиториями и преподавателями.', 'Живой таймер до начала следующего занятия.', 'Последние правки в отдельном разделе.', 'Свой домен, логотип, источник и данные.'],
      metaTitle: 'Расписания вузов — сеть для 14 университетов',
      metaDescription: 'Единая сеть расписаний для 14 вузов Узбекистана.',
    },
    uz: {
      eyebrow: 'Universitet jadvallari · Veb tarmoq',
      title: '14 universitet uchun yagona jadval tarmog‘i',
      lead: 'O‘zbekiston talabalari uchun umumiy jadval tizimi — har bir universitetning o‘z ma’lumoti va brendi bilan.',
      type: 'Turi', typeValue: 'Universitetlar tarmog‘i', platform: 'Platforma', platformValue: 'Veb · o‘rnatiladi', coverage: 'Qamrov', coverageValue: '14 universitet', status: 'Holati', statusValue: 'Ishlaydi',
      network: 'Tarmoq ishtirokchilari', overview: 'Loyiha haqida', features: 'Imkoniyatlar',
      ratingsLoading: 'Baholar yuklanmoqda…', ratingsUnavailable: 'Baholar mavjud emas', noRatings: 'Hozircha baho yo‘q', reviewsEmpty: 'Bu universitet uchun hozircha matnli sharh yo‘q.', anonymous: 'Anonim', ratingLabel: 'dan 5', closeReviews: 'Sharhlarni yopish',
      ratingCount: (count) => `${count} ta baho`, showReviews: (name) => `${name} sharhlarini ko‘rsatish`, reviewsTitle: (name) => `${name} sharhlari`,
      overviewA: 'Talaba universitet va guruhini bir marta tanlaydi. Keyin ilova bugungi darslar, xonalar va o‘qituvchilarni darhol ochadi, haftani ko‘rsatadi va keyingi darsgacha vaqtni sanaydi.',
      overviewB: 'Bitta server butun tarmoqni boshqaradi, ammo har bir universitetning jadval manbasi, bazasi, manzili va vizual uslubi alohida qoladi. Yangi universitet interfeysni qayta yig‘masdan ulanadi.',
      featureTitles: ['Bugun va hafta', 'Darsgacha hisoblagich', 'Jadval o‘zgarishlari', 'Har bir universitet brendi'],
      featureTexts: ['Guruh darslari, xonalar va o‘qituvchilar.', 'Keyingi dars boshlanishigacha jonli taymer.', 'So‘nggi o‘zgarishlar alohida bo‘limda.', 'O‘z domeni, logotipi, manbasi va ma’lumoti.'],
      metaTitle: 'Universitet jadvallari — 14 universitet tarmog‘i',
      metaDescription: 'O‘zbekistondagi 14 universitet uchun yagona jadval tarmog‘i.',
    },
  };

  function locale() {
    return translations[(document.documentElement.lang || 'en').slice(0, 2)] || translations.en;
  }

  function localePrefix() {
    const lang = (document.documentElement.lang || 'en').slice(0, 2);
    return lang === 'ru' ? '/ru' : lang === 'uz' ? '/uz' : '';
  }

  function isNetworkPage() {
    return /\/work\/university-schedules\/?$/.test(window.location.pathname);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function reviewDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(document.documentElement.lang || 'en', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(date);
  }

  function reviewStars(rating, t) {
    const value = Math.max(1, Math.min(5, Math.round(Number(rating) || 0)));
    return `<span class="network-case__review-stars" role="img" aria-label="${value} ${t.ratingLabel}"><span>${'★'.repeat(value)}</span><i>${'★'.repeat(5 - value)}</i></span>`;
  }

  async function loadNetworkRatings(t) {
    const wall = document.querySelector('.network-case__brand-wall');
    const comments = document.querySelector('.network-case__comments');
    if (!wall || !comments || wall.dataset.loaded === '1') return;
    wall.dataset.loaded = '1';

    const responses = await Promise.allSettled(universities.map(async ([id, short, university]) => {
      const response = await fetch(`https://${id}.skycoax.uz/api/reviews`, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const json = await response.json();
      if (!json?.ok || !json.data) throw new Error('Invalid review response');
      return { id, short, university, data: json.data };
    }));

    const sourceById = new Map(responses
      .filter((result) => result.status === 'fulfilled')
      .map((result) => [result.value.id, result.value]));
    const cards = [...wall.querySelectorAll('.network-case__brand')];
    cards.sort((a, b) => {
      const aData = sourceById.get(a.dataset.university)?.data;
      const bData = sourceById.get(b.dataset.university)?.data;
      const aCount = Number(aData?.count) || 0;
      const bCount = Number(bData?.count) || 0;
      const aAverage = Number(aData?.average) || 0;
      const bAverage = Number(bData?.average) || 0;
      return (bAverage - aAverage) || (bCount - aCount)
        || String(a.dataset.short).localeCompare(String(b.dataset.short));
    });
    cards.forEach((card) => wall.append(card));
    wall.append(comments);

    let activeCard = null;
    const closeComments = () => {
      if (activeCard) {
        activeCard.classList.remove('is-review-open');
        activeCard.querySelector('.network-case__brand-rating')?.setAttribute('aria-expanded', 'false');
      }
      activeCard = null;
      comments.hidden = true;
      comments.innerHTML = '';
    };
    const placeCommentsAfterRow = (card) => {
      const ordered = [...wall.querySelectorAll('.network-case__brand')];
      const columns = Math.max(1, getComputedStyle(wall).gridTemplateColumns.split(' ').length);
      const index = ordered.indexOf(card);
      const nextIndex = Math.min(ordered.length, Math.ceil((index + 1) / columns) * columns);
      wall.insertBefore(comments, ordered[nextIndex] || null);
    };
    const renderComments = (card, source) => {
      const count = Number(source.data.count) || 0;
      const average = Number(source.data.average) || 0;
      const items = (Array.isArray(source.data.items) ? source.data.items : [])
        .filter((review) => String(review.text || '').trim());
      const feed = items.map((review) => {
        const name = String(review.name || '').trim();
        const displayName = !name || name.toLowerCase() === 'аноним' ? t.anonymous : name;
        return `<article class="network-case__review">
          <div class="network-case__review-body">
            <div class="network-case__review-meta"><strong>${escapeHtml(displayName)}</strong><time datetime="${escapeHtml(review.ts)}">${escapeHtml(reviewDate(review.ts))}</time></div>
            ${reviewStars(review.rating, t)}
            <p>${escapeHtml(review.text)}</p>
          </div>
        </article>`;
      }).join('');
      comments.innerHTML = `<div class="network-case__comments-head"><div><strong>${escapeHtml(t.reviewsTitle(source.short))}</strong><span>★ ${average.toFixed(1)} · ${escapeHtml(t.ratingCount(count))}</span></div><button type="button" aria-label="${escapeHtml(t.closeReviews)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></div>${feed ? `<div class="network-case__reviews-feed">${feed}</div>` : `<p class="network-case__reviews-empty">${escapeHtml(t.reviewsEmpty)}</p>`}`;
      comments.querySelector('button')?.addEventListener('click', closeComments);
      placeCommentsAfterRow(card);
      comments.hidden = false;
      activeCard = card;
      card.classList.add('is-review-open');
      card.querySelector('.network-case__brand-rating')?.setAttribute('aria-expanded', 'true');
    };

    cards.forEach((card) => {
      const source = sourceById.get(card.dataset.university);
      const button = card.querySelector('.network-case__brand-rating');
      if (!button) return;
      if (!source) {
        button.querySelector('small').textContent = t.ratingsUnavailable;
        return;
      }
      const count = Number(source.data.count) || 0;
      const average = Number(source.data.average) || 0;
      button.disabled = false;
      button.setAttribute('aria-label', t.showReviews(source.short));
      button.querySelector('strong').textContent = count ? `★ ${average.toFixed(1)}` : '—';
      button.querySelector('small').textContent = count ? t.ratingCount(count) : t.noRatings;
      button.addEventListener('click', () => {
        if (activeCard === card) closeComments();
        else {
          closeComments();
          renderComments(card, source);
        }
      });
    });
  }

  function applyMetadata(t) {
    document.title = t.metaTitle;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t.metaDescription);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', `https://skycoax.uz${localePrefix()}/work/university-schedules/`);
  }

  function apply() {
    if (!isNetworkPage()) return;
    const main = document.querySelector('main.case');
    const hero = main?.querySelector('.case__hero');
    if (!hero || hero.querySelector('.network-case__brand-wall')) return;
    const t = locale();
    applyMetadata(t);
    const brands = universities.map(([id, short, name]) => `<article class="network-case__brand" data-university="${id}" data-short="${escapeHtml(short)}">
      <a class="network-case__brand-main" href="https://${id}.skycoax.uz/" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(name)}" title="${escapeHtml(name)}"><span class="network-case__brand-logo"><img src="/university-logos/${id}.png" alt="" loading="lazy"></span><span class="network-case__brand-name">${escapeHtml(short)}</span></a>
      <button class="network-case__brand-rating" type="button" aria-expanded="false" disabled><span><strong>—</strong><small>${escapeHtml(t.ratingsLoading)}</small></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></button>
    </article>`).join('');
    const features = t.featureTitles.map((title, index) => `<div class="case__feature"><p class="case__feature-title">${title}</p><p class="case__feature-text">${t.featureTexts[index]}</p></div>`).join('');
    hero.innerHTML = `
      <div class="network-case__intro"><p class="case__eyebrow">${t.eyebrow}</p><h1 class="case__title network-case__title">${t.title}</h1><p class="case__lead">${t.lead}</p></div>
      <div class="case__cover network-case__cover"><img src="/projects/university-schedules-cover-v2.png" alt="${t.title}" style="object-position:50% 50%"></div>
      <div class="case__meta"><div><p class="case__meta-label">${t.type}</p><p class="case__meta-value">${t.typeValue}</p></div><div><p class="case__meta-label">${t.platform}</p><p class="case__meta-value">${t.platformValue}</p></div><div><p class="case__meta-label">${t.coverage}</p><p class="case__meta-value">${t.coverageValue}</p></div><div><p class="case__meta-label">${t.status}</p><p class="case__meta-value">${t.statusValue}</p></div></div>
      <section id="universities" class="case__block"><h2 class="case__label">${t.network}</h2><div class="case__content"><div class="network-case__brand-wall">${brands}<div class="network-case__comments" hidden></div></div></div></section>
      <section id="overview" class="case__block"><h2 class="case__label">${t.overview}</h2><div class="case__content"><p>${t.overviewA}</p><p>${t.overviewB}</p></div></section>
      <section id="features" class="case__block"><h2 class="case__label">${t.features}</h2><div class="case__content"><div class="case__features">${features}</div></div></section>`;
    loadNetworkRatings(t);
  }

  function start() {
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', apply);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
