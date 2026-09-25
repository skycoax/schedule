// Para — один адрес для всех вузов (para.skycoax.uz). Здесь вуз выбирает сам человек,
// а не адрес: сервер берёт его из ?uni=<id> или из куки uni (её пишет приложение).
// Описание — hub/hub.json, картинки бренда Para — там же. Старые адреса вузов
// (kfu.skycoax.uz…) при redirectOldHosts отправляют людей сюда вместе с настройками.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, social } from './config.js';

export function loadHub() {
  const file = join(config.hubDir, 'hub.json');
  if (!existsSync(file)) return null;
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  const fail = (msg) => { throw new Error(`hub/hub.json: ${msg}`); };
  if (!Array.isArray(cfg.hosts) || !cfg.hosts.length) fail('нужен hosts: ["para.skycoax.uz"]');
  for (const k of ['name', 'title', 'description', 'appDescription']) if (!cfg.site || !cfg.site[k]) fail(`нет site.${k}`);
  if (!cfg.about) fail('нет about');
  return {
    dir: config.hubDir,
    hosts: cfg.hosts.map((h) => String(h).trim().toLowerCase()),
    redirectOldHosts: cfg.redirectOldHosts === true,
    site: cfg.site,
    about: cfg.about,
  };
}

const hostOf = (host) => String(host || '').toLowerCase().replace(/:\d+$/, '');

export function isHubHost(hub, host) {
  return !!hub && hub.hosts.includes(hostOf(host));
}

/**
 * Разработка (DEV_HUB=1, не production): localhost, любой *.localhost (be.localhost, chat.localhost…)
 * и 127.0.0.1 считаются адресом Para. У каждого *.localhost свои куки — разработчики не мешают друг другу.
 */
export const isDevHub = (hub, host) =>
  !!hub && social.devHub && /^(?:[a-z0-9-]+\.)?localhost$|^127\.0\.0\.1$/.test(hostOf(host));

/**
 * Разработка (DEV_HUB=1, не production): <id вуза>.localhost — адрес этого вуза (kfu.localhost → kfu),
 * чтобы проверять приложение на адресе вуза в браузере. Остальные *.localhost — по-прежнему Para.
 */
export function devTenantOf(tenants, host) {
  if (!social.devHub) return null;
  const m = hostOf(host).match(/^([a-z0-9-]+)\.localhost$/);
  return (m && tenants.find((t) => t.id === m[1])) || null;
}

function cookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}

/**
 * Вуз запроса на адресе Para: ?uni= важнее куки (ссылка «открыть такой-то вуз»).
 * Незнакомый ?uni= (вуз отключили, опечатка в ссылке) не сбивает уже выбранный вуз.
 */
export function hubTenant(tenants, req) {
  const find = (id) => (id && tenants.find((t) => t.id === String(id).toLowerCase())) || null;
  return find(req.query && req.query.uni) || find(cookie(req, 'uni'));
}

export const hubUrl = (hub) => `https://${hub.hosts[0]}`;
