# Para social v1: implementation contract (authoritative)

Status: **frozen implementation contract, revision 2** (all blockers and majors from `spec/critique.md` fixed; see the last
section, "Changelog from critique"). Six engineers build from this file in parallel, in the same working tree
`C:/Users/user/a`, without seeing each other's work.

Precedence: **this file wins** over `spec/ux.md`, `spec/backend.md` and `spec/compliance.md` wherever they differ. Use those
files only as references:
- `ux.md` for wireframes, spacing, motion and any microcopy that this file does not list;
- `backend.md` for the security reasoning and the prototyped code. `sanitizeJpeg()` in §5.2 ships as is; `safeReturn()`,
  `claimsFrom()`, `cleanText()`, the token buckets and the error handler are also reused;
- `compliance.md` for the legal-text drafts that §E.6 adapts.

If a referenced passage contradicts this file (for example a category id, an endpoint path, a field name, the age, or a string),
**this file is correct**.

Technical text is in English. Every user-facing string is Russian, exactly as it should ship. The app uses «ты». The public HTML
pages (`/policy`, `/rules`, `/delete-account`) use «вы».

## 0. Ground rules for every engineer

1. **Edit only files you own** (§D). If you need a change in someone else's file, do not make it. List it in your final report
   under `open_questions` with the exact change you need.
2. **The working tree is shared.** Never run git commands that change the tree or the index: no `git stash`, `checkout`,
   `switch`, `reset`, `restore`, `clean`, `commit`, `push` or `worktree`. Read‑only git (`status`, `diff`, `log`, `show`)
   is fine.
3. **Keep your files compiling at all times.** If a dependency is not ready, write a stub with the exact exported signature
   instead of broken code. Check only your own files with
   `cd web && npx tsc --noEmit -p . 2>&1 | grep -E "src/(<your paths>)"`, because other people's files may be in flux.
4. **No new npm dependencies** in `web/` or `server/`. Do not edit `package.json` or lockfiles.
5. **Secrets.** Never print, log, commit or ask for `GOOGLE_CLIENT_ID/SECRET`, `SOCIAL_SALT`, `IP_SALT` or `server/.env`.
   Never read `server/.env`.
6. **Do not deploy.** Do not touch nginx, systemd, DNS or the VPS.
7. **Style.** Follow the restrained iOS look: no gradients on controls, no glows, no colored shadows, no emoji in UI chrome.
   Use existing tokens and the new ones in §E.8 only.
8. **Accessibility floor.** Every tap target is at least 44×44 CSS px. Every icon-only button has an `aria-label`. Inputs use
   a font of 16 px or more. Layouts work from 320 px wide without horizontal scroll, in both themes.
9. **Strings.** Strings in this file are final. For a string this file does not list, take it from `ux.md`. If it is in neither,
   write it in the same voice and list it in your report.
10. **TypeScript notes.** The signatures below write `JSX.Element` for brevity. With `@types/react` 19.2 the global `JSX`
    namespace does not exist, so every file that names it adds `import type { JSX } from 'react'` (or writes
    `React.JSX.Element` with `import type * as React from 'react'`). `noUnusedParameters` is on: stub parameters you do not
    use yet get a `_` prefix (`(_p: ChatTabProps)`).

---

## A. Final product decisions

### A.1 Decisions

| # | Topic | Decision (binding) |
|---|---|---|
| D1 | Where social lives | Only on the Para hub (`brand.hub === true`, `para.skycoax.uz`, or `localhost` with `DEV_HUB=1`), and only after a university is chosen (`brand.id !== ''`). Per‑university hosts (`kfu.skycoax.uz` …) render the schedule only: no tab bar, no `social/*` chunks, and no requests to `/api/auth`, `/api/social` or `/api/media`. |
| D2 | Bottom tabs | `Расписание` · `Обсуждения` · `Профиль`. A floating glass capsule sits above the bottom edge. Each item has an icon above its label. The active item sits on a darker pill with a blue (`--accent`) icon and label (ux.md §3.1). |
| D3 | Schedule top row | A fixed glass row. **Left:** a round button with the Para logo mask; it opens the existing `UniversityMenu`. **Center:** a glass segmented control `Сегодня \| Неделя`. **Right:** a round `Правки` button (history icon, plus an orange dot when there are unseen changes); it opens `ChangesSheet`, a bottom sheet that wraps the unchanged `ChangesView`. In teacher mode the right slot is an empty 44×44 placeholder. |
| D4 | Large title | Under the row: the group or teacher name with a chevron (tap → Picker) and a subtitle (`КФУ · Джизак · 1 курс`). `Header.tsx`, `TopBar.tsx` and `.cbar` are deleted. The `Сменить` pill and the theme icon leave the header. |
| D5 | Theme | On the hub: `Профиль → Оформление` (`Авто \| Светлая \| Тёмная`). On non‑hub hosts: a `ThemeSection` above the footer of the schedule page. |
| D6 | Accounts | Everyone is a guest by default. Sign‑in uses the Google OAuth 2.0 authorization‑code flow, server‑side, with PKCE S256, nonce and single‑use state, and full‑page redirects. There is no Google JS on our pages. Until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, `google:false` and every sign‑in button is disabled, with the caption `Вход через Google скоро появится. Читать обсуждения можно и без аккаунта.` |
| D7 | Minimum age | Accounts require age ≥ `SOCIAL_MIN_AGE` (server env, default **16**). The sign‑in sheet asks `Сколько тебе лет?` **before** redirecting to Google. The options are `Младше {minAge}` · `{minAge}–17` · `18 и старше`; when `minAge >= 18` the middle option is not rendered. "Under" never reaches Google and sets `ageBlock` locally for 30 days. `{minAge}–17` = `minor`, `18+` = `adult`. Minors get stricter defaults (D15). **Delete mode** (`intent=delete`) never asks the age and ignores `ageBlock`. |
| D8 | Consent | The sign‑in sheet has a required checkbox: `Принимаю Правила обсуждений и Политику конфиденциальности`. `accept=1` travels through `/api/auth/google/start` **only for `intent=signin`**. The server records `rules_version` and `policy_version` at the callback, for new and returning users, **only when `intent==='signin' && accepted===1`**; a delete‑mode sign‑in never records consent. `RulesSheet` in accept mode appears only when `config.rulesVersion` is greater than the version the user accepted. |
| D9 | First sign‑in | `SetupSheet`: the name is prefilled with the Google `given_name`, `@username` is suggested by the server (`me.suggestedUsername`, never derived from the email), and the photo is optional. The Google profile photo is **never** used. SetupSheet opens by itself **only** right after `#auth=ok`, or from `ensure()`; it is dismissible with `Позже`. Otherwise a signed‑in user without a profile sees a `Заверши профиль` card in «Профиль». It never opens when `mode !== 'on'` or when the user is banned. |
| D10 | Chat scope | The feed shows the **currently selected university** (`req.tenant`). Accounts, friends and blocks are global. Replies inherit the root's `uni`. A thread from another university shows a badge (for example `ТГЭУ`). |
| D11 | Guests | Guests can read the feed and threads and view photos. They cannot open profiles, search people, post, reply, like, add friends, report or block. Any of those actions opens `SignInSheet` with the right reason. Guests can **hide an author locally** (`Скрыть посты @u`). For guests, `Пожаловаться` opens the sign‑in sheet, which also offers the Telegram fallback. For a guest request the server sends `author.uni = author.uniShort = null` («мой вуз» is signed‑in only), and the chat UI never renders `author.uni*` at all. |
| D12 | Posts and replies | Text is at most 1000 graphemes, 30 lines and 3 links. Accounts younger than 24 h may post no links. A root post has 0–4 photos, and at least text or one photo. A root post needs **one** category. Replies form a flat thread, oldest first, with an optional reply‑to (the username is resolved at read time) and **at most 1 photo**. Posts and replies get likes (the count only). There is no editing and there are no DMs. |
| D13 | Categories (fixed, in this display order) | `study` Учёба · `schedule` Расписание · `events` События · `company` Компания · `lost` Потеряшки · `other` Разное. **No photos** in `company`, neither in the root post nor in its replies (server‑enforced). There is no marketplace and no «Знакомства». |
| D14 | Photos | The client re‑encodes to JPEG: full size with a long side ≤ 1600 px and ≤ 880 KB, and a thumb with a long side ≤ 640 px and ≤ 140 KB. Each is its own request (nginx has a 1 MB limit). The server sanitizes both: it strips EXIF, XMP, ICC and COM and any bytes after EOI. Full ≤ 2048 px and ≤ 900 KB, thumb ≤ 640 px and ≤ 150 KB. Files are served from `/api/media/<id>.jpg` and `/api/media/<id>_t.jpg`. A missing thumb falls back to the full URL. The server rejects a thumb whose aspect ratio or size does not match the full image (§B.5 #14); moderators always see both. Unattached uploads are purged after 24 h. The service worker never caches media; the HTTP cache (`public, max-age=604800`, 7 days) is enough. |
| D15 | Profile | Avatar (cropped to 512 + 128), name, `@username`, `О себе` (≤ 160), Telegram, Instagram, and «мой вуз» (`uni`, editable in `EditProfileSheet`). **The schedule group is not in the profile in v1.** Privacy settings: `linksVisibility` = `friends` (default) or `signed` (adults only). `searchable` defaults to on for adults and **off for minors**. `friendRequests` = `all` or `none`; the default is `all` for adults and **`none` for minors** (a minor can switch it to «Все» in Settings). |
| D16 | Profiles and search | Both require sign‑in. Search is `POST` (the query stays out of access logs) and matches name and username prefix, with the same university first. Users with `searchable=false` appear only when the query exactly equals their username. |
| D17 | Friends | Request, accept, decline, cancel and remove. Lists are private to their owner; profiles show counts only. |
| D18 | Safety (Play UGC) | Report posts, replies and profiles (9 reasons, signed‑in only; **banned users can report and block**). Block (two‑way invisibility). Local hide for guests. Auto‑hide on reports (C19). Profanity is masked on output (`п•••`). Rate limits, plus stricter limits for new accounts. An admin queue with both the preview and the full photo. Bans (read‑only for 1, 7 or 30 days, or permanent) and **unban from the UI**. Reset of profile fields. An audit log. A kill switch (`SOCIAL_MODE=on\|readonly\|off`): `readonly` still allows report, block, deleting your own posts, privacy‑reducing settings, logout and account deletion; `off` still allows sign‑in **for deletion only**, logout and account deletion. An "unofficial community" label in the feed. |
| D19 | Account deletion | In the app: `Профиль → Удалить аккаунт`, a checkbox, then `Удалить аккаунт навсегда`. The public page `https://para.skycoax.uz/delete-account` has its own sign‑in (`intent=delete`, which never creates an account). Banned users can delete. Deletion works in **every** `SOCIAL_MODE`, `off` included. Deletion is immediate and hard. Details in §C.4. |
| D20 | Username | `^(?!\d+$)[a-z0-9_]{3,20}$`, stored lowercase. Reserved names (§C.3). It can be changed once per 30 days, and freely during the first 24 h after the account is created. A released or deleted name is held for 30 days. |
| D21 | Offline | The schedule works offline exactly as today. Social data is never served by the service worker. Chat and Profile show what is in memory plus an offline row. |
| D22 | Service worker | Only navigations to `/` (or `/index.html`) are saved as the app page. On activate, a poisoned `/__page` (one without `id="root"`) is deleted, and `/assets/` entries unused for 30 days are dropped (never one the saved page references). The cache name stays `para-v1`. |
| D23 | Hub pages | `/policy` (rewritten), `/rules` (new; includes `#children`), `/delete-account` (new) and `/robots.txt`. There is no `/safety` page. |
| D24 | Analytics hygiene | Stop writing `hits.ip_coarse` and null the existing values. Request logs have no IP, and no query string for sensitive paths. `trustProxy: '127.0.0.1'`. |
| D25 | Dependencies | None new, on either side. |
| D26 | Tab restore | A cold start restores the last tab only if it was used less than 30 min ago; otherwise it opens `Расписание`. A deep link beats the restore. |
| D27 | Not in v1 | DMs, post editing, the unread‑replies badge, per‑university kill switch, student moderators, group on profile, «Взять фото из Google», link previews, the «Мне уже 18» UI (the API exists), the warn action, username rename by an admin, and hiding a single post server‑side. |
| D28 | Play Console (owner) | Store category `Образование`. IARC: users interact and share images, UGC moderated. Target audience: **recommend 16–17 and 18+** (owner decides, Q1; code is unaffected because the age is an env value). Data safety per §E.6. |
| D29 | Tab stacks | ux.md D11 ("each tab keeps its own stack") is **dropped**: all tabs share one browser history. Leaving a tab first collapses that tab's pushed screens and open sheets (`unwind`, §E.2), then switches; only the root's scroll position is kept. |
| D30 | `SOCIAL_MODE=off` in the UI | The tab bar shows two items, `Расписание` · `Профиль`. Chat deep links open `Расписание`. «Профиль» keeps the signed‑in account card, the schedule/app settings and `Удалить аккаунт`; social rows are hidden. First paint uses `brand.social`. |
| D31 | Consent before network | On the hub, no `/api/auth/*` or `/api/social/*` request is sent before the schedule consent (`store('agreed')`). |

### A.2 Conflict resolution log

| # | Topic | ux.md | backend.md | compliance.md | **Decision** |
|---|---|---|---|---|---|
| C1 | Minimum age and gate | 13+, no gate | 16, checkbox after Google | 16, 3‑way question before Google | `SOCIAL_MIN_AGE` env (default 16). A 3‑way question before Google. The server stores `age_group` (`minor`\|`adult`). |
| C2 | Where rules are accepted | Switch in SetupSheet | `acceptRules`+`ageConfirmed` in `PATCH /me` | Checkbox on the sign‑in sheet | Checkbox on SignInSheet → `accept=1` → stored at the callback. `POST /api/social/me/rules` is used only after a version bump. |
| C3 | Category ids | study/schedule/campus/people/lost/other | general/study/events/acquaint/market/lostfound | Учёба/Вопросы/События/Компания/Потеряшки/Разное | `study, schedule, events, company, lost, other` |
| C4 | Photos in «Компания» | allowed | allowed | off | Off (server `400 invalid`) |
| C5 | Photos per reply | 1 | 4 | — | 1 |
| C6 | Image sizes and thumbs | 1280 + 480 thumb, 2 requests | ≤ 1600, 1 request | 1600, 1 request | Full ≤ 1600 (server ≤ 2048) plus an optional client thumb ≤ 640 in a second request |
| C7 | Media URL | `/api/social/media/…` | `/api/media/<id>.jpg` | `/media/<id>.jpg` | `/api/media/<id>.jpg` and `/api/media/<id>_t.jpg` |
| C8 | SW media cache | none | `para-media-v1` | none | None; `/api/media/*` is not intercepted |
| C9 | SW cache name | keep `para-v1` | keep | bump to `para-v2` | Keep `para-v1`; purge a poisoned `/__page` on activate |
| C10 | Auth status call | `/api/auth/config` + `/api/social/me` | `/api/auth/me` | `/api/auth/config` | `GET /api/auth/me` only |
| C11 | OAuth outcome transport | `?signed=1&authError=` | `#auth=` | `?auth=` | `#auth=<outcome>` fragment (never logged) |
| C12 | OAuth start | GET navigation | GET navigation | POST → url | GET navigation with `intent`, `age`, `accept`, `return` query |
| C13 | Session cookie | Lax | `__Host-para_sid`, Lax | Strict | `__Host-para_sid` (prod) / `para_sid` (http dev), `SameSite=Lax`, 180 d sliding |
| C14 | User id type | string | integer | random text | Integer (JSON number) |
| C15 | Reply model | Separate `Reply` | Unified `posts` table | `reply_to_user_id` | Unified table; `type Reply = Post`; `replyTo` from `parent_id`, username resolved at read time |
| C16 | Guests and profiles/search | Guests see profiles | Guests see profiles | Sign‑in required | Sign‑in required (`401 auth` → SignInSheet reason `profile`/`search`) |
| C17 | Guest reports | allowed | sign‑in | — | Sign‑in required. The sheet adds `Или напиши нам в Telegram: @skycoax`. Local hide stays available. |
| C18 | Report reasons | 7 | 4 | 11 | 9: `spam, abuse, sexual, violence, privacy, scam, impersonation, child, other` |
| C19 | Auto‑hide | — | 3 reporters | child 1 / severe 2 / other 3 | `child` 1, other severe (`sexual, violence, privacy`) 2, anything else 3. Counted reporters only: account ≥ `SOCIAL_REPORTER_MIN_AGE_H` (24 h), and admins always count. |
| C20 | Group in profile | visibility all/friends/none | none | none/friends | Not in v1 |
| C21 | Privacy settings | group only | `contacts` | `show_links`, `searchable`, `friend_requests` + minor rules | `linksVisibility`, `searchable`, `friendRequests` + minor rules (D15) |
| C22 | Username charset | `[a-z0-9_]` | `[a-z0-9_.]` | `[a-z0-9_]` | `^(?!\d+$)[a-z0-9_]{3,20}$` |
| C23 | Username change and hold | ? | 7 d, freed at once | 30 d, hold 30 d | 30 d (free in the first 24 h); names held 30 d after a change or a deletion |
| C24 | Delete confirmation | type the username | `{confirm:true}` | checkbox | Checkbox + `{ "confirm": true }` |
| C25 | Public deletion entry | `?tab=profile&delete=1` | static page with its own sign‑in | `/?open=delete-account` before `initUni` | The static `/delete-account` page with its own sign‑in (`intent=delete`) **and** the in‑app deep link `/?tab=profile&delete=1` |
| C26 | Search transport | GET | GET | POST | `POST /api/social/users/search {q}` |
| C27 | Search scope | uni\|all | same‑uni first | — | No scope control; same university first |
| C28 | Google photo | not imported | ignored | optional import | Never used in v1 |
| C29 | Name prefill | given_name | name | name | `given_name` (else the first word of `name`) |
| C30 | Moderation actions | delete/restrict/dismiss | hide/unhide/delete/ban/unban/dismiss | + warn/mute/reset/rename | `dismiss, hide, unhide, delete, ban, unban, reset` via **one** endpoint `POST /api/social/admin/action` |
| C31 | Report retention | — | 180 d after resolution | 1 year | 180 d after resolution; a text snapshot is kept with the report |
| C32 | Tombstone copy | — | «Удалённое сообщение» | «Пост удалён» | `Пост удалён` (root) / `Ответ удалён` (reply) |
| C33 | Length unit | code points | graphemes | chars | Graphemes (`Intl.Segmenter`); the server is authoritative |
| C34 | Kill switch | `config.social` | `SOCIAL_MODE` env | per‑uni meta + admin API | `SOCIAL_MODE` env (global). `brand.social` gives the first paint; the per‑uni switch is P2. |
| C35 | Profanity mask | `б•••` | `п•••` | `б***` | First character + `•••` |
| C36 | Unread replies | P2 | — | — | Not in v1 |
| C37 | `ip_coarse` | — | — | stop storing | Stop storing + null the existing values |
| C38 | `trustProxy`, log serializer | — | recommended | required | Ship both |
| C39 | New‑account limits | — | lower caps | no photos, no links 24 h | No links for 24 h + lower caps; photos allowed |
| C40 | Hub static pages | `/delete-account` | + `/rules`, `/safety` | + `/rules#children`, robots | `/policy`, `/rules`, `/delete-account`, `/robots.txt` |
| C41 | UI kit owner | separate stream E2 | — | — | FE‑CORE (`web/src/ui/*`) |
| C42 | Google button label | «Войти через Google» | — | «Продолжить с Google» | `Продолжить с Google` (the Google‑localized "continue with" label) |
| C43 | Profile route for guests (backend G) | — | G | S | S |
| C44 | Reports on replies | separate target `reply` | `post` covers replies | `reply` | API target `post` covers replies; the client passes the reply id |
| C45 | Admin identity | `ADMIN_EMAILS`? | `SOCIAL_ADMIN_EMAILS` | `ADMIN_EMAILS` | `SOCIAL_ADMIN_EMAILS` (verified Google emails), computed per request, never stored |
| C46 | Contact email in public texts | — | — | owner's personal git email | Placeholder `[почта для связи]` until the owner decides (Q3); Telegram `@skycoax` meanwhile |
| C47 | Per‑tab stacks | each tab keeps its stack | — | — | Dropped (D29): leaving a tab unwinds its stack |
| C48 | Friend requests to minors | — | — | grooming risk named | Minors default to `friendRequests:'none'`; same‑uni‑only is an owner question (Q16) |
| C49 | Media HTTP cache | — | `immutable`, 1 year | — | `public, max-age=604800` (7 days); the policy says «до 7 дней» |

---

## B. REST API contract

### B.1 Transport conventions

- **Hosts.** Every `/api/auth/*`, `/api/social/*` and `/api/media/*` route exists **only** when `req.hub` is true, which means
  `para.skycoax.uz`, or (when `DEV_HUB=1` and not in production) `localhost`, any `*.localhost` host such as
  `chat.localhost`, or `127.0.0.1`. On any other host the answer is `404 {"ok":false,"error":"Нет такого адреса API","code":"not_found"}`.
  With `SOCIAL_MODE=off` only the deletion subset exists (§F.2): `GET /api/auth/me` (answers `mode:'off'`),
  `POST /api/auth/logout`, `DELETE /api/social/me`, and the OAuth start/callback for `intent=delete`; everything else is that
  404. Unknown paths under `/api/auth/` and `/api/social/` (any method) answer the same 404 JSON through catch‑all routes
  (§F.2). The client treats a 404 from `/api/auth/me` exactly like `mode:'off'` with no user.
- **University.** The client appends `uni=<brand.id>` to **every** social and auth request, the same way `web/src/api.ts` does.
  The server reads it through the existing `req.tenant` (`hubTenant`). Routes marked **U** need it.
- **Requests.** Use `credentials: 'same-origin'` and `cache: 'no-store'`. The social client never adds `cid` to a URL or
  body. The browser still attaches the `cid` cookie that `lib/store.ts` writes; the social server code never reads it (its
  cookie parser reads only the session and OAuth cookie names, §C.5) and never logs the `cookie` header.
- **Mutations** (POST, PUT, PATCH, DELETE):
  - always send the header `X-Para: 1`;
  - for JSON, always send `Content-Type: application/json` **and** a body, even if it is only `{}`;
  - for uploads, send `Content-Type: image/jpeg` with a raw body.

  The server also tolerates a bodiless request with `Content-Length: 0` (the smoke test uses it).
- **Server CSRF gate** (hook on mutating methods of every social route): `x-para === '1'`, and either the `Origin` is in the
  allow‑list (`https://<hub.hosts[i]>`, `PARA_ORIGIN`, and outside production any Origin matching
  `/^http:\/\/(?:[a-z0-9-]+\.)?localhost(:\d+)?$|^http:\/\/127\.0\.0\.1(:\d+)?$/`), or there is no `Origin` and
  `Sec-Fetch-Site` is absent, `same-origin` or `none`. Otherwise the answer is `403 csrf`. CORS is disabled for these paths, so
  a preflight gets no `Access-Control-Allow-Origin`.
- **Envelope.** Success is `{ "ok": true, "data": … }`. Failure is
  `{ "ok": false, "error": "<Russian text>", "code": "<ErrorCode>", "field"?: "<name>", "retryAfter"?: <seconds> }`.
  A 429 also sets `Retry-After`.
- **Headers on every social/auth JSON response:** `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- **Types.** User and post ids are JSON **numbers**. Media ids are 22‑character base64url strings. Cursors are opaque strings;
  `next: null` means there is no more. Times are ISO‑8601 UTC strings. All text lengths count **graphemes**.
- **Body limits.** JSON routes accept up to 16 384 bytes. `POST /api/social/media` accepts up to 921 600 bytes. `PUT …/thumb`
  accepts up to 153 600 bytes.
- **Profanity** is masked on output (`name`, `bio`, `text`) with the first character followed by `•••`. The stored text stays
  original. `rawText` exists only in admin payloads.

### B.2 Guards (checked in this order, then validation, then rate limit, then the transaction)

| Guard | Meaning | Failure |
|---|---|---|
| **G** | guest ok | — |
| **S** | valid session | `401 auth` «Войди через Google, чтобы продолжить» |
| **P** | profile complete (`username` set) **and** current rules accepted | `403 profile` «Сначала заполни профиль» / `403 rules` «Сначала прими правила обсуждений» |
| **N** | not banned | `403 banned` (text in §B.3) |
| **M** | `SOCIAL_MODE=on` (writes) | `403 readonly` «Обсуждения временно доступны только для чтения» |
| **A** | admin (verified email in `SOCIAL_ADMIN_EMAILS`) | `403 forbidden` «Недостаточно прав» |
| **U** | university selected (`req.tenant`) | `400 uni` «Сначала выбери вуз» |
| **N\*M\*** | N and M apply **unless** the request only reduces exposure (PATCH `/me`, §B.5 #17) | as N / M |

Routes **without M** keep working in `readonly`: logout (#4), own‑post delete (#10), media delete (#15), rules accept (#18),
account deletion (#19), friend decline/cancel/remove (#27, #28), block/unblock (#30, #31), report (#32), and the
privacy‑reducing PATCH `/me`. Reads always work.

### B.3 Error codes

| code | HTTP | Default `error` (exact) |
|---|---|---|
| `invalid` | 400 | «Неверный запрос», or a field message from §B.4 (then `field` is set) |
| `uni` | 400 | «Сначала выбери вуз» |
| `auth` | 401 | «Войди через Google, чтобы продолжить» |
| `profile` | 403 | «Сначала заполни профиль» |
| `rules` | 403 | «Сначала прими правила обсуждений» |
| `banned` | 403 | `banText(ban) + ' Читать можно.'`, i.e. temporary: «Публикация ограничена до {D MMMM}. Причина: {reason}. Читать можно.» · permanent: «Публикация ограничена навсегда. Причина: {reason}. Читать можно.» (`{D MMMM}` in `Asia/Tashkent`, e.g. «3 октября»). This is the **only** ban phrasing; the client builds the same `banText` in `format.ts` (§E.2). |
| `readonly` | 403 | «Обсуждения временно доступны только для чтения» |
| `forbidden` | 403 | «Недостаточно прав» |
| `csrf` | 403 | «Запрос отклонён — обнови страницу и попробуй ещё раз» |
| `blocked` | 403 | «Нельзя ответить на эту публикацию» / «Нельзя добавить этого пользователя» / «Этот человек не принимает заявки в друзья» |
| `not_found` | 404 | «Публикация удалена или скрыта» / «Профиль не найден» / «Фото не найдено» / «Заявка не найдена» / «Нет такого адреса API» |
| `conflict` | 409 | «Это имя уже занято» |
| `too_large` | 413 | media routes (#13, #14): «Фото больше 900 КБ — уменьши его»; JSON routes: «Слишком большой запрос» (the error handler branches on `req.routeOptions.url`) |
| `media_type` | 415 | «Нужна фотография в формате JPEG» |
| `rate` | 429 | under 60 s: «Слишком часто — подожди немного»; otherwise «Слишком часто — попробуй через {N} мин.»; special caps use their own text (§C.6) |
| `server` | 500 | «Ошибка сервера — попробуй чуть позже» |
| `disk` | 507 | «Сейчас нельзя загрузить фото — попробуй позже» |
| `network` | — | client‑only: «Нет интернета» (when `!navigator.onLine`) or «Сервер не отвечает — попробуй чуть позже» |

Client mapping rules (FE‑CORE `api.ts`):
- A non‑JSON response with status 413 (nginx HTML) maps to `too_large` with the media text above.
- Any other non‑JSON response maps to `server`.
- For `GET /api/auth/me` only: a 5xx or a non‑JSON answer is treated like a network error (§E.2 session step 2), not as
  `server`.

### B.4 Validation messages (exact, `400 invalid` + `field`)

| field | Rule | Message |
|---|---|---|
| `username` | lowercase, `^[a-z0-9_]{3,20}$` | «Имя пользователя — от 3 до 20 символов: латинские буквы, цифры и знак подчёркивания» |
| `username` | not all digits | «Имя пользователя не может состоять только из цифр» |
| `username` | reserved (§C.3) or a profane token | «Это имя зарезервировано — выбери другое» |
| `username` | taken or held by someone else | `409 conflict` «Это имя уже занято» |
| `username` | changed less than 30 days ago (and the account is older than 24 h) | «Имя пользователя можно менять раз в 30 дней» |
| `name` | `cleanText(single line)`, 1–40 graphemes, contains `\p{L}` or `\p{N}` | «Имя — от 1 до 40 символов» |
| `name` | impersonation words (§C.3) or profane | «Такое имя использовать нельзя» |
| `bio` | `cleanText(maxLines 4)`, ≤ 160 | «О себе — не больше 160 символов» |
| `tg` | accepts `name`, `@name`, `t.me/name`, `https://t.me/name`; result `^[a-z][a-z0-9_]{4,31}$`; `''` clears | «Telegram: укажи имя пользователя, например @username» |
| `ig` | accepts `name`, `@name`, `instagram.com/name`, `https://www.instagram.com/name/`; result `^[a-z0-9._]{1,30}$`, no leading or trailing `.`, no `..`; `''` clears | «Instagram: укажи имя пользователя, например @username» |
| `linksVisibility` | `'signed'` only for `adult` | «До 18 лет контакты видят только друзья» |
| `age` | only `'adult'`, only from `minor` | «Неверный запрос» |
| `uni` | enabled tenant id, or `''` to clear | «Такого вуза нет в Para» |
| `avatar` | own `kind='avatar'` media, not attached, or `null` | «Фото профиля не найдено — загрузи его ещё раз» |
| thumb (#14) | aspect ratio within 2 % of the full image, and long side = `min(640, full long side)` ± 2 px (avatar: square, side `min(128, full side)` ± 2 px) | «Миниатюра не совпадает с фото — загрузи фото ещё раз» |
| avatar full (#13a) | square: `|w − h| <= 2` | «Фото профиля должно быть квадратным» |
| `version` (rules) | equals current | «Правила обновились — прими новую версию» |
| `text` | ≤ 1000 graphemes (and ≤ 4000 UTF‑16 units), ≤ 30 lines | «Слишком длинный текст — максимум 1000 символов» |
| `text` | text or ≥ 1 photo | «Напиши текст или добавь фото» |
| `text` | ≤ 3 links (`/\bhttps?:\/\/|\bwww\.|\bt\.me\//gi`) | «Не больше 3 ссылок в одном сообщении» |
| `text` | no links if the account is younger than 24 h | «Ссылки можно добавлять через сутки после регистрации» |
| `text` | same cleaned text by the same author within 10 min | «Такое сообщение уже отправлено» |
| `category` | one of the 6 ids, roots only | «Выбери тему» |
| `media` | root: ≤ 4 distinct ids `^[A-Za-z0-9_-]{22}$` | «Можно прикрепить не больше 4 фото» |
| `media` | reply: ≤ 1 | «К ответу можно прикрепить одно фото» |
| `media` | `company` root or a reply under it: must be empty | «В теме «Компания» — только текст» |
| `media` | attach failed (not own / already attached / expired) | «Фото не найдено — загрузи его ещё раз» |
| `replyTo` | a live reply in the same thread or the root id | «Неверный запрос» |
| thread | live replies ≥ 1000 | «В этой ветке уже слишком много ответов» |
| `reason` | one of the 9 | «Выбери причину жалобы» |
| `note` | ≤ 300; required (≥ 1) when `reason='other'` | «Комментарий к жалобе — не больше 300 символов» / «Опиши, что случилось» |
| report | own post or self | «Нельзя пожаловаться на себя» |
| friend | self | «Нельзя добавить в друзья себя» |
| block | self | «Нельзя заблокировать себя» |
| `confirm` | `true` | «Подтверди удаление аккаунта» |
| `q` | 2–32 graphemes after trimming and removing a leading `@` | «Введи хотя бы 2 символа» |
| `reason` (ban) | 1–200 | «Укажи причину» |
| JPEG | sanitizer messages (backend.md §5.2), e.g. «Это не JPEG», «Файл обрезан — загрузи фото ещё раз», «Фото больше 2048 точек по стороне — уменьши его» | as thrown |

### B.5 Endpoints

Legend: `→` is the `data` of a successful response. Status 200 unless shown.

#### Auth

| # | Method and path | Guards | Request | Response |
|---|---|---|---|---|
| 1 | `GET /api/auth/me` | G | — | `AuthState` |
| 2 | `GET /api/auth/google/start?return=&intent=&age=&accept=&uni=` | G | top‑level navigation | `302` (below) |
| 3 | `GET /api/auth/google/callback?code&state` or `?error&state` | G | navigation from Google | `302` to `ORIGIN + return + '#auth=<AuthOutcome>'` |
| 4 | `POST /api/auth/logout` | S‑idempotent | `{}` or `{ "all": true }` | `null`; clears the cookie; `200` even without a session |
| 5 | `POST /api/auth/dev` | dev only (§F.4) | `{ "name": "alice", "age"?: "minor"\|"adult", "intent"?: "signin"\|"delete" }` | `Me`; sets the session cookie. `google_sub = 'dev:' + name`, `email = name + '@dev.local'`, so the same name always returns the same user. With `intent:'signin'` (default) it records `rules_version`/`policy_version` = current, like an accepted sign‑in. With `intent:'delete'` it records nothing, and with no such user it answers `404 not_found` «Аккаунта Para с этим Google нет — удалять нечего» and creates nothing (same `findOrCreateUser()` as the callback). |

**#1 `GET /api/auth/me`.** It slides the session (§C.5) and clears an invalid cookie. `mode` is `'on' | 'readonly' | 'off'`
(in `off` the route still exists so that a signed‑in user can reach deletion). Example for a guest:
```json
{ "ok": true, "data": { "user": null, "google": false, "dev": false, "mode": "on",
  "config": { "rulesVersion": 1, "minAge": 16, "limits": {
    "text": 1000, "lines": 30, "links": 3, "media": 4, "replyMedia": 1,
    "mediaBytes": 921600, "thumbBytes": 153600, "mediaSide": 2048, "thumbSide": 640, "avatarSide": 1024,
    "name": 40, "bio": 160, "usernameMin": 3, "usernameMax": 20, "note": 300 } } } }
```

**#2 start.** Always `302`, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer` (nginx may append its global
`strict-origin-when-cross-origin`, which then wins; that leaks only our origin to Google and is accepted).
- `back = safeReturn(return)` (backend.md §3.2). The fragment is dropped, and `/api/*` becomes `/`.
- `intent` is `signin` (default) or `delete`. `age` is `minor` or `adult`, and is required for `signin`. `accept=1` is required
  for `signin`. For `delete`, `age` and `accept` are ignored (stored as `NULL` / `0`).

Outcomes, checked in order:
1. Google is not configured, or `mode=off` and `intent=signin` → `ORIGIN+back+'#auth=unavailable'`.
2. The rate limit is hit → `#auth=limited`.
3. `intent=signin` without a valid `age` or without `accept=1` → `#auth=consent`.
4. Otherwise:
   - insert `oauth_states` (§C.2);
   - set the cookie `__Host-para_oauth` (dev: `para_oauth`) with `HttpOnly; Secure(prod); SameSite=Lax; Path=/; Max-Age=600`;
   - `302` to `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`,
     `redirect_uri=ORIGIN/api/auth/google/callback`, `response_type=code`, `scope=openid email profile`, `state`, `nonce`,
     `code_challenge` (S256), `code_challenge_method=S256`, `prompt=select_account`, `access_type=online`, `hl=ru`.

**#3 callback outcomes, in order.** Every exit is a `302` and clears the oauth cookie.
1. `unavailable` (Google not configured, or `mode=off` and the state's `intent` is `signin`).
2. `limited`.
3. The state is malformed, unknown, or older than 10 min (single use: `DELETE … RETURNING`) → `expired`, and `return` = `/`.
4. `error=access_denied` → `cancelled`; any other `error` → `failed`.
5. The binding cookie hash does not match → `browser`.
6. The token exchange or the id_token claims fail (backend.md §3.3–3.4; `access_token` is discarded) → `failed`.
7. `email_verified !== true` → `unverified`.
8. Look up the user by `google_sub` (never by email):
   - **not found and `intent=delete`** → `none`, and **no account is created**;
   - **not found and `intent=signin`** → create the user:
     - `username` NULL; `name` = cleaned `given_name`, else the first word of `name`;
     - `email`, `email_verified=1`;
     - `uni` = the state's `uni` if it is an enabled tenant;
     - `age_group` from the state;
     - `searchable` = 1 for `adult`, 0 for `minor`; `friend_req` = `'all'` for `adult`, `'none'` for `minor`;
     - `rules_version`/`policy_version` = current, `rules_at` = now (the start already required `accept=1` for `signin`);
     - if `ban_marks` holds `sha256(SOCIAL_SALT|sub)` with an active ban, the new row gets `status='banned'` with the stored
       `until`/`reason`;
   - **found** → refresh `email`/`email_verified`. **Only if** the state's `intent === 'signin' && accepted === 1`, set
     `rules_version`/`policy_version` to current and `rules_at` to now. A `delete` sign‑in never touches consent.
9. Delete any session the request already carries. Create a new session (§C.5) and keep at most 20 sessions per user.
10. `audit('auth.login')`, then `302` to `ORIGIN + return_to + '#auth=ok'`.

Returning users with `intent=delete` just sign in (`ok`). The deletion page then shows its delete button. `claimsFrom()`
(backend.md §3.4) is extended to also return `given_name` (C29).

`AuthOutcome` → client text. This is the only list. `session.handleAuthOutcome` and `delete-account.html` both use it:

| outcome | In‑app toast («ты») | `/delete-account` page text («вы») |
|---|---|---|
| `ok` | «Вход выполнен» | — (shows the delete block) |
| `cancelled` | «Вход отменён» | «Вход отменён.» |
| `expired` | «Время на вход истекло — попробуй ещё раз» | «Время на вход истекло — попробуйте ещё раз.» |
| `failed` | «Не получилось войти через Google — попробуй ещё раз» | «Не получилось войти через Google — попробуйте ещё раз.» |
| `browser` | «Вход не завершился: браузер не сохранил данные входа. Открой Para в Chrome или Safari и попробуй ещё раз» | «Вход не завершился: браузер не сохранил данные входа. Откройте страницу в Chrome или Safari.» |
| `limited` | «Слишком много попыток входа — попробуй позже» | «Слишком много попыток входа — попробуйте позже.» |
| `unavailable` | «Вход через Google пока недоступен» | «Вход через Google пока недоступен.» |
| `unverified` | «В этом аккаунте Google не подтверждена почта» | «В этом аккаунте Google не подтверждена почта.» |
| `consent` | (no toast) opens `SignInSheet` again | «Не получилось войти через Google — попробуйте ещё раз.» |
| `none` | «Аккаунта Para с этим Google нет — удалять нечего» | «Аккаунта Para с этим Google нет — удалять нечего.» |

#### Feed, threads, posts

| # | Method and path | Guards | Request | Response |
|---|---|---|---|---|
| 6 | `GET /api/social/feed?category=&cursor=&limit=` | G, U | `limit` 1–50, default 20 | `Page<Post>` (roots, newest first) |
| 7 | `GET /api/social/posts/:id?cursor=` | G | `:id` is a root or a reply | `Thread` (replies oldest first, 50 per page) |
| 8 | `POST /api/social/posts` | S P N M U | `NewPost` | `201 Post` |
| 9 | `POST /api/social/posts/:id/replies` | S P N M | `NewReply` (`:id` must be a root) | `201 Post` (a reply) |
| 10 | `DELETE /api/social/posts/:id` | S (own, even when banned) or A | `{}` | `null` |
| 11 | `PUT /api/social/posts/:id/like` | S P N M | `{}` | `LikeState` (idempotent) |
| 12 | `DELETE /api/social/posts/:id/like` | S P N M | `{}` | `LikeState` (idempotent) |

Visibility rules. Apply them in SQL, never by hiding things on the client (viewer id 0 = guest):
- **V1.** A post or reply whose author is banned is invisible to others. Its author and admins still see it.
- **V2.** `hidden=1` is invisible to others. The author gets `hidden:true`; admins see it too.
- **V3.** A block in either direction between the viewer and the author makes the author's posts and replies invisible to the
  viewer. This does not apply to admins.
- **V4.** The feed and profile lists show only live, visible roots.
- **V5.** A thread with a tombstoned root is still returned: `deleted:true, text:'', author:null, media:[]`, plus its live
  replies.
- **V6.** A tombstoned reply (one kept because live replies point to it) comes back as `deleted:true, text:'', author:null`.
- **V7.** For a guest viewer (no session) every `UserCard` inside a `Post` (`author`) has `uni: null, uniShort: null`. `Post.uni`
  and `Post.uniShort` (where the post was written) stay filled.

`reply_count` / `Post.replies` counts **live replies as stored** (not deleted), including hidden ones and replies the viewer
cannot see because of bans or blocks. It is a label, not the length of the list; the UI never uses it for pagination.

`#7` returns `404 not_found` «Публикация удалена или скрыта» when:
- the id is unknown or hard‑deleted;
- the root is hidden (for anyone except its author and admins);
- the root's author is banned (for anyone except that author and admins);
- the viewer and the root's author block each other in either direction (except admins).

When `:id` is a reply, the root thread is returned with `focus: <id>`.

`#8` checks, in order:
1. validation (§B.4);
2. bucket, then the daily cap;
3. the duplicate check;
4. one transaction: insert the post with `uni = req.tenant.id`, then attach each media with
   `UPDATE media SET post_id=?, position=?, attached_at=? WHERE id=? AND owner_id=? AND kind='post' AND post_id IS NULL`.
   Any `changes !== 1` rolls back with the field error.

`#9`:
- The root must be live and visible to the caller, and not hidden (except for its author and admins).
- A block in either direction with the root author or with the `replyTo` author → `403 blocked` «Нельзя ответить на эту
  публикацию».
- `replyTo = root id` is normalized to `parent_id = NULL`.
- On success: `reply_count += 1` and `last_reply_at = now` on the root.

`#10` follows §C.4. It returns `404` if the post is already deleted or unknown, and `403 forbidden` if the caller is neither the
author nor an admin. An admin delete also marks the open reports on that post `actioned` and writes the `post.delete` audit
entry.

#### Media

| # | Method and path | Guards | Request | Response |
|---|---|---|---|---|
| 13 | `POST /api/social/media?kind=post` | S P N M | raw `image/jpeg`, ≤ 921 600 B, ≤ 2048 px | `201 UploadedMedia` (`thumb` = `url` until #14) |
| 13a | `POST /api/social/media?kind=avatar` | S N M | raw `image/jpeg`, ≤ 921 600 B, ≤ 1024 px, square (± 2 px) | `201 UploadedMedia` |
| 14 | `PUT /api/social/media/:id/thumb` | S N M, owner | raw `image/jpeg`, ≤ 153 600 B, ≤ 640 px; only while unattached and not anyone's current avatar; **dimensions must match the full image** (§B.4 thumb rule: aspect within 2 %, long side `min(640, full)` ± 2 px; avatar: square, side `min(128, full)` ± 2 px) → else `400 invalid` «Миниатюра не совпадает с фото — загрузи фото ещё раз» | `MediaRef` with `thumb: '/api/media/<id>_t.jpg'` |
| 15 | `DELETE /api/social/media/:id` | S, owner | `{}`; only while unattached and not the current avatar | `null`; otherwise `404` «Фото не найдено» |
| 16 | `GET /api/media/:file` | G | `:file` matches `^([A-Za-z0-9_-]{22})(_t)?\.jpg$` (anything else → 404 without touching the disk) | JPEG bytes |

For #13 and #14:
- `sanitizeJpeg()` (backend.md §5.2) runs **before** anything is written.
- Write to a `.tmp-<id>` file, then `rename` it.
- `kind=post` allows at most 12 unattached photos per user; above that → `429 rate` «Слишком много неотправленных фото —
  отправь или удали их».
- The free‑space guard answers `507 disk`.

For #16:
- The visibility matrix of backend.md §5.4 applies to both `<id>.jpg` and `<id>_t.jpg`. A missing thumb file → 404.
- Headers:
  - `Content-Type: image/jpeg`
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: default-src 'none'; sandbox`
  - `Cross-Origin-Resource-Policy: same-origin`
  - `X-Robots-Tag: noindex`
  - `Cache-Control: public, max-age=604800` when public (7 days, so removed photos leave viewers' caches within a week),
    otherwise `private, no-store`.
- `GET /api/media/*` is in **no** rate bucket: the names are unguessable and the files immutable.

#### Me

| # | Method and path | Guards | Request | Response |
|---|---|---|---|---|
| 17 | `PATCH /api/social/me` | S N\*M\* | `MePatch` (any subset) | `Me` |
| 18 | `POST /api/social/me/rules` | S | `{ "version": <config.rulesVersion> }` | `Me` |
| 19 | `DELETE /api/social/me` | S (banned ok; every `SOCIAL_MODE`, `off` included) | `{ "confirm": true }` | `null`; clears the session cookie |
| 20 | `GET /api/social/username?u=` | S | — | `UsernameCheck` |

`#17` rules:
- **Guards N and M are skipped** when every key in the body is in the privacy‑reducing set: `linksVisibility:'friends'`,
  `searchable:false`, `friendRequests:'none'`, `avatar:null`, `bio:''`, `tg:''`, `ig:''`, `uni:''`. Any other key or value
  applies N and M as usual. So banned users and `readonly` mode can always hide themselves.
- **Onboarding** (current `username` is NULL): `username` and `name` are both required.
- **Username change:** allowed when `username_at` is NULL or older than 30 days, **or** the account is younger than 24 h. The
  old name goes into `held_usernames` for 30 days. It writes the `profile.username` audit entry.
- **avatar:** the id of an own, unattached `kind='avatar'` media, or `null` to remove it. The previous avatar row and its files
  are deleted after commit.
- **age:** only `'adult'`, and only when the current value is `minor`. It is one‑way.
- **linksVisibility `signed`:** allowed only for adults.
- Profile fields go through `cleanText`. Stored values are unmasked.

`#20` returns `{ available: true }` for the caller's current username. It returns `available:false` + `error` when the name is
invalid, reserved, taken, held by someone else, or when a change is not allowed yet («Имя пользователя можно менять раз в 30
дней»).

#### People, friends, blocks, reports

| # | Method and path | Guards | Request | Response |
|---|---|---|---|---|
| 21 | `POST /api/social/users/search` | S | `{ "q": "алис" }` | `{ items: UserCard[] }` (≤ 20) |
| 22 | `GET /api/social/users/:username` | S | case‑insensitive | `ProfilePage` (first 10 roots from all universities, newest first) |
| 23 | `GET /api/social/users/:username/posts?cursor=` | S | — | `Page<Post>` |
| 24 | `GET /api/social/friends` | S | — | `FriendLists` (each ≤ 200, newest first; blocked and banned excluded) |
| 25 | `POST /api/social/friends/:userId` | S P N M | `{}` | `{ relation: 'outgoing' \| 'friends' }` (becomes `friends` if they had already asked; idempotent) |
| 26 | `POST /api/social/friends/:userId/accept` | S P N M | `{}` | `{ relation: 'friends' }`; if nothing is pending from them → `404` «Заявка не найдена» |
| 27 | `POST /api/social/friends/:userId/decline` | S | `{}` | `{ relation: 'none' }` (idempotent) |
| 28 | `DELETE /api/social/friends/:userId` | S | `{}` | `{ relation: 'none' }` (unfriend or cancel your own request) |
| 29 | `GET /api/social/blocks` | S | — | `{ items: UserCard[] }` |
| 30 | `PUT /api/social/blocks/:userId` | S | `{}` | `{ relation: 'blocked' }`; deletes friendship and requests in both directions; ≤ 1000 blocks |
| 31 | `DELETE /api/social/blocks/:userId` | S | `{}` | `{ relation: 'none' }` |
| 32 | `POST /api/social/reports` | S (banned ok, readonly ok) | `ReportBody` | `ReportResult` (idempotent per reporter and target) |

`:userId` must match `^\d{1,12}$`.

`#21` search:
- **Matches:** `username LIKE q%` or `name_fold LIKE %fold(q)%`, with `ESCAPE '\'`.
- **Excludes:** self, users not onboarded, banned users, blocks in either direction, and `searchable=0` users unless
  `username = q` exactly.
- **Order:** same `uni` as `req.tenant` first, then username‑prefix matches, then newest.
- The query is never logged or stored.

`#22`:
- `404` «Профиль не найден» when the user is not found, not onboarded, banned (for a non‑admin viewer), or **has blocked the
  viewer**.
- If the **viewer blocked them**: `relation:'blocked'`, `bio:''`, `links:null`, `linksHidden:null`, `posts:[]`, `next:null`.
- `links` is visible to self and friends, or to any signed‑in viewer when `links_vis='signed'`. Otherwise `links:null` and
  `linksHidden:'friends'`.
- `canFriend` = `relation==='none' && target.friend_req==='all'`.
- Self sees their own hidden posts (`hidden:true`).
- `banned` is the target's `Ban` (or `null`) **only when the viewer is an admin**; for everyone else it is always `null`.

`#25` errors:
- self → `400`;
- a block in either direction, or a target that is not onboarded → `403 blocked` «Нельзя добавить этого пользователя»;
- target `friend_req='none'` → `403 blocked` «Этот человек не принимает заявки в друзья»;
- 50 or more pending outgoing requests → `429 rate` «Слишком много заявок — дождись ответов».

`#32` accepts `target:'post'` for both roots and replies. The report stores a `snapshot` (§C.2, with media ids and `rootId`)
and runs auto‑hide (§C.4).

#### Admin (all **S A**, prefix `/api/social/admin/`)

| # | Method and path | Request | Response |
|---|---|---|---|
| 33 | `GET /api/social/admin/reports?status=open\|closed&cursor=` | — | `Page<ReportCase>` (30 per page) |
| 34 | `POST /api/social/admin/action` | `AdminActionBody` | `null` |
| 35 | `GET /api/social/admin/stats` | — | `AdminStats` |
| 36 | `GET /api/social/admin/audit?cursor=` | — | `Page<AuditItem>` (50 per page) |

`#33` grouping and order:
- One case per `target_key`.
- `user` is filled for **both** target types: for a user target it is that user; for a post target it is the post's author
  (`null` if the author's account is deleted). So the UI can show `Снять ограничение` on any case whose `user.status` is
  `banned`.
- `post.media` and `snapshot.media` carry both `thumb` and `url` for every photo; admins can load hidden media (backend.md
  §5.4).
- `open` = the case has at least one open report. Order: `severe` first, then counted reporters descending, then `lastAt`
  descending.
- `closed` = no open reports. Order: `resolvedAt` descending.

`#34` actions:

| action | target | Effect |
|---|---|---|
| `dismiss` | post or user | Open reports → `dismissed`. If the post is hidden with `hidden_reason='reports'`, unhide it and set `report_count=0`. Audit `report.dismiss`. |
| `hide` | post | `hidden=1`, `hidden_reason='admin'`. Open reports → `actioned`. Audit `post.hide.admin`. |
| `unhide` | post | `hidden=0`. Open reports → `dismissed`. Audit `post.unhide`. |
| `delete` | post | Admin delete (§C.4). Open reports → `actioned`. Audit `post.delete`. |
| `ban` | user, or a post (bans its author) | `days`: `1\|7\|30\|null` (null = permanent). `reason` is required. `hidePosts?`: hides all of their posts with reason `admin`. Open reports on the user and on the post → `actioned`. Sessions are kept. You cannot ban an admin (`403 forbidden`). Audit `user.ban`. |
| `unban` | user, or a post (its author) | Clears the ban. Audit `user.unban`. |
| `reset` | user, or a post (its author) | `fields` ⊆ `avatar\|bio\|links\|name`. `name` → «Пользователь», `avatar` → removed (the files are deleted), `bio` → `''`, `links` → `tg=ig=''`. Open user reports → `actioned`. Audit `user.reset`. |

### B.6 `web/src/social/types.ts` (exact file content, owned by FE‑CORE)

```ts
// Обсуждения Para: формы данных API (/api/auth/*, /api/social/*, /api/media/*).
// Зеркало server/src/social/*. Меняется только вместе с CONTRACT.md (раздел B).

export type SocialMode = 'on' | 'readonly' | 'off';
export type AgeGroup = 'minor' | 'adult';
export type CategoryId = 'study' | 'schedule' | 'events' | 'company' | 'lost' | 'other';
export type ReportReason =
  | 'spam' | 'abuse' | 'sexual' | 'violence' | 'privacy' | 'scam' | 'impersonation' | 'child' | 'other';
export type Relation = 'self' | 'none' | 'outgoing' | 'incoming' | 'friends' | 'blocked';
export type LinksVisibility = 'friends' | 'signed';
export type FriendRequests = 'all' | 'none';
export type AuthIntent = 'signin' | 'delete';
export type AuthOutcome =
  | 'ok' | 'cancelled' | 'expired' | 'failed' | 'browser' | 'limited' | 'unavailable' | 'unverified' | 'consent' | 'none';
export type AuthReason =
  | 'post' | 'reply' | 'like' | 'friend' | 'block' | 'report' | 'profile' | 'search' | 'account' | 'delete' | 'expired';
export type ErrorCode =
  | 'invalid' | 'uni' | 'auth' | 'profile' | 'rules' | 'banned' | 'readonly' | 'forbidden' | 'csrf' | 'blocked'
  | 'not_found' | 'conflict' | 'too_large' | 'media_type' | 'rate' | 'server' | 'disk' | 'network';

export interface Category { id: CategoryId; label: string; hint: string; photos: boolean }
/** Порядок показа. Сервер принимает ровно эти id. */
export const CATEGORIES: readonly Category[] = [
  { id: 'study', label: 'Учёба', hint: 'Вопросы по предметам, конспекты, помощь с заданиями', photos: true },
  { id: 'schedule', label: 'Расписание', hint: 'Замены, аудитории, переносы пар', photos: true },
  { id: 'events', label: 'События', hint: 'Мероприятия, кружки, спорт и жизнь вуза', photos: true },
  { id: 'company', label: 'Компания', hint: 'Найти, с кем учиться, заниматься спортом или ходить на мероприятия', photos: false },
  { id: 'lost', label: 'Потеряшки', hint: 'Потерянные и найденные вещи — напиши, где и когда', photos: true },
  { id: 'other', label: 'Разное', hint: 'Всё остальное, что не нарушает правила', photos: true },
];
export const categoryOf = (id: string | null | undefined): Category | null =>
  CATEGORIES.find((c) => c.id === id) || null;

export interface ReasonDef { id: ReportReason; label: string; severe: boolean }
export const REPORT_REASONS: readonly ReasonDef[] = [
  { id: 'spam', label: 'Спам или реклама', severe: false },
  { id: 'abuse', label: 'Оскорбления или травля', severe: false },
  { id: 'sexual', label: '18+ или откровенное', severe: true },
  { id: 'violence', label: 'Насилие, угрозы или жестокость', severe: true },
  { id: 'privacy', label: 'Чужие фото или личные данные', severe: true },
  { id: 'scam', label: 'Мошенничество или продажа работ', severe: false },
  { id: 'impersonation', label: 'Выдаёт себя за другого', severe: false },
  { id: 'child', label: 'Угроза ребёнку', severe: true },
  { id: 'other', label: 'Другое', severe: false },
];

export interface Limits {
  text: number; lines: number; links: number; media: number; replyMedia: number;
  mediaBytes: number; thumbBytes: number; mediaSide: number; thumbSide: number; avatarSide: number;
  name: number; bio: number; usernameMin: number; usernameMax: number; note: number;
}
export interface SocialConfig { rulesVersion: number; minAge: number; limits: Limits }
/** GET /api/auth/me. В режиме 'off' маршрут остаётся (ради удаления аккаунта); 404 клиент понимает так же, как 'off' без аккаунта. */
export interface AuthState { user: Me | null; google: boolean; dev: boolean; mode: SocialMode; config: SocialConfig }

export interface MediaRef { id: string; url: string; thumb: string; w: number; h: number }
export interface UploadedMedia extends MediaRef { bytes: number }

export interface Links { tg: string; ig: string }
export interface Ban { until: string | null; reason: string }

/** Автор в ленте, строка в поиске и в списках. Только люди с заполненным профилем. */
export interface UserCard {
  id: number;
  username: string;
  name: string;
  avatar: string | null;        // миниатюра 128 (или полное фото, если миниатюры нет)
  uni: string | null;           // «мой вуз», id. Гостю (в Post.author) всегда null; в ленте не показывается
  uniShort: string | null;      // 'ТГЭУ · Ташкент'. Гостю всегда null
  team: boolean;                // модератор Para → значок «Команда Para»
}

export interface UserProfile extends UserCard {
  avatarFull: string | null;    // 512
  bio: string;
  links: Links | null;          // null — скрыты от этого зрителя
  linksHidden: 'friends' | null;
  counts: { friends: number; posts: number };
  since: string;                // 'YYYY-MM'
  relation: Relation;
  canFriend: boolean;
  banned: Ban | null;           // только для модераторов; остальным всегда null
}

export interface Me {
  id: number;
  username: string | null;      // null → нужен SetupSheet
  name: string;
  avatar: string | null;
  avatarFull: string | null;
  bio: string;
  links: Links;
  uni: string | null;
  uniShort: string | null;
  team: boolean;
  isAdmin: boolean;
  email: string;                // только своё и замаскированное: 'a•••@gmail.com'
  age: AgeGroup;
  privacy: { links: LinksVisibility; searchable: boolean; friendRequests: FriendRequests };
  needsProfile: boolean;        // username === null
  suggestedUsername: string | null;  // только пока needsProfile
  rulesAccepted: boolean;       // rules_version === config.rulesVersion
  banned: Ban | null;
  requestsIn: number;           // входящие заявки в друзья
  modQueue: number;             // открытые жалобы (только у модераторов, иначе 0)
  counts: { friends: number; posts: number };
  usernameNextChange: string | null; // когда снова можно сменить @имя; null — можно сейчас
  createdAt: string;
}

/** Публикация и ответ — одна форма (одна таблица на сервере). */
export interface Post {
  id: number;
  uni: string;
  uniShort: string | null;
  rootId: number | null;        // null — публикация, иначе ответ в её ветке
  category: CategoryId | null;  // только у публикаций
  replyTo: { id: number; username: string | null } | null; // username null → «в ответ на удалённое сообщение»
  author: UserCard | null;      // null у удалённых
  text: string;                 // мат замаскирован
  media: MediaRef[];
  likes: number;
  liked: boolean;
  replies: number;              // живые ответы (у публикаций)
  createdAt: string;
  deleted: boolean;             // «Пост удалён» / «Ответ удалён»
  hidden: boolean;              // true видят только автор и модераторы
  mine: boolean;
  canDelete: boolean;
  reported: boolean;            // я уже жаловался
}
export type Reply = Post;

export interface Page<T> { items: T[]; next: string | null }
export interface Thread { post: Post; replies: Post[]; next: string | null; focus: number | null }
export interface ProfilePage { user: UserProfile; posts: Post[]; next: string | null }
export interface FriendRow extends UserCard { since: string }
export interface FriendLists { friends: FriendRow[]; incoming: FriendRow[]; outgoing: FriendRow[] }
export interface LikeState { liked: boolean; likes: number }
export interface UsernameCheck { available: boolean; error?: string }
export interface ReportResult { reported: true; hidden: boolean }

export interface NewPost { text: string; category: CategoryId; media: string[] }
export interface NewReply { text: string; media: string[]; replyTo?: number }
export interface MePatch {
  username?: string; name?: string; bio?: string; tg?: string; ig?: string;
  linksVisibility?: LinksVisibility; searchable?: boolean; friendRequests?: FriendRequests;
  avatar?: string | null; uni?: string /* '' — не показывать */; age?: 'adult';
}
export interface ReportBody { target: 'post' | 'user'; id: number; reason: ReportReason; note?: string }

export type ReportTarget = { type: 'post'; id: number } | { type: 'user'; id: number };
export type AdminAction = 'dismiss' | 'hide' | 'unhide' | 'delete' | 'ban' | 'unban' | 'reset';
export type ResetField = 'avatar' | 'bio' | 'links' | 'name';
export interface AdminActionBody {
  action: AdminAction;
  target: ReportTarget;
  days?: 1 | 7 | 30 | null;
  reason?: string;
  hidePosts?: boolean;
  fields?: ResetField[];
}
/** Снимок цели на момент первой жалобы. */
export interface ReportSnapshot {
  kind: 'post' | 'reply' | 'user';
  rootId: number | null;        // у ответа — id публикации, иначе null
  text: string;                 // пост/ответ — исходный текст; профиль — «О себе»
  name: string | null;          // профиль — имя
  username: string | null;
  media: MediaRef[];            // фото из снимка, которые ещё лежат на сервере (у профиля — аватар)
  mediaCount: number;           // сколько фото было на момент жалобы
  at: string;
}
export interface ReportCase {
  key: string;                                  // 'p:812' | 'u:7'
  target: ReportTarget;
  status: 'open' | 'dismissed' | 'actioned';
  post: (Post & { rawText: string }) | null;    // сейчас; null — удалён совсем или цель — человек
  snapshot: ReportSnapshot | null;
  /** Цель‑человек, а у цели‑поста — его автор (null — аккаунт удалён). */
  user: (UserCard & {
    bio: string; links: Links; avatarFull: string | null;
    status: 'active' | 'banned'; banned: Ban | null; createdAt: string; openReports: number;
  }) | null;
  reasons: Partial<Record<ReportReason, number>>;
  notes: string[];                              // до 10 последних комментариев
  reporters: number;
  severe: boolean;
  hidden: boolean;
  firstAt: string;
  lastAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;                    // '@username' модератора
}
export interface AdminStats {
  users: number; usersToday: number; postsToday: number; repliesToday: number;
  openReports: number; hiddenPosts: number; bannedUsers: number; mediaBytes: number;
}
export interface AuditItem {
  id: number; ts: string; actor: { id: number; username: string | null } | null;
  action: string; target: string | null; uni: string | null; info: Record<string, unknown>;
}
```

---

## C. Database (owned by BE)

One global file, `<DATA_DIR>/social.db`. It sits next to the per‑tenant `<id>.db` files. `deploy.sh` never touches `data/`.
Photos live in `<MEDIA_DIR>` (default `<DATA_DIR>/media`) as `<id>.jpg` and `<id>_t.jpg`.

### C.1 Opening

`server/src/social/db.js`:
- `openSocialDb()` runs `mkdirSync(dataDir)` and opens the file with `new DatabaseSync(path)`.
- PRAGMAs: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
- Migrations: `PRAGMA user_version` 0 → 1 applies `SCHEMA_V1` inside `BEGIN IMMEDIATE … COMMIT`.

`tx(db, fn)` wraps `BEGIN IMMEDIATE` / `COMMIT`, and runs `ROLLBACK` on a throw. There is **no `await` inside `fn`**: do
file I/O before or after the transaction.

Timestamps are ISO‑8601 UTC text, except `sessions.seen_at`, which is `YYYY-MM-DD`.

### C.2 DDL, schema v1 (exact)

```sql
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
```

The audit actions are `auth.login`, `account.delete`, `profile.username`, `post.hide.auto`, `post.hide.admin`, `post.unhide`,
`post.delete` (admin only), `report.dismiss`, `user.ban`, `user.unban` and `user.reset`.

Constants in `config.js` (`social`): `rulesVersion: 1`, `policyVersion: 1`. **Bump `rulesVersion`** whenever POLICY changes
`web/src/social/rules.ts` or `server/hub/rules.html` in substance. Everyone is then asked to accept again through `RulesSheet`.

### C.3 Field rules

`cleanText`, `graphemes`, `tooLong` and `maskProfanity` come from backend.md §4.3 and §7.3 unchanged, except that the mask
character is `•••` after the first character.

- **Reserved usernames (exact):**
  `admin administrator root system support help helpdesk moderator moder mod mods staff team para paraapp para_app skycoax
  official api auth login logout signin signup register me my settings profile profiles user users account accounts policy
  privacy rules terms safety delete deleted delete_account null undefined anonymous anon guest test telegram instagram google
  youtube tiktok feed post posts search friends notifications media brand assets`, plus every tenant id and the first label of
  every hub host.
- **Reserved if the username contains:** `admin moderator skycoax official rasmiy support dekanat rektor rector`, or any token
  (split on `_` and digits) for which `isProfane()` is true.
- **Name impersonation** (folded text contains): `администрац модератор деканат ректор admin moderator dekanat rektor skycoax
  официальн rasmiy`, or the name equals `para`, or contains `команда para` / `para team`.
- **Suggested username** (`me.suggestedUsername`, only while `needsProfile`):
  1. transliterate the name into Latin (ru/uz, e.g. `Азиз` → `aziz`);
  2. keep `[a-z0-9_]` and trim to 14 characters;
  3. pad to 3 characters with `student` if shorter;
  4. append `_` plus 2–4 random digits;
  5. retry up to 5 times until the name is available and not reserved; otherwise return `null`.

  It is never derived from the email.
- **Masked email:** first character + `•••@` + domain.

### C.4 Deletion, auto‑hide, bans

`tombstone(postId, by)`, all in one `tx`:
```sql
UPDATE posts SET text = '', author_id = NULL, media_count = 0, like_count = 0, hidden = 0, deleted_at = ?, deleted_by = ? WHERE id = ?;
DELETE FROM media WHERE post_id = ?;   -- файлы удаляются после COMMIT
DELETE FROM likes WHERE post_id = ?;
-- жалобы НЕ удаляются: у них есть снимок; post_id остаётся (или станет NULL при жёстком удалении)
```

`deletePost(post, by)`:
- **Reply:** if a live reply has `parent_id = post.id`, tombstone it; otherwise hard `DELETE`. Either way,
  `reply_count = reply_count - 1` on the root.
- **Root:** if it has live replies, tombstone it (the thread stays and shows «Пост удалён»); otherwise hard `DELETE` (the
  cascade removes its tombstoned replies, likes and media rows).
- Unlink the files after COMMIT and ignore `ENOENT`.

`deleteAccount(user)` is one `tx`, followed by the unlinks:
1. `files = SELECT id, thumb_bytes FROM media WHERE owner_id = ?`.
2. Decrement `like_count` on every post the user liked, then delete their likes.
3. Run `deletePost(r,'account')` on the user's replies, oldest first, then on the user's roots.
4. If the account is banned and the ban is still active: `INSERT OR REPLACE INTO ban_marks (sha256(salt|sub), until, reason, now)`.
5. If `username` is set: `INSERT OR REPLACE INTO held_usernames (username, NULL, now+30d)`.
6. Assert that no live post has `author_id = ?`.
7. `DELETE FROM users WHERE id = ?`. This cascades to sessions, media rows, friends and blocks. `reports.reporter_id` and
   `reports.user_id` become NULL.
8. `audit('account.delete', actor = id, target 'u:<id>')`.
9. After COMMIT: unlink every file (`<id>.jpg` and `<id>_t.jpg`), and clear the session cookie.

**Auto‑hide** on `POST /api/social/reports`, all in one `tx`:
1. `counted = reporter is admin OR (reporter.created_at <= now - SOCIAL_REPORTER_MIN_AGE_H AND NOT (reason = 'child' AND the
   reporter has any report with reason 'child' and status 'dismissed'))`. So someone whose `child` report was dismissed once no
   longer hides posts single‑handedly with that reason (their later reports still reach the queue).
2. `INSERT OR IGNORE` the report with `counts = counted ? 1 : 0` and `snapshot` JSON
   `{"kind": "post"|"reply"|"user", "rootId": <root id or null>, "text": <raw text | bio>, "name": <null | user name>,
   "username": <author/user username>, "media": [<media ids of the post | avatar id>], "mediaCount": <n>, "at": now}`.
   `GET /admin/reports` expands `media` ids to `MediaRef`s for the rows that still exist.
3. For a post, recompute `report_count` = the number of distinct open, counted reports. Hide the post (`hidden=1`,
   `hidden_reason='reports'`, audit `post.hide.auto`) if any of these is true:
   - the reporter is an admin;
   - there is at least 1 counted open `child` report;
   - there are at least 2 counted open reports with a severe reason (`sexual, violence, privacy, child`);
   - `report_count >= SOCIAL_REPORT_THRESHOLD` (default 3).
4. Users are never auto‑actioned. Five or more open reports only put them at the top of the queue.
5. Return `{ reported: true, hidden }`.

A dismissed report stays (because of the unique index), so the same people cannot hide the same post again.

**Bans** are read‑only. A banned user may sign in, read, delete their own posts, report, block, make privacy‑reducing
profile changes, log out and delete their account.
The expiry job lifts temporary bans every 10 min, and a lazy check on session load does the same.

### C.5 Sessions and cookies

- Token: `randomBytes(32).toString('base64url')`. The database stores `sha256` of it.
- `ORIGIN = PARA_ORIGIN || 'https://' + hub.hosts[0]`, fixed at startup. `cookieSecure = ORIGIN.startsWith('https://')`.
- Session cookie: `__Host-para_sid` (secure) or `para_sid` (http dev), with
  `Path=/; Max-Age=15552000; HttpOnly; SameSite=Lax[; Secure]`.
- OAuth binding cookie: `__Host-para_oauth` / `para_oauth`, with `Max-Age=600` and the same attributes.
- The session slides when `seen_at` is older than 24 h: `expires_at` becomes now + 180 d and the cookie is re‑sent.
- Load uses the first cookie occurrence, checks it against `^[A-Za-z0-9_-]{43}$`, then joins `users`. An invalid or expired
  session clears the cookie.
- The social cookie parser extracts **only** `__Host-para_sid`, `__Host-para_oauth`, `para_sid` and `para_oauth` (the two dev
  names only when `!cookieSecure`). It never reads `cid`, `uni` or any other cookie (`hubTenant()` keeps reading `uni` as
  today), and the `cookie` header is never logged.

### C.6 Rate limits

Token buckets are in memory (`limits.js`, backend.md §7.1). Daily caps come from the database.
- The key is `u:<userId>`, or `ip:<hash>` with `hash = ipParts(clientIp).hash`.
- `clientIp(req) = req.headers['x-real-ip'] || req.socket.remoteAddress`.
- Order in every write: guards → validation → bucket → daily cap → transaction.
- Uzbek mobile carriers use CGNAT and a campus shares one Wi‑Fi IP, so IP buckets are generous and signed‑in reads use the
  user key.

| Action | Key | Bucket (burst / refill) | Daily cap (account < 24 h) |
|---|---|---|---|
| OAuth start + callback (one bucket) | ip | 60 / 1 per 10 s | global: at most 5000 states per 10 min |
| Reads (feed, thread, profile, profile posts, `/api/auth/me`) | `u:<id>` when signed in, else ip | 300 / 10 per s | — |
| `GET /api/media/*` | — | **none** | — |
| Search, username check | user | 20 / 1 per 3 s | — |
| Root post | user | 3 / 1 per 2 min | 30 (5) |
| Reply | user | 10 / 1 per 20 s | 300 (50) |
| Like / unlike | user | 30 / 1 per 2 s | — |
| Photo upload (`kind=post`) | user | 8 / 1 per min | 60 (12); unattached ≤ 12 |
| Thumb upload | user | 12 / 1 per 30 s | — |
| Avatar upload | user | 5 / 1 per 30 min | 20 |
| Report | user | 10 / 1 per 3 min | 50 (10) |
| Friend request | user | 10 / 1 per 3 min | pending outgoing ≤ 50 |
| Block / unblock | user | 20 / 1 per min | blocks ≤ 1000 |
| Profile PATCH, rules accept | user | 10 / 1 per min | — |
| Post delete | user | 30 / 1 per 10 s | — |
| Admin action | user | 60 / 1 per s | — |
| Dev login | — | none | — |

Dev‑only switches, both **ignored when `NODE_ENV=production`**:
- `SOCIAL_RATE_LIMITS=off` disables the buckets and the daily caps.
- `SOCIAL_NEW_ACCOUNT_H=<hours>` (default 24) sets the "new account" window: no links, lower caps. `0` disables it.

### C.7 Background jobs and retention (`jobs.js`, `setInterval(...).unref()`, each in try/catch)

| Every | Job |
|---|---|
| 10 min | Delete `oauth_states` older than 10 min. Lift expired bans (audit `user.unban`, actor NULL). Sweep full token buckets. |
| 1 h | Delete unattached `kind='post'` media older than 24 h (rows + files). Delete avatars older than 24 h that no `users.avatar_id` references. Unlink files in `MEDIA_DIR` that have no row and an mtime older than 1 h (including `.tmp-*`). Delete expired `sessions`. |
| 24 h (and 60 s after start) | Delete `audit` older than 180 d. Delete resolved `reports` older than 180 d after `resolved_at`. Delete open `reports` older than 365 d. Hard‑delete tombstoned roots without live replies. Delete expired `held_usernames`. Delete `ban_marks` that have expired or are older than 365 d. `VACUUM INTO <DATA_DIR>/backup/social-YYYY-MM-DD.db`, keeping the newest 7 (media is not backed up). |

---

## D. File ownership

Every file has **exactly one** owner. A file not listed here is **read‑only for everyone**.

| Owner | New files | Modified files | Deleted |
|---|---|---|---|
| **BE** | `server/src/social/index.js`, `db.js`, `http.js`, `auth.js`, `users.js`, `posts.js`, `media.js`, `jpeg.js`, `text.js`, `moderation.js`, `limits.js`, `jobs.js` (all under `server/src/social/`); `server/test/social-smoke.mjs`, `server/test/social-seed.mjs` | `server/src/index.js`, `server/src/config.js`, `server/src/hub.js`, `server/src/site.js`, `server/src/analytics.js`, `server/.env.example`, `deploy/deploy.sh`, `AGENTS.md` | — |
| **FE‑CORE** | `web/src/tabs.ts`; `web/src/ui/{Sheet,ActionSheet,Toast,Segmented,List,Button,Switch,Spinner,ErrorBoundary,icons}.tsx`, `web/src/ui/{layers,bar,keyboard,online}.ts`, `web/src/ui/ui.css`; `web/src/lib/image.ts`; `web/src/social/{types,api,events,format,stack,local}.ts`, `web/src/social/{session,actions}.tsx`; `web/src/social/ui/{Avatar,RichText,PhotoGrid,PhotoViewer,EmptyState,Badges,ReportSheet}.tsx`, `web/src/social/ui/social-ui.css`, `web/src/social/ui/avatar.css` | `web/src/brand.ts` | — |
| **FE‑SHELL** | `web/src/shell/{AppShell,TabBar,NavBar,useUniversityMenu}.tsx`, `web/src/shell/deeplink.ts`, `web/src/shell/shell.css`; `web/src/components/{ScheduleNav,ScheduleTitle,ChangesSheet,ThemeControl,ThemeSection}.tsx` | `web/src/App.tsx`, `web/src/components/TeacherApp.tsx`, `web/src/components/PullRefresh.tsx`, `web/src/hooks/useTheme.ts`, `web/src/lib/uni.ts`, `web/src/index.css`, `web/index.html` | `web/src/components/Header.tsx`, `web/src/components/TopBar.tsx` |
| **FE‑CHAT** | `web/src/social/chat/{ChatTab,Feed,PostCard,ThreadView,ReplyRow,ReplyComposer,Composer,CategoryChips}.tsx`, `web/src/social/chat/drafts.ts`, `web/src/social/chat/chat.css` | — | — |
| **FE‑PROFILE** | `web/src/social/profile/{ProfileTab,GuestCard,ProfileHeader,SettingsList,EditProfileSheet,AvatarCropper,FriendsView,PeopleSearch,UserProfileView,BlockedView,HiddenView,DeleteAccountSheet,ModerationView,AuthHost,SignInSheet,SetupSheet,RulesSheet,GoogleButton,UsernameField}.tsx`, `web/src/social/profile/profile.css` | — | — |
| **POLICY** | `server/hub/rules.html`, `server/hub/delete-account.html`, `web/src/social/rules.ts` | `server/hub/policy.html`, `web/public/sw.js`, `web/src/components/DocSheet.tsx`, `web/src/components/Consent.tsx`, `web/src/components/SiteFooter.tsx`, `web/src/components/UniversityStart.tsx`, `android/play-listing.md` | — |

**Read‑only for everyone** (use them, don't edit them):
- `web/src/api.ts`, `types.ts`, `main.tsx`;
- `web/src/lib/{store,format,parse,plural,track,boot,now,orbs,trend}.ts`;
- every other file in `web/src/components/` (`Hero`, `DayCard`, `WeekView`, `ChangesView`, `Picker`, `TeacherPicker`,
  `UniversityMenu`, `Install`, `InstallCard`, `ReviewsBlock`, `ReviewsModal`, `ReviewPrompt`, `StatsBlock`, `StatsModal`,
  `StatsDetails`, `RolePick`, `OfflineNote`, `Spark`, `charts`, `stars`, `FlipClock`);
- `web/src/hooks/useInstall.ts`, `web/vite.config.ts`, `web/tsconfig.json`, every `package.json` and lockfile;
- `server/src/{db,tenants,schedule,store,poller,source,source-edupage,teachers,together,parse-cell,reviews}.js`;
- `server/tenants/**`, `server/hub/hub.json` and its images, `deploy/*` except `deploy.sh`, and `android/*` except
  `play-listing.md`.

**CSS rule.** Each FE owner has their own CSS file, imported by their own components. Only FE‑SHELL edits `web/src/index.css`.
New tokens are the ones in §E.8, pasted by FE‑SHELL. Class prefixes are exclusive:

| Owner | Class prefixes |
|---|---|
| FE‑SHELL | `.tabbar*`, `.tabfade`, `.navrow`, `.navbtn*`, `.navseg` (a placement wrapper only; the control inside is FE‑CORE's `Segmented variant="glass"`), `.navtitle`, `.ltitle*`, `.coach*`, `.themesec*`, `.wrap--sched`, `.chunk-err*`, `.sheet--changes`, `html.has-tabbar`, `html[data-tab]` |
| FE‑CORE | `.ui-*` (`ui.css`; **exception:** `ui.css` may write `html.has-tabbar .ui-toast{…}` and `html.has-tabbar .ui-*` descendant rules); `.av*` (`avatar.css`, imported only by `Avatar.tsx`, so the tab bar pulls no other social CSS into the main chunk); `.rt*`, `.pgrid*`, `.pview*`, `.empty-st*`, `.report*`, `.badge-team`, `.badge-uni` (`social-ui.css`) |
| FE‑CHAT | `.wrap--chat`, `.post*`, `.cats`, `.thr*`, `.rrow*`, `.rcmp*`, `.cmp*`, `.newpill`, `.chat-*` |
| FE‑PROFILE | `.wrap--prof`, `.prof*`, `.set*`, `.edit*`, `.crop*`, `.frd*`, `.ppl*`, `.mod*`, `.del*`, `.signin*`, `.setup*`, `.rules*`, `.gbtn*`, `.uname*` |

Existing classes may be **used** by anyone and **changed** by no one except FE‑SHELL. The shared ones are `.chips .chip .panel
.sec__t .sheet__head .modal__ok .hdr__btn .hdr__logo .offline .alert .skel .eyebrow .dot`.

**`#doc` → `.sheet--doc`.** `DocSheet` is mounted by StudentApp, TeacherApp, ProfileTab and AuthHost, so the id would repeat.
POLICY changes `DocSheet.tsx` to `className={'sheet sheet--doc' + (open ? ' open' : '')}` with no `id`. FE‑SHELL changes
`index.css` line `#doc{z-index:90}` to `#doc, .sheet--doc{z-index:90}` (works whichever lands first).

---

## E. Module interfaces between owners

The signatures below are **frozen**. Implementations may add private helpers, but not change exported names, props or types.
A dependency that has not landed yet is coded against these signatures. Phase 0 (§H) puts a compiling stub of every export in
place.

### E.1 `web/src/tabs.ts` (FE‑CORE, exact content)

```ts
// Общий контракт оболочки (shell), вкладки «Расписание» и вкладок «Обсуждения»/«Профиль».
import type { ThemeMode } from './hooks/useTheme';

export type TabId = 'schedule' | 'chat' | 'profile';
export type Role = 'student' | 'teacher';

export interface ThemeApi { mode: ThemeMode; set: (m: ThemeMode) => void }

/** Что вкладка «Расписание» сообщает наверх: для строк «Профиля» и точки на вкладке. */
export interface ScheduleContext {
  kind: 'group' | 'teacher';
  title: string;          // «Информационные системы и технологии» / «Иванов И.И.»
  subtitle: string;       // «КФУ · Джизак · 1 курс · 09.03.02» / «Преподаватель · КФУ · Джизак»
  unseenChanges: boolean; // та же правда, что точка на кнопке «Правки»
  installUrl: string;     // личная ссылка для окна «На главный экран» ('' — группы ещё нет)
}

/** Разовая команда вкладке «Расписание». n растёт, чтобы повторить ту же команду. */
export interface ScheduleCommand { kind: 'picker' | 'changes'; n: number }

export interface ScheduleSlotProps {
  active: boolean;
  command: ScheduleCommand | null;
  /** Вызывать из эффекта, только когда есть согласие и выбрана группа/преподаватель, и только при изменении полей. */
  onContext: (c: ScheduleContext) => void;
  theme: ThemeApi;
}

export interface ChatLink { post?: number; compose?: boolean; user?: string }
export interface ProfileLink { user?: string; del?: boolean; mod?: boolean }

export interface ChatTabProps {
  active: boolean;
  link: ChatLink | null;
  onLinkHandled: () => void;
}

export interface ProfileTabProps {
  active: boolean;
  theme: ThemeApi;
  role: Role;
  setRole: (r: Role) => void;     // AppShell: сменить режим и открыть «Расписание»
  schedule: ScheduleContext | null;
  openPicker: () => void;         // AppShell: открыть «Расписание» и выбор группы/преподавателя
  link: ProfileLink | null;
  onLinkHandled: () => void;
}

/** window CustomEvent: повторное нажатие на активную вкладку, detail: TabId. */
export const RESELECT_EVENT = 'para:reselect';
```

### E.2 FE‑CORE exports

#### `web/src/ui/*` (app‑wide primitives, no social knowledge)

```ts
// ui/Sheet.tsx
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  variant: 'bottom' | 'full';
  detent?: 'medium' | 'large';          // bottom only: max-height 55dvh | 92dvh (default 'large')
  title?: string;                       // 17/600, centered in the sheet bar
  left?: ReactNode;                     // bar slots
  right?: ReactNode;                    // bottom default: text button «Готово» → onClose. Pass null for none.
  dismissible?: boolean;                // default true: scrim tap, swipe down, Esc, Android Back
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}
export function Sheet(p: SheetProps): JSX.Element | null
// ui/ActionSheet.tsx
export interface SheetAction { id: string; label: string; role?: 'default' | 'destructive' | 'cancel'; disabled?: boolean }
export function chooseAction(o: { title?: string; message?: string; actions: SheetAction[] }): Promise<string | null>
export function confirmDialog(o: { title: string; message?: string; confirm: string; destructive?: boolean; cancel?: string }): Promise<boolean>
export function promptText(o: { title: string; message?: string; placeholder?: string; confirm: string; maxLength?: number; required?: boolean }): Promise<string | null>
export function DialogHost(): JSX.Element
// ui/Toast.tsx
export function toast(text: string, o?: { kind?: 'default' | 'error'; ms?: number; action?: { label: string; onClick: () => void } }): void
export function ToastHost(): JSX.Element
// ui/Segmented.tsx
export function Segmented<T extends string>(p: {
  value: T; options: { value: T; label: string; badge?: number; disabled?: boolean }[]; onChange: (v: T) => void;
  ariaLabel: string; variant?: 'glass' | 'inset'; asTabs?: boolean; controls?: string;
}): JSX.Element
// ui/List.tsx
export function ListSection(p: { header?: string; footer?: ReactNode; children: ReactNode }): JSX.Element
export function ListRow(p: {
  label: ReactNode; value?: ReactNode; icon?: { name: IconName; color: string /* 'var(--c3)' */ };
  onClick?: (el: HTMLElement) => void; href?: string; external?: boolean; chevron?: boolean;
  tone?: 'default' | 'accent' | 'destructive'; badge?: number; disabled?: boolean; trailing?: ReactNode; ariaLabel?: string;
}): JSX.Element
// ui/Button.tsx
export function Button(p: {
  children: ReactNode; onClick?: () => void;
  variant?: 'filled' | 'tinted' | 'plain' | 'destructive' | 'destructive-filled';
  size?: 32 | 44 | 50; full?: boolean; disabled?: boolean; busy?: boolean; type?: 'button' | 'submit';
  ariaLabel?: string; className?: string;
}): JSX.Element
// ui/Switch.tsx — <input type="checkbox" role="switch"> in iOS style
export function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }): JSX.Element
// ui/Spinner.tsx, ui/ErrorBoundary.tsx
export function Spinner(p: { size?: number }): JSX.Element
export class ErrorBoundary extends Component<{ fallback: (retry: () => void) => ReactNode; children: ReactNode }> {}
// ui/icons.tsx — 24×24, stroke 1.8, round caps/joins; *Fill variants are filled
export type IconName =
  | 'calendar' | 'calendarFill' | 'bubbles' | 'bubblesFill' | 'person' | 'personFill' | 'history' | 'compose'
  | 'back' | 'chevronRight' | 'chevronDown' | 'ellipsis' | 'heart' | 'heartFill' | 'reply' | 'share' | 'photo'
  | 'send' | 'close' | 'search' | 'check' | 'globe' | 'lock' | 'flag' | 'hand' | 'trash' | 'people' | 'shield'
  | 'plus' | 'link' | 'telegram' | 'instagram' | 'wifiOff' | 'warning';
export function Icon(p: { name: IconName; size?: number; className?: string }): JSX.Element
// ui/layers.ts — Android/browser Back for sheets and pushed screens. ONE history for the whole app (D29).
export function pushLayer(id: string, onPop: () => void): () => Promise<void>  // returns close(); rules below
export function useLayer(open: boolean, onClose: () => void, id?: string): void
export function depth(): number                                  // layers currently open (= history entries we own)
export function openLayerCount(exceptIds?: string[]): number     // e.g. openLayerCount(['tab']) for "is any overlay open"
export function unwind(toDepth: number): Promise<void>           // pop every layer above toDepth with ONE history.go(-n)
export function whenIdle(): Promise<void>                        // resolves when no history operation is pending
// ui/bar.ts — tab bar visibility (module-level set + useSyncExternalStore)
export function useHideTabBar(hidden: boolean, reason: string): void
export function useTabBarHidden(): boolean
// ui/keyboard.ts — call ONCE (AppShell). Writes --kb (px) on <html>, adds hide reason 'keyboard'.
export function useKeyboardWatcher(): boolean
// ui/online.ts
export function useOnline(): boolean
```

Behavior that others rely on:
- `Sheet` renders through a portal to `document.body` with `role="dialog" aria-modal="true"`.
  - Focus moves in on open, is trapped inside, and returns to the opener on close.
  - Scroll lock is ref‑counted.
  - It calls `useLayer(open && dismissible, onClose)`. Back does **not** close a non‑dismissible sheet.
  - The bottom variant has a scrim, a grabber (36×5) and drag‑to‑dismiss (100 px or 0.6 px/ms) when the content is scrolled
    to the top.
  - Z‑index is 60.
  - Classes: `.ui-sheet`, `.ui-sheet--bottom|--full`, `.ui-sheet__bar`, `.ui-sheet__body`, `.ui-scrim`.
- `chooseAction`, `confirmDialog` and `promptText` queue dialogs one at a time. They resolve `null`/`false` on dismiss and are
  history layers. If no action has the `cancel` role, an `Отмена` item is added automatically.
- `toast` shows one toast at a time; a new one replaces the old one. It is `role="status"`, lasts 2600 ms by default, and sits
  above the tab bar through `html.has-tabbar .ui-toast` (a rule in `ui.css`, §D exception).
- `Segmented variant="glass"` is the control inside FE‑SHELL's `ScheduleNav` (`Сегодня | Неделя`); FE‑SHELL's `.navseg` only
  places it. The glass variant's look is ux.md §4.1 "Center `.navseg`" (44 px capsule, 3 px padding, 38 px segments,
  radius 19 px), implemented under `.ui-seg--glass` in `ui.css`. `variant="inset"` is the Settings style.
- **`layers.ts` rules (binding; they fix the same‑tick back/push race):**
  1. Every layer is `{ key, id, onPop, closing }` on a module stack. `pushLayer()` calls
     `history.pushState({ paraLayer: key, depth: n }, '')` with the same URL (`n` = stack length after the push).
  2. **One FIFO queue** serializes every history operation (`pushState`, `back`, `go`). An operation that triggers a
     `popstate` (`back`, `go`) waits for that `popstate`, or 1000 ms as a safety timeout, before the next queued operation runs.
     A `pushLayer()` called while a back is pending is queued and runs after it. Two `back()` calls are never issued in the same
     task.
  3. `close()` (UI‑initiated): if the layer is on top, mark it `closing`, remove it, and enqueue one `back`; `onPop` is **not**
     called (the caller already closes its UI). The returned promise resolves after that `popstate` is processed. If the layer
     is buried, mark it `dead` and resolve at once; a dead layer that later becomes the top is removed with one more queued
     `back`, so Back never becomes a no‑op.
  4. The single `popstate` listener reads `event.state?.depth ?? 0` as the target depth `D`. If a queued back/go is pending, it
     settles that operation. Then, while the stack is longer than `D`, it pops the top: `closing`/`dead` layers silently, any
     other layer by calling its `onPop` exactly once (Android Back, `unwind`).
  5. `unwind(toDepth)`: marks nothing `closing`, enqueues one `history.go(-(depth() - toDepth))` and resolves after its
     `popstate`, so every popped layer's `onPop` runs (top first). No‑op when `depth() <= toDepth`.
  6. `chooseAction`, `confirmDialog` and `promptText` resolve **after** their own `close()` promise, so a follow‑up dialog
     (`postMenu` → `Удалить пост?`) is pushed only after the first one's `popstate`.
  7. **Chrome caveat.** Chrome may skip, on Back, history entries that were pushed without a user activation (its
     history‑manipulation intervention). The non‑activated pushes in this app are: the cold‑start `'tab'` entry (§E.3),
     sheets opened by deep‑link handlers, and SetupSheet auto‑opened after `#auth=ok`. Every such flow must be harmless when
     skipped: Back then leaves the app (as a cold start would) and nothing is lost (drafts are saved, SetupSheet comes back from
     the `Заверши профиль` card). Do not design a flow that relies on those entries.

#### `web/src/lib/image.ts`

```ts
export interface PreparedImage { full: Blob; thumb: Blob | null; w: number; h: number; preview: string /* object URL of thumb, else of full */ }
export class ImageError extends Error { code: 'type' | 'decode' | 'too_big'; constructor(code: ImageError['code'], message: string) }
/** defaults: maxSide 1600, maxBytes 880_000, thumbSide 640, thumbBytes 140_000 */
export function prepareImage(file: File, o?: { maxSide?: number; maxBytes?: number; thumbSide?: number; thumbBytes?: number }): Promise<PreparedImage>
export function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement>
/** Avatar: square crop → full 512 (q .86) + thumb 128 (q .8) */
export function cropSquare(src: ImageBitmap | HTMLImageElement, crop: { x: number; y: number; size: number }, out?: number): Promise<{ full: Blob; thumb: Blob }>
export function releaseBitmap(b: ImageBitmap | HTMLImageElement): void
```

The algorithm is ux.md §5.10, with the sizes above. Errors carry these exact messages:
- `type`: «Это не фото»;
- `decode`: «Не удалось открыть фото. Попробуй другое.»;
- `too_big`: «Фото слишком большое».

Additional rules:
- Fill the canvas with `#fff` before drawing.
- Use `createImageBitmap(file, { imageOrientation: 'from-image' })` to bake in the orientation.
- Canvas output carries no metadata.
- **Thumb geometry must pass the server check (§B.5 #14).** Compute the thumb from the **final full** size:
  `s = min(1, thumbSide / max(fw, fh))`, `tw = round(fw * s)`, `th = round(fh * s)`. To meet `thumbBytes`, lower only the
  quality (down to 0.4), never the dimensions; if it is still too big, return `thumb: null` (the upload then skips the thumb
  and the server serves `thumb = url`). `cropSquare` returns exactly 512² and 128².

#### `web/src/social/api.ts`

```ts
export class ApiError extends Error {
  status: number; code: ErrorCode; field?: string; retryAfter?: number;
  constructor(status: number, code: ErrorCode, message: string, extra?: { field?: string; retryAfter?: number })
}
export const isApiError = (e: unknown, code?: ErrorCode): e is ApiError => …;
/** SessionProvider registers it. Called (after the promise rejects) on every 401 'auth' except from /api/auth/me,
 *  and on 403 'profile' | 'rules' | 'banned'. Callers must NOT toast errors with these four codes themselves. */
export function setAuthErrorHandler(fn: ((code: 'auth' | 'profile' | 'rules' | 'banned') => void) | null): void;

export const socialApi: {
  me(signal?: AbortSignal): Promise<AuthState>;                                   // GET  /api/auth/me (5xx/non-JSON → ApiError 'network')
  /** /api/auth/google/start?return=&intent=&uni= ; for intent 'signin' also &age=&accept=1 (accept only when o.accept === true).
   *  For intent 'delete' neither age nor accept is ever added. */
  signInUrl(o: { returnTo: string; intent: AuthIntent; age?: AgeGroup; accept: boolean }): string;
  devLogin(name: string, age?: AgeGroup, intent?: AuthIntent): Promise<Me>;       // POST /api/auth/dev
  logout(all?: boolean): Promise<void>;                                            // POST /api/auth/logout
  feed(o: { category?: CategoryId | null; cursor?: string | null; limit?: number }, signal?: AbortSignal): Promise<Page<Post>>;
  thread(id: number, cursor?: string | null, signal?: AbortSignal): Promise<Thread>;       // GET /api/social/posts/:id
  createPost(b: NewPost): Promise<Post>;                                           // POST /api/social/posts
  createReply(rootId: number, b: NewReply): Promise<Post>;                         // POST /api/social/posts/:id/replies
  deletePost(id: number): Promise<void>;                                           // DELETE /api/social/posts/:id
  like(id: number, on: boolean): Promise<LikeState>;                               // PUT|DELETE /api/social/posts/:id/like
  /** POST full (XHR, progress 0..0.9), then PUT thumb (0.9..1) when given. A failed thumb still resolves (thumb = url). */
  uploadMedia(img: { full: Blob; thumb?: Blob | null }, o?: { kind?: 'post' | 'avatar'; onProgress?: (p: number) => void; signal?: AbortSignal }): Promise<UploadedMedia>;
  deleteMedia(id: string): Promise<void>;                                          // DELETE /api/social/media/:id
  updateMe(p: MePatch): Promise<Me>;                                               // PATCH /api/social/me
  setAvatar(img: { full: Blob; thumb: Blob }, onProgress?: (p: number) => void): Promise<Me>;  // uploadMedia(kind avatar) + PATCH {avatar}
  removeAvatar(): Promise<Me>;                                                     // PATCH {avatar:null}
  acceptRules(version: number): Promise<Me>;                                       // POST /api/social/me/rules
  deleteAccount(): Promise<void>;                                                  // DELETE /api/social/me {confirm:true}
  checkUsername(u: string, signal?: AbortSignal): Promise<UsernameCheck>;          // GET /api/social/username?u=
  searchUsers(q: string, signal?: AbortSignal): Promise<UserCard[]>;               // POST /api/social/users/search
  user(username: string, signal?: AbortSignal): Promise<ProfilePage>;              // GET /api/social/users/:username
  userPosts(username: string, cursor: string, signal?: AbortSignal): Promise<Page<Post>>;
  friends(signal?: AbortSignal): Promise<FriendLists>;                             // GET /api/social/friends
  friend(userId: number, action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove'): Promise<Relation>;
      // request → POST /friends/:id · accept → POST /friends/:id/accept · decline → POST /friends/:id/decline · cancel|remove → DELETE /friends/:id
  blocks(signal?: AbortSignal): Promise<UserCard[]>;
  block(userId: number): Promise<void>;                                            // PUT /api/social/blocks/:id
  unblock(userId: number): Promise<void>;                                          // DELETE /api/social/blocks/:id
  report(b: ReportBody): Promise<ReportResult>;                                    // POST /api/social/reports
  adminReports(status: 'open' | 'closed', cursor?: string | null, signal?: AbortSignal): Promise<Page<ReportCase>>;
  adminAction(b: AdminActionBody): Promise<void>;
  adminStats(signal?: AbortSignal): Promise<AdminStats>;
  adminAudit(cursor?: string | null, signal?: AbortSignal): Promise<Page<AuditItem>>;
};
```

Rules for `api.ts`:
- Import types only from `./types` and `brand` from `../brand`. **Never import or modify `web/src/api.ts`.**
- Append `uni=` as in §B.1, and apply the rest of the transport rules there.
- Pre‑check each upload: a `full` blob larger than 921 600 bytes or a `thumb` larger than 153 600 bytes is rejected with
  `ApiError(413,'too_large',…)` before any request is sent.
- `setAvatar({full, thumb})` uploads with `kind:'avatar'`, then PATCHes `{avatar: id}`.

#### `web/src/social/session.tsx`

```ts
export type SessionStatus = 'loading' | 'guest' | 'signed';
export type AuthPrompt =
  | { kind: 'signin'; reason: AuthReason; returnTo: string }
  | { kind: 'setup' }
  | { kind: 'rules' }
  | { kind: 'banned'; ban: Ban };
export interface Session {
  status: SessionStatus;            // 'loading' until the first me() settles (also while waiting for consent)
  /** While 'loading': the me_cache object (only id/name/username/avatar are valid). Never trust other fields until ready. */
  me: Me | null;
  mode: SocialMode;                 // brand.social ?? 'on' until /api/auth/me answers; 'off' on 404 or mode:'off'
  google: boolean | null;           // null = unknown (request failed) → sign-in button stays enabled
  dev: boolean;
  config: SocialConfig | null;
  online: boolean;
  prompt: AuthPrompt | null;        // AuthHost renders the sheet for it
  /** Resolves once the FIRST me() settles (success, 404, 5xx or network error). Never rejects. */
  ready: Promise<void>;
  ensure(reason: AuthReason, returnTo?: string): Promise<boolean>;
  requestSignIn(reason: AuthReason, returnTo?: string): void;  // awaits ready internally, then opens SignInSheet; don't await
  resolvePrompt(ok: boolean): void; // AuthHost: sheet completed (true) / dismissed (false)
  /** Flushes drafts, then location.replace(socialApi.signInUrl(o)). */
  signIn(o: { returnTo: string; intent: AuthIntent; age?: AgeGroup; accept: boolean }): void;
  /** Dev only. POST /api/auth/dev, then location.replace(returnTo + '#auth=ok') (404 for intent 'delete' → '#auth=none'),
   *  where returnTo is the open signin prompt's returnTo, else currentReturnTo(). So dev sign-in exercises the real OAuth-return path. */
  devSignIn(name: string, age?: AgeGroup, intent?: AuthIntent): Promise<void>;
  signOut(all?: boolean): Promise<void>;
  refresh(): Promise<void>;         // reuses an in-flight me(); also how AppShell starts the first fetch after consent
  setMe(me: Me): void;              // after PATCH / avatar / rules; writes me_cache; emits 'me-changed'
  handleAuthOutcome(o: AuthOutcome): void;
}
/** eager: the URL carried '#auth=' → fetch me() at once instead of on idle. */
export function SessionProvider(p: { children: ReactNode; eager?: boolean }): JSX.Element  // also hosts the lazy ReportSheet
export function useSession(): Session
export function useMe(): Me | null
/** '/?uni=<brand.id>&tab=<html[data-tab]||schedule>' + extra params (URL-encoded) */
export function currentReturnTo(extra?: Record<string, string | number>): string
```

Session algorithm (binding):
1. **Mount.**
   - Read `me_cache` so the tab‑bar avatar shows at once (`status` stays `'loading'`).
   - **Consent gate (D31):** if `store('agreed')` is empty, send nothing. `ready` stays pending until AppShell calls
     `refresh()` on the first `onContext` after consent (that call settles `ready`).
   - Otherwise: if `eager`, call `socialApi.me()` immediately; else after the first paint through `requestIdleCallback`
     (fallback `setTimeout(300)`). The idle fetch is skipped if a `refresh()` already ran; `refresh()` reuses an in‑flight
     request.
   - Refetch on `visibilitychange` → visible (if the last fetch was more than 5 min ago) and on `online`, only after consent.
   - Subscribe to `useSocialEvents`: on `relation` and `moderated`, run a `refresh()` debounced by 1000 ms (keeps
     `requestsIn`/`modQueue` badges fresh).
2. **`me()` results** (each one settles `ready` the first time):
   - `404`, or `mode:'off'` in the body → `mode='off'`. With a 404: status `guest`, `me=null`. With a body: as success below
     (a signed‑in user stays signed in so that deletion is reachable).
   - Network error, 5xx or non‑JSON → keep the cache: `google=null`, status `signed` if a cache exists, otherwise `guest`.
   - Success: set `mode`, `google`, `dev`, `config` and `me`, then write `me_cache`. **No prompt is opened here.**
3. **`ensure(reason, returnTo = currentReturnTo())`**:
   1. `await ready`.
   2. If a prompt is already open, wait until it is resolved. If it was dismissed (`resolvePrompt(false)`), resolve `false`;
      otherwise restart these checks from 3.3.
   3. `mode='off'` and reason ≠ `delete` → toast «Обсуждения временно недоступны», resolve `false`.
   4. `mode='readonly'` and the reason is not one of `profile|search|account|delete|expired|report|block` → toast
      «Обсуждения временно доступны только для чтения», resolve `false`.
   5. Guest → `prompt=signin(reason, returnTo)`. Dismissing it resolves `false`. Signing in navigates away, so the promise never
      resolves.
   6. `me.banned` and the reason is `post|reply|like|friend` → `prompt=banned`, resolve `false`. (`report` and `block` pass.)
   7. `me.needsProfile` and the reason is a P‑guarded write (`post|reply|like|friend`):
      - `mode==='on' && !me.banned` → `prompt=setup`; on success continue, on `Позже` resolve `false`;
      - otherwise → toast «Сначала заполни профиль», resolve `false`.
      Other reasons (`report`, `block`, `profile`, `search`, …) do not need a profile and continue.
   8. `!me.rulesAccepted` and the reason is `post|reply|like|friend` → `prompt=rules`. On accept, continue; on `Не сейчас`
      resolve `false`.
   9. Resolve `true`.
4. **`requestSignIn(reason, returnTo)`:** `await ready`; if signed in, do nothing; else set `prompt=signin(reason, returnTo)`.
   Allowed in every mode for `delete`; in `off` for any other reason it toasts «Обсуждения временно недоступны».
5. **Auth errors from any call** (through `setAuthErrorHandler`):
   - `auth` (401): status `guest`, `me=null`, `clearSocialLocal()`, toast «Сессия истекла — войди снова»,
     `emit({type:'me-changed', me:null})`;
   - `profile`: `refresh()`, then `prompt=setup` (only if `mode==='on'` and not banned);
   - `rules`: `refresh()`, then `prompt=rules`;
   - `banned`: `refresh()`, then `prompt=banned`.
6. **`signOut(all)`:** `logout(all)`, then the same local clearing, then toast «Выход выполнен».
7. **`handleAuthOutcome(o)`:** show the toast from §B.5 at once (`consent` → `prompt=signin('account')` instead, no toast).
   Then, if a `me()` is in flight or `ready` is still pending, **await that same request** (no second fetch); otherwise
   `refresh()`. After it: if `o==='ok'` and `me.needsProfile && mode==='on' && !me.banned` and no prompt is open → open
   `prompt=setup` (this is the **only** automatic SetupSheet).
8. **`signIn`** uses `location.replace()`, so no stale pre‑OAuth entry stays in history. Known TWA limitation: Back from the
   returned app can still show Google's account chooser once; choosing again ends in `#auth=expired` (a toast, harmless).
9. **ReportSheet** is loaded lazily (`import('./ui/ReportSheet')`) on the first `report()` call, so it and `social-ui.css` stay
   out of the main chunk.
10. **Debugging.** If `ls('paraDebug') === '1'`, set `window.__paraDebug = { socialApi, session, prepareImage }`. This is for
    developer checks only; users never set that key.

#### `web/src/social/events.ts`, `format.ts`, `stack.ts`, `local.ts`

```ts
// events.ts — window CustomEvent 'para:social' with detail = SocialEvent
export const SOCIAL_EVENT = 'para:social';
export type SocialEvent =
  | { type: 'post-created'; post: Post }
  | { type: 'post-deleted'; id: number; rootId: number | null }
  | { type: 'reply-created'; reply: Post }
  | { type: 'like'; id: number; likes: number; liked: boolean }
  | { type: 'block'; userId: number } | { type: 'unblock'; userId: number }
  | { type: 'hide-user'; userId: number }
  | { type: 'relation'; userId: number; relation: Relation }
  | { type: 'reported'; target: ReportTarget; hidden: boolean }
  | { type: 'moderated'; target: ReportTarget; action: AdminAction }   // after every successful adminAction()
  | { type: 'me-changed'; me: Me | null };
export function emit(e: SocialEvent): void
export function useSocialEvents(fn: (e: SocialEvent) => void): void
// format.ts (Asia/Tashkent, ru-RU)
export function relTime(iso: string, now?: number): string      // «сейчас» · «5 мин» · «3 ч» · «вчера» · «24 сент.» · «24 сент. 2025»
export function fullTime(iso: string): string                    // «25 сентября 2026 в 14:05»
export function fmtCount(n: number): string                      // 999 · «1,2 тыс.» · «12 тыс.»
export function textLength(s: string): number                    // graphemes (Intl.Segmenter; fallback code points)
export function textTooLong(s: string, max: number): boolean     // textLength(s) > max || s.length > 4 * max (server's UTF-16 cap)
/** The ONLY ban phrasing: «Публикация ограничена до 3 октября. Причина: спам.» / «Публикация ограничена навсегда. Причина: спам.» */
export function banText(ban: Ban): string
export function countLinks(s: string): number                    // same regex as the server
export function hasPhone(s: string): boolean                     // /(\+?998)?[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/
export type Token = string | { t: 'url'; href: string; label: string } | { t: 'mention'; username: string };
export function tokenize(text: string): Token[]                  // ux.md §5.5 regexes; mentions [a-z0-9_]{3,20}
export function useNow(ms?: number): number                      // re-render tick, default 60000
// stack.ts — a tab's push navigation on top of ui/layers; saves/restores window.scrollY per depth.
// Each pushed screen is a layer (id 'screen'); Back or unwind() pops it through onPop.
export interface Stack<S> { stack: S[]; top: S | null; push(s: S): void; pop(): Promise<void>; popToRoot(): Promise<void> }
export function useStack<S>(): Stack<S>
// local.ts — localStorage via lib/store ls() (never cookies)
export interface HiddenUser { id: number; username: string; name: string }
export function hiddenUsers(): HiddenUser[]                      // newest first
export function isHiddenUser(id: number): boolean
export function hideUser(u: HiddenUser): void                    // max 200, newest kept
export function unhideUser(id: number): void
export function readMeCache(): Pick<Me, 'id' | 'name' | 'username' | 'avatar'> | null
export function writeMeCache(me: Me | null): void
export function ageBlocked(): boolean                            // ageBlock set < 30 days ago
export function setAgeBlock(): void
export function clearSocialLocal(): void                         // removes me_cache and every draft_post_* (keeps hiddenUsers, ageBlock)
```

#### `web/src/social/actions.tsx`

```ts
export function postLink(p: Post): string            // location.origin + '/?uni=' + p.uni + '&post=' + (p.rootId ?? p.id)
export function userLink(username: string): string   // location.origin + '/?uni=' + brand.id + '&user=' + username
export function useSocialActions(): {
  /** returnTo: where a guest comes back after sign-in (ThreadView passes currentReturnTo({ post: rootId })). */
  report(target: ReportTarget, o: { username: string; kind: 'post' | 'reply' | 'user'; returnTo?: string }): Promise<ReportResult | null>;
  block(user: Pick<UserCard, 'id' | 'username'>, returnTo?: string): Promise<boolean>;
  unblock(user: Pick<UserCard, 'id' | 'username'>): Promise<boolean>;
  hideLocally(user: Pick<UserCard, 'id' | 'username' | 'name'>): void;
  copyLink(url: string): Promise<void>;                // toast «Ссылка скопирована»
  share(url: string, title?: string): Promise<void>;   // navigator.share, else copyLink
  postMenu(post: Post, returnTo?: string): Promise<'deleted' | 'reported' | 'blocked' | 'hidden' | 'moderated' | null>;
  userMenu(user: UserProfile): Promise<'reported' | 'blocked' | 'unblocked' | 'moderated' | null>;
}
```

`postMenu` builds its items with `chooseAction`. Replies get no `Скопировать ссылку`, and a tombstone gets no menu. Every
successful admin action from `postMenu`/`userMenu` emits `{type:'moderated'}`.

| Viewer ↓ / target → | Own post or reply | Someone else's |
|---|---|---|
| Guest | — | `Скопировать ссылку` · `Пожаловаться` (→ `ensure('report')`) · `Скрыть посты @{u}` |
| Signed in | `Скопировать ссылку` · `Удалить` (destructive) | `Скопировать ссылку` · `Пожаловаться` · `Заблокировать @{u}` (destructive) |
| Admin (in addition, someone else's) | — | `Скрыть (модератор)` · `Удалить как модератор` (destructive) · `Ограничить автора…` |

`userMenu` offers `Скопировать ссылку` · `Пожаловаться` · `Заблокировать @{u}` (or `Разблокировать` when blocked). Admins
also get `Ограничить…` (when `user.banned === null`) **or** `Снять ограничение` (when `user.banned !== null`), and
`Сбросить профиль…`. The latter uses `chooseAction` with `Сбросить фото` / `Сбросить «О себе»` / `Сбросить ссылки` /
`Сбросить имя`. `Снять ограничение` runs action `unban` without confirmation and toasts `Ограничение снято`.

Dialogs, confirmations and toasts:

| Flow | Strings | Result |
|---|---|---|
| Delete a root | `Удалить пост?` / `Ответы других останутся, а на месте поста будет «Пост удалён». Это нельзя отменить.` / `Удалить` | emit `post-deleted`, toast `Удалено` |
| Delete a reply | `Удалить ответ?` / `Это нельзя отменить.` / `Удалить` | emit `post-deleted`, toast `Удалено` |
| Block | `Заблокировать @{u}?` / `Ты не будешь видеть посты и ответы @{u}, а @{u} не сможет отвечать тебе, отмечать твои посты, открывать твой профиль и добавлять тебя в друзья. @{u} не узнает о блокировке.` / `Заблокировать` (destructive) | emit `block`, toast `Пользователь заблокирован` |
| Unblock | no confirmation | emit `unblock`, toast `Пользователь разблокирован` |
| Hide locally | — | `hideUser({id, username, name})`, emit `hide-user`, toast `Посты @{u} скрыты` |
| Admin unban | — | action `unban`, toast `Ограничение снято` |
| Admin delete | `Удалить как модератор?` / `Публикация исчезнет у всех. Это нельзя отменить.` / `Удалить` | action `delete` |
| Admin restrict | `chooseAction` titled `Ограничить автора` with `На сутки` · `На неделю` · `На месяц` · `Навсегда`, then `promptText({title:'Причина', placeholder:'Например: спам', confirm:'Ограничить', required:true, maxLength:200})` | action `ban`, toast `Автор ограничен` |
| Admin hide | — | action `hide`, toast `Скрыто` |

**ReportSheet** (`social/ui/ReportSheet.tsx`) is internal. It is opened by `report()` and mounted lazily by `SessionProvider`
(inside an `ErrorBoundary`; a failed chunk load toasts «Нет интернета» and resolves `report()` with `null`). It is a bottom
sheet.
- Title `Пожаловаться`.
- Subtitle, by target:
  - `Что не так с этим постом?`;
  - `Что не так с этим ответом?`;
  - `Что не так с этим профилем?`.

  The second line is always `Автор не узнает, кто пожаловался.`
- A radio list from `REPORT_REASONS` (rows of 48 px).
- A textarea labelled `Что случилось? (необязательно)`, at most 300 characters. When the reason is `other`, its label becomes
  `Опиши, что случилось` and it is required.
- The button is `Отправить жалобу`.
- On success, the body becomes `Спасибо! Модератор проверит жалобу.` with the buttons `Заблокировать @{u}` (tinted) and
  `Готово`, then `emit({type:'reported'})`.
- Errors show inline with the server text. Offline shows `Нет интернета — жалоба не отправлена.`

#### `web/src/social/ui/*` (shared atoms)

```ts
export function Avatar(p: { user: { id: number; name: string; avatar: string | null } | null; size: 24 | 26 | 32 | 40 | 44 | 56 | 88 | 96; onClick?: () => void; label?: string; ring?: boolean }): JSX.Element
export function RichText(p: { text: string; clamp?: number; onMention: (username: string) => void; className?: string }): JSX.Element
export function PhotoGrid(p: { media: MediaRef[]; onOpen: (i: number) => void }): JSX.Element | null   // uses m.thumb
export function PhotoViewer(p: { media: MediaRef[]; index: number; open: boolean; onClose: () => void }): JSX.Element | null  // uses m.url; history layer; useHideTabBar(open,'viewer')
export function EmptyState(p: { icon?: IconName; title: string; text?: string; action?: { label: string; onClick: () => void } }): JSX.Element
// Badges.tsx
export function TeamBadge(): JSX.Element                        // «Команда Para», 11/600 caps, tinted --c1
export function UniBadge(p: { short: string }): JSX.Element     // abbrOf(short), e.g. «ТГЭУ»
```

- **Avatar:** when there is no photo it shows a monogram: the first grapheme of `name`, colored with `colorOf(String(user.id))`
  from `lib/uni`. The image uses `loading="lazy"` and `alt=""`, and falls back to the monogram on error. A `null` user renders
  a grey circle. `Avatar.tsx` imports **only** `avatar.css` (`.av*`); it must not import `social-ui.css`, because the tab bar
  puts `Avatar` in the main chunk.
- **Moderator photos:** `PhotoGrid` and `PhotoViewer` accept `m.thumb` / `m.url` as given; ModerationView (FE‑PROFILE) shows
  both side by side (see §E.5), so a mismatched preview is visible.
- **RichText** never uses `dangerouslySetInnerHTML`. It links only `http`/`https` URLs, with
  `rel="noopener noreferrer nofollow ugc" target="_blank"`, and uses `white-space: pre-wrap`.

#### `web/src/brand.ts` (the only change)

```ts
import type { SocialMode } from './social/types';
export interface Brand { /* …existing fields… */ social?: SocialMode }   // hub only; injected by server/src/site.js
```

### E.3 FE‑SHELL exports and duties

```ts
// shell/AppShell.tsx
export interface AppShellProps {
  theme: ThemeApi;
  role: Role | null;                          // null = not chosen yet (StudentApp shows RolePick)
  setRole: (r: Role) => void;
  renderSchedule: (p: ScheduleSlotProps) => ReactNode;
}
export function AppShell(p: AppShellProps): JSX.Element
// shell/TabBar.tsx
export function TabBar(p: {
  tab: TabId; onSelect: (t: TabId) => void; hidden: boolean;
  items: TabId[];                              // ['schedule','chat','profile'], or ['schedule','profile'] when mode is 'off'
  badges: Partial<Record<TabId, boolean>>;
  me: { id: number; name: string; avatar: string | null } | null;
}): JSX.Element
// shell/NavBar.tsx — render ONLY while the owning screen is active; includes the .topfade
export function NavBar(p: { left?: ReactNode; center?: ReactNode; right?: ReactNode; title?: string }): JSX.Element
export function NavButton(p: { label: string; onClick: (el: HTMLElement) => void; dot?: boolean; haspopup?: 'menu' | 'dialog'; disabled?: boolean; children: ReactNode }): JSX.Element
export function NavTextButton(p: { children: string; onClick: () => void; variant?: 'glass' | 'filled'; disabled?: boolean }): JSX.Element
export function BackButton(p: { onClick: () => void; label?: string /* «Назад» */ }): JSX.Element
export function NavPlaceholder(): JSX.Element
export function LargeTitle(p: { title: string; subtitle?: string; onClick?: () => void; ariaLabel?: string; chevron?: boolean }): JSX.Element
export function UniLogoButton(p: { onOpen: (el: HTMLElement) => void }): JSX.Element   // round glass button with .hdr__logo mask, aria-haspopup="menu"
// shell/useUniversityMenu.tsx — the anchored existing UniversityMenu, reusable by any screen (StudentApp and TeacherApp too).
// The open menu is a history layer (useLayer). Anchor: under the element, unless r.bottom + 8 > innerHeight * 0.45 —
// then top = max(bottom of the visible .navrow (or 60) + 8, round(innerHeight * 0.18)), left = r.left clamped to [12, innerWidth − menuWidth − 12].
export function useUniversityMenu(): { open: (el: HTMLElement) => void; element: JSX.Element | null }
// shell/deeplink.ts
export interface DeepLink { tab?: TabId; post?: number; user?: string; compose?: boolean; del?: boolean; mod?: boolean; auth?: AuthOutcome }
/** Parses search + '#auth=', then replaceState removing tab, post, user, compose, delete, mod and '#auth=…'.
 *  Keeps uni, group, from, ok, u and '#m=' untouched (§E.7). */
export function readDeepLink(): DeepLink
// components/*
// no `changes` → NavPlaceholder. Center: <div className="navseg"><Segmented variant="glass" …/></div> (FE-CORE control).
export function ScheduleNav(p: { view: 'today' | 'week'; onView: (v: 'today' | 'week') => void; onUniversities: (el: HTMLElement) => void; changes?: { unseen: boolean; onOpen: () => void } }): JSX.Element
export function ScheduleTitle(p: { kind: 'group' | 'teacher'; title: string; subtitle: string; onPick: () => void }): JSX.Element
export function ChangesSheet(p: { open: boolean; group: Group; changes: ChangeEntry[]; onClose: () => void }): JSX.Element | null
export function ThemeControl(p: { mode: ThemeMode; onChange: (m: ThemeMode) => void }): JSX.Element   // Segmented inset «Авто | Светлая | Тёмная»
export function ThemeSection(p: { theme: ThemeApi }): JSX.Element                                    // non-hub: title «Оформление» + ThemeControl
export function PullRefresh(p: { onRefresh: () => Promise<void>; enabled?: boolean /* true */; target?: string /* '.wrap' */ }): JSX.Element
// hooks/useTheme.ts
export function useTheme(): { mode: ThemeMode; cycle: () => void; set: (m: ThemeMode) => void }   // set persists store('theme')
// lib/uni.ts (additions)
export const DEEP_PARAMS: readonly string[]   // ['tab','post','user','compose','delete','mod']
export function pendingDeepLink(): boolean     // true while the URL carries a DEEP_PARAMS key or '#auth=' (UniversityStart shows a note)
```

**AppShell (binding behavior):**
1. `const SOCIAL_TABS = true` is the frontend emergency switch. `hub = brand.hub && !!brand.id && SOCIAL_TABS`.
2. **Non‑hub**, or `!SOCIAL_TABS`: render
   `renderSchedule({ active: true, command: null, onContext: () => {}, theme })` + `<ToastHost/>` + `<DialogHost/>`.
   There is no `SessionProvider`, and no `social/*` lazy import is executed.
3. **Hub:** AppShell calls `readDeepLink()` once in its **own** `useState` initializer (before `SessionProvider` mounts), then
   renders `<SessionProvider eager={!!dl.auth}><HubShell dl={dl} …/></SessionProvider>`.
4. **Deep links.** Routing:
   - `post`/`compose` → `chat` + `chatLink`;
   - `user` → `chat` + `chatLink.user` when `tab=chat` was present, otherwise `profile` + `profileLink.user`;
   - `delete`/`mod` → `profile` + `profileLink`;
   - an explicit `tab` counts only when none of those five is present;
   - when `session.mode === 'off'` (from `brand.social` at first paint), chat links are dropped and the tab is `schedule`;
   - after mount, `dl.auth` → `session.handleAuthOutcome(dl.auth)`.

   **Hold rule.** If `store('agreed')` was empty at mount, hold the link (except `auth`) and apply it on the first `onContext`
   after onboarding. Links are passed to the panels only **after** the mount effect below has pushed the `'tab'` entry, and
   the panels handle them only once `session.status !== 'loading'`.
5. **Initial tab:** the deep link; else `ls('tab')` if `Date.now() - ls('tabAt') < 30 min`; else `schedule`. Write
   `ls('tab')`/`ls('tabAt')` on every change and on `visibilitychange` → hidden.
6. **Page flags.** Set `document.documentElement.dataset.tab = tab` and add the class `has-tabbar` to `<html>` (remove it on
   unmount).
7. **History (one stack for the app, D29).**
   - The `'tab'` layer exists exactly while the tab is not `schedule`; its `onPop` sets `tab='schedule'`.
   - **Cold start on a non‑schedule tab** (restore, deep link, OAuth return): the mount effect pushes the `'tab'` layer first,
     then sets `chatLink`/`profileLink`. (This push has no user activation; see the Chrome caveat in `layers.ts` rules.)
   - `select(t)` is async and serialized:
     1. `t === tab` → reselect (item 8).
     2. `await unwind(tab === 'schedule' ? 0 : 1)`: this closes every pushed screen and open sheet of the tab being left
        (their `onPop` runs), keeping only the `'tab'` entry.
     3. `t === 'schedule'` → `await unwind(0)` (pops `'tab'`). From `schedule` to another tab → `pushLayer('tab', …)`, then
        switch. Between Chat and Profile → just switch.
   - Legacy overlays opened from Chat or Profile are layers too: FE‑PROFILE wraps its `DocSheet` and `Install` with
     `useLayer`, and `useUniversityMenu` is a layer (FE‑SHELL). Schedule‑tab legacy modals stay as today.
8. **Re‑selecting the active tab** dispatches `new CustomEvent(RESELECT_EVENT, { detail: tab })`. Each tab first pops to its
   root (`await popToRoot()`), then scrolls to the top, then (only Chat) refreshes. `StudentApp` and `TeacherApp` scroll to
   the top.
9. **Scroll.** Save `scrollY` per tab before switching and restore it in `useLayoutEffect`.
10. **Mounting.** Chat and Profile panels mount on first visit and then stay mounted (`hidden` when inactive).
    - Lazy loading: `ChatTab`, `ProfileTab` and `AuthHost` load through `lazyWithReload(() => import(...))`. On a failed
      import while online, it runs `location.reload()` once per session (`sessionStorage.chunkReload`).
    - Each lazy panel sits inside an `ErrorBoundary` whose fallback is `Раздел загрузится, когда появится интернет` +
      `Повторить`.
    - Prefetch all three with `requestIdleCallback` after the first `onContext` while online.
11. **Composition.** Render `ProfileTab` with:
    - `role={role ?? 'student'}`;
    - `setRole={(r) => { setRole(r); select('schedule'); }}`;
    - `openPicker={() => { select('schedule'); setCommand({ kind: 'picker', n: Date.now() }); }}`;
    - `schedule={ctx}`.

    Render AuthHost as
    `{session.prompt && <ErrorBoundary fallback={() => <AuthHostFailed/>}><Suspense fallback={null}><AuthHost/></Suspense></ErrorBoundary>}`,
    where the private `AuthHostFailed` component, in an effect, calls `session.resolvePrompt(false)` and toasts
    «Нет интернета» (offline) or «Раздел загрузится, когда появится интернет» (online), then renders `null`.
12. **Tab bar.** `<TabBar>` gets:
    - `hidden={useTabBarHidden()}`;
    - `items={session.mode === 'off' ? ['schedule','profile'] : ['schedule','chat','profile']}` (if the tab is `chat` when
      the mode becomes `off`, `select('schedule')`);
    - `me={session.status === 'guest' ? null : session.me}` (so `me_cache` shows the avatar while `'loading'`);
    - `badges={{ schedule: !!ctx?.unseenChanges, profile: session.status === 'signed' && !!me && (me.requestsIn > 0 || (me.isAdmin && me.modQueue > 0)) }}`.

    Also render `<div className="tabfade" aria-hidden="true"/>`, `<ToastHost/>` and `<DialogHost/>`, and call
    `useKeyboardWatcher()`.
13. **Context and consent.** `onContext(c)`: ignore it if shallow‑equal to the last context. On the **first** context, if
    `session.status === 'loading'`, call `session.refresh()` (it reuses an in‑flight request, so it never double‑fetches);
    then apply a held deep link and start the prefetch.
14. **Coach callout (P1).** Show the callout from ux.md §3.9 once (`ls('coach_chat')`), never while `mode === 'off'`.

**TabBar:** ux.md §3.1. Details:
- Labels are `Расписание`, `Обсуждения`, `Профиль`; only the ids in `items` render (2 or 3 items; the capsule shrinks).
- Semantics: `role=tablist` with `aria-label="Разделы"`, roving focus, arrow keys.
- The signed‑in profile icon is `<Avatar size={26}>` (FE‑CORE).
- Badge dot texts: `, есть непросмотренные правки` and `, есть заявки в друзья`.
- When hidden: `.tabbar.is-hidden` + `inert`.

**App.tsx** (FE‑SHELL):
- The top‑level `App` owns `useTheme()`, `role` (`store('role')`) and `setRole` (persists `store('role')`). It renders
  `<AppShell renderSchedule={(slot) => role === 'teacher' ? <TeacherApp {...slot} onSwitchRole={() => setRole('student')}/> : <StudentApp {...slot} setRole={setRole}/>}/>`.
- `StudentApp` is today's body in the same file, with these changes:
  - `Header`, `TopBar`, `.seg` and the `Правки` tab are replaced by `ScheduleNav` + `ScheduleTitle` + `ChangesSheet`. The view
    type becomes `'today'|'week'`.
  - Compute `unseen` once and use it for the dot, for `html.is-changed` and for `onContext`.
  - `onContext` is called **from a `useEffect` keyed on `[agreed, sel, gname, subtitle, unseen, myUrl]`**, and only when
    `store('agreed') && sel` (a group the user actually chose, never the `groups[0]` fallback). Payload:
    `{kind:'group', title: gname, subtitle, unseenChanges: unseen, installUrl: myUrl}`.
    `subtitle = [uniShort, group.sheet, code].filter(Boolean).join(' · ')`, where
    `uniShort = brand.label.replace(/^Расписание\s+/i, '')`.
  - The 1‑second tick runs only while `active` (clear the interval when `!active`; one immediate tick when it becomes
    active again), so hidden tabs do not re‑render every second.
  - `useHideTabBar(consent || rolePick || (picker.open && picker.first), 'onboarding')`.
  - `command.kind === 'picker'` → `setPicker({open:true, first:false})`. `'changes'` → `openChanges()`.
  - The page container becomes `<div className="wrap wrap--sched">` (the same in `TeacherApp`).
  - Render `ScheduleNav`/`NavBar` only while `active`. Use `<PullRefresh enabled={active} target=".wrap--sched">`.
  - `overlayOpenRef.current = !active || consent || picker.open || installOpen || docOpen || statsOpen || reviewsOpen ||
    promptOpen || changesOpen || openLayerCount(['tab']) > 0`, so the review prompt never pops on another tab or over a sheet
    (the university menu is now a layer, so `uniAnchor` is replaced by the layer count).
  - The university menu comes from `useUniversityMenu()` (replaces the local `uniAnchor` state).
  - Render `ThemeSection` between `.extras` and `SiteFooter` only when `!brand.hub`.
  - Keep `trackVisit`, `seenTs`, the review triggers, the personal link and every modal **unchanged**.
- `TeacherApp` props become `ScheduleSlotProps & { onSwitchRole: () => void }`. It drops the `mode/cycle` props and gets the
  same chrome (ScheduleNav without `changes`, and ScheduleTitle with `kind:'teacher'` and subtitle `Преподаватель · {uniShort}`).
  It gets the same gating (`onContext` from an effect, only when `agreed && teacherKey`, with `installUrl: ''`), the same
  paused tick, `useHideTabBar(picker.open && picker.first, 'onboarding')`, and handles `command.kind === 'picker'` by opening
  its `TeacherPicker` (`'changes'` is ignored).
- `PullRefresh` gets the new props. `onStart` ignores touches whose target is inside
  `.sheet, .modal, .ui-sheet, .ui-as, .umenu, .pview, .rcmp, [data-no-ptr]`. The effect depends on `[enabled, target]`.
- `lib/uni.ts`:
  - (a) If the URL has `post` or `user`, `store('uni')` is non‑empty and `?uni=` differs from it, run
    `location.replace('/?' + params with uni=<saved>)` and return `false`.
  - (b) Every `history.replaceState` in `initUni` must **preserve all other query params and the hash** (today it drops them),
    except that the `#m=` fragment is still consumed.
  - (c) `DEEP_PARAMS = ['tab','post','user','compose','delete','mod']`. The saved‑uni redirect in the `!brand.id` branch
    (`location.replace('/?uni=' + saved)`) and `openUni(id)` both **carry every present `DEEP_PARAMS` key and a `#auth=…`
    hash** into the new URL. So a shared `?user=…`, a Play reviewer's `/?tab=profile&delete=1`, or a deep link opened on a new
    phone survives UniversityStart.
  - (d) `pendingDeepLink()` is true while the URL has any `DEEP_PARAMS` key or `#auth=`; POLICY's `UniversityStart` uses it.
- `index.html`: the viewport meta becomes
  `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`.
- `index.css`:
  - add the tokens from §E.8;
  - delete `.cbar*`, `.hdr__ico`, `.hdr__logo-btn`, the `.hdr` layout and `.seg*`, but **keep `.hdr__logo` and `.hdr__btn`**;
  - `.wrap` gets `padding-top: calc(var(--nav-space))`;
  - add `html.has-tabbar .wrap{padding-bottom:calc(var(--tabbar-space) + 28px)}`,
    `html.has-tabbar .nudge{bottom:calc(var(--tabbar-space) + 10px)}` and
    `html[data-tab]:not([data-tab="schedule"]) body::before, …::after{opacity:0}`;
  - `.topfade.is-compact` height becomes `calc(var(--nav-space) + 8px)`, compact from `scrollY > 4`;
  - `.ptr` gets `padding-top: calc(var(--nav-top) + var(--nav-h) + 4px)`;
  - add the reduced‑transparency rules for `.tabbar` and `.navbtn` (FE‑CORE writes the same rule for the glass `Segmented` in
    `ui.css`);
  - change `#doc{z-index:90}` to `#doc, .sheet--doc{z-index:90}` (§D).

### E.4 FE‑CHAT exports and duties

```ts
// social/chat/ChatTab.tsx
export default function ChatTab(p: ChatTabProps): JSX.Element
// social/chat/PostCard.tsx
export function PostCard(p: { post: Post; clamp?: boolean; onOpen: (focusReply?: boolean) => void; onOpenUser: (username: string) => void; onChange: (p: Post | null) => void }): JSX.Element
// social/chat/ThreadView.tsx
export function ThreadView(p: { postId: number; focusComposer?: boolean; onBack: () => void; onOpenUser: (username: string) => void }): JSX.Element
```

The design is ux.md §5, with these binding overrides:
- **Stack:** `type ChatScreen = { kind: 'thread'; id: number; focus?: boolean } | { kind: 'user'; username: string }`,
  through `useStack`. The user screen renders FE‑PROFILE's `UserProfileView`.
- **Opening a user** (author avatar or name, or a mention): a guest gets
  `session.ensure('profile', currentReturnTo({ user: username }))` (the return URL carries `tab=chat`, so after sign‑in the
  link comes back to Chat as `link.user`). When it resolves `true`, push the `user` screen.
- **Feed nav row:** left `UniLogoButton` (via `useUniversityMenu`); right `NavButton` `Новый пост` (icon `compose`), which runs
  `ensure('post', currentReturnTo({ compose: 1 }))` and then opens the Composer.
- **Title:** `LargeTitle` `Обсуждения` with the subtitle `Неофициальное сообщество · {uniShort}`.
- **Guest row** (`.chat-guest`, at the top of the feed while `status==='guest'`):
  `Читать можно без аккаунта. Писать, отвечать и ставить отметки — после входа.` + a button `Войти` →
  `requestSignIn('account')`.
- **Chips:** `Все` + `CATEGORIES`. The selection lives in `sessionStorage.chatCat`.
- **States** (ux.md §5.14). These strings are final:
  - empty: `Здесь пока тихо` / `Задай вопрос или поделись новостью — обсуждение увидят все в {uniShort}.` / `Написать пост`;
  - empty category: `В разделе «{label}» пока пусто`;
  - error: `Не удалось загрузить обсуждения` + `Повторить`;
  - offline: **`Без интернета.`** `Обсуждения обновятся, когда появится связь.`;
  - `mode off` (normally ChatTab is not mounted then, D30; this state covers a mode change while it is open):
    `Обсуждения скоро откроются` / `Мы готовим место для общения внутри вуза. Загляни чуть позже.`;
  - `mode readonly`: a row `Сейчас обсуждения доступны только для чтения.`; the compose/reply/like controls are disabled, while
    `Пожаловаться`, `Заблокировать`, `Скрыть посты` and deleting your own post stay available;
  - banned: a row `{banText(me.banned)} Читать можно. Если это ошибка — напиши @skycoax.`;
  - end of the list: `Это всё`.
- **PostCard:**
  - `UniBadge short={post.uniShort}` when `post.uni !== brand.id`. **Never render `author.uni`/`author.uniShort`** (they are
    `null` for guests anyway, V7);
  - `TeamBadge` when `author.team`;
  - own hidden post: a banner `Скрыто до проверки модератором — на пост пожаловались.`;
  - tombstone: `Пост удалён` / `Ответ удалён`;
  - `author === null` on a live post: `Удалённый аккаунт`;
  - `reported` collapses the post to `Жалоба отправлена · Показать`;
  - `replyTo.username === null` shows `в ответ на удалённое сообщение`;
  - like: optimistic, with `emit('like')`;
  - `•••` → `useSocialActions().postMenu(post, returnTo)`; inside ThreadView every action that may need sign‑in (like, reply,
    report, block, author tap) passes `currentReturnTo({ post: rootId })`, so a guest comes back to the same thread.
- **Composer (full `Sheet`):** ux.md §5.8, plus these rules:
  - photos go through `prepareImage` one after another, and then `socialApi.uploadMedia` with at most 2 at a time;
  - tiles have the states preparing, uploading, done and failed;
  - `Можно добавить до 4 фото`;
  - the category is required (`Выбери тему поста`);
  - the length check is `textTooLong(text, limits.text)` (graphemes **and** the 4000 UTF‑16 cap); the same in `.rcmp`;
  - when the category is `company`, the photo button is disabled and the hint `В теме «Компания» — только текст` shows. If
    photos are already attached, `Опубликовать` stays disabled until they are removed or the category changes;
  - before publishing, `hasPhone(text)` → `confirmDialog({ title: 'В тексте есть номер телефона', message: 'Его увидят все, даже без аккаунта. Всё равно опубликовать?', confirm: 'Опубликовать', cancel: 'Изменить' })`;
  - server errors are inline, and the text is kept;
  - success: `emit('post-created')`, toast `Опубликовано`;
  - drafts go through `drafts.ts`: `ls('draft_post_' + brand.id)` = `{ text, category, media: UploadedMedia[] }`, debounced
    500 ms. A restored media that returns 404 shows `Фото устарело`;
  - removing an uploaded tile calls `deleteMedia(id)`;
  - Cancel on a dirty composer → `Удалить черновик?` with `Удалить` / `Сохранить черновик` / `Отмена`.
- **ThreadView:** ux.md §5.7. `useHideTabBar(true,'thread')`.
  - The reply composer `.rcmp` allows at most 1 photo, and none when the root category is `company`.
  - Guests see the bar `Войди, чтобы ответить` + `Войти`.
  - A 404 shows `Пост удалён` / `Возможно, автор удалил его или он нарушал правила.` + `Назад`.
- **Events:** keep every list consistent through `useSocialEvents`. Events: `post-created`, `post-deleted`, `like`, `block`,
  `hide-user`, `reported` and `me-changed`. On `block`/`hide-user`, drop that author's items at once.
- **Deep links:** handle `link` only when `active` and `session.status !== 'loading'` (effect keyed on both). `link.post` →
  push the thread. `link.compose` → `ensure('post')`, and the Composer only if it resolves `true`. `link.user` →
  `ensure('profile')`, then push the `user` screen. Then call `onLinkHandled()` exactly once.
- **Reselect:** pop to root, then scroll to the top, then refresh page 1.

### E.5 FE‑PROFILE exports and duties

```ts
// social/profile/ProfileTab.tsx
export default function ProfileTab(p: ProfileTabProps): JSX.Element
// social/profile/UserProfileView.tsx (used by Chat too)
export function UserProfileView(p: { username: string; onBack: () => void; onOpenThread: (postId: number) => void; onOpenUser: (username: string) => void }): JSX.Element
// social/profile/AuthHost.tsx (lazy-loaded by AppShell; renders the sheet for session.prompt, then calls session.resolvePrompt)
export default function AuthHost(): JSX.Element | null
// social/profile/RulesSheet.tsx
export function RulesSheet(p: { open: boolean; mode: 'accept' | 'read'; onAccept?: () => void; onClose: () => void }): JSX.Element | null
// social/profile/GoogleButton.tsx
export function GoogleButton(p: { onClick: () => void; disabled?: boolean; caption?: string }): JSX.Element   // label «Продолжить с Google», 4-color G mark
```

**AuthHost** maps `session.prompt` like this (AppShell wraps it in an `ErrorBoundary`, §E.3 item 11):
- `signin` → `SignInSheet`;
- `setup` → `SetupSheet` (dismissible: `Позже`, scrim, swipe and Back all call `resolvePrompt(false)`);
- `rules` → `RulesSheet mode="accept"`: `acceptRules(config.rulesVersion)`, then `setMe`, then `resolvePrompt(true)`;
- `banned` → a bottom sheet titled `Публикация ограничена` with the text `{banText(ban)} Читать обсуждения, жаловаться и
  удалить аккаунт можно.` and the button `Понятно`.

**SignInSheet** (bottom sheet). All strings are final:

| Element | String |
|---|---|
| Title by reason | `post` `Войди, чтобы написать пост` · `reply` `Войди, чтобы ответить` · `like` `Войди, чтобы ставить отметки` · `friend` `Войди, чтобы добавлять друзей` · `block` `Войди, чтобы блокировать` · `report` `Войди, чтобы пожаловаться` · `profile` `Войди, чтобы открывать профили` · `search` `Войди, чтобы искать людей` · `account` `Вход в Para` · `expired` `Сессия истекла — войди снова` |
| Body | `Расписание работает и без аккаунта. Аккаунт нужен, чтобы писать в «Обсуждениях», вести профиль и добавлять друзей.` |
| Extra line for `report` | `Или напиши нам в Telegram: @skycoax` (link `https://t.me/skycoax`) |
| Age question | `Сколько тебе лет?`, a radio group with `Младше {minAge}` · `{minAge}–17` · `18 и старше` (the middle option is not rendered when `minAge >= 18`); nothing preselected; `minAge = session.config?.minAge ?? 16` |
| Consent checkbox (unchecked) | `Принимаю Правила обсуждений и Политику конфиденциальности` (the two names open `RulesSheet mode="read"` and `DocSheet`, both inside the sheet as layers) |
| Data note | `Para получит от Google только имя и почту. Почту никто не увидит.` |
| Primary | `GoogleButton` → `session.signIn({ returnTo: prompt.returnTo, intent: 'signin', age, accept: true })`. It stays disabled until an allowed age is chosen and the box is ticked. |
| Not configured (`google === false`) | disabled + caption `Вход через Google скоро появится. Читать обсуждения можно и без аккаунта.` |
| Offline | disabled + caption `Нет интернета — войти не получится` |
| Under age (choosing `Младше {minAge}` → `setAgeBlock()`; also shown directly while `ageBlocked()`, **except in delete mode**) | title `Обсуждения — с {minAge} лет`, text `Расписание, правки и отзывы работают как раньше.`; for reason `report` also the line `Или напиши нам в Telegram: @skycoax` (hiding an author stays in the post's `•••` menu); button `Понятно` |
| Secondary | text button `Не сейчас` → `resolvePrompt(false)` |
| Dev (`session.dev`) | text button `Войти для разработки` → field `Имя латиницей` + `Войти` → `session.devSignIn(name, age ?? 'adult', reason === 'delete' ? 'delete' : 'signin')` |
| **Delete mode** (reason `delete`) | title `Удаление аккаунта`, text `Войди тем же аккаунтом Google, чтобы удалить его. Новый аккаунт при этом не создастся.`, no age question, no checkbox, ignores `ageBlocked()`, works in every `mode`; `signIn({ intent: 'delete', returnTo, accept: false })` |

**SetupSheet** (full sheet, **dismissible**; opens by itself only after `#auth=ok`, otherwise from `ensure()` or the
`Заверши профиль` card):
- Title `Почти готово`, subtitle `Так тебя увидят в обсуждениях.`
- Note `Имя, имя пользователя и фото видят все в «Обсуждениях».`
- An optional avatar (`Добавить фото` → `AvatarCropper` → `uploadMedia(kind avatar)`).
- `Имя` is prefilled with `me.name`.
- `@` uses `UsernameField`, prefilled with `me.suggestedUsername`. Its status line:
  - `Проверяю…`;
  - `Свободно`;
  - the server `error` verbatim;
  - `3–20 символов: латинские буквы, цифры и знак подчёркивания`.
- `Продолжить` → `updateMe({ name, username, avatar? })` → `setMe` → `resolvePrompt(true)`.
- Bar left: text button `Позже` → `resolvePrompt(false)`.
- Text button at the bottom `Выйти из аккаунта` → `signOut()` → `resolvePrompt(false)`.

**RulesSheet:**
- Accept mode shows the eyebrow `Мы обновили правила`.
- Title from `RULES_TITLE`, then `RULES_INTRO` and the list `RULES_POINTS` (POLICY's `rules.ts`).
- A link `Полный текст правил` (`/rules`, new tab).
- Buttons `Принимаю` / `Не сейчас`. Read mode has only `Готово`.

**ProfileTab** (the root has no nav buttons, only `NavBar` with no slots + `LargeTitle` `Профиль`):
- **`session.status === 'loading'`:** render the settings list (it needs no network) and a skeleton header from `me_cache`;
  no account actions until ready.
- **`session.mode === 'off'` (D30):** the guest card's button is disabled with the caption `Обсуждения временно недоступны`.
  A signed‑in user keeps the header (without `Изменить профиль`/`Поделиться`) and the `Аккаунт` section (`Выйти`,
  `Выйти на всех устройствах`, `Удалить аккаунт`); the `Общение`, `Конфиденциальность`, `Мои посты` and `Модерация` sections
  are hidden. The schedule/app sections still work.
- **Guest card:**
  - `Гостевой режим`;
  - `Расписание работает без входа. Войди через Google, чтобы писать в обсуждениях, заводить друзей и вести свой профиль.`;
  - `GoogleButton` → `requestSignIn('account')`;
  - the note `Другим будут видны имя, @имя пользователя, фото и твои посты. Почту Google не видит никто.`
- **`Заверши профиль` card** (signed in, `me.needsProfile`), in place of the header: title `{me.name}`, text
  `Заверши профиль, чтобы писать в обсуждениях и добавлять друзей.`, button `Заверши профиль` →
  `session.ensure('post', currentReturnTo())` (that opens SetupSheet, then RulesSheet if needed; the result is ignored). When
  `mode !== 'on'` or `me.banned`, the button is not rendered and the text is `Профиль не заполнен.`
- **Signed‑in header:** ux.md §6.3 without the group chip.
  - Counts: `{n} друг/друга/друзей · {n} пост/поста/постов`.
  - Buttons `Изменить профиль` / `Поделиться` (`share(userLink(me.username))`).
- **`Мои посты`:** the first 3 roots from `socialApi.user(me.username)`, with `Все посты` → the `user` screen. Empty:
  `Здесь появятся твои посты`.
- **SettingsList** (`ListSection`/`ListRow`):

| Section | Row | When | Action |
|---|---|---|---|
| `Расписание` | `Вуз` → `{uniShort}` | always | `useUniversityMenu().open(el)` |
| | `Группа` → `{schedule.title}` (teacher: `Преподаватель` → `{title}`) | always | `openPicker()` |
| | `Режим` → `Segmented` `Студент \| Преподаватель` | always | `setRole(r)` |
| `Оформление` | `ThemeControl` | always | `theme.set(m)` |
| `Общение` | `Друзья` (badge `requestsIn`) · `Найти людей` · `Заблокированные` | signed in | push `friends` / `search` / `blocked` |
| `Конфиденциальность` | `Кто видит Telegram и Instagram` → `Segmented` `Друзья \| Все, кто вошёл` (for minors the second option is disabled, footer `До 18 лет — только друзья`) | signed in | `updateMe({linksVisibility})` optimistic |
| | `Показывать меня в поиске` → `Switch` (footer `Если выключить, найти тебя можно будет только по точному @имени.`) | signed in | `updateMe({searchable})` |
| | `Кто может добавить в друзья` → `Segmented` `Все \| Никто` (for minors, footer `До 18 лет заявки по умолчанию выключены. Включай, только если знаешь, кто будет писать.`) | signed in | `updateMe({friendRequests})` |
| `Скрытые авторы` | `Скрытые авторы` → count | guest with `hiddenUsers().length` | push `hidden` (P1) |
| `Модерация` | `Жалобы` (badge `modQueue`) | `me.isAdmin` | push `moderation` |
| `Приложение` | `На главный экран` | `!isStandalone() && !!schedule?.installUrl` | the existing `Install` modal with `schedule.installUrl`, wrapped in `useLayer` |
| | `Правила обсуждений` | always | `RulesSheet mode="read"` |
| | `Политика конфиденциальности` | always | the existing `DocSheet`, wrapped in `useLayer` |
| | `Написать автору` ↗ | always | `https://t.me/skycoax` |
| | `Удалить аккаунт` | guest | `requestSignIn('delete', currentReturnTo({ delete: 1 }))` (works in every mode) |
| `Аккаунт` | `Аккаунт Google` → `me.email` | signed in | info |
| | `Выйти` (accent) | signed in | `confirmDialog({title:'Выйти из аккаунта?', message:'Расписание и настройки на этом телефоне останутся.', confirm:'Выйти'})` → `signOut()` |
| | `Выйти на всех устройствах` | signed in | `confirmDialog({title:'Выйти на всех устройствах?', message:'Придётся снова войти на каждом телефоне и компьютере.', confirm:'Выйти'})` → `signOut(true)` |
| | `Удалить аккаунт` (destructive) | signed in | `DeleteAccountSheet` |

  Footer: `Para — неофициальное приложение и не связано ни с одним вузом.`
- **EditProfileSheet:**
  - fields: `Имя`, `@`, `О себе` (≤ 160, the counter appears when 40 or fewer are left), `Telegram` (prefix `t.me/`) and
    `Instagram` (prefix `instagram.com/`);
  - a row `Мой вуз` → `{me.uniShort}` or `Не указан`; tap → `chooseAction` with every university from `getUniversities()`
    (`web/src/api.ts`, read‑only use) plus `Не показывать` (→ `uni: ''`); footer `Виден только тем, кто вошёл.`;
  - `Изменить фото` → `Выбрать фото` / `Удалить фото` / `Отмена`;
  - the client mirrors the §B.4 rules;
  - `Готово` sends `PATCH` with only the changed fields → `setMe`, toast `Сохранено`. Server field errors show under the field;
  - `Отмена` on a dirty form → `Отменить изменения?` with `Отменить изменения` / `Продолжить редактирование`.
- **AvatarCropper:** ux.md §6.5. `cropSquare` → `setAvatar` → toast `Фото обновлено`.
- **FriendsView:** `Друзья · {n}` | `Заявки · {n}`.
  - Incoming: `Принять` / `✕` (`aria-label="Отклонить"`). Outgoing: `Отменить`.
  - Empty states: `Пока нет друзей` / `Найди одногруппников через поиск.` + `Найти людей`; `Новых заявок нет`.
  - Toast `Теперь вы друзья`.
  - Decline, cancel and remove call the API directly (no `ensure`; they work in `readonly`). Every friend action emits
    `{type:'relation'}`.
- **PeopleSearch:** the field `Имя или @username`, at least 2 characters, a 300 ms debounce and an aborted previous request.
  - Relation buttons: `Добавить` · `Заявка отправлена` · `Принять` · `В друзьях`.
  - After any friend action, `emit({type:'relation', userId, relation})` (the session refreshes the badge).
  - Hint `Найди одногруппников и друзей по имени или @username`. `Никого не нашли`. `Не удалось выполнить поиск` +
    `Повторить`.
- **UserProfileView:** ux.md §6.8, with these changes.
  - There is no group line. Links appear only if `links` is set, or `linksHidden==='friends'` → `Контакты видны только друзьям`.
  - `canFriend === false` with relation `none` → the text `Не принимает заявки в друзья`.
  - Relation buttons:
    - `Добавить в друзья`;
    - `Заявка отправлена`, which offers `Отменить заявку`;
    - `Принять заявку` + `Отклонить`;
    - `В друзьях`, which offers `Удалить из друзей` → `Удалить @{u} из друзей?`.
  - `blocked`: `Этот пользователь заблокирован` + `Разблокировать`.
  - A 404 shows `Профиль недоступен` / `Возможно, аккаунт удалён или скрыт.` + `Назад`.
  - `•••` → `userMenu`.
  - Admins only, when `user.banned`: a row `{banText(user.banned)}` and a button `Снять ограничение` (action `unban`, toast
    `Ограничение снято`, emit `moderated`).
- **BlockedView:** `Разблокировать`. Empty: `Ты никого не блокируешь`.
- **HiddenView (P1):** rows `{name}` / `@{username}` from `hiddenUsers()` (no network), button `Показать снова`.
- **DeleteAccountSheet** (bottom, large):
  - title `Удалить аккаунт?`;
  - text `Удалятся профиль, почта, посты, ответы, фото, отметки «нравится», друзья и блокировки. Вернуть их не получится. Расписание и настройки на этом телефоне останутся.`;
  - a link `Что остаётся после удаления` → `/delete-account#kept` (new tab);
  - `Switch`/checkbox `Понимаю, что это нельзя отменить`;
  - buttons `Удалить аккаунт навсегда` (destructive‑filled, disabled until the box is ticked) and `Отмена`;
  - while working: `Удаляю…`;
  - success: `signOut` locally without calling logout, `clearSocialLocal()`, toast `Аккаунт удалён`;
  - offline: `Нужен интернет, чтобы удалить аккаунт.`;
  - error: the server text, or `Не получилось удалить аккаунт. Попробуй ещё раз или напиши @skycoax.`
- **ModerationView:** ux.md §6.12.
  - Header (from `adminStats()`, one line, `--ink-60`): `Пользователей: {users} · сегодня {postsToday} {пост/поста/постов} и
    {repliesToday} {ответ/ответа/ответов} · скрыто {hiddenPosts} · ограничено {bannedUsers}`. The audit log has no screen in
    v1 (API only).
  - Segments: `Открытые · {n}` | `Решённые`.
  - Case eyebrow: `ПОСТ` / `ОТВЕТ` / `ПРОФИЛЬ` (from `target` and `snapshot.kind`, so it works when `post` is null) ·
    `{uniShort}` · `{n} {plural(n, ['жалоба','жалобы','жалоб'])}` · relative time.
  - Show `rawText`. If `post` is null, show the `snapshot` (text, name, username), with a note `Автор удалил публикацию`.
  - **Photos:** for every photo of `post.media` (or `snapshot.media`), render the preview (`thumb`) and the original (`url`)
    side by side, captioned `Превью` / `Оригинал`, each tappable to open full size. For a profile, the avatar at 128
    (`avatar`) and 512 (`avatarFull`). A mismatch is grounds for a permanent ban (rules.html).
  - Reason counts use the `REPORT_REASONS` labels. Notes are italic.
  - Buttons: `Удалить` · `Скрыть`/`Вернуть` · `Ограничить…` (when `user?.status !== 'banned'`) or `Снять ограничение` (when
    `user?.status === 'banned'`; shown in open **and** closed cases; toast `Ограничение снято`) · `Сбросить…` (users) ·
    `Отклонить`. Every successful action emits `{type:'moderated'}`.
  - Empty: `Жалоб нет`.
  - Closed cases show `Решено · {resolvedBy} · {relTime}`.
- **Deep links:** handle `link` only when `active` and `session.status !== 'loading'`.
  - `link.user` → a guest gets `ensure('profile')` first, then push the `user` screen.
  - `link.del` → signed in: `DeleteAccountSheet`; guest: `requestSignIn('delete', currentReturnTo({ delete: 1 }))`.
  - `link.mod` → `ModerationView` when `isAdmin`.
  - Then call `onLinkHandled()` exactly once.

### E.6 POLICY exports and deliverables

**`web/src/social/rules.ts`** (the export names are frozen; the wording may be polished):
```ts
// Правила обсуждений внутри приложения (коротко, на «ты»). Полный текст — server/hub/rules.html.
// Существенная правка → попросить BE поднять social.rulesVersion (server/src/config.js).
export const RULES_TITLE = 'Правила обсуждений';
export const RULES_INTRO = 'Обсуждения — неофициальное сообщество студентов твоего вуза: вуз его не ведёт. Чтобы здесь было нормально всем:';
export const RULES_POINTS: readonly string[] = [
  'Уважай людей: без оскорблений, травли, угроз и унижений.',
  'Без 18+, жестокости, спама, рекламы и продажи работ и ответов.',
  'Чужие фото, номера и личные данные — только с согласия. Посты «кто это на фото?» удаляются.',
  'Para — не сайт знакомств. «Компания» — чтобы найти, с кем учиться, заниматься спортом и ходить на мероприятия.',
  'Не выдавай себя за других и не публикуй ничего незаконного.',
  'Всё, что ты публикуешь, видят все — даже без аккаунта.',
  'За нарушения — удаление, запрет писать или блокировка. Заметил нарушение — «•••» → «Пожаловаться».',
];
export const LINKS = { policy: '/policy', rules: '/rules', deletion: '/delete-account', telegram: 'https://t.me/skycoax' } as const;
```

**`web/public/sw.js`** (exact logic; keep the existing comments' style):
```js
const CACHE = 'para-v1';
const PAGE = '/__page';
const WAIT_MS = 6000;
const API = /^\/api\/(schedule|teachers|teacher|universities|reviews|stats\/summary)$/;
const APP_PAGE = /^\/(index\.html)?$/;   // сохраняем как «страницу приложения» только её саму

const ASSET_TTL = 30 * 864e5;            // файл сборки, которым не пользовались 30 дней, выбрасываем
const ASSET_TOUCH = 7 * 864e5;           // дату использования обновляем не чаще раза в неделю

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    // Раньше как страница приложения сохранялся любой переход (например, /policy) — такую копию выбрасываем.
    const cache = await caches.open(CACHE);
    const page = await cache.match(PAGE);
    const html = page ? await page.clone().text() : '';
    if (page && !html.includes('id="root"')) await cache.delete(PAGE);
    // Старые файлы сборки копятся с каждой выкладкой. Те, на которые ссылается сохранённая страница, не трогаем;
    // без даты (сохранены прежней версией) — ставим дату сейчас.
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (!path.startsWith('/assets/') || html.includes(path)) continue;
      const res = await cache.match(req);
      const at = Date.parse(res && res.headers.get('x-para-saved') || '');
      if (!at) await save(req, res);
      else if (Date.now() - at > ASSET_TTL) await cache.delete(req);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // /policy, /rules, /delete-account, /api/auth/* — обычные переходы, только сеть.
    if (APP_PAGE.test(url.pathname)) networkFirst(event, PAGE);
    return;
  }
  if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(req));
  else if (API.test(url.pathname) || url.pathname.startsWith('/brand/') || url.pathname === '/manifest.json') {
    networkFirst(event, req.url);
  }
  // /api/auth/*, /api/social/*, /api/media/* — не перехватываем (фото кеширует сам браузер, до 7 дней).
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) {
    // Файлом пользуются — продлеваем ему жизнь (не чаще раза в неделю).
    const at = Date.parse(hit.headers.get('x-para-saved') || '');
    if (!at || Date.now() - at > ASSET_TOUCH) save(req, hit.clone()).catch(() => {});
    return hit;
  }
  const res = await fetch(req);
  if (res.ok) save(req, res.clone()).catch(() => {});
  return res;
}
// networkFirst и save — без изменений (save(key, res) уже ставит x-para-saved и принимает Request или строку).
```

**Hub pages** use the same HTML/CSS skeleton as today's `policy.html`, light and dark, «вы», with no external scripts:
- `server/hub/policy.html`: compliance.md §1, **edited to the facts table below**.
- `server/hub/rules.html`: compliance.md §2b with these edits:
  - remove the "предупреждение" action;
  - the restriction terms are 1, 7 or 30 days or permanent;
  - a moderator can reset the name, photo, «О себе» or links;
  - add rule `Обсуждения доступны с 16 лет` (follows `SOCIAL_MIN_AGE`);
  - add rule: an image whose preview deliberately differs from the full photo (to slip content past moderators) → permanent
    restriction;
  - minors: friend requests are off by default; contacts are visible to friends only;
  - the contact email is the placeholder `[почта для связи]`;
  - keep `#children`, `#safety`, `#report` and `#appeal`.
- `server/hub/delete-account.html`: the text of compliance.md §3, edited as follows.
  - The app steps: 1) open «Профиль»; 2) at the bottom tap «Удалить аккаунт»; 3) tick «Понимаю, что это нельзя отменить» and
    tap «Удалить аккаунт навсегда».
  - The button link is `/?tab=profile&delete=1` (not `/?open=…`); `lib/uni.ts` carries it through UniversityStart when the
    browser has no university yet.
  - The page works in every `SOCIAL_MODE`, `off` included (the server keeps the deletion subset).
  - The kept items follow the facts table.
  - It has an inline same‑origin script (about 60 lines) that writes user data only through `textContent`:
    1. Handle `#auth=<o>` with the page texts from §B.5, then `history.replaceState` without the hash.
    2. Call `fetch('/api/auth/me', {cache:'no-store'})`:
       - 404 or an error → only the static instructions;
       - `user:null` → the button `Продолжить с Google` → `location.assign('/api/auth/google/start?intent=delete&return=%2Fdelete-account')`.
         If `google:false`, the button is disabled with `Вход через Google пока недоступен. Напишите нам — удалим вручную.`;
       - a user → `Вы вошли как @{username}` (or `{name}`), a checkbox `Понимаю, что это нельзя отменить`, and a red button
         `Удалить аккаунт навсегда` → `fetch('/api/social/me', {method:'DELETE', headers:{'Content-Type':'application/json','X-Para':'1'}, body:'{"confirm":true}'})`.
         Success → `Аккаунт удалён. Расписанием можно пользоваться и дальше.` An error shows `json.error`.

**Facts that `policy.html`, `rules.html`, `delete-account.html`, `DocSheet` and `play-listing.md` must state** (and nothing that
contradicts them):

| Topic | Fact |
|---|---|
| Guests | The schedule, reviews, stats and reading «Обсуждения» work without an account. Nothing new is collected from guests. |
| Account | Optional. Needed only to write, keep a profile and add friends. Sign‑in with Google. Minimum age **16** (the `SOCIAL_MIN_AGE` value). The age is asked before Google as a group (`16–17` / `18 и старше`). No birth date is asked. Consent to the rules and the policy is recorded at sign‑in (version and time); signing in only to delete the account records nothing. |
| Data from Google | Google ID, email (and whether it is verified), first name (only to prefill «Имя»). **Not used:** the Google photo, contacts, or any other Google data. No Google scripts on our pages. Access can be revoked at myaccount.google.com/connections. |
| Public to everyone, including guests | Posts, replies, photos in them, the author's name, @username and avatar, category, time, the university **where the post was written**, like counts. |
| Visible to signed‑in users only | The profile page («О себе», «мой вуз», friend and post counts) and people search. «Мой вуз» is never sent to guests, not even inside posts. |
| Telegram and Instagram | Visible to friends (default) or to all signed‑in users. Under 18: friends only. |
| Friend requests | Anyone signed in can send one unless the person chose «Никто». **Under 18 the default is «Никто»**; the person can turn requests on. |
| Private | Email, Google ID, age group, the friends list, the blocks list, who liked something, and who reported. |
| Search | By name and @username, signed‑in only. «Показывать меня в поиске» (off by default for under‑18). The exact @username always finds the person. The query is not logged or stored. |
| DMs | None. |
| Photos | Chosen by the user through the system picker. Re‑encoded on the phone. The server removes metadata (EXIF, GPS, device) and stores them under random names. Deleted immediately when the post or account is deleted. Unsent uploads are deleted within 24 h. They may stay **up to 7 days** in the browser cache of people who already saw them. Photos are not in backups. |
| Profanity | Masked automatically. The original text is kept for moderation. |
| Reports | The reporter is hidden from the author. A text snapshot of the reported content is stored for moderators. Reports are deleted 180 days after a decision. If the reporter deletes their account, their reports stay but are anonymized. |
| Moderation | The developer and the people he names (verified Google accounts). They see the content, reports and public profile, **not** the email. Actions: hide, delete, restrict posting for 1, 7 or 30 days or permanently (reading is still allowed), and reset the name, photo, «О себе» or links. A moderation log without content is kept for 180 days. |
| Auto‑hide | Several reports (one for «Угроза ребёнку») hide a post until a moderator checks it. |
| Ban evasion | A salted irreversible fingerprint of the Google ID of a banned account that was deleted, kept until the ban ends and at most 1 year. |
| Sessions | The cookie `__Host-para_sid` (HttpOnly, not readable by scripts) exists only while signed in. It lasts 180 days of inactivity. Signing out deletes it. During sign‑in there is also `__Host-para_oauth`, for 10 min. |
| On the phone (new keys) | `tab`, `tabAt`, `me_cache`, `draft_post_<вуз>`, `hiddenUsers` (id, @username and name of authors you hid), `ageBlock`, `coach_chat` (localStorage); `chatCat` (sessionStorage), in addition to today's list (`uni`, `group`, `role`, `teacher`, `prev_…`, `theme`, `seenTs`, `agreed`, `cid`, `homeShown`, `reviewPromptAt`, `reviewedAt`, `myRating`). |
| Analytics | Unchanged, and **not linked to accounts**. Exact wording: «Сервер не связывает номер cid с аккаунтом: код обсуждений его не читает и не хранит.» (The browser does attach the `cid` cookie to every request to the site; do **not** claim it is never sent.) **The IP address is not stored in the stats**, only an irreversible fingerprint (`ip_coarse` has been removed). Records are kept while they are needed for aggregate numbers (no automatic purge in v1). |
| Server logs | The app log records no IP address and no query parameters. The nginx log (IP, time, address, browser) is kept for 14 days (the owner confirms this, Q6). |
| Backups | A daily copy of the account database on the same server, 7 days. Photos are not backed up. |
| Deletion | In the app: «Профиль» → «Удалить аккаунт». On the web: `/delete-account` (its own Google sign‑in that never creates an account). By request: Telegram @skycoax or `[почта для связи]`, within 7 days. Banned accounts can also be deleted, and deletion keeps working even while «Обсуждения» are switched off. |
| What survives deletion | Other people's replies under your posts (the post becomes «Пост удалён»). Your reports (anonymized). Reports about you with snapshots (up to 180 days after a decision). Log entries without content (180 days). The ban fingerprint. Your @username is held for 30 days. Backups for 7 days. |
| Search engines | `robots.txt` disallows `/api/`. Post and profile links carry `noindex`. |
| Third parties | None, except Google as the sign‑in provider and the hosting provider. No ads, no trackers, no sale of data, no AI training. |
| Controller and location | `[имя разработчика]`, server in `[страна]` (Q2, Q3). |

**`DocSheet.tsx`:**
- Replace `id="doc"` with the class `sheet--doc` (§D); the component may be mounted several times.
- Bump the date.
- Add the keys above (on the hub).
- Add a hub‑only section `Аккаунт и «Обсуждения»`: `Аккаунт — по желанию, с 16 лет, вход через Google. Посты, ответы, фото, имя и фото профиля видят все, кто открывает «Обсуждения». Почту не видит никто. Удалить аккаунт — «Профиль» → «Удалить аккаунт».`
- Links: `Полная политика конфиденциальности` → `/policy` (non‑hub: `https://para.skycoax.uz/policy`) and
  `Правила обсуждений` → `/rules`.

**`Consent.tsx`** (existing users are not prompted again):
- Add a hub‑only bullet: `Аккаунт — <b>по желанию</b>: он нужен только для «Обсуждений» и друзей, вход через Google.`
- The storage bullet becomes: `В браузере остаются <b>только настройки</b>: вуз, группа, тема, метка правки, это согласие и случайный номер для подсчёта.`

**`SiteFooter.tsx`:** add `<a href="/policy">Политика конфиденциальности</a>` next to `Условия и данные` (non‑hub: the absolute
hub URL).

**`UniversityStart.tsx`:** under `.unis__note`, add `<a href="/policy">Политика конфиденциальности</a> · <a href="/rules">Правила обсуждений</a>`.
This is needed because Google's OAuth brand check looks for a policy link on the home page. When `pendingDeepLink()`
(`lib/uni.ts`) is true, show the line `Выбери вуз, чтобы продолжить` above the list (it keeps the existing `openUni(id)`
call, which carries the link).

**`android/play-listing.md`:** compliance.md §7, with these edits:
- use «Продолжить с Google»;
- no Google photo;
- "Другая информация" = age group, «мой вуз», Telegram/Instagram;
- target audience: **16–17 and 18+ (recommended; the owner decides)**;
- the App access steps match D19 and the SignInSheet;
- the email is a placeholder.

### E.7 Cross‑cutting contracts

**Deep links** (query on `/`; parsed once by FE‑SHELL, which strips them after reading):

| Param | Values | Effect |
|---|---|---|
| `tab` | `schedule` \| `chat` \| `profile` | Initial tab |
| `post` | integer | Chat + `ThreadView` (a reply id opens its thread) |
| `compose` | `1` | Chat + Composer (guest → sign‑in, returning here) |
| `user` | username | Profile + `UserProfileView` (guest → sign‑in); with `tab=chat`, Chat + its `user` screen |
| `delete` | `1` | Profile + `DeleteAccountSheet` (guest → sign‑in in delete mode) |
| `mod` | `1` | Profile + `ModerationView` (admins) |
| `#auth=` | `AuthOutcome` | `session.handleAuthOutcome` |

Reserved and untouched: `uni`, `group`, `from`, `ok`, `u` (cid) and `#m=`. After `readDeepLink()` the address bar keeps
exactly those that were present.
Share links: `https://para.skycoax.uz/?uni=<post.uni>&post=<rootId>` and `https://para.skycoax.uz/?uni=<brand.id>&user=<username>`.
A deep link opened with no university chosen survives UniversityStart (`lib/uni.ts` rule (c)).

**Storage keys** (all through `ls()` from `lib/store.ts`; social keys never go into cookies):

| Key | Where | Owner | Value |
|---|---|---|---|
| `tab`, `tabAt` | local | FE‑SHELL | last tab, ms |
| `coach_chat` | local | FE‑SHELL | `'1'` |
| `me_cache` | local | FE‑CORE | JSON `{id,name,username,avatar}` |
| `hiddenUsers` | local | FE‑CORE | JSON `HiddenUser[]` = `{id, username, name}[]` (≤ 200, newest first) |
| `ageBlock` | local | FE‑CORE | ms timestamp (valid 30 d) |
| `paraDebug` | local | FE‑CORE | `'1'` (developers only) |
| `draft_post_<uni>` | local | FE‑CHAT | JSON `{text, category, media: UploadedMedia[]}` |
| `chatCat` | session | FE‑CHAT | `CategoryId \| ''` |
| `chunkReload` | session | FE‑SHELL | `'1'` |

**Window events:** `para:reselect` (detail `TabId`, from FE‑SHELL) and `para:social` (detail `SocialEvent`, from FE‑CORE
`emit`). There are no other global events.

**Tab bar hide reasons:** `keyboard` (FE‑CORE watcher), `onboarding` (FE‑SHELL), `thread` (FE‑CHAT), `viewer` (FE‑CORE
PhotoViewer). Full sheets simply cover the bar.

### E.8 Tokens and z‑index (FE‑SHELL pastes into `index.css`; everyone uses them)

```css
:root{
  --nav-h:44px;
  --nav-top:calc(env(safe-area-inset-top) + 8px);
  --nav-space:calc(var(--nav-top) + var(--nav-h) + 14px);
  --tabbar-h:62px;
  --tabbar-gap:10px;
  --tabbar-space:calc(var(--tabbar-h) + var(--tabbar-gap) + env(safe-area-inset-bottom));
  --kb:0px;
  --glass-shadow:0 6px 20px rgba(0,0,0,.14);
  --bar-glass-solid:#f7f7f9;
  --tab-pill:rgba(118,118,128,.16);
  --tab-ink:var(--ink-100);
  --accent:var(--c1);
  --accent-press:rgba(0,122,255,.12);
  --like:var(--c4);
  --r-post:20px;
  --r-media:14px;
  --r-sheet:22px;
  --media-bg:#e5e5ea;
  --viewer-bg:#000;
  --gbtn-bg:#ffffff; --gbtn-ink:#1f1f1f; --gbtn-edge:#747775;
}
/* dark — in BOTH `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){…}}` AND `:root[data-theme="dark"]{…}` */
  --glass-shadow:0 6px 24px rgba(0,0,0,.5);
  --bar-glass-solid:#2c2c2e;
  --tab-pill:rgba(0,0,0,.36);
  --accent-press:rgba(10,132,255,.2);
  --media-bg:#2c2c2e;
  --gbtn-bg:#131314; --gbtn-ink:#e3e3e3; --gbtn-edge:#8e918f;
```

Z‑index scale, from low to high:
- `.topfade` 15
- `.navrow` 16
- `.ptr` 20
- `.tabfade` 24
- `.tabbar` 25
- `.rcmp` 26
- `.newpill` 27
- `.coach` 28
- `.sheet` and `.ui-sheet` 60
- `.nudge` 65
- `.modal` and `.ui-as` 70
- `.umenu` 79/80
- `#doc` / `.sheet--doc` 90
- `.pview` 95
- `.ui-toast` 100

---

## F. Server integration (BE)

### F.1 `registerSocial`

```js
// server/src/social/index.js
export const SOCIAL_PATH = /^\/api\/(auth|social|media)(\/|$|\?)/;
/** @fastify/cors options: the public schedule API stays open to all origins; social paths get no CORS. */
export const corsOptions = { delegator: (req, cb) => cb(null, { origin: !SOCIAL_PATH.test(String(req.url || '')) }) };
/** Request log without IP/port and without query strings (code, state, search, PIN, group, cid). */
export const logSerializers = {
  req: (req) => ({ method: req.method, url: String(req.url || '').split('?')[0], host: req.headers && req.headers.host }),
};
/**
 * Accounts and «Обсуждения». A Fastify plugin, registered only when hub/hub.json exists.
 * SOCIAL_MODE=off → registers only the deletion subset (§F.2 step 1); everything else under /api/auth|social → 404 JSON.
 * @param {import('fastify').FastifyInstance} app  encapsulated child instance (via app.register)
 * @param {{ hub: { hosts: string[], dir: string }, tenants: Array<{ id: string, hosts: string[], brand: object, enabled?: boolean }> }} opts
 */
export async function registerSocial(app, { hub, tenants }) { /* §F.2 */ }
```

### F.2 What `registerSocial` does (order matters)

1. `db = openSocialDb()`. `mkdirSync(MEDIA_DIR, { recursive: true })`.
   `ctx = { db, hub, tenants, origin: social.origin || 'https://' + hub.hosts[0], log }`. (The database is opened in every
   mode, because `off` still serves deletion.)
2. The startup log line has no values: `{ mode, google: 'настроен'|'не настроен', admins: n, dev: bool, minAge }`. It warns if
   `DEV_LOGIN=1` in production (ignored) or if `GOOGLE_CLIENT_ID` does not end with `.apps.googleusercontent.com`.
3. Inside `app.register(async (inst) => { … })`:
   1. `decorateRequest('user', null)` and `decorateRequest('sid', null)`.
   2. `onRequest` hooks, in order:
      - the hub guard (`!req.hub` → 404 `Нет такого адреса API`);
      - the CSRF gate (§B.1);
      - the session loader (§C.5; its cookie parser reads only the session/OAuth cookie names);
      - `Cache-Control: no-store` + `X-Robots-Tag: noindex` for `/api/auth` and `/api/social`.
   3. `addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: 921_600 }, …)`.
   4. The error handler: backend.md §8.11, plus `code` and `field`. `FST_ERR_CTP_BODY_TOO_LARGE` maps to the media text only
      when `req.routeOptions.url` is `/api/social/media` or `/api/social/media/:id/thumb`; on every other route it is
      `413 too_large` «Слишком большой запрос».
   5. Routes:
      - `mode === 'off'`: only `GET /api/auth/me` (answers `mode:'off'`), `POST /api/auth/logout`, `DELETE /api/social/me`,
        `GET /api/auth/google/start` + `/callback` (both answer `#auth=unavailable` unless the intent is `delete`), and the dev
        route when enabled. **No** feed, post, media (including `GET /api/media/*`), user or admin routes.
      - otherwise: `authRoutes`, `postRoutes`, `userRoutes`, `mediaRoutes`, `adminRoutes`, with route `bodyLimit` per §B.1.
        The dev route is added only when `social.devLogin`.
   6. **Catch‑all 404s** (do not use `setNotFoundHandler`: the root context shares it):
      `inst.route({ method: ['GET','POST','PUT','PATCH','DELETE'], url: '/api/auth/*', handler: notFound })`, the same for
      `'/api/social/*'`, and `method: ['POST','PUT','PATCH','DELETE']` for `'/api/media/*'`. `notFound` answers
      `404 {ok:false, error:'Нет такого адреса API', code:'not_found'}`. More specific routes win in find‑my‑way.
4. `startJobs(ctx)` (§C.7); in `off` only the 10‑min and 1‑h jobs that clean states, sessions and orphans, plus the daily
   retention job, run (same functions).

### F.3 Exact changes to existing server files

**`server/src/index.js`.** The minimal integration is the two marked lines ★. The rest is required hardening (D24).
```diff
-import { loadHub, isHubHost, hubTenant } from './hub.js';
+import { loadHub, isHubHost, isDevHub, hubTenant } from './hub.js';
+import { registerSocial, corsOptions, logSerializers } from './social/index.js';   // ★
+// and add scrubCoarseIp to the existing `import { logHit, aggregate, summary, pulse } from './analytics.js'`
@@
+const HUB_PAGES = { '/policy': 'policy.html', '/rules': 'rules.html', '/delete-account': 'delete-account.html' };
 const app = Fastify({
-  // За nginx настоящий IP приходит в X-Forwarded-For — доверяем ему.
-  trustProxy: true,
-  logger: { level: process.env.LOG_LEVEL || 'info' },
+  // Доверяем только своему nginx (127.0.0.1): иначе X-Forwarded-For подделывается клиентом.
+  trustProxy: '127.0.0.1',
+  logger: { level: process.env.LOG_LEVEL || 'info', serializers: logSerializers },
 });
-await app.register(cors, { origin: true });
+// API расписания открыто всем сайтам; вход, обсуждения и фото — только со своей страницы.
+await app.register(cors, corsOptions);
 const tenants = loadTenants();
+tenants.forEach((t) => scrubCoarseIp(t.db));   // IP с обнулённым октетом больше не храним
@@ app.addHook('onRequest', …)
-  req.hub = isHubHost(hub, req.headers.host);
+  req.hub = isHubHost(hub, req.headers.host) || isDevHub(hub, req.headers.host);
@@ before «Сама страница, манифест и картинки бренда»
+// ─── Аккаунты и обсуждения (только на адресе Para) ───
+if (hub) await app.register(registerSocial, { hub, tenants });                       // ★
@@ in site(): replace the single /policy block
-  if (req.hub && (path === '/policy' || path === '/policy/')) {
-    const file = join(hub.dir, 'policy.html');
+  const doc = req.hub && HUB_PAGES[path.replace(/\/+$/, '')];
+  if (doc) {
+    const file = join(hub.dir, doc);
     if (existsSync(file)) { … unchanged … }
   }
+  if (req.hub && path === '/robots.txt') {
+    reply.header('cache-control', 'public, max-age=86400').type('text/plain; charset=utf-8');
+    return 'User-agent: *\nDisallow: /api/\n';
+  }
@@ just before `reply.header('cache-control', 'no-cache').type('text/html…')`
+  if (req.hub && req.query && (req.query.post || req.query.user)) reply.header('x-robots-tag', 'noindex');
```

**`server/src/hub.js`:**
`export const isDevHub = (hub, host) => !!hub && social.devHub && /^(?:[a-z0-9-]+\.)?localhost$|^127\.0\.0\.1$/.test(hostOf(host));`
It imports `social` from `./config.js`. (`*.localhost` gives each engineer a separate cookie jar, §G.0. `tenantFor()` in
`tenants.js` is unchanged: only bare `localhost`/`127.0.0.1` map to `DEV_TENANT`.)

**`server/src/config.js`:** add `export const social = {…}` from backend.md §2, with these additions:
- `minAge: clamp(Number(env.SOCIAL_MIN_AGE) || 16, 13, 18)`;
- `rulesVersion: 1`, `policyVersion: 1`;
- `export const googleConfigured = () => !!(social.google.clientId && social.google.clientSecret)`.

**`server/src/site.js`:** `hubPageHtml()` adds `social: social.mode` to **both** brand objects (with and without a tenant).
`pageHtml()` is unchanged.

**`server/src/analytics.js`:**
- `logHit` writes `NULL` into `ip_coarse`.
- Export `scrubCoarseIp(db)`, which runs `UPDATE hits SET ip_coarse = NULL WHERE ip_coarse IS NOT NULL`. It is idempotent and
  fast when there is nothing to update.

### F.4 Environment variables (`server/.env.example` gets placeholders only)

| Var | Default | Meaning |
|---|---|---|
| `GOOGLE_CLIENT_ID` | empty | Web OAuth client (owner types it on the VPS). Empty → `google:false`. |
| `GOOGLE_CLIENT_SECRET` | empty | Never logged or printed. |
| `SOCIAL_ADMIN_EMAILS` | empty | Comma‑separated verified Google emails of moderators. |
| `SOCIAL_SALT` | `IP_SALT` or a fallback | Salt for `ban_marks`. The owner sets a long random value (`openssl rand -hex 32`). |
| `SOCIAL_MODE` | `on` | `on` \| `readonly` \| `off` (kill switch + `systemctl restart schedule-api`). |
| `SOCIAL_MIN_AGE` | `16` | Minimum account age, 13–18. The public texts must say the same number. |
| `SOCIAL_REPORT_THRESHOLD` | `3` | Distinct counted reporters that hide a post (non‑severe). |
| `SOCIAL_REPORTER_MIN_AGE_H` | `24` | A reporter account younger than this is not counted (0 for tests). |
| `MEDIA_DIR` | `<DATA_DIR>/media` | Photo files. |
| `PARA_ORIGIN` | `https://<hub.hosts[0]>` | Dev only, e.g. `http://chat.localhost:8794` (makes the cookies non‑`__Host-`, non‑Secure). |
| `DEV_LOGIN` | — | `1` → `POST /api/auth/dev`. **Ignored when `NODE_ENV=production`.** Also requires a loopback socket and no `X-Real-IP`. |
| `DEV_HUB` | — | `1` → `localhost`, `*.localhost` and `127.0.0.1` count as the hub. Ignored in production. |
| `SOCIAL_NEW_ACCOUNT_H` | `24` | New‑account window: no links, lower daily caps. Any value other than 24 is honored only outside production. |
| `SOCIAL_RATE_LIMITS` | `on` | `off` disables buckets and daily caps. Ignored in production. |

### F.5 `deploy/deploy.sh` and `AGENTS.md` (BE)

```diff
 echo "== сборка сайта =="
+for f in "$ROOT"/server/src/*.js "$ROOT"/server/src/social/*.js; do node --check "$f"; done
 (cd "$ROOT/web" && npm run build)
@@
-tar --force-local -czf "$TMP/server.tgz" -C "$ROOT/server" --exclude=node_modules --exclude=data --exclude=.env .
+tar --force-local -czf "$TMP/server.tgz" -C "$ROOT/server" --exclude=node_modules --exclude=data --exclude=.env --exclude=test .
@@ after the «Para:» curl, inside the ssh block
+  curl -fsS -H "Host: para.skycoax.uz" http://127.0.0.1:8792/api/auth/me | grep -o "\"google\":[a-z]*"
+  curl -fsS -o /dev/null -w "rules: %{http_code}\n" -H "Host: para.skycoax.uz" http://127.0.0.1:8792/rules
```

`AGENTS.md` gets a section `### Обсуждения (только Para)`. It covers:
- the module layout;
- the env table (without values) and the `SOCIAL_MODE` kill switch;
- `data/social.db`, `data/media/` and `data/backup/` are user data: never delete them in scripts, never name a source folder
  `data` or `test`;
- never read or print `.env`;
- bump `social.rulesVersion` together with the rules text;
- the smoke‑test command (§G.1).

### F.6 Deploy notes (the owner runs this after the §G.7 integration gate)

1. `DEPLOY_HOST=skycoax-vps bash deploy/deploy.sh`.
   - It builds `web/`, tars `web/dist` and `server/` (excluding `node_modules`, `data`, `.env` and `test`), extracts over
     `~/schedule-server` and `/var/www/schedule`, and restarts `schedule-api`. (The brief says rsync; the script uses
     tar + scp, and nothing here depends on rsync.)
   - `deploy.sh` defaults to `skycoax@46.8.195.171:~/schedule-server`, while the repo's systemd unit runs
     `/home/ubuntu/schedule-server`. Before the first social deploy the owner confirms with `systemctl cat schedule-api` which
     home the service really uses and that its `DATA_DIR` is writable for `social.db`, `media/` and `backup/` (Q5).
   - `rm -rf /var/www/schedule/assets` deletes the old chunks, and `lazyWithReload` covers clients still holding the old page.
   - `social.db`, `media/` and `backup/` are created on the first start inside `DATA_DIR`. **Before the first deploy, confirm
     that the service user can write to `DATA_DIR`** (Q5).
2. Owner, on the VPS, without chat:
   - `nano ~/schedule-server/.env` and add `SOCIAL_SALT=<random>` and `SOCIAL_ADMIN_EMAILS=<own gmail>`, then
     `chmod 600 ~/schedule-server/.env` and `sudo systemctl restart schedule-api`.
   - Later, add `GOOGLE_CLIENT_ID/SECRET` from Google Cloud: a Web client with the redirect URI
     `https://para.skycoax.uz/api/auth/google/callback`, and on the consent screen the privacy policy `/policy`, the terms
     `/rules` and the domain `skycoax.uz`. The app must be **In production**.
3. Verify:
   ```bash
   curl -s https://para.skycoax.uz/api/auth/me                                    # "user":null, "google":false|true
   curl -s -o /dev/null -w "%{http_code}\n" https://kfu.skycoax.uz/api/auth/me     # 404
   for p in policy rules delete-account robots.txt; do curl -s -o /dev/null -w "$p %{http_code}\n" https://para.skycoax.uz/$p; done
   curl -s "https://para.skycoax.uz/api/schedule?group=&uni=tsue" | head -c 200    # schedule unaffected
   curl -sI "https://para.skycoax.uz/api/auth/google/start?return=/&intent=signin&age=adult&accept=1" | grep -i location
   ```
4. **Emergency switches:**
   - `SOCIAL_MODE=readonly` (writes stop; report, block, own‑post delete, logout and deletion keep working) or `off` (chat
     disappears; sign‑in for deletion, logout and deletion keep working) in `.env` + a restart;
   - frontend: `SOCIAL_TABS = false` in `shell/AppShell.tsx` + a redeploy;
   - full rollback: redeploy the previous commit. `social.db` survives because it sits in `data/`.

---

## G. Acceptance criteria and test plan

### G.0 Common local environment (every engineer, Git Bash, absolute paths)

Every engineer runs a **private** server, a **private** build folder and a **private host name**, so parallel work never
collides. Never write into `web/dist`, and never share a port.

**Why host names:** cookies ignore the port (RFC 6265), and `lib/store.ts` copies every setting (`agreed`, `uni`, `group`,
`role`, `theme`, `cid`…) into cookies. On plain `localhost` all six servers would share `para_sid`, `para_oauth` and those
settings, and one server would log out another engineer's test user. Chrome resolves every `*.localhost` name to loopback,
and host‑only cookies are separate per name, so each owner gets their own jar.

| Owner | Port `P` | Hub URL (browser and `PARA_ORIGIN`) | Non‑hub check URL (port `P+100`) |
|---|---|---|---|
| BE | 8792 | `http://be.localhost:8792` | — |
| FE‑SHELL | 8793 | `http://shell.localhost:8793` | `http://127.0.0.1:8893` |
| FE‑CHAT | 8794 | `http://chat.localhost:8794` | — |
| FE‑PROFILE | 8795 | `http://profile.localhost:8795` | — |
| FE‑CORE | 8796 | `http://core.localhost:8796` | — |
| POLICY | 8797 | `http://policy.localhost:8797` | `http://localhost:8897` |

The two non‑hub URLs use the only two names that `tenantFor()` maps to `DEV_TENANT` (`127.0.0.1` and bare `localhost`), one
each, so FE‑SHELL and POLICY never share a jar either. Scripts and `curl` may keep using `http://127.0.0.1:$P` (the hub
server accepts it too); a browser never uses `127.0.0.1:$P` for the hub.

```bash
P=8794; H=chat.localhost                 # your port and host name from the table
ROOT=/c/Users/user/a
OUT="$TEMP/para-dist-$P"; DATA="$TEMP/para-data-$P"; mkdir -p "$DATA"
cp "$ROOT"/server/data/*.db "$DATA"/ 2>/dev/null || true   # local schedule snapshots (contain local analytics too: keep them in $TEMP, delete when done)

# 1) Build the web app into your own folder, rebuilding on save (run in background)
cd "$ROOT/web" && npx vite build --watch --outDir "$OUT" --emptyOutDir

# 2) Hub server with dev login (run in background)
cd "$ROOT/server" && NODE_ENV=development DEV_LOGIN=1 DEV_HUB=1 PARA_ORIGIN=http://$H:$P \
  SOCIAL_ADMIN_EMAILS=boss@dev.local SOCIAL_REPORTER_MIN_AGE_H=0 SOCIAL_NEW_ACCOUNT_H=0 SOCIAL_RATE_LIMITS=off \
  PORT=$P DATA_DIR="$DATA" WEB_DIR="$OUT" node --experimental-sqlite src/index.js

# 3) Seed accounts/posts (BE provides it; needs BE phase 1). Re-runnable: fixed users, suffixed content.
node "$ROOT/server/test/social-seed.mjs" http://127.0.0.1:$P kfu
```

The server and the watcher are started with the Bash tool's `run_in_background`. When you finish, stop both and run
`rm -rf "$DATA" "$OUT"`. Two extra env values are dev‑only and ignored
in production (BE implements them): `SOCIAL_NEW_ACCOUNT_H` (default 24) and `SOCIAL_RATE_LIMITS=off`.

**Browser checks (headless).**
- Open it with `preview_start({ url: 'http://' + H + ':' + P + '/?uni=kfu' })`, then `resize_window({ preset: 'mobile' })`
  (375×812). Also check at 320×568 and in dark (`colorScheme: 'dark'`).
- Use `javascript_tool` for assertions and `read_page`/`find` for structure. Reset the size to `desktop` when done.
- A "fresh profile" means: clear site data for **your** host only (DevTools → Application → Clear site data, or
  `localStorage.clear()` plus expiring every cookie of `location.host`), never for other hosts.
- Dev sign‑in:
  - UI: Профиль → `Продолжить с Google` sheet → `Войти для разработки`.
  - Console:
    `await fetch('/api/auth/dev?uni=kfu',{method:'POST',headers:{'Content-Type':'application/json','X-Para':'1'},body:'{"name":"alice"}'}); location.reload()`.
- Seeded logins (fixed, the same user every time, `google_sub = 'dev:<name>'`, email `<name>@dev.local`, rules accepted):
  `alice` (adult), `bob` (adult), `mia` (minor, not searchable, friend requests `none`) and `boss` (admin, because
  `SOCIAL_ADMIN_EMAILS=boss@dev.local`). A UI dev login with one of these names signs in as the seeded user.
- Direct API access in the page: `localStorage.paraDebug='1'; location.reload()`, then `await __paraDebug.socialApi.feed({})`.

**Non‑hub check** (FE‑SHELL, POLICY): start a second server **without** `DEV_HUB` and with `DEV_TENANT=kfu` on port `P+100`,
and open the non‑hub URL from the table. It is then the plain KFU site.

**Type check of only your files:**
`cd /c/Users/user/a/web && npx tsc --noEmit -p . 2>&1 | grep -E "src/(<your dirs>)" || echo "clean"`.
Run the full `npx tsc --noEmit && npm run build` (into `web/dist`) only in the §G.7 gate.

### G.1 BE

Commands:
```bash
cd /c/Users/user/a
for f in server/src/*.js server/src/social/*.js; do node --check "$f" || echo "FAIL $f"; done
# Run A (main): server as in G.0 with P=8792, H=be.localhost, SOCIAL_NEW_ACCOUNT_H=0 and WITHOUT SOCIAL_RATE_LIMITS
# (limits on, new-account window off, so the ≤ 3 links rule and the buckets are testable)
node server/test/social-smoke.mjs http://127.0.0.1:8792 kfu          # prints «Всё прошло: N проверок.»
node server/test/social-seed.mjs  http://127.0.0.1:8792 kfu          # re-runnable seed for the FE teams (fixed users)
# Run B (new-account rules): restart on a fresh DATA_DIR with default SOCIAL_NEW_ACCOUNT_H (24) and limits on
SMOKE_NEW_ACCOUNT=1 node server/test/social-smoke.mjs http://127.0.0.1:8792 kfu   # link in a new account's post → 400, lower caps
# Run C (kill switch): restart with SOCIAL_MODE=readonly, then with SOCIAL_MODE=off
SMOKE_MODE=readonly node server/test/social-smoke.mjs http://127.0.0.1:8792 kfu
SMOKE_MODE=off      node server/test/social-smoke.mjs http://127.0.0.1:8792 kfu
B=http://127.0.0.1:8792
curl -s -H "Host: kfu.skycoax.uz"  $B/api/health | head -c 200; echo
curl -s -H "Host: tsue.skycoax.uz" "$B/api/schedule?group=" | head -c 200; echo
curl -s -H "Host: para.skycoax.uz" "$B/api/schedule?group=&uni=tsue" | head -c 200; echo
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: kfu.skycoax.uz" $B/api/auth/me                     # 404
curl -s -D - -o /dev/null -H "Host: kfu.skycoax.uz" -H "Origin: https://evil.example" $B/api/universities | grep -i access-control-allow-origin   # still reflected
curl -s -D - -o /dev/null -X OPTIONS -H "Host: para.skycoax.uz" -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST" $B/api/social/posts | grep -ci access-control-allow-origin   # 0
for p in policy rules delete-account robots.txt; do curl -s -o /dev/null -w "$p %{http_code}\n" -H "Host: para.skycoax.uz" $B/$p; done   # 200 each (after POLICY lands)
curl -sI -H "Host: para.skycoax.uz" "$B/api/auth/google/start?return=/&intent=signin" | grep -i location        # …#auth=unavailable (no keys) — with keys: …#auth=consent
node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);console.log(d.prepare('SELECT COUNT(*) n FROM hits WHERE ip_coarse IS NOT NULL').get())" "$TEMP/para-data-8792/kfu.db"   # { n: 0 }
```

Acceptance:
1. The smoke test is rewritten to **this** contract (categories, `age`/`accept`, 9 reasons, `POST …/users/search`, profiles need
   S, `/admin/action`, thumbs). It covers **every** endpoint in §B.5 plus:
   - `#auth=consent` and `#auth=unavailable`;
   - the open‑redirect guard;
   - CSRF (no `X-Para`, a foreign Origin, the preflight);
   - JPEG EXIF and trailing‑byte stripping, 415, 400, 413 (media text on #13, «Слишком большой запрос» on a 20 KB JSON
     body), >2048, path traversal;
   - thumb upload and the `_t.jpg` visibility; a thumb with a different aspect ratio or a wrong long side → 400
     «Миниатюра не совпадает с фото…»; a non‑square avatar → 400;
   - 200 `GET /api/media/<id>.jpg` in 5 s from one IP all return 200 (media is in no bucket), and `Cache-Control` is
     `public, max-age=604800`;
   - a guest `GET /feed` has `author.uni === null` on every post; a signed‑in one has it filled;
   - unknown `POST /api/social/nope` and `GET /api/auth/nope` → 404 JSON with `code:'not_found'`;
   - a returning user signing in with `intent=delete` (dev route) keeps the old `rules_version`;
   - a new `minor` gets `searchable:false` and `friendRequests:'none'`;
   - `GET /users/:u` returns `banned` only to `boss`; `unban` clears it;
   - a reporter whose `child` report was dismissed no longer auto‑hides with a second `child` report;
   - `company` + media → 400; a reply with 2 media → 400;
   - the V1–V6 visibility rules (hidden, banned, block in both directions, tombstone);
   - auto‑hide: `child` 1, severe 2, other 3;
   - the admin queue with `rawText` and `snapshot`, and every admin `action`;
   - friends, including `friendRequests:'none'`;
   - search with `searchable:false` (exact username only);
   - minor rules (`linksVisibility:'signed'` → 400);
   - the username 30‑day rule and holds;
   - account deletion (the reporter is anonymized, the username is held, the photos give 404, the root becomes a tombstone);
   - `intent=delete` never creates a user (through `POST /api/auth/dev {intent:'delete'}`, which shares `findOrCreateUser()`
     with the callback);
   - logout.
   - Smoke users use their own names (`sm_<suffix>_a` …) so they never collide with the seed users.
   - With `SMOKE_NEW_ACCOUNT=1` (run B) it checks only the new‑account rules: a link in a new account's post → 400
     «Ссылки можно добавлять через сутки после регистрации», and the lower daily root cap.
   - With `SMOKE_MODE=readonly` (run C): every route with guard M answers `403 readonly`; report, block/unblock, own‑post
     delete, media delete, friend decline/cancel/remove, rules accept, a privacy‑reducing PATCH `/me`, logout and account
     deletion still work; reads work.
   - With `SMOKE_MODE=off` (run C): `/api/auth/me` answers `mode:'off'`; feed, posts, media GET and admin → 404 JSON; the
     dev login, logout and `DELETE /api/social/me` work; `google/start?intent=signin` → `#auth=unavailable`.
2. `social-seed.mjs` (re‑runnable; it upserts the **fixed** users through `POST /api/auth/dev` and PATCHes a profile only
   when `needsProfile`; only post texts carry a run suffix):
   - users `alice` (adult), `bob` (adult), `mia` (minor: `searchable:false`, `friendRequests:'none'`) and `boss` (admin), all
     onboarded with those exact usernames and rules accepted;
   - about 25 kfu roots across all categories, several with 1–4 photos (the fixture JPEG + a matching thumb);
   - one thread with about 12 replies including `replyTo`;
   - likes, a pending friend request bob→alice, one accepted friendship, and one open report.

   It prints the usernames and the ids of the thread and the reported post.
3. Schedule regression: `/api/health`, `/api/schedule`, `/api/teachers`, `/api/universities`, `/api/reviews`, `/api/hit` and
   `/api/stats/summary` give the same shape for `kfu`, `tsue` and `para?uni=`. CORS stays reflected on those.
4. Server stdout contains no `remoteAddress` and no `?` in any logged `url`. The Google secret, emails, OAuth `code`/`state`,
   post text and search terms never appear.
5. `EXPLAIN QUERY PLAN` of both feed statements shows `idx_posts_feed` / `idx_posts_feed_cat`.
6. `SOCIAL_MODE=readonly` → every route with guard M answers `403 readonly`. Report, block, deleting your own post,
   privacy‑reducing settings, account deletion and logout still work, and reads work. `SOCIAL_MODE=off` → `/api/auth/me`
   answers `mode:'off'`, only the deletion subset exists (§F.2), and the schedule works. Both per run C.
7. `NODE_ENV=production DEV_LOGIN=1` → `POST /api/auth/dev` gives 404, and a startup error line is logged.

### G.2 FE‑CORE

1. `web/src/social/types.ts` and `web/src/tabs.ts` match §B.6 and §E.1 **byte for byte in the exported names and shapes**.
   Comments may differ.
2. The own‑files type check is clean. There are no new dependencies, and `api.ts` does not import `web/src/api.ts`.
3. In the browser with `paraDebug` against the seeded server, run the whole API table:
   - `me` (guest), `devLogin('alice')`, `me` (signed);
   - `feed({})`, `feed({category:'lost'})`, `thread(id)`;
   - `createPost` with an uploaded photo (full and thumb), `createReply` with `replyTo`, `like` on/off;
   - `report`, `searchUsers('bo')`, `user('bob')`, the `friend` actions, `block`/`unblock`, `updateMe` (field error → `ApiError.field`);
   - `adminReports` as `boss`.

   Each resolves, or rejects with an `ApiError` whose `code` is in the §B.3 table. The Network panel shows `X-Para: 1` and a
   JSON body on every mutation, and `uni=` on every call.
4. `prepareImage` on a canvas‑generated 4000×3000 JPEG gives full ≤ 1600 px and ≤ 880 KB, thumb ≤ 640 px and ≤ 140 KB. On a
   transparent PNG, pixel (0,0) of the full image is white. The blob bytes contain no `Exif`. `cropSquare` gives 512² and 128².
5. `Sheet`, the dialogs and `layers.ts`:
   - Esc, a scrim tap and **Back** (`history.back()` in the console) each close exactly one layer.
   - Focus returns to the opener. A non‑dismissible sheet ignores Back.
   - The body does not scroll behind an open sheet.
   - **Race:** `postMenu` on your own post → `Удалить` → the `Удалить пост?` confirmation appears **and stays**; confirming
     deletes. The same for ReportSheet success → `Заблокировать @u` → confirmation. After each flow `depth()` is 0 and
     `history.state?.paraLayer` is undefined.
   - `await unwind(0)` with three stacked layers closes all three with one `popstate` and calls each `onPop` once.
   - Composer `Отмена` → `Удалить черновик?` → `Удалить` closes both; one more Back then leaves the tab layer, not a ghost.
6. Session:
   - A guest `ensure('like')` shows `SignInSheet` (once AuthHost lands). A dismiss gives `false`.
   - With `store('agreed')` empty, **no** request to `/api/auth/me` is made until `refresh()`; `ready` is still pending.
   - `ensure()` called while `status === 'loading'` waits for `ready` and does not open a sign‑in sheet for a signed‑in user
     (throttle the network to "Slow 3G" to observe it).
   - **OAuth‑return path** (dev login emulation): sign in as `alice` in the console, then open
     `/?uni=kfu&tab=chat&compose=1#auth=ok` → exactly one toast `Вход выполнен`, the Composer opens, no second sheet, and
     `/api/auth/me` is requested once.
   - A new dev user (`devSignIn('newbie')`), then `handleAuthOutcome('ok')` → SetupSheet opens once; `Позже` closes it and it
     does **not** reopen on reload; `ensure('post')` reopens it.
   - `SOCIAL_MODE=readonly`: `ensure('report')` and `ensure('block')` resolve `true`; `ensure('post')` toasts the read‑only text.
   - `signInUrl({intent:'delete', …, accept:true})` contains neither `accept` nor `age`.
   - A forced 401 (delete the cookie in DevTools, then like) → guest + toast `Сессия истекла — войди снова`.
   - `me_cache` shows the tab‑bar avatar before `/api/auth/me` answers (with FE‑SHELL's `me={status === 'guest' ? null : me}`).
   - After `friend(id,'accept')` + `emit({type:'relation'})`, `me.requestsIn` updates within ~1 s without a reload.
7. The FE‑CORE share of the main chunk is ≤ 10 KB gz JS, measured in the §G.7 build. `social-ui.css` and `ReportSheet` are
   **not** in the main chunk (only `avatar.css` and `ui.css` are).

### G.3 FE‑SHELL

1. Own‑files type check clean.
2. **Hub (375×812, light and dark):**
   - the bottom capsule has 3 items with an icon above the label;
   - the active item has the darker pill and the blue ink;
   - the top row has the round logo, `Сегодня | Неделя` and the round `Правки`;
   - the large title with the chevron opens the Picker;
   - `Правки` opens a bottom sheet with `ChangesView`;
   - the dot shows exactly when `html.is-changed` is set, and opening the sheet clears both and persists `seenTs`.
3. **Onboarding** on a clean profile (clear the site data of `shell.localhost` only): consent → role → group. The tab bar is
   hidden during onboarding. No `/api/auth/*` or `/api/social/*` request is sent before consent, and `onContext` fires only
   after a group is chosen (never with the `groups[0]` fallback). `trackVisit` fires once.
4. **Tab behavior:**
   - A cold start opens `Расписание`. Reopening within 30 min restores the last tab; Back from that restored tab (after one
     tap anywhere) → `Расписание`.
   - Re‑tapping a tab pops to root, then scrolls to the top.
   - Back from Chat or Profile root → `Расписание`. Back from `Расписание` leaves the app (`history.length` does not keep
     growing).
   - **Stack collapse (D29):** Profile → `Друзья` → tap `Обсуждения` → Back → `Расписание` (not an invisible Friends pop);
     Chat → a user's profile → tap `Профиль` → Back → `Расписание`. After each, `depth()` is 0 on `Расписание`.
   - Profile → `Политика конфиденциальности` (DocSheet) → Back closes the DocSheet and stays on Profile.
   - With `openLayerCount(['tab']) > 0` or ChangesSheet open, the review nudge never appears.
   - With `SOCIAL_MODE=off` (restart the server): the capsule has two items, `/?uni=kfu&tab=chat` opens `Расписание`.
5. **Deep links:** `/?uni=kfu&tab=chat`, `&post=<id>`, `&user=<name>`, `&tab=chat&user=<name>` (opens in Chat),
   `&tab=profile&delete=1`, `#auth=ok` (toast `Вход выполнен`), `#auth=cancelled`. Afterwards the address bar keeps exactly the
   reserved params that were present (`uni`, `group`, `from`, `ok`, `u`), per §E.7.
   A shared post from another uni keeps the saved uni (lib/uni rule (a)). With site data cleared (no uni):
   `/?user=alice` and `/?tab=profile&delete=1` → UniversityStart shows `Выбери вуз, чтобы продолжить` → pick KFU → the link
   is applied after onboarding.
6. **Teacher mode:** the same chrome, the right slot is a placeholder, and `Профиль → Режим` switches both ways.
7. **Non‑hub server** (`DEV_TENANT=kfu`, opened at `http://127.0.0.1:8893`):
   - there is no tab bar, and the new top row is there;
   - `ThemeSection` sits above the footer;
   - the Network panel shows **zero** requests to `/api/auth|social|media` and no `ChatTab`/`ProfileTab`/`AuthHost` chunk.
8. **Offline** (DevTools Offline, then reload): the saved schedule and `OfflineNote` render, and the tab bar works. With the
   chunks prefetched, Chat shows its offline state. With them not prefetched, it shows `Раздел загрузится, когда появится интернет`.
9. **Layout:**
   - At 320×568: `document.documentElement.scrollWidth <= innerWidth`, and the title clamps to 2 lines with the chevron never
     alone on a line.
   - The last card and the footer are fully above the capsule. The review nudge and the toasts sit above the capsule.
   - Pull‑to‑refresh works only on the active tab, and never inside open sheets.
   - Reduced motion: no pill slide. Reduced transparency: solid bars.
10. **No 1 Hz re‑render:** with React DevTools "Highlight updates" (or a render counter in the console), the Chat and Profile
    panels do not re‑render every second while `Расписание` ticks, and StudentApp does not tick while hidden.
11. **Bundle:** main JS ≤ 104 KB gz (baseline about 90 KB) and main CSS ≤ 12 KB gz (baseline about 8 KB):
    `cd web && npm run build && for f in dist/assets/*.{js,css}; do printf "%s %s\n" $(gzip -c "$f" | wc -c) "$f"; done`.
    Run this only in the §G.7 gate.

### G.4 FE‑CHAT

1. Own‑files type check clean. The chat chunk is ≤ 30 KB gz JS and ≤ 5 KB gz CSS.
2. **As a guest:**
   - the feed, the chips and the threads render, and photos open in the viewer (swipe, `N из M`, Back closes);
   - the guest row shows;
   - `Новый пост`, like, reply, `Пожаловаться`, and tapping an author each open `SignInSheet` with the right title;
   - `Скрыть посты @u` removes that author's posts at once and survives a reload.
3. **As `alice`:**
   - post text + 4 photos. Each upload is ≤ 900 KB (Network), and the tiles show progress. `Опубликовано` appears and the post
     is prepended.
   - A 1000‑grapheme post (with emoji) is accepted; the 1001st grapheme disables `Опубликовать`.
   - `company` disables photos and shows `В теме «Компания» — только текст`.
   - A phone number triggers the confirmation.
   - `javascript:alert(1)` stays plain text. `https://…` becomes a link. `@bob` opens bob's profile in the chat stack.
4. **Threads:**
   - A reply with `replyTo` shows `в ответ @…`; tapping it scrolls to the target and highlights it.
   - The reply composer sits above the keyboard, and the tab bar is hidden.
   - One photo per reply.
   - `Показать ещё ответы` pages.
5. **Menus:**
   - own → `Удалить` (the confirmation, then `Пост удалён` if it has replies, otherwise it disappears);
   - someone else's → report (the post collapses to `Жалоба отправлена · Показать`) and block (the author disappears from the
     feed and the open thread);
   - as `boss`: `Скрыть (модератор)`, `Удалить как модератор`, `Ограничить автора…`.
6. **States:** the empty university and empty category states, a server error (stop the server → `Не удалось загрузить
   обсуждения` + `Повторить`), offline, `SOCIAL_MODE=readonly` and `off` (restart the server with it), and a banned user
   (ban `alice` as `boss`).
7. **Draft:** type text, add photos, reload the page → the composer restores text, category and photos. `Удалить` clears it.
8. The 429 text from the server shows verbatim, and the text is kept. Test with a BE server with limits on.
9. **Edge rules:**
   - 1000 ZWJ‑family emoji (`👨‍👩‍👧‍👦`, 11 UTF‑16 units each) exceed 4000 UTF‑16 units → `Опубликовать` is disabled before
     the server is asked (`textTooLong`).
   - As a guest inside a thread: like → sign in (dev) → you land back **in the same thread**.
   - As a guest: no post card renders any author university (`author.uni` is `null` in the Network panel, too).
   - `SOCIAL_MODE=readonly`: `Пожаловаться`, `Заблокировать` and deleting your own post still work; compose/reply/like are
     disabled.
   - `/?uni=kfu&tab=chat&compose=1` opened while signed in → the Composer opens once; as a guest → one SignInSheet.

### G.5 FE‑PROFILE

1. Own‑files type check clean. The profile chunk is ≤ 30 KB gz JS and ≤ 5 KB gz CSS. `AuthHost` is its own small chunk
   (≤ 8 KB gz).
2. **SignInSheet:**
   - every reason title;
   - the age question and the checkbox gate the button;
   - `Младше 16` → the under‑age state, which persists 30 days (`ageBlock`); for reason `report` it still shows the Telegram
     line;
   - `google:false` → disabled + caption;
   - offline → disabled + caption;
   - delete mode: no age question, no checkbox, and it opens normally even while `ageBlock` is set;
   - the dev button signs in and lands on `returnTo#auth=ok` (toast `Вход выполнен`).
3. **First sign‑in** (a new dev name through the UI dev button) → `SetupSheet` opens by itself once. The suggested username
   shows `Свободно`, a taken one shows `Это имя уже занято`, and `admin` shows the reserved message. `Продолжить` → the profile
   renders, and the tab‑bar avatar updates without a reload. With another new name, `Позже` → the `Заверши профиль` card
   shows in «Профиль»; a reload does **not** reopen the sheet; the card's button does.
4. **Edit the profile:**
   - name, username (30‑day rule text on the second change after 24 h — use BE's clock only in the smoke test; here check the
     message path using a server error);
   - bio counter;
   - Telegram paste `https://t.me/Alice_TG` → `alice_tg`;
   - Instagram validation;
   - the avatar crop → 512/128 uploaded, toast `Фото обновлено`.
5. **Privacy:** the `minor` (`mia`) link setting is locked to friends, and `Кто может добавить в друзья` starts at `Никто`
   with the minor footer. Turning search off → `mia` is not found by name but is found by the exact `@username`.
   `Кто может добавить в друзья: Никто` → others see `Не принимает заявки в друзья`. `Мой вуз` → `Не показывать` works.
6. **Friends** across two browsers (`alice` normal plus `bob` in an incognito tab): request → the badge on bob's `Профиль` tab
   → accept → both lists update. Then cancel, decline and remove. `Теперь вы друзья`.
7. **People search:** debounce and abort. Seen in the Network panel: one request per pause.
8. **Other people's profiles:**
   - a guest tapping an author → the sign‑in sheet;
   - signed in → the profile shows links only when allowed;
   - `•••` report and block, then `Этот пользователь заблокирован` + `Разблокировать`;
   - a profile of someone who blocked you → `Профиль недоступен`.
9. **Settings:**
   - the `Вуз` row opens the university menu; at 320×568 with the row scrolled to the bottom of the screen the menu is at least
     240 px tall and fully on screen; Back closes it;
   - `Группа` switches to `Расписание` and opens the Picker (in teacher mode: the teacher picker);
   - `Режим` switches role;
   - the theme applies live;
   - `На главный экран` uses the personal link, and is hidden in teacher mode (`installUrl === ''`);
   - the rules and policy open in‑app, and Back closes them without leaving «Профиль»;
   - `Выйти` → guest, `me_cache` cleared, the drafts cleared; `Выйти на всех устройствах` also signs out a second browser;
   - as a guest, `Удалить аккаунт` opens the sign‑in sheet in delete mode.
   - With `SOCIAL_MODE=off` (restart): a signed‑in `alice` still sees her card and `Удалить аккаунт`, and the social sections
     are hidden.
10. **Delete account:** the button is enabled only after ticking. Afterwards the user is a guest, `alice`'s posts are gone from
    the feed (with a tombstone where others replied), and `/?tab=profile&delete=1` as a guest opens the sign‑in sheet in
    delete mode.
11. **Moderation** as `boss`:
    - the `Жалобы` badge;
    - the stats header;
    - the open cases show reasons, notes and `rawText`, or the snapshot with `Автор удалил публикацию`; the eyebrow says
      `ОТВЕТ` for a deleted reply;
    - every photo shows `Превью` and `Оригинал` side by side;
    - `Удалить`, `Скрыть`/`Вернуть`, `Ограничить…` (the ban reason prompt), `Сбросить…` and `Отклонить` each remove the card
      with a toast, and the `Жалобы` badge updates within ~1 s;
    - after `Ограничить…`, the same author's case (open or in `Решённые`) and their profile's `•••` offer
      `Снять ограничение` → toast `Ограничение снято`;
    - `Решённые` lists closed cases with the resolver.

### G.6 POLICY

1. **Hub pages:** `/policy`, `/rules` and `/delete-account` return 200 without sign‑in, in light and dark, at 320 px wide.
   - Every row of the §E.6 facts table is stated, and nothing contradicts it (the lead reviews the diff).
   - The placeholders `[имя разработчика]`, `[страна]` and `[почта для связи]` are clearly marked.
   - `#children`, `#kept` and `#part` anchors exist.
2. **`/delete-account` script, guest:**
   - `Продолжить с Google` → the start URL has `intent=delete`;
   - with `google:false` it is disabled with the caption;
   - `#auth=none` shows the `none` text.
3. **`/delete-account` script, signed in** (dev login in the app first, then open the page): `Вы вошли как @…` → tick → delete
   → `Аккаунт удалён…`. `/api/auth/me` then shows `user:null`. Data is written only through `textContent` (review).
4. **Service worker** on the built app (Chrome DevTools → Application):
   1. Open `/?uni=kfu`, then `/policy`, then go offline and reload `/` → the schedule, not the policy.
   2. With an old SW that has a poisoned `/__page` (simulate: `caches.open('para-v1').then(c=>c.put('/__page', new Response('<html>policy</html>')))`),
      update and activate the new SW → `/__page` is deleted.
   3. `/api/auth/*`, `/api/social/*` and `/api/media/*` never appear in Cache Storage.
   4. The cache name is still `para-v1`.
   5. Asset expiry: put a fake `/assets/old-x.js` with `x-para-saved` 40 days ago and one without the header, then activate a
      new SW → the first is gone, the second now has a date; assets referenced by `/__page` are never deleted; a cache hit on
      an asset whose date is older than 7 days refreshes the date.
5. **In the app:** `DocSheet` has the new section and keys, and the new date, and uses `.sheet--doc` (no `id="doc"` anywhere
   in the DOM). The `Consent` hub bullet shows only on the hub. `SiteFooter` has a real `/policy` link. `UniversityStart` has
   the policy and rules links, and shows `Выбери вуз, чтобы продолжить` for `/?user=alice` with no uni chosen.
   `/delete-account` works with `SOCIAL_MODE=off` (restart the BE server with it).
   The policy states «до 7 дней» for photo caching, the minors' friend‑request default, and the exact `cid` sentence.
6. **`rules.ts`:** the exports are exactly as in §E.6. `play-listing.md` is updated per §E.6.

### G.7 Integration gate (lead, after every owner reports green)

1. Run `cd web && npx tsc --noEmit && npm run build` and the bundle budgets (§G.3.11, §G.4.1, §G.5.1).
   Then run `for f in server/src/*.js server/src/social/*.js; do node --check "$f"; done`.
2. BE smoke on a fresh `DATA_DIR`, then the seed.
3. **End‑to‑end on one server (375×812):**
   1. A fresh profile: UniversityStart → KFU → consent → student → group.
   2. The tab bar → Chat as a guest → like → the sign‑in sheet → the dev login → SetupSheet → back in Chat.
   3. Post with photos → a second account in incognito replies with a photo and a mention → the first one likes the reply.
   4. The second account reports → `boss` hides it → the author sees the hidden banner.
   5. Friends request and accept → the Profile badge.
   6. Block → content disappears both ways.
   7. Delete the account → a tombstone.
   8. Offline start → the schedule.
   9. Restart with `SOCIAL_MODE=off`: two tabs; a signed‑in user deletes the account from «Профиль»; `/delete-account`
      works for another user.
   10. With cleared site data: `/?tab=profile&delete=1` → UniversityStart → KFU → onboarding → the delete‑mode sign‑in sheet.
4. Regression on the `kfu` and `tsue` non‑hub hosts (§G.1.3 plus the UI in §G.3.7).
5. Only then does the owner deploy (§F.6).

---

## H. Order of work

```
Phase 0  (first ~60–90 min, all owners in parallel)  ── compiling skeletons with FINAL exported signatures
Phase 1  BE core API · FE-CORE kit+session+api+image · FE-SHELL shell+schedule · POLICY pages+sw   (parallel)
Phase 2  FE-CHAT · FE-PROFILE against the real API + seed                                        (parallel)
Phase 3  each owner runs their §G checklist and reports
Phase 4  lead integration gate (§G.7) → owner deploys (§F.6)
```

**Phase 0 deliverables.** They unblock everyone. Each owner makes these compile before anything else:
- **FE‑CORE:**
  - `social/types.ts` and `tabs.ts` in full;
  - `social/api.ts` in full (it is mechanical);
  - minimal but working `ui/*`: `Sheet` may start without drag and without animation, `toast` may start as a plain `div`;
    `layers.ts` exports all six functions (`unwind`/`whenIdle` may start as simple `history.go` wrappers);
  - `ui/icons.tsx` with every `IconName`;
  - `session.tsx` with a working guest‑only `SessionProvider` (accepting `eager`) and `useSession` whose `ready` resolves
    after the first `me()` (or at once while consent is missing, in the stub only);
  - stubs for `actions.tsx`, `social/ui/*`, `lib/image.ts`, `events.ts`, `format.ts`, `stack.ts` and `local.ts` that return
    safe values;
  - the `brand.ts` field.
- **FE‑SHELL:**
  - paste the §E.8 tokens into `index.css`;
  - add `useTheme().set`;
  - `NavBar.tsx` exports (`NavBar`, `NavButton`, `NavTextButton`, `BackButton`, `NavPlaceholder`, `LargeTitle`,
    `UniLogoButton`), `useUniversityMenu`, `ThemeControl` and the new `PullRefresh` props, all at least in simple form.
    FE‑CHAT and FE‑PROFILE import these on day one;
  - `lib/uni.ts` exports `DEEP_PARAMS` and `pendingDeepLink()` (POLICY's `UniversityStart` imports them on day one).
- **FE‑CHAT:** `ChatTab` (default export) showing `Обсуждения`, plus `PostCard` and `ThreadView` with the final props.
- **FE‑PROFILE:** `ProfileTab` (default), `UserProfileView`, `AuthHost` (default, renders `null`), `RulesSheet` and
  `GoogleButton` with the final props.
- **POLICY:** `web/src/social/rules.ts` in full.
- **BE:**
  - `server/src/social/index.js` exporting `SOCIAL_PATH`, `corsOptions`, `logSerializers` and `registerSocial`. At first it
    registers `GET /api/auth/me` (guest data) and `POST /api/auth/dev`;
  - the `config.js`, `hub.js`, `index.js`, `site.js` and `analytics.js` changes;
  - the server boots and the schedule regression passes.

**Phase 1 priorities.**
- **BE:** auth/me + dev → feed/posts/thread/replies/like → media (+ thumb) → `PATCH /me` + username → the users/search
  profile → friends/blocks/reports → admin → jobs → `social-seed.mjs` (**deliver the seed early**, since FE depends on it) →
  the full smoke test.
- **FE‑CORE:** `Sheet`/`ActionSheet`/`Toast`/`Segmented`/`List`/`Button`/`Switch` → `layers`/`bar`/`keyboard` → the full
  session with `ensure` → `image.ts` → `Avatar`/`RichText`/`PhotoGrid`/`PhotoViewer` → `actions` + `ReportSheet`.
- **FE‑SHELL:**
  1. `App.tsx` restructure with `StudentApp`, `ScheduleNav`, `ScheduleTitle` and `ChangesSheet`, first working on non‑hub;
  2. `AppShell` + `TabBar` + history + deep links;
  3. `TeacherApp`;
  4. CSS cleanup.
- **POLICY:** `sw.js` → `rules.html` → `delete-account.html` → `policy.html` → the in‑app copy → `play-listing.md`.

**Dependency map** (who waits for whom; nobody edits another owner's file):

| Consumer | Needs (by contract) |
|---|---|
| FE‑SHELL | FE‑CORE (`ui/*`, `session`, `tabs.ts`), and FE‑CHAT/FE‑PROFILE default exports (lazy) |
| FE‑CHAT | FE‑CORE (everything social), FE‑SHELL (`NavBar` family, `useUniversityMenu`, `PullRefresh`), FE‑PROFILE (`UserProfileView`), BE (runtime) |
| FE‑PROFILE | FE‑CORE, FE‑SHELL (`NavBar` family, `ThemeControl`, `useUniversityMenu`), FE‑CHAT (`PostCard`, `ThreadView`), POLICY (`rules.ts`), BE (runtime) |
| POLICY | FE‑SHELL (`pendingDeepLink` in `lib/uni.ts`) at build time; BE (`/api/auth/me`, `DELETE /api/social/me`, the routes serving the pages) for the page script |
| BE | nobody |

**Final report from each engineer** (returned to the lead, not written as a file):
- the files created, modified and deleted (all within the ownership table);
- the checks run, with a one‑line result each;
- any deviation from this contract, and why;
- requests for other owners (exact change plus the file);
- new strings not listed here.

---

## I. Мини-игра «Код» (schema V7)

A hidden multiplayer easter egg: Bulls and Cows on the flip-clock digits. Five taps on the `Hero` clock open it (web:
`web/src/game/`). Everything is asynchronous and decided by the server; all state is in `social.db`; outcomes are settled
lazily (on every read or write of a duel) and every 10 minutes (`settleExpired`); there are no per-game timers. Nothing ever
needs two people online at once: «live» (the opponent's attempts in real time, «в игре», reactions) is a bonus over SSE.
Server files: `game-logic.js` (pure rules), `game-db.js` (settle + stats + hooks; imports only `db.js` and `game-logic.js`),
`game-stream.js` (SSE registry; imports only `http.js` and `limits.js`), `game.js` (routes, view builders, boards, jobs).

### I.1 Rules

- A code and an attempt are 4 **different** digits 0–9 (a leading zero is allowed; 5040 codes). Answer: `on` (●, right digit,
  right place) and `near` (○, in the code but elsewhere); the order of the marks says nothing about which digit is which.
  Example: code 4071, attempt 1074 → ●●○○. Cracked at 4 ●. `ATTEMPTS = 12`, `FAIL_SCORE = 13`, `TTL_MS = 24 h`.
- Repeating an earlier attempt → `400 invalid` field `guess` «Эта комбинация уже была» (no attempt is spent).
- **Duel** (a race, no turns): the creator sets a code when creating; the other player sets theirs when accepting. Score = attempts
  needed to crack; not cracked in 12, or not finished before the deadline = 13. Lower score wins; equal = draw (13 : 13 too).
  An open challenge must be accepted within 24 h (`expired`, nothing counted); once both codes are set, both have 24 h
  (`deadline_at = joined_at + 24h`). «Сдаться» (`left`) = a loss. Cancelling an unaccepted challenge has no consequences.
- **Reactions**: `wave`👋 `like`👍 `wow`😮 `lol`😂 `fire`🔥 `deal`🤝; active duels only; never stored; bucket `gameReact`
  and at most 20 per duel per player (in memory).
- **«Код дня»**: each person gets their own code for the day (`randomCode()`, `crypto.randomInt`, stored on the first attempt;
  no HMAC, no salt). Day = Asia/Tashkent: `tashkentDay(ms) = new Date(ms + 5*3600e3).toISOString().slice(0,10)`. 12 attempts.
  Ranking: fewer attempts → smaller `ms` (first to last attempt, server time; 1 attempt → 0) → earlier `finished_at`. Not cracked
  → no place, the code is revealed. Streak: solve on day D — `streak_day = D−1` → +1, `= D` → unchanged, else → 1;
  `best_streak = max`; the displayed streak is 0 when `streak_day < D−1`.
- **Training with the bot** is local only (`web/src/game/bot.ts`, `store('game_bot')`), never touches the server.

**`settle(d, now)`** — the single pure function that decides outcomes. Input `{status, deadlineAt, a:{n,res}, b:{n,res}}`,
`res ∈ null | 'cracked' | 'failed' | 'timeout' | 'left'`; `score(side) = cracked ? n : failed|timeout ? 13 : null`.

| # | Condition (in order) | Result |
|---|---|---|
| 1 | `status='open'` | `now ≥ deadlineAt` → `{status:'expired', reason:'expired', winner:'none'}`, else `null` |
| 2 | `status≠'active'` | `null` |
| 3 | a side has `res='left'` | `done`, the other side wins, reason `left` |
| 4 | `now ≥ deadlineAt` | every side with `res=null` gets `timeout` (13); `timedOut = true` |
| 5 | both scores non-null | lower wins, equal → `draw`; reason `timedOut ? 'timeout' : 'score'` |
| 6 | `sa≠null, sb=null, b.n ≥ sa` (and mirror) | the final side wins, reason `early` (the other's `res` stays null; never for 13) |
| 7 | otherwise | `null` (the game continues) |

Stats change only inside `UPDATE game_duels SET status='done' … WHERE id=? AND status='active' AND v=?` with `changes === 1`
(`finishDuel`), so a duel is counted exactly once.

### I.2 Modes and kill switches

| State | Game routes | Client |
|---|---|---|
| `SOCIAL_MODE=off` or `SOCIAL_GAME=off` | not registered → catch‑all `404 not_found` | `config.game='off'`, `me.game=null`: training only |
| `SOCIAL_MODE=readonly` | reads and the stream work; writes → `403 readonly`, except `leave`, `decline`, `seen` (guard S) | «Игры с людьми временно на паузе» |
| `SOCIAL_GAME=friends` | quick → `403 forbidden` «Случайный соперник сейчас выключен»; board `scope=all\|uni` → `403 forbidden` «Общие таблицы сейчас выключены»; `searching` is 0; `DailyView.place=null, total=0` | no «Случайный соперник»; tables: «Друзья» only |

`config.js`: `social.game` (`SOCIAL_GAME`, default `on`), dev-only `gamePingMs` (`GAME_PING_MS`, default 20000, min 200) and
`gameStreamMaxMs` (`GAME_STREAM_MAX_MS`, default 900000, min 2000); `gameMode() = social.mode === 'off' ? 'off' : social.game`.
`rulesVersion` and `policyVersion` do not change.

### I.3 Schema V7 (`SCHEMA_V7` in `db.js`)

Tables `game_players` (stats and streak; created on the first `GET /api/social/games` or the first game), `game_duels`
(`kind` link|friend|quick|rematch; `status` open|active|done|expired|cancelled; `token` only for a link — kept after accept so a
retried join is idempotent, NULL once the duel is done, expired or cancelled; previews and joins require `status='open'`;
`a_id` creator, `b_id` joiner, `to_id` addressee — all `ON DELETE SET NULL`; `rematch_of`; codes; moves as JSON
`[["1074",2,2,"<iso>"], …]`; `a_res`/`b_res`; `winner` a|b|draw|none; `reason`; `a_seen`/`b_seen`; `v`; `created_at`,
`joined_at`, `deadline_at`, `finished_at`; `idx_gd_to` is partial on `to_id IS NOT NULL`, so the `ON DELETE SET NULL` action of an
account deletion uses it), `game_daily` (PK `(user_id, day)`; no university column — «Мой вуз» uses the profile's `users.uni`;
`solved` 0 playing / 1 cracked / 2 not cracked; `ms`), `game_meta` (`'beat'`). DDL verbatim in `server/src/social/db.js`.

Write rules: every write is `tx()` with no await inside; `v = v + 1` on every change of game state (not on `seen`);
`publish*` only after COMMIT, never throws. Seen flags on done/expired/cancelled: 0 for every participant except the one
whose action caused it (leaver, decliner, canceller); a finish by an attempt, expiry and timeout clear both.

### I.4 API (`/api/social/games`, envelope and hooks as §B.1; **no U guard** except `daily/board?scope=uni`)

Order in each handler: guards → validation → rate limit → transaction. Common texts:
`code`/`guess` not 4 distinct digits → `400 invalid` «Нужны четыре разные цифры»; repeated guess → `400` «Эта комбинация уже была»;
stale `n` → `409 conflict` field `n` «Состояние игры изменилось»; `n === moves.length` with the same guess as the last one → **200**
(idempotent retry); duel not active or my side final → `409 conflict` field `status` «Игра уже закончилась»;
`:id` not `^\d{1,12}$` or not a participant → `404 not_found` «Игра не найдена».

| # | Route | Guards | Buckets / caps | Body → response |
|---|---|---|---|---|
| 1 | `GET /api/social/games` | S | read | → `GameLobby`. Creates `game_players`; lazily settles own expired rows |
| 2 | `GET …/daily` | S | read | → `{daily: DailyView}`; creates nothing; own unfinished rows of past days → solved 2 |
| 3 | `POST …/daily/guess` | SPNM | gameGuess | `{day, guess, n}` → `{daily}`; `day ≠ today` → `409` field `day` «Новый день — код обновился» |
| 4 | `GET …/daily/board?scope=all\|uni\|friends` | S (+U for `uni`) | read | → `DailyBoard` (top 50, today) |
| 5 | `POST …/duels` | SPNM | gameNew, cap `game`, open limits, active limit | `{mode:'link'\|'friend'\|'quick', code, to?}` → `{duel, matched}`. First settles my own rows past their deadline. `friend`: an accepted, active, unblocked friend, else `403 blocked` «Нельзя вызвать этого пользователя»; my open invite to that friend → returned; the friend's open `friend`/`rematch` invite to me → accepted instead (`matched: true`, the duel is active — one open invite per pair, never two crossing ones). `quick`: my open search → returned; the same code paired within the last 60 s (as joiner or as host) → that duel, `matched: true` (a retry after a lost response); else pair FIFO or create |
| 6 | `GET …/invite?t=TOKEN` | none (guests); requires `X-Para: 1` (else `403 csrf`) | gameJoin: signed in → `u:<id>`; guest → by IP, charged only on a 404 (checked before) | → `{invite: GameInvite}` (`from` without uni for guests). Unknown, expired, taken, host inactive, blocked → `404` «Вызов истёк или уже принят» |
| 7 | `POST …/join` | SPNM | gameJoin by `u:<id>`, cap, active limit | `{t, code}` → `{duel}`; own token → `400 invalid` «Это твой вызов — отправь ссылку другу»; already accepted by me (a retry) → 200 with that duel |
| 8 | `POST …/duels/:id/accept` | SPNM | gameJoin by `u:<id>`, cap, active limit | `{code}` → `{duel}`; `to_id = me`, open, creator active, no block; already accepted by me → 200 |
| 9 | `POST …/duels/:id/decline` | S | gameNew | `{}` → `{}`; `to_id = me`, open → cancelled/declined |
| 10 | `GET …/duels/:id` | S | read | → `{duel}`; participants (a, b; `to_id` while open) |
| 11 | `POST …/duels/:id/guess` | SPNM | gameGuess | `{guess, n}` → `{duel}` |
| 12 | `POST …/duels/:id/react` | SPNM | gameReact, ≤ 20 per duel | `{r}` → `{}`; active only; unknown `r` → `400` field `r` |
| 13 | `POST …/duels/:id/leave` | S | gameNew | `{expect?: 'open'\|'active'}` → `{duel}`; own open → cancelled/cancelled; open invite to me → declined; active → my `res='left'`. `expect` is what the screen showed («Отменить вызов/поиск» → `'open'`, «Сдаться» → `'active'`); an open/active duel in the other state → `409 conflict` field `status` «Состояние игры изменилось» (an invite accepted while its cancel was being confirmed is never a loss); other `expect` → `400` field `expect` |
| 14 | `POST …/duels/:id/rematch` | SPNM | gameNew, cap, open limits, active limit | `{code}` → `{duel}`; first settles my own rows past their deadline (an expired offer can be neither accepted nor returned); source done, opponent active and not blocked (else `403 blocked` «Реванш с этим игроком пока недоступен»). (a) an active rematch of this duel → returned; (b) the opponent's open counter‑offer → accepted; (c) my open offer → returned; (d) new: friends → `kind 'friend'` (lobby invite), others → `kind 'rematch'` (mutual, visible only on the result screen). Non‑friends: a `rematch` offer of this pair that expired or was declined within 7 days → `403 blocked` |
| 15 | `POST …/seen` | S | read | `{ids: int[≤30]}` → `{}`; publishes `lobby` to self |
| 16 | `GET …/stream` | S, N | gameStream by user; ≤ 300 total | SSE (§I.6) |

**Open limits** (in the transaction, `429 rate`, `retryAfter: 3600`): ≤ 5 own open link/friend/rematch invites → «Слишком много
вызовов ждут ответа — отмени какой-нибудь»; ≤ 1 open quick search (a repeat returns it); ≤ 20 active duels → «Слишком много
начатых игр — сначала доиграй», checked for whoever joins and for whoever creates an invite, a search or a rematch offer. The host
of an invite is not re-checked when it is accepted, so the overshoot is at most 6 (5 invites + 1 search).

**Quick pairing** (in the transaction): the oldest open `quick` entry of someone else with `deadline_at > now`, owner active,
no block in either direction (`ORDER BY created_at`); `UPDATE … SET status='active', b_id, b_code, joined_at=now,
deadline_at=now+24h, v=v+1 WHERE id=? AND status='open' AND deadline_at>now` (the same statement for #7, #8, #14, #5 friend);
`changes ≠ 1` → one more candidate, then my own entry.

**Boards.** `scope=all`: `d.day=today AND d.solved=1 AND (u.id=$me OR (u.status='active' AND (accepted friend OR (u.searchable=1
AND u.age_group='adult'))))` and no block either way; `uni` adds `u.uni=$tenant` — the profile's «мой вуз» (for every row, mine too;
a hidden uni is in no uni board); `friends` keeps only «accepted friend». Friends are in every scope, so a friend of any age who is
missing from «Все» cannot give away that they are 16–17. Order `n, ms, finished_at`, top 50; `total` = the visible count; my place
= 1 + visible rows strictly better.

**Me and auth.** `GET /api/auth/me` → `user.game: {waiting} | null`, `config.game: 'on'|'friends'|'off'`. `gameMeOf`: no
`game_players` row → `null`; else `waiting` = my active duels with my `res` null + my unseen done/expired/cancelled rows within
7 days whose opponent is not blocked either way (what the lobby can show) + open `kind='friend'` invites to me. An open non‑friend
`rematch` is never counted and never listed for its addressee. When more than 30 rows qualify for the lobby, #1 marks my unseen
finished rows that did not make the 30 as seen (they cannot be opened), so the hero dot never stays on for them.

### I.5 Types (`web/src/social/types.ts`, mirrored exactly by the server)

```ts
type DuelKind = 'link' | 'friend' | 'quick' | 'rematch';
type DuelStatus = 'open' | 'active' | 'done' | 'expired' | 'cancelled';
type DuelRes = 'cracked' | 'failed' | 'timeout' | 'left' | null;
type DuelReason = 'score'|'early'|'left'|'timeout'|'blocked'|'banned'|'deleted'|'declined'|'expired'|'cancelled';
type GameReaction = 'wave' | 'like' | 'wow' | 'lol' | 'fire' | 'deal';
interface GameMove { g: string; on: number; near: number }
interface GameMark { on: number; near: number }
interface DuelView {
  id: number; v: number; kind: DuelKind; status: DuelStatus;
  role: 'creator' | 'joiner' | 'invited';          // invited: open duel addressed to me
  token: string | null;                            // creator only, kind 'link', status 'open'
  createdAt: string; deadlineAt: string;
  friends: boolean;
  me:  { code: string | null; moves: GameMove[]; left: number; res: DuelRes; score: number | null };
  opp: { user: UserCard | null; gone: boolean;     // gone: the opponent's account was deleted
         n: number; marks: GameMark[]; res: DuelRes; score: number | null; live: boolean };
  outcome: null | { winner: 'me' | 'opp' | 'draw' | 'none'; reason: DuelReason; oppCode: string | null };
  rematch: null | { id: number; mine: boolean; status: DuelStatus };   // latest duel with rematch_of = this id (done only)
  canRematch: boolean;                             // done, opp active and not blocked, not in cooldown, no own/active offer
}
interface DuelRow {
  id: number; v: number; kind: DuelKind; status: DuelStatus;
  state: 'turn' | 'wait_join' | 'wait_opp' | 'invited' | 'won' | 'lost' | 'draw' | 'expired' | 'cancelled';
  opp: UserCard | null; gone: boolean; myN: number; oppN: number;
  myScore: number | null; oppScore: number | null; unseen: boolean; deadlineAt: string; reason: DuelReason | null;
}
interface GameLobby {
  me: { wins: number; losses: number; draws: number; streak: number; bestStreak: number };
  daily: { status: 'new' | 'playing' | 'cracked' | 'failed'; n: number; left: number };
  duels: DuelRow[];      // invited first, then turn, then by COALESCE(finished_at, joined_at, created_at) DESC;
                         // open/active + finished within 7 days; ≤ 30; rows with a blocked opponent hidden
  searching: number;     // others in the quick pool (per viewer, minus blocked); 0 in 'friends' mode
  cfg: { attempts: 12; ttlH: 24; reactions: GameReaction[]; game: 'on' | 'friends' };
}
interface DailyView {
  day: string; status: 'new' | 'playing' | 'cracked' | 'failed';
  moves: GameMove[]; n: number; left: number; ms: number | null;
  code: string | null;          // only when finished
  place: number | null; total: number;   // scope 'all' (null/0 in 'friends' mode); the client shows the place when total ≥ 3
  streak: number; bestStreak: number;
}
interface DailyBoard { day: string; scope: 'all' | 'uni' | 'friends';
  items: { place: number; user: UserCard; n: number; ms: number; me: boolean }[];
  me: { place: number; n: number; ms: number } | null; total: number }
interface GameInvite { id: number; from: UserCard; expiresAt: string; mine: boolean }
```

**Never sent:** the opponent's code while `status ≠ 'done'`, and the opponent's guess digits ever (only `marks` — ●○ against
MY code). `opp.live` = the opponent has an open stream AND the duel is active. Reason `'blocked'` is stored but sent as
`'cancelled'` (in `outcome` and `DuelRow.reason`). A pair with a block either way gets `opp.user = null` (with `gone: false`),
`rematch = null`, `canRematch = false`, `live = false` — the blocked person never sees the blocker's current card through a duel.

**Accepted risk.** A code's 4 distinct digits are revealed to the opponent at the end of a duel; a player can use a solver (the
game cannot prevent it); there are no prizes, and stats are visible only to their owner, so neither matters. People exchange no
free text: only existing identity, 4 digits, ●○ counts and 6 preset emoji.

### I.6 SSE: `GET /api/social/games/stream`

Before hijack (normal JSON errors): `guard('SN')`, `limit('gameStream','u:'+id)`, ≥ 300 connections → `503 server` «Игра
перегружена — попробуй чуть позже». Then: capture `reply.getHeader('set-cookie')` (the session slide), `reply.hijack()`,
`writeHead(200, {content-type: text/event-stream; charset=utf-8, cache-control: no-store, x-accel-buffering: no,
x-robots-tag: noindex, connection: keep-alive, set-cookie?})`, `setKeepAlive(true, 20000)`, `setNoDelay`, `setTimeout(0)`,
write `retry: 3000\n\n` then `hello`. nginx needs no change (no buffering, no gzip for event-stream, ping < 60 s).

Registry `Map<userId, Set<Conn>>`: ≤ 3 per user (a 4th sends the oldest `bye replaced`); cleanup on the response `close`;
`writableLength > 65536` → destroy. `?c=` (`^[A-Za-z0-9_-]{8,24}$`, random per `GameStream` instance): a new connection with the
same user and `c` silently destroys the older one (no `bye`, no presence change) — a tab that reconnected after a silent network
drop does not leave a ghost that looks «в игре» or takes one of the 3 places. Events (`event: <name>\ndata: <json>\n\n`, no `id:`, no replay; resync = refetch):

| Event | Payload | When |
|---|---|---|
| `hello` | `{now}` | right after connecting |
| `ping` | `{now}` | one global `setInterval(gamePingMs)` (20 s) to every connection |
| `duel` | `{duel: DuelView}` | built per recipient, to both participants (and the addressee of an open friend invite) after any change; a change of a rematch (`rematch_of`) also re-sends its source duel (its `rematch`/`canRematch`), one level |
| `lobby` | `{waiting}` | to participants after any published duel change, and to self after `seen` |
| `react` | `{duel, r}` | to the opponent only |
| `presence` | `{duel, live}` | to the opponent in each active duel on every 0→1 of connections (at once, also when it cancels a pending «left») and 1→0 (after 5 s) |
| `bye` | `{reason: 'max_age'\|'replaced'\|'session'\|'ban'}` | lifetime `gameStreamMaxMs` (15 min), 4th connection, logout/deletion, ban; then `end()` |

### I.7 Limits (`limits.js`)

`gameGuess [3, 1 s]`, `gameNew [6, 2 min]` (create, quick, rematch, leave, decline), `gameJoin [10, 1 min]` (preview, join,
accept — by `u:<id>` when signed in: a campus Wi‑Fi or CGNAT address is shared by many; a guest preview by `ipKey(req)`, charged only
when it misses), `gameReact [5, 3 s]`, `gameStream [10, 30 s]` per user. Daily cap `game: [40, 15]`
«Лимит игр на сегодня исчерпан — попробуй завтра» — duels created (`a_id`, `created_at`) plus joined (`b_id`, `joined_at`) in 24 h.

### I.8 Hooks, background work, retention

- Block (`PUT /api/social/blocks/:id`, same tx): `cancelDuelsBetween` — every open/active duel of the pair (a/b or a/to_id,
  either order) → cancelled/blocked, winner none, seen 0 for both, no stats; then `publishDuels`.
- Ban (`moderation.js`, same tx) and account deletion (`posts.js deleteAccount`, before `DELETE FROM users`): `forfeitAll` — own
  open duels → cancelled/cancelled; open invites to them → cancelled/declined; active → their `res='left'` → `finishDuel` (the
  opponent wins with reason `left`, which the UI never names as a ban; stats count). After the tx: `closeStreams(id, 'ban' |
  'session')` and `publishDuels`. Deletion then cascades `game_players`/`game_daily`; finished duels stay for the opponent as
  «Удалённый аккаунт» (`opp.user=null, gone=true`) for at most 30 days.
- Logout: `all === true ? closeStreams(id, 'session') : closeStreamsBySid(sid)`.
- `tenMinuteJob`: `settleExpired` (≤ 500 open/active rows past the deadline, one tx each, then publish) and `sweepReactCounters`.
- `dailyJob` (retention tx): finished duels older than 30 days deleted; `game_daily` older than 90 days deleted; unfinished past
  days → `solved=2`. `game_players` stays while the account exists.
- `startGame` (all modes): every 60 s `game_meta.beat = now`; at startup, if `now − beat > 10 min`, every open/active
  `deadline_at` moves by `min(gap, 6 h)` (one tx, `v+1`). A normal deploy extends nothing.

### I.9 Tests

`node --test server/test/game-logic.test.mjs` (rules, settle table, exactly-once `finishDuel` on a temporary DB, hooks; the web bot
through `--experimental-strip-types`, 2000 seeded games averaging 6.5–8.5, skipped when unavailable) and the «Код» section of
`social-smoke.mjs` (server with `GAME_PING_MS=1000 GAME_STREAM_MAX_MS=5000`), plus its readonly/off cases and the optional
`SMOKE_GAME=friends` run against a server with `SOCIAL_GAME=friends`.

---

## Open questions (owner decisions; the defaults above apply until answered)

- **Q1.** Minimum age and Play target audience.
  - The code default is 16 (`SOCIAL_MIN_AGE`), and the recommended Play target audience is 16–17 and 18+.
  - The lead's brief said 13+. If the owner keeps 13, only the env value and the literal «16» in the public texts and
    `DocSheet` change.
- **Q2.** Legal and hosting details.
  - The developer's legal name for the policy, and the country where the VPS is hosted (placeholders `[имя разработчика]` and
    `[страна]`).
  - A local legal check on Uzbek personal‑data localization (ЗРУ‑547) before launch.
- **Q3.** The public contact email for the policy and Play (placeholder `[почта для связи]`). The compliance draft used the
  owner's personal git email; the owner must choose.
- **Q4.** Guests cannot report; they get sign‑in plus the Telegram fallback and local hide. Is this acceptable, or should
  anonymous reports be allowed (they would not count toward auto‑hide)?
- **Q5.** The systemd unit says `User=ubuntu`, `/home/ubuntu/schedule-server`, while `deploy.sh` targets `skycoax@…:~/schedule-server`
  (and the brief uses `DEPLOY_HOST=skycoax-vps`). Confirm with `systemctl cat schedule-api` which home the service runs from and
  that `DATA_DIR` (and so `media/` and `backup/`) is writable by the service user. **Blocks the first deploy.**
- **Q6.** Confirm the nginx log retention (`/etc/logrotate.d/nginx`, expected 14 days) and that `IP_SALT` is set in the VPS
  `.env`. Both are stated in the policy.
- **Q7.** Moderation capacity (the target is a review within 24 h) and the list of admin Gmail accounts for `SOCIAL_ADMIN_EMAILS`.
- **Q8.** «Компания» instead of «Знакомства», no photos there, and no marketplace in v1. Confirm.
- **Q9.** Off‑server backups of `social.db` and `media/` (today: 7 local DB copies on the same disk only).
- **Q10.** The release date for «Действует с …» in `policy.html`, `rules.html`, `delete-account.html` and `DocSheet`.
- **Q11.** An iOS home‑screen web app OAuth round‑trip needs a device test. The failure mode is safe: `#auth=browser`.
- **Q12.** Profiles and people search need sign‑in (a privacy default). Confirm, since it reduces discovery for guests.
- **Q13.** One photo per reply, no editing, no unread‑replies badge in v1. Confirm.
- **Q14.** The Google button label `Продолжить с Google` (Google's localized "Continue with Google"). Verify against Google's
  current Russian branding guidelines before shipping; the string lives only in `GoogleButton.tsx` and `delete-account.html`.
- **Q15.** Play distribution in Uzbekistan only at first; Uzbek translations of the rules and policy later.
- **Q16.** Friend requests to minors. Default now: minors start with `friendRequests:'none'` and may turn it on. Should the
  server additionally allow requests to a minor **only from the same university** (`users.uni`), or forbid adult → minor
  requests entirely? Either is a small BE change in #25 plus one line in the policy.
- **Q17.** Tab stacks (D29). Leaving a tab now resets its pushed screens (one shared history keeps Android Back predictable).
  Accept this, or fund a per‑tab history model in v1.1?
- **Q18.** Chrome may skip non‑activated history entries on Back (cold‑start restore into Chat/Profile, sheets opened by deep
  links, SetupSheet after OAuth). The contract makes those skips harmless (Back leaves the app). Accept, or require the
  cold‑start tab restore to wait for the first tap?

---

## Changelog from critique

Revision 2 answers every item of `spec/critique.md` (2 blockers, 17 majors, 22 minors). None was rejected outright. Five
were accepted in a narrower or partial form, each explained in its row: #9 (a same‑size thumb with different content is
caught by human review, not code), #15 (the same‑uni rule is left to the owner, Q16), #24 (no hide‑author button inside the
under‑age sheet), #25 (only exposure‑reducing values bypass N/M) and #32 (no audit screen in v1).

| # | Sev. | Resolution (where) |
|---|---|---|
| 1 | blocker | Each owner gets a host name (`be`, `shell`, `chat`, `profile`, `core`, `policy` + `.localhost`) with its own cookie jar; `PARA_ORIGIN` uses it. `isDevHub` accepts `*.localhost`; the dev CSRF Origin regex accepts `*.localhost` and `127.0.0.1`. Non‑hub checks use `127.0.0.1:8893` (FE‑SHELL) and `localhost:8897` (POLICY), so they never share a jar either. (§B.1, §F.3 `hub.js`, §F.4, §G.0) |
| 2 | blocker | `Session.ready` added; `ensure()` and `requestSignIn()` await it; a second `ensure()` waits on an open prompt; Chat/Profile handle links only when `status !== 'loading'`; `SessionProvider eager` fetches at once when the URL had `#auth=`, and `handleAuthOutcome` reuses that request. New G.2.6 test for `compose=1#auth=ok`. (§E.2 session, §E.3 items 3–4, §E.4, §E.5, §G.2) |
| 3 | major | D29: one shared history; `select()` unwinds the tab being left before switching; a cold start on Chat/Profile pushes `'tab'` at mount before links are handed over; legacy overlays opened from Chat/Profile (DocSheet, Install, UniversityMenu) are layers; `layers.ts` exports `depth()`, `openLayerCount()`, `unwind()`, `whenIdle()`; the Chrome skip caveat is stated and every non‑activated push is harmless. (§A.1 D29, §E.2 layers rules 1–7, §E.3 item 7, §G.3.4, Q17, Q18) |
| 4 | major | `layers.ts` serializes every history operation in one FIFO queue that waits for each `popstate`; UI `close()` returns a promise; dialogs resolve after their own `popstate`; a same‑tick push after a back is queued. G.2.5 race tests added. (§E.2 layers rules 2–6, §G.2.5) |
| 5 | major | Media GET is in no bucket; reads are keyed by user when signed in and the IP read bucket is 300 / 10 per s; OAuth is 60 / 1 per 10 s per IP with the global state cap kept; the smoke test sends 200 media GETs in 5 s. (§B.5 #16, §C.6, §G.1) |
| 6 | major | SetupSheet opens by itself only after `#auth=ok` (or from `ensure()`), is dismissible with `Позже`, and never opens in `readonly`/`off` or for banned users; Profile shows a `Заверши профиль` card instead. `me()` no longer sets a prompt. (§A.1 D9, §E.2 session steps 2, 3.7, 7, §E.5 AuthHost/SetupSheet/ProfileTab, §G.5.3) |
| 7 | major | `SOCIAL_MODE=off` keeps `GET /api/auth/me` (`mode:'off'`), logout, `DELETE /api/social/me` and the OAuth start/callback for `intent=delete`; `AuthState.mode` includes `'off'`; the tab bar shows `Расписание · Профиль` (D30) and Profile keeps the account card and deletion. G.1.6 rewritten; smoke run C. (§A.1 D18–D19, D30, §B.1, §B.5 #1–#3, #19, §B.6, §F.2, §E.3 item 12, §E.5, §G.1) |
| 8 | major | Read‑only allows `report` and `block` in `ensure()`; the guard section lists every route without M; G.1.6 reworded as proposed. (§B.2, §E.2 step 3.4, §E.4 states, §G.1.6) |
| 9 | major | The server checks thumb geometry against the full image (aspect ≤ 2 %, long side `min(640, full)` ± 2 px; avatars square, `min(128, full)`); `image.ts` derives the thumb from the final full size and lowers only quality; ModerationView shows `Превью` and `Оригинал` for every photo and both avatar sizes; the snapshot stores media ids; `rules.html` names a mismatched preview as grounds for a permanent ban. A same‑size thumb with different content cannot be detected without an image decoder (no new deps), so human review of both images is the control. (§B.4, §B.5 #13a/#14, §C.2, §C.4, §E.2 image.ts, §E.5 ModerationView, §E.6 rules.html) |
| 10 | major | `signInUrl(o)` takes `accept: boolean` and adds `accept`/`age` only for `intent==='signin'`; the server records consent only when `intent==='signin' && accepted===1`; the dev route records consent only for `signin`. (§A.1 D8, §B.5 #2, #3, #5, §E.2 api.ts, session `signIn`) |
| 11 | major | `lib/uni.ts` carries `DEEP_PARAMS` and `#auth=` through the saved‑uni redirect and `openUni()`, and exports `pendingDeepLink()`; `userLink()` includes `uni`; UniversityStart shows `Выбери вуз, чтобы продолжить`. (§E.2 actions, §E.3 lib/uni (c)–(d), §E.6 UniversityStart, §E.7, §G.3.5, §G.7) |
| 12 | major | Kept the gate (D31): `SessionProvider` sends nothing while `store('agreed')` is empty; AppShell calls `session.refresh()` on the first `onContext` after consent. G.3.3 now holds. (§A.1 D31, §E.2 session step 1, §E.3 item 13) |
| 13 | major | For guests the server sends `author.uni = author.uniShort = null` (V7); the UI never renders `author.uni*`; `UniBadge` uses `post.uniShort`. The facts table was **not** loosened. (§A.1 D11, §B.5 V7, §B.6 comments, §E.4 PostCard, §E.6 facts, §G.1, §G.4.9) |
| 14 | major | Policy wording replaced with «Сервер не связывает номер cid с аккаунтом: код обсуждений его не читает и не хранит.»; the social cookie parser reads only the session/OAuth cookie names and never logs `cookie`. (§B.1, §C.5, §E.6 facts) |
| 15 | major | Minors are created with `friendRequests:'none'` (and `searchable:false`); they may switch it on, with a warning footer. The optional same‑uni restriction is an owner decision (Q16) and is not implemented by default. (§A.1 D15, §A.2 C48, §B.5 #3, §C.2, §E.5 Settings, §E.6 facts and rules.html, Q16) |
| 16 | major | `UserProfile.banned` (admins only) and `ReportCase.user` for post targets (the author); `Снять ограничение` in ModerationView (open and closed cases) and in `userMenu`; toast `Ограничение снято`. (§B.5 #22, #33, §B.6, §E.2 actions, §E.5, §G.5.11) |
| 17 | major | `useUniversityMenu` re‑anchors the menu near the top when the element is below 45 % of the viewport, and the menu is a history layer; tested from the Profile row at 320×568. (§E.3 `useUniversityMenu`, §G.5.9) |
| 18 | major | The seed upserts fixed users `dev:alice`, `dev:bob`, `dev:mia`, `dev:boss` (suffix only on content); `POST /api/auth/dev` records rules/policy versions for `signin`; `devLogin`/`devSignIn` take `intent`; dev sign‑in navigates to `returnTo#auth=ok`, so it exercises the real return path. (§B.5 #5, §E.2 api.ts/session, §G.0, §G.1.2) |
| 19 | major | TabBar gets `me={session.status === 'guest' ? null : session.me}`. (§E.3 item 12, §G.2.6) |
| 20 | minor | Ground rule 10: `import type { JSX } from 'react'` (or `React.JSX.Element`), and `_`‑prefixed unused stub params. (§0) |
| 21 | minor | `avatar.css` split out (only `.av*`, imported by `Avatar.tsx`); `ReportSheet` lazy‑loaded; budgets set to main JS ≤ 104 KB gz and main CSS ≤ 12 KB gz. (§D, §E.2, §G.2.7, §G.3.11) |
| 22 | minor | AuthHost sits inside an `ErrorBoundary` whose fallback resolves the prompt `false` and toasts; ReportSheet likewise. (§E.3 item 11, §E.2 ReportSheet) |
| 23 | minor | Took the recommended option: `POST /reports` drops guard N, so banned users can report; `ensure('report')` passes for banned users. (§B.5 #32, §C.4 bans, §E.2 step 3.6) |
| 24 | minor | Middle age option hidden when `minAge >= 18`; delete mode ignores `ageBlock`; the under‑age state keeps the Telegram line for `report` (hiding stays in the `•••` menu, because the sheet does not know the author). (§A.1 D7, §E.5 SignInSheet) |
| 25 | minor | PATCH `/me` skips N and M when the body only reduces exposure (`linksVisibility:'friends'`, `searchable:false`, `friendRequests:'none'`, `avatar:null`, `bio:''`, `tg:''`, `ig:''`, `uni:''`). Narrowed to reducing **values**, so it cannot be used to widen exposure while banned or read‑only. (§B.2, §B.5 #17) |
| 26 | minor | `onContext` only when `agreed && (sel || teacherKey)`; `На главный экран` hidden when `installUrl === ''`; TeacherApp handles `command.kind === 'picker'`. (§E.1, §E.3 App.tsx/TeacherApp, §E.5 Settings) |
| 27 | minor | `onContext` from an effect keyed on its fields; AppShell ignores shallow‑equal contexts; the tick pauses while `!active`. (§E.3 item 13 and App.tsx, §G.3.10) |
| 28 | minor | `overlayOpenRef` includes `changesOpen` and `openLayerCount(['tab']) > 0`. (§E.3 App.tsx) |
| 29 | minor | Thread actions pass `currentReturnTo({ post: rootId })`; `user` with `tab=chat` routes to Chat (`ChatLink.user`). (§E.1, §E.2 actions, §E.3 item 4, §E.4, §E.7) |
| 30 | minor | `session.signIn` uses `location.replace`; the remaining Google‑chooser Back is documented as a harmless TWA limitation. (§E.2 session step 8) |
| 31 | minor | New `moderated` event; friend UIs emit `relation`; the session debounces a `refresh()` on both. (§E.2 events and session, §E.5) |
| 32 | minor | `Мой вуз` row in EditProfileSheet (`uni:''` clears); `Выйти на всех устройствах`; AdminStats header in ModerationView; `hiddenUsers` stores `{id, username, name}`. The audit log stays API‑only in v1 (no screen), by decision. (§B.4, §B.6 MePatch, §E.2 local.ts, §E.5, §E.7) |
| 33 | minor | a) the 413 text branches on the route; b) catch‑all 404 routes for `/api/auth/*`, `/api/social/*` and mutating `/api/media/*` (not `setNotFoundHandler`, which the root context shares); c) 5xx or non‑JSON on `/api/auth/me` is a network error; d) indexes `idx_users_avatar`, `idx_reports_post` (plus `idx_reports_child` for #37); e) `claimsFrom()` returns `given_name`; f) nginx's Referrer‑Policy accepted and documented. (§B.3, §B.5 #2–#3, §C.2, §F.2) |
| 34 | minor | `format.ts` `textTooLong()` checks graphemes and the 4000 UTF‑16 cap; Composer and ReplyComposer use it; G.4.9 test. (§E.2 format.ts, §E.4, §G.4.9) |
| 35 | minor | Main BE run with `SOCIAL_NEW_ACCOUNT_H=0` and limits on; run B with defaults and `SMOKE_NEW_ACCOUNT=1`; run C for the modes. G.3.5 aligned with §E.7 (reserved params kept). (§G.1, §G.3.5, §E.7) |
| 36 | minor | Explicit `ui.css` exception for `html.has-tabbar .ui-toast`; ScheduleNav renders `Segmented variant="glass"` and `.navseg` is placement only; `DocSheet` uses `.sheet--doc` instead of `id="doc"`, and `index.css` styles `#doc, .sheet--doc`. (§D, §E.2, §E.3, §E.6, §E.8) |
| 37 | minor | A reporter with a dismissed `child` report no longer counts for `child`; `reply_count` semantics documented; the snapshot carries `kind` and `rootId`, so the eyebrow works when `post` is null. (§B.5, §C.2, §C.4, §E.5) |
| 38 | minor | Media `Cache-Control: public, max-age=604800`; the policy says «до 7 дней». (§A.1 D14, §A.2 C49, §B.5 #16, §E.6 facts) |
| 39 | minor | One ban phrasing through `banText()` everywhere (server error, chat row, AuthHost sheet); `plural()` for «жалоба»; `Заявка отправлена`; «знак подчёркивания»; `Младше {minAge}`; the Google label stays a pre‑ship check (Q14). (§B.3, §B.4, §E.2 format.ts, §E.4, §E.5, Q14) |
| 40 | minor | `sw.js` stamps `/assets/` entries with `x-para-saved`, refreshes the stamp on use at most weekly, and on activate deletes entries unused for 30 days, never those referenced by `/__page`. (§A.1 D22, §E.6 sw.js, §G.6.4) |
| 41 | minor | Deploy notes say tar + scp (no rsync); the `skycoax@` vs `/home/ubuntu` mismatch and `DATA_DIR` writability are a first‑deploy blocker in Q5. (§F.6, Q5) |
