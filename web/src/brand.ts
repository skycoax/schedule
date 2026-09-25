// Бренд вуза приходит от сервера: сборка сайта одна на все вузы, а сервер по адресу
// (kfu.skycoax.uz, tsue.skycoax.uz…) кладёт в index.html JSON с данными вуза
// (<script id="brand">). Сами вузы описаны в server/tenants/<id>/tenant.json.
// На адресе Para (para.skycoax.uz) бренд нейтральный, hub = true, а вуз — тот, что
// выбрал человек; id пустой, пока вуз не выбран. Адрес вуза — та же Para с уже выбранным
// вузом и его эмблемой: вкладки, вход и «Обсуждения» там те же (social есть и там).
import type { SocialMode } from './social/types';

export interface Brand {
  id: string;
  /** Para: общий адрес для всех вузов, вуз выбирается в приложении. */
  hub?: boolean;
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
  /** Режим «Обсуждений» для первой отрисовки (server/src/site.js, SOCIAL_MODE) — на Para и на адресах вузов.
   *  Нет поля — сервер без Para: на странице только расписание. */
  social?: SocialMode;
  /** Только Para: старые адреса вузов переносят сюда настройки во фрагменте #m= (hub.json redirectOldHosts). */
  moveIn?: boolean;
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

/** Есть ли на этом адресе аккаунты и «Обсуждения» (Para и адреса вузов на сервере с Para). */
export const hasSocial = !!brand.social;
