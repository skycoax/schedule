// Вузы. Каждый — папка tenants/<id>/ с tenant.json и картинками бренда.
// Новый вуз = новая папка + деплой (см. tenants/README.md). Папки, чьё имя
// начинается с «_» (например, _tools), вузами не считаются.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { openDb } from './db.js';

const SITE_KEYS = ['name', 'title', 'description', 'appDescription'];
const BRAND_KEYS = ['label', 'university', 'about', 'source', 'sourceShort', 'searchHint'];

// Понятная ошибка при запуске лучше, чем странное поведение потом.
function check(id, cfg) {
  const fail = (msg) => { throw new Error(`tenants/${id}/tenant.json: ${msg}`); };
  if (!/^[a-z0-9-]+$/.test(id)) fail('имя папки — только латиница в нижнем регистре, цифры и дефис');
  if (!Array.isArray(cfg.hosts) || !cfg.hosts.length) fail('нужен hosts: ["имя.skycoax.uz"]');
  const src = cfg.source || {};
  if (src.type === 'edupage') {
    if (!src.host) fail('нужен source.host, например "tsue.edupage.org"');
    if (src.includeUnscheduledGroups !== undefined && typeof src.includeUnscheduledGroups !== 'boolean') {
      fail('source.includeUnscheduledGroups должен быть true или false');
    }
  }
  else if (src.type === 'sheets') { if (!src.url) fail('нужен source.url — адрес Apps Script …/exec'); }
  else fail('source.type должен быть "edupage" или "sheets"');
  for (const k of SITE_KEYS) if (!cfg.site || !cfg.site[k]) fail(`нет site.${k}`);
  for (const k of BRAND_KEYS) if (!cfg.brand || !cfg.brand[k]) fail(`нет brand.${k}`);
}

export function loadTenants() {
  const tenants = [];
  const owner = new Map();
  const ids = readdirSync(config.tenantsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();

  for (const id of ids) {
    const file = join(config.tenantsDir, id, 'tenant.json');
    if (!existsSync(file)) continue;
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    if (cfg.enabled === false) continue;
    check(id, cfg);

    const hosts = cfg.hosts.map((h) => String(h).trim().toLowerCase());
    for (const h of hosts) {
      if (owner.has(h)) throw new Error(`Адрес ${h} указан сразу у двух вузов: ${owner.get(h)} и ${id}`);
      owner.set(h, id);
    }

    tenants.push({
      id,
      dir: join(config.tenantsDir, id),
      hosts,
      source: cfg.source,
      pollMinutes: Math.max(1, Number(cfg.pollMinutes) || 5),
      snapshotKeep: Math.max(2, Number(cfg.snapshotKeep) || 50),
      site: cfg.site,
      brand: { id, logoCredit: '', ...cfg.brand },
      db: openDb(join(config.dataDir, `${id}.db`)),
      cache: {},     // разобранный снимок, журнал, статистика — у каждого вуза свои
    });
  }

  if (!tenants.length) throw new Error(`В ${config.tenantsDir} нет ни одного вуза`);
  return tenants;
}

/** Вуз по адресу запроса (Host), или null. */
export function tenantFor(tenants, host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  const t = tenants.find((x) => x.hosts.includes(h));
  if (t) return t;
  if (config.devTenant && (h === 'localhost' || h === '127.0.0.1')) {
    return tenants.find((x) => x.id === config.devTenant) || null;
  }
  return null;
}
