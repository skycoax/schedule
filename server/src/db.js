// База — встроенный SQLite Node (node:sqlite, флаг --experimental-sqlite).
// Нативных зависимостей нет: движок вшит в рантайм, одинаково на Windows и Linux.
// У каждого вуза свой файл базы (data/<id>.db): данные вузов не смешиваются.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
  -- Снимки расписания: храним историю, чтобы уметь показать «что изменилось».
  CREATE TABLE IF NOT EXISTS snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at TEXT NOT NULL,           -- ISO-время, когда прочитали источник
    hash       TEXT NOT NULL,           -- отпечаток содержимого (чтобы не плодить копии)
    data       TEXT NOT NULL            -- JSON: { header, groups: [...] }
  );

  -- Журнал изменений: одна запись на каждую замеченную правку расписания.
  CREATE TABLE IF NOT EXISTS changes (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    ts    TEXT NOT NULL,                -- когда заметили
    items TEXT NOT NULL                 -- JSON-массив изменений
  );

  -- Заходы (аналитика). IP не храним сырым: только псевдоним и огрублённый вид.
  CREATE TABLE IF NOT EXISTS hits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL,
    cid        TEXT,                    -- случайный номер браузера (не личность)
    is_first   INTEGER DEFAULT 0,       -- первый заход этого браузера
    ip_hash    TEXT,                    -- соль+sha256 полного IP (для дедупликации/антифрода)
    ip_coarse  TEXT,                    -- IP с обнулённым последним октетом (для грубой гео)
    country    TEXT,
    city       TEXT,
    device     TEXT,                    -- iPhone / Android / Mac / Windows / …
    model      TEXT,                    -- модель, если её выдаёт браузер (обычно только Android)
    os         TEXT,
    browser    TEXT,
    ref        TEXT,                    -- referrer (откуда пришёл)
    source     TEXT,                    -- метка ?from= или разобранный referrer
    grp        TEXT,                    -- выбранная группа
    screen     TEXT,
    lang       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_hits_ts  ON hits (ts);
  CREATE INDEX IF NOT EXISTS idx_hits_cid ON hits (cid);

  -- Разное «ключ-значение» (например, время последней успешной сверки).
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Отзывы: без регистрации, имя необязательно. Текст хранится уже очищенным
  -- от тегов (см. reviews.js) — но выводим его всё равно только как обычный
  -- текст (React сам экранирует), а не innerHTML, это и есть настоящая защита.
  CREATE TABLE IF NOT EXISTS reviews (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT NOT NULL,
    cid     TEXT,                       -- тот же случайный номер браузера, что и в hits
    name    TEXT,
    rating  INTEGER NOT NULL,           -- 1..5
    text    TEXT,
    ip_hash TEXT                        -- для антиспама, не для личности
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_ts      ON reviews (ts);
  CREATE INDEX IF NOT EXISTS idx_reviews_cid     ON reviews (cid);
  CREATE INDEX IF NOT EXISTS idx_reviews_ip_hash ON reviews (ip_hash);
`;

/** Открывает (и при необходимости создаёт) базу вуза. */
export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // WAL — параллельное чтение во время записи; на всегда-включённом сервере это норма.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function metaGet(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function metaSet(db, key, value) {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}
