// Бренд вуза приходит от сервера: сборка сайта одна на все вузы, а сервер по адресу
// (kfu.skycoax.uz, tsue.skycoax.uz…) кладёт в index.html JSON с данными вуза
// (<script id="brand">). Сами вузы описаны в server/tenants/<id>/tenant.json.

export interface Brand {
  id: string;
  /** Надпись над заголовком в окнах: «Расписание КФУ · Джизак». */
  label: string;
  /** Полное название вуза — подпись логотипа для экранных чтецов. */
  university: string;
  logoCredit: string;
  about: string;
  source: string;
  /** Короткое «откуда данные» для окна согласия. */
  sourceShort: string;
  searchHint: string;
}

// Заглушка для разработки без сервера (vite dev отдаёт index.html как есть).
const FALLBACK: Brand = {
  id: 'dev',
  label: 'Расписание',
  university: 'Университет',
  logoCredit: '',
  about: 'Неофициальный просмотрщик расписания вуза.',
  source: 'Расписание принадлежит вузу. Приложение только отображает его и ничего в нём не меняет.',
  sourceShort: 'Расписание берётся из открытого расписания вуза и может отставать — перед важным решением сверяйся с оригиналом.',
  searchHint: 'Название группы…',
};

function read(): Brand {
  try {
    const el = document.getElementById('brand');
    const data = el ? JSON.parse(el.textContent || '') : null;
    if (data && typeof data === 'object' && data.label) return { ...FALLBACK, ...data };
  } catch { /* разработка без сервера — заглушка */ }
  return FALLBACK;
}

export const brand: Brand = read();
