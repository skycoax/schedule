// Фоновые задачи «Обсуждений» (CONTRACT.md §C.7): setInterval(...).unref(), каждая в try/catch.
//   10 мин — старые входы, истёкшие баны, полные ведёрки;
//   1 ч   — неотправленные фото, брошенные аватары, файлы без строки в базе, истёкшие сессии;
//   24 ч  — сроки хранения (журнал, жалобы, «надгробия», удержанные имена, отпечатки банов) и копия базы.
// В SOCIAL_MODE=off работают те же функции (удаление аккаунта остаётся, данные чистятся по срокам).
import { readdirSync, statSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, social } from '../config.js';
import { tx, nowIso, HOUR, DAY } from './db.js';
import { audit } from './moderation.js';
import { sweepBuckets } from './limits.js';
import { unlinkMedia } from './media.js';

const MIN = 60_000;
const FILE_RE = /^([A-Za-z0-9_-]{22})(_t)?\.jpg$/;
const BACKUP_RE = /^social-\d{4}-\d{2}-\d{2}\.db$/;
const BACKUPS_KEEP = 7;

function every(ms, name, log, fn) {
  const run = () => {
    try { fn(); } catch (err) { log.error({ job: name, msg: err && err.message }, 'обсуждения: задача не выполнилась'); }
  };
  setInterval(run, ms).unref();
  return run;
}

/** Каждые 10 минут: входы старше 10 минут, истёкшие временные баны, полные ведёрки. */
export function tenMinuteJob(ctx) {
  const db = ctx.db;
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(nowIso(Date.now() - 10 * MIN));
  const now = nowIso();
  const expired = db.prepare(
    "SELECT id FROM users WHERE status = 'banned' AND banned_until IS NOT NULL AND banned_until <= ?").all(now);
  for (const { id } of expired) {
    const r = db.prepare("UPDATE users SET status = 'active', banned_until = NULL, ban_reason = '' WHERE id = ? AND status = 'banned'")
      .run(id);
    if (r.changes === 1) audit(db, null, 'user.unban', 'u:' + id, null, { expired: true });
  }
  sweepBuckets();
}

/**
 * Каждый час: неотправленные фото старше суток, аватары старше суток, которые никто не поставил,
 * файлы в MEDIA_DIR без строки в базе (и .tmp-*) старше часа, истёкшие сессии.
 */
export function hourlyJob(ctx) {
  const db = ctx.db;
  const dayAgo = nowIso(Date.now() - DAY);
  const orphans = tx(db, () => {
    const rows = db.prepare(`SELECT id FROM media WHERE post_id IS NULL AND created_at < ?
      AND (kind = 'post' OR NOT EXISTS (SELECT 1 FROM users x WHERE x.avatar_id = media.id))`).all(dayAgo);
    const del = db.prepare('DELETE FROM media WHERE id = ?');
    for (const r of rows) del.run(r.id);
    return rows;
  });
  unlinkMedia(orphans);

  sweepFiles(ctx);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
}

/** Файлы без строки в базе и недописанные .tmp-* старше часа. Чужие имена не трогаем. */
function sweepFiles(ctx) {
  let names;
  try { names = readdirSync(social.mediaDir); } catch { return; }
  const hourAgo = Date.now() - HOUR;
  const row = ctx.db.prepare('SELECT thumb_bytes FROM media WHERE id = ?');
  for (const name of names) {
    const m = name.match(FILE_RE);
    const tmp = name.startsWith('.tmp-');
    if (!m && !tmp) continue;
    const file = join(social.mediaDir, name);
    let st;
    try { st = statSync(file); } catch { continue; }
    if (!st.isFile() || st.mtimeMs > hourAgo) continue;
    if (m) {
      const r = row.get(m[1]);
      if (r && (!m[2] || Number(r.thumb_bytes) > 0)) continue;
    }
    try { rmSync(file, { force: true }); } catch { /* в следующий раз */ }
  }
}

/**
 * Раз в сутки (и через минуту после запуска): сроки хранения и резервная копия social.db.
 * Фото в копию не входят (объём); копии за 7 последних дней — в <DATA_DIR>/backup/.
 */
export function dailyJob(ctx) {
  const db = ctx.db;
  const now = Date.now();
  const iso = (ms) => nowIso(ms);
  tx(db, () => {
    db.prepare('DELETE FROM audit WHERE ts < ?').run(iso(now - 180 * DAY));
    // Входы в журнал больше не пишутся — убираем оставшиеся от ранних версий.
    db.prepare("DELETE FROM audit WHERE action = 'auth.login'").run();
    db.prepare("DELETE FROM reports WHERE status <> 'open' AND resolved_at < ?").run(iso(now - 180 * DAY));
    db.prepare("DELETE FROM reports WHERE status = 'open' AND created_at < ?").run(iso(now - 365 * DAY));
    // Публикации-«надгробия» без живых ответов — совсем (каскад уберёт их ответы-«надгробия»).
    db.prepare(`DELETE FROM posts WHERE root_id IS NULL AND deleted_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM posts r WHERE r.root_id = posts.id AND r.deleted_at IS NULL)`).run();
    // Ответы-«надгробия», на которые больше никто не ссылается (цепочки — за несколько проходов).
    const prune = db.prepare(`DELETE FROM posts WHERE root_id IS NOT NULL AND deleted_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM posts c WHERE c.parent_id = posts.id)`);
    for (let i = 0; i < 20 && prune.run().changes > 0; i++);
    db.prepare('DELETE FROM held_usernames WHERE until < ?').run(iso(now));
    db.prepare('DELETE FROM ban_marks WHERE (until IS NOT NULL AND until < ?) OR created_at < ?')
      .run(iso(now), iso(now - 365 * DAY));
  });
  backup(ctx);
}

/** VACUUM INTO <DATA_DIR>/backup/social-YYYY-MM-DD.db (раз в день), храним 7 последних. */
function backup(ctx) {
  const dir = join(config.dataDir, 'backup');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `social-${nowIso().slice(0, 10)}.db`);
  if (!existsSync(file)) ctx.db.prepare('VACUUM INTO ?').run(file);
  const old = readdirSync(dir).filter((n) => BACKUP_RE.test(n)).sort().reverse().slice(BACKUPS_KEEP);
  for (const n of old) rmSync(join(dir, n), { force: true });
}

/**
 * Запустить задачи.
 * @param {{ db: import('node:sqlite').DatabaseSync, log: import('fastify').FastifyBaseLogger }} ctx
 */
export function startJobs(ctx) {
  const log = ctx.log;
  every(10 * MIN, 'ten-minutes', log, () => tenMinuteJob(ctx));
  const hourly = every(HOUR, 'hourly', log, () => hourlyJob(ctx));
  const daily = every(DAY, 'daily', log, () => dailyJob(ctx));
  setTimeout(() => { hourly(); daily(); }, 60_000).unref();
}
