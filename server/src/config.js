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
  // Сборка React (одна на все вузы): index.html отсюда сервер отдаёт с брендом вуза.
  webDir: env.WEB_DIR || join(root, '..', 'web', 'dist'),
  // Для разработки на localhost: какой вуз показывать, раз адрес ни на кого не похож.
  devTenant: env.DEV_TENANT || '',
  adminPin: env.ADMIN_PIN || '',
  ipSalt: env.IP_SALT || 'kfu-raspisanie-default-salt',
  tz: 'Asia/Tashkent',
};
