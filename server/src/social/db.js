// База «Обсуждений»: один файл <DATA_DIR>/social.db на все вузы (аккаунты, друзья и блокировки
// общие; публикации помечены вузом). Лежит рядом с базами вузов <id>.db; deploy.sh папку data/ не трогает.
// Схема — CONTRACT.md §C.2 дословно (V1) и изменения после него (V2…). Новая версия схемы = новый элемент
// MIGRATIONS (user_version).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

export const SCHEMA_V1 = `
-- Аккаунты. Один на человека для всех вузов. Почта — только для входа и ролей, наружу не отдаётся (кроме своей, замаскированной).
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub      TEXT    NOT NULL UNIQUE,                 -- 'dev:<name>' у входа для разработки
  email           TEXT    NOT NULL,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  age_group       TEXT    NOT NULL DEFAULT 'adult' CHECK (age_group IN ('minor','adult')),
  username        TEXT    UNIQUE COLLATE NOCASE,           -- NULL до SetupSheet; хранится в нижнем регистре
  username_at     TEXT,
  name            TEXT    NOT NULL DEFAULT '',
  name_fold       TEXT    NOT NULL DEFAULT '',             -- toLocaleLowerCase('ru'), ё→е — для поиска
  bio             TEXT    NOT NULL DEFAULT '',
  tg              TEXT    NOT NULL DEFAULT '',
  ig              TEXT    NOT NULL DEFAULT '',
  links_vis       TEXT    NOT NULL DEFAULT 'friends' CHECK (links_vis IN ('friends','signed')),
  searchable      INTEGER NOT NULL DEFAULT 1 CHECK (searchable IN (0,1)),          -- INSERT: 0 для minor
  friend_req      TEXT    NOT NULL DEFAULT 'all' CHECK (friend_req IN ('all','none')), -- INSERT: 'none' для minor
  avatar_id       TEXT    REFERENCES media(id) ON DELETE SET NULL,
  uni             TEXT,                                    -- «мой вуз»
  status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  banned_until    TEXT,                                    -- NULL при status='banned' — бессрочно
  ban_reason      TEXT    NOT NULL DEFAULT '',
  rules_version   INTEGER NOT NULL DEFAULT 0,
  policy_version  INTEGER NOT NULL DEFAULT 0,
  rules_at        TEXT,
  created_at      TEXT    NOT NULL,
  CHECK (age_group = 'adult' OR links_vis = 'friends')
);
CREATE INDEX IF NOT EXISTS idx_users_uni       ON users (uni);
CREATE INDEX IF NOT EXISTS idx_users_name_fold ON users (name_fold);
CREATE INDEX IF NOT EXISTS idx_users_banned    ON users (banned_until) WHERE status = 'banned';
CREATE INDEX IF NOT EXISTS idx_users_avatar    ON users (avatar_id)    WHERE avatar_id IS NOT NULL;  -- is_avatar при выдаче и SET NULL

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT    NOT NULL UNIQUE,                     -- sha256(token) hex; сам токен только в куке
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL,
  seen_at     TEXT    NOT NULL,                            -- 'YYYY-MM-DD'
  expires_at  TEXT    NOT NULL,
  device      TEXT    NOT NULL DEFAULT ''                  -- «Android · Chrome 131», без сырого UA
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,                            -- 43 знака base64url
  bind_hash   TEXT NOT NULL,                               -- sha256(значение куки para_oauth)
  verifier    TEXT NOT NULL,                               -- PKCE code_verifier
  nonce       TEXT NOT NULL,
  return_to   TEXT NOT NULL DEFAULT '/',
  uni         TEXT,
  intent      TEXT NOT NULL DEFAULT 'signin' CHECK (intent IN ('signin','delete')),
  age_group   TEXT CHECK (age_group IS NULL OR age_group IN ('minor','adult')),
  accepted    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_oauth_created ON oauth_states (created_at);

-- Публикации и ответы в одной таблице. Ветка плоская: root_id — публикация, parent_id — на какой ответ отвечают.
CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uni           TEXT    NOT NULL,
  author_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- страховка; удаление аккаунта сначала чистит посты кодом
  root_id       INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  parent_id     INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  category      TEXT CHECK (category IS NULL OR category IN ('study','schedule','events','company','lost','other')),
  text          TEXT    NOT NULL DEFAULT '',                        -- как написал автор; мат маскируется при выдаче
  media_count   INTEGER NOT NULL DEFAULT 0,
  like_count    INTEGER NOT NULL DEFAULT 0,
  reply_count   INTEGER NOT NULL DEFAULT 0,                         -- живые ответы
  report_count  INTEGER NOT NULL DEFAULT 0,                         -- учитываемые жалобщики (открытые)
  hidden        INTEGER NOT NULL DEFAULT 0,
  hidden_reason TEXT CHECK (hidden_reason IS NULL OR hidden_reason IN ('reports','admin')),
  created_at    TEXT    NOT NULL,
  last_reply_at TEXT,
  deleted_at    TEXT,
  deleted_by    TEXT CHECK (deleted_by IS NULL OR deleted_by IN ('self','admin','account')),
  CHECK ((root_id IS NULL) = (category IS NOT NULL))
);
-- Условия в запросах должны повторять WHERE частичного индекса дословно.
CREATE INDEX IF NOT EXISTS idx_posts_feed     ON posts (uni, id DESC)           WHERE root_id IS NULL AND deleted_at IS NULL AND hidden = 0;
CREATE INDEX IF NOT EXISTS idx_posts_feed_cat ON posts (uni, category, id DESC) WHERE root_id IS NULL AND deleted_at IS NULL AND hidden = 0;
CREATE INDEX IF NOT EXISTS idx_posts_thread   ON posts (root_id, id)            WHERE root_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_parent   ON posts (parent_id)              WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_author   ON posts (author_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_hidden   ON posts (id)                     WHERE hidden = 1;

CREATE TABLE IF NOT EXISTS likes (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (post_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes (user_id);

CREATE TABLE IF NOT EXISTS media (
  id          TEXT    PRIMARY KEY,                         -- 22 знака base64url (128 бит)
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('post','avatar')),
  post_id     INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  bytes       INTEGER NOT NULL,
  thumb_bytes INTEGER NOT NULL DEFAULT 0,                  -- 0 — миниатюры нет (thumb = url)
  sha256      TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  attached_at TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_media_post    ON media (post_id, position) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_owner   ON media (owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_media_orphans ON media (created_at)        WHERE post_id IS NULL;

-- Жалобы. Одна от человека на цель (target_key = 'p:<id>' | 'u:<id>'). Снимок — текст на момент жалобы.
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,     -- обезличивается при удалении аккаунта жалобщика
  target_key   TEXT    NOT NULL,
  post_id      INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,     -- автор публикации или сам пользователь
  uni          TEXT,
  reason       TEXT    NOT NULL CHECK (reason IN ('spam','abuse','sexual','violence','privacy','scam','impersonation','child','other')),
  note         TEXT    NOT NULL DEFAULT '',
  snapshot     TEXT    NOT NULL DEFAULT '{}',                       -- JSON {kind, rootId, text, name, username, media:[id…], mediaCount, at}
  counts       INTEGER NOT NULL DEFAULT 1,                          -- 1 — учитывается для автоскрытия
  status       TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  created_at   TEXT    NOT NULL,
  resolved_at  TEXT,
  resolved_by  INTEGER                                              -- без FK: переживает удаление модератора
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_once   ON reports (reporter_id, target_key) WHERE reporter_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_reports_open   ON reports (status, target_key);
CREATE INDEX        IF NOT EXISTS idx_reports_target ON reports (target_key);
CREATE INDEX        IF NOT EXISTS idx_reports_user   ON reports (user_id);
CREATE INDEX        IF NOT EXISTS idx_reports_post   ON reports (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_reports_child  ON reports (reporter_id) WHERE reason = 'child' AND status = 'dismissed';

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);

-- Друзья: одна строка на пару (меньший id, больший id).
CREATE TABLE IF NOT EXISTS friends (
  user_lo      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_hi      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id INTEGER NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('pending','accepted')),
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  PRIMARY KEY (user_lo, user_hi),
  CHECK (user_lo < user_hi),
  CHECK (requester_id IN (user_lo, user_hi))
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_friends_hi ON friends (user_hi, status);

-- Имена, которые нельзя занять 30 дней (после смены или удаления аккаунта).
CREATE TABLE IF NOT EXISTS held_usernames (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  user_id  INTEGER,                                        -- кто держит (NULL — аккаунт удалён); свой можно вернуть
  until    TEXT NOT NULL
) WITHOUT ROWID;

-- Отпечаток заблокированного и удалённого аккаунта: бан не снимается удалением и повторным входом.
CREATE TABLE IF NOT EXISTS ban_marks (
  sub_hash   TEXT PRIMARY KEY,                             -- sha256(SOCIAL_SALT + '|' + google_sub)
  until      TEXT,                                         -- NULL — бессрочно (всё равно стирается через 365 дней)
  reason     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) WITHOUT ROWID;

-- Журнал модерации и важных событий. Без текста публикаций, почты, IP и токенов.
CREATE TABLE IF NOT EXISTS audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT    NOT NULL,
  actor_id  INTEGER,                                       -- без FK; NULL — система
  action    TEXT    NOT NULL,
  target    TEXT,                                          -- 'p:123' | 'u:45'
  uni       TEXT,
  info      TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (ts);
`;

// Вход с адреса вуза (kfu.skycoax.uz…): Google возвращает на Para, а завершается вход там, где начался.
// origin — адрес страницы, с которой начали вход (NULL — сама Para).
export const SCHEMA_V2 = `
ALTER TABLE oauth_states ADD COLUMN origin TEXT;
`;

// Данные входа через Google и регистрации — только для модераторов в админке (политика, «Что Para получает
// от Google» и «Модерация»). Наружу, в профили и посты, не отдаются.
export const SCHEMA_V3 = `
ALTER TABLE users ADD COLUMN google_name    TEXT NOT NULL DEFAULT '';  -- имя и фамилия, как записаны в Google
ALTER TABLE users ADD COLUMN google_locale  TEXT NOT NULL DEFAULT '';  -- язык аккаунта Google: ru, uz, en…
ALTER TABLE users ADD COLUMN google_hd      TEXT NOT NULL DEFAULT '';  -- домен Google Workspace (почта вуза), если есть
ALTER TABLE users ADD COLUMN google_picture TEXT NOT NULL DEFAULT '';  -- адрес фото в Google (с последнего входа)
ALTER TABLE users ADD COLUMN signup_host    TEXT NOT NULL DEFAULT '';  -- где завели аккаунт: para.skycoax.uz, kfu.skycoax.uz…
ALTER TABLE users ADD COLUMN signup_device  TEXT NOT NULL DEFAULT '';  -- «iPhone · Safari» при регистрации
ALTER TABLE users ADD COLUMN last_login_at  TEXT;                      -- последний вход через Google
ALTER TABLE users ADD COLUMN login_count    INTEGER NOT NULL DEFAULT 0;
`;

// Моменты (как Instants в Instagram): фото с камеры, которое сутки видят друзья; автору — архив на год.
// Фото — обычная строка media (kind 'post', post_id NULL), связь — instants.media_id; удаляется строка media —
// вместе с ней момент и его просмотры.
export const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS instants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id    TEXT    NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
  uni         TEXT,
  created_at  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,                            -- до этого времени момент видят друзья (сутки)
  hidden      INTEGER NOT NULL DEFAULT 0                   -- скрыт после жалобы (тяжёлая причина) или модератором
);
CREATE INDEX IF NOT EXISTS idx_instants_author ON instants (author_id, id);
CREATE INDEX IF NOT EXISTS idx_instants_exp    ON instants (expires_at);

-- Кто открыл момент и какую реакцию поставил (одна на человека).
CREATE TABLE IF NOT EXISTS instant_views (
  instant_id  INTEGER NOT NULL REFERENCES instants(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at     TEXT    NOT NULL,
  reaction    TEXT,
  reacted_at  TEXT,
  PRIMARY KEY (instant_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_iviews_user ON instant_views (user_id);

-- Настройку «Кто может добавить в друзья» убрали из приложения — заявки открыты всем.
UPDATE users SET friend_req = 'all' WHERE friend_req <> 'all';
`;

// Кто видит момент: 'all' — все вошедшие в «Обсуждениях» того же вуза (по умолчанию для новых), 'friends' — только
// друзья. Уже снятые моменты снимались «для друзей» — у них так и остаётся.
export const SCHEMA_V5 = `
ALTER TABLE instants ADD COLUMN audience TEXT NOT NULL DEFAULT 'friends' CHECK (audience IN ('all','friends'));
CREATE INDEX IF NOT EXISTS idx_instants_uni ON instants (uni, expires_at);
`;

// Значок у имени (галочка, корона, сердечко…), который выдаёт модератор; NULL — без значка. Список — users.js BADGES.
export const SCHEMA_V6 = `
ALTER TABLE users ADD COLUMN badge TEXT;
`;

// Мини-игра «Код» (game.js, CONTRACT.md §I): быки и коровы на четырёх разных цифрах. Счёт игрока, дуэли
// (вызов ссылкой, другу, случайный соперник, реванш) и «Код дня». Всё решает сервер, без таймеров на игру:
// сроки проверяются при чтении и раз в 10 минут. game_meta.beat — отметка «сервер жив» (продление сроков после простоя).
export const SCHEMA_V7 = `
CREATE TABLE IF NOT EXISTS game_players (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  draws       INTEGER NOT NULL DEFAULT 0,
  streak      INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  streak_day  TEXT,                         -- последний взломанный «Код дня», 'YYYY-MM-DD' (Ташкент)
  found_at    TEXT NOT NULL                 -- первый GET /api/social/games
);

CREATE TABLE IF NOT EXISTS game_duels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL CHECK (kind IN ('link','friend','quick','rematch')),
  status      TEXT    NOT NULL CHECK (status IN ('open','active','done','expired','cancelled')),
  token       TEXT    UNIQUE,               -- только kind='link'; NULL, когда игра кончилась, истекла или отменена
  a_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- создатель
  b_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- принявший
  to_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- адресат (friend, rematch)
  rematch_of  INTEGER REFERENCES game_duels(id) ON DELETE SET NULL,
  a_code      TEXT    NOT NULL,
  b_code      TEXT,
  a_moves     TEXT    NOT NULL DEFAULT '[]',  -- [["1074",2,2,"2026-09-26T10:00:00.000Z"], …]
  b_moves     TEXT    NOT NULL DEFAULT '[]',
  a_res       TEXT CHECK (a_res IN ('cracked','failed','timeout','left')),
  b_res       TEXT CHECK (b_res IN ('cracked','failed','timeout','left')),
  winner      TEXT CHECK (winner IN ('a','b','draw','none')),
  reason      TEXT CHECK (reason IN ('score','early','left','timeout','blocked','banned','deleted',
                                     'declined','expired','cancelled')),
  a_seen      INTEGER NOT NULL DEFAULT 1,
  b_seen      INTEGER NOT NULL DEFAULT 1,
  v           INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  joined_at   TEXT,
  deadline_at TEXT    NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_gd_quick    ON game_duels (created_at) WHERE status = 'open' AND kind = 'quick';
CREATE INDEX IF NOT EXISTS idx_gd_a        ON game_duels (a_id, status);
CREATE INDEX IF NOT EXISTS idx_gd_b        ON game_duels (b_id, status);
CREATE INDEX IF NOT EXISTS idx_gd_to       ON game_duels (to_id) WHERE to_id IS NOT NULL;   -- и для ON DELETE SET NULL
CREATE INDEX IF NOT EXISTS idx_gd_deadline ON game_duels (deadline_at) WHERE status IN ('open','active');
CREATE INDEX IF NOT EXISTS idx_gd_finished ON game_duels (finished_at);
CREATE INDEX IF NOT EXISTS idx_gd_rematch  ON game_duels (rematch_of) WHERE rematch_of IS NOT NULL;

CREATE TABLE IF NOT EXISTS game_daily (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         TEXT    NOT NULL,             -- 'YYYY-MM-DD', Asia/Tashkent
  code        TEXT    NOT NULL,
  moves       TEXT    NOT NULL DEFAULT '[]',
  n           INTEGER NOT NULL DEFAULT 0,
  solved      INTEGER NOT NULL DEFAULT 0 CHECK (solved IN (0,1,2)),   -- 0 играет, 1 взломан, 2 не взломан
  started_at  TEXT    NOT NULL,
  finished_at TEXT,
  ms          INTEGER,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_gdaily_board ON game_daily (day, n, ms) WHERE solved = 1;

CREATE TABLE IF NOT EXISTS game_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;   -- 'beat'
`;

const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7];

/** Открыть (и при необходимости создать) social.db и довести схему до последней версии. */
export function openSocialDb(dir = config.dataDir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'social.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

function migrate(db) {
  let version = Number(db.prepare('PRAGMA user_version').get().user_version) || 0;
  while (version < MIGRATIONS.length) {
    const next = version + 1;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${next}`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* уже откатилось */ }
      throw err;
    }
    version = next;
  }
}

/**
 * Транзакция: BEGIN IMMEDIATE → fn(db) → COMMIT, при исключении ROLLBACK и исключение дальше.
 * Внутри fn — никаких await: файлы пишем и удаляем до или после транзакции.
 */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(db);
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* уже откатилось */ }
    throw err;
  }
}

/** Время для базы: ISO-8601 UTC (сравнивается как текст). */
export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();
/** День для sessions.seen_at: 'YYYY-MM-DD' (UTC). */
export const today = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
