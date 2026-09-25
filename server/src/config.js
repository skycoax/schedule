// Общий конфиг сервера. Всё, что относится к конкретному вузу (адрес, источник
// расписания, тексты), лежит в tenants/<id>/tenant.json — см. tenants.js.
// .env читаем вручную (без зависимостей): файл маленький.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// .env → process.env (не перезатирая уже заданное в окружении).
try {
  const text = readFileSync(join(root, '.env'), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
} catch { /* .env может не быть — тогда берём значения по умолчанию */ }

const env = process.env;

export const config = {
  port: Number(env.PORT || 8792),
  host: env.HOST || '127.0.0.1',
  // Базы вузов: data/<id>.db — у каждого своя.
  dataDir: env.DATA_DIR || join(root, 'data'),
  tenantsDir: env.TENANTS_DIR || join(root, 'tenants'),
  // Para — общий адрес для всех вузов (hub.json + картинки бренда). Нет папки — нет и Para.
  hubDir: env.HUB_DIR || join(root, 'hub'),
  // Сборка React (одна на все вузы): index.html отсюда сервер отдаёт с брендом вуза.
  webDir: env.WEB_DIR || join(root, '..', 'web', 'dist'),
  // Для разработки на localhost: какой вуз показывать, раз адрес ни на кого не похож.
  devTenant: env.DEV_TENANT || '',
  adminPin: env.ADMIN_PIN || '',
  ipSalt: env.IP_SALT || 'kfu-raspisanie-default-salt',
  tz: 'Asia/Tashkent',
};

// ─── Обсуждения (только Para) — server/src/social/ ───
const prod = env.NODE_ENV === 'production';
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const newAccountH = Number(env.SOCIAL_NEW_ACCOUNT_H);
export const social = {
  // on — всё работает; readonly — читать можно, писать нельзя; off — остаётся только удаление аккаунта.
  mode: ['on', 'readonly', 'off'].includes(env.SOCIAL_MODE) ? env.SOCIAL_MODE : 'on',
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',   // никогда не логировать
    // Только для дымового теста (вне production): свой адрес обмена кода вместо oauth2.googleapis.com.
    tokenUrl: (!prod && env.SOCIAL_DEV_GOOGLE_TOKEN_URL) || 'https://oauth2.googleapis.com/token',
  },
  // Модераторы: подтверждённые Google-почты через запятую. Роль считается при каждом запросе, в базе не хранится.
  adminEmails: new Set(String(env.SOCIAL_ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
  // Соль для отпечатков заблокированных и удалённых аккаунтов (ban_marks). Длинная случайная строка.
  salt: env.SOCIAL_SALT || env.IP_SALT || 'para-social-default-salt',
  // Откуда приходит сайт: https://<первый адрес из hub.json>. PARA_ORIGIN (http://be.localhost:8792) — только
  // для разработки: в production не действует, куки там всегда __Host- и Secure.
  origin: prod ? '' : String(env.PARA_ORIGIN || '').replace(/\/+$/, ''),
  mediaDir: env.MEDIA_DIR || join(env.DATA_DIR || join(root, 'data'), 'media'),
  // С какого возраста можно завести аккаунт (13–18). Публичные тексты должны говорить то же число.
  minAge: clamp(Number(env.SOCIAL_MIN_AGE) || 16, 13, 18),
  // Версии правил обсуждений и политики. rulesVersion повышать вместе с текстом правил
  // (web/src/social/rules.ts, server/hub/rules.html) — тогда все примут их заново.
  rulesVersion: 1,
  policyVersion: 1,
  reportThreshold: Math.max(1, Number(env.SOCIAL_REPORT_THRESHOLD) || 3),
  reporterMinAgeH: env.SOCIAL_REPORTER_MIN_AGE_H === undefined ? 24 : Math.max(0, Number(env.SOCIAL_REPORTER_MIN_AGE_H) || 0),
  // Только для разработки. В production игнорируются, даже если заданы.
  devLogin: !prod && env.DEV_LOGIN === '1',
  devHub: !prod && env.DEV_HUB === '1',          // localhost, *.localhost и 127.0.0.1 считаются адресом Para
  // «Новый аккаунт»: без ссылок и с меньшими дневными пределами. Не 24 — только вне production; 0 — выключено.
  newAccountH: !prod && env.SOCIAL_NEW_ACCOUNT_H !== undefined && env.SOCIAL_NEW_ACCOUNT_H !== '' && Number.isFinite(newAccountH)
    ? Math.max(0, newAccountH) : 24,
  rateLimits: prod || env.SOCIAL_RATE_LIMITS !== 'off',
  // Для строки в журнале при старте: DEV_LOGIN=1 в production — ошибка настройки (он всё равно не действует).
  devLoginIgnored: prod && env.DEV_LOGIN === '1',
  production: prod,
};
export const googleConfigured = () => !!(social.google.clientId && social.google.clientSecret);
