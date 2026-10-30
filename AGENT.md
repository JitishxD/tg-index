# TG Index — Agent Context

Private self-hosted index + streamer for Telegram channels/forum groups (owner + a few friends, not public).
A Telegram USER account (mtcute) reads history → SQLite (Drizzle + FTS5) indexes every message → Next.js UI browses/searches →
Bun server streams files from Telegram with HTTP Range. No transcoding/HLS: unplayable formats show
"use VLC/mpv" with Open in VLC / Download / Copy stream URL.

## Layout

- `server/` Bun + Hono + @mtcute/bun + drizzle-orm (port 8080)
  - `src/index.ts` boot: tg.start → startIndexer → routes; unhandledRejection logger; graceful shutdown
  - `src/config.ts` env (incl. MAX_STREAMS, STREAM_READ_AHEAD_MB, BACKFILL_DELAY_MS, RESYNC_MINUTES)
  - `src/db/schema.ts` Drizzle tables (chats, sync_state, categories, media, mediaFts read-only decl)
  - `src/db/index.ts` PRAGMAs, bootstrap DDL, prepared statements `q`, `saveRows`/`deleteRows`/`saveBatch`
    (transactions; dataVersion bumps only when total_changes() moved), `ensureCategory`, `propagateAlbumCaptions`
  - `src/indexer/index.ts` cursor-based sync (backfill + catch-up), per-chat mutex, retry/backoff, live updates,
    `reconcile`, `reindex`, `indexerStatus`, `listChats`, `hasChat`
  - `src/telegram/client.ts` TelegramClient + middlewares: flood waiter maxWait 60s, upload.getFile retry cap (4)
  - `src/telegram/extract.ts` Message → row, all message types, title + sort key, category assignment
  - `src/telegram/categories.ts` chat/topic/hashtag nodes, in-memory memo, rate-limited topic reload
  - `src/telegram/messageCache.ts` 10-min LRU message cache; per-chat batched getMessages (≤100 ids, 8ms window)
  - `src/stream/handler.ts` pull-based Range streaming, bounded read-ahead (mtcute `throttle`), chunk timeout, retries
  - `src/stream/range.ts`; `src/stream/thumb.ts` lazy disk thumbs (semaphore 4, 30s timeout, negative cache, atomic write)
  - `src/api/routes.ts` JSON API (Bearer API_SECRET), caching keyed on dataVersion
  - `src/lib/` flood (floodSeconds/withFlood/isFatal/errText), sign (HMAC, bucketed expiry), slug, natural
- `web/` Next.js 16 App Router (port 3000). Server components call the API (`lib/api.ts`, server-only).
  - `proxy.ts` cookie auth (token memoized in `lib/auth.ts`); `app/login`
  - `app/page.tsx` picker; `app/all`; `app/c/[slug]`; `app/v/[id]`; `app/search`; `app/status`
  - `components/` CategoryTree, Listing, SortPref, Feed, VideoCard, Player, SearchBox
  - `lib/tree.ts` buildTree/pathOf/contains
- `Caddyfile` /stream /thumb → server (flush_interval -1), /api → 404, rest → web. `docker-compose.yml`, `.env`.
- `data/` (gitignored): index.db(+wal/shm), session (Telegram login!), thumbs/

## Schema (NO migrations)

New tables via CREATE IF NOT EXISTS are fine. Changing an existing table = edit BOTH `schema.ts` and the DDL in
`db/index.ts`, then tell the user to delete `data/index.db*` and `data/thumbs/` (keep `data/session`). Never add migration code.

- `chats(id marked -100…, title, username, is_forum)` (legacy DBs may still have an unused `backfill_done` column)
- `sync_state(chat_id PK, cursor, done)` — cursor = highest msg id scanned (only moves forward); done = first backfill finished
- `categories(id, chat_id, kind chat|topic|hashtag, key, name, slug UNIQUE, parent_id)` — chat root (key "root") → topic (key topicId) → hashtag (key "tag" or "topicId/tag").
- `media` one row per non-service message: chat_id+msg_id UNIQUE, category_id (deepest node), kind, title, caption, file_name,
  sort_name, size, mime, duration, width, height, has_thumb, grouped_id, tags (space-sep), posted_at (unix), extra (JSON).
- title: video/audio/document → file name (audio fallback "performer - track"), else first caption line, else file name, else "kind #id".
- sort*name = naturalKey(file_name || title): lowercase, no diacritics/extension, `* . -` → space, digit runs zero-padded to 12.
- kinds: files = video audio document; downloadable also voice photo sticker round gif; others text poll location contact dice other.
- extra: audio{performer,track} sticker{emoji} text{url,siteName,title,description} poll{question,quiz,closed,voters,answers[]}
  location{lat,lng,live?,title?,address?} contact{name,phone} dice{emoji,value} other{type}.
- `media_fts` FTS5 external content, synced by triggers.

## Indexing

- `getHistory({reverse:true, offset:{id:cursor+1}, limit:100})` page by page; each page is saved with `saveBatch`
  (upserts + drops + cursor in one tx). Resume = read cursor. Catch-up = same walk, phase "catch-up".
- Per page: `withFlood` (sleeps exact FLOOD_WAIT). Around the walk: `withRetry` (8 attempts, exp backoff ≤5 min, fatal errors stop).
- `exclusive(chatId)` serializes sync / reconcile / reindex per chat. `syncAll` runs at boot and every RESYNC_MINUTES.
- reconcile deletes only ids ≤ last scanned id that weren't seen.

## Drizzle usage rules

- Query builder + `.prepare()` with `sql.placeholder` for hot paths (sync `.all/.get/.run`, bun-sqlite).
- Raw SQL only for: PRAGMAs/DDL/FTS, album caption propagation, bm25, total_changes(), cursor max().
- Writes go through `saveRows/deleteRows/saveBatch` so `dataVersion` bumps (API caches depend on it).
- Category subtree filtering is done in memory (`categoryIndex().kids`) → `inArray(category_id, ids)`; chat roots filter by chat_id.

## API (Bearer API_SECRET)

- GET /categories → [{id,name,slug,kind,parentId,chatId,chatTitle,count,files}] counts inclusive of descendants
- GET /chats → [{id,title,username,isForum,rootSlug,count,files,lastPost,cover}]
- GET /media?category=slug&chat=id&kind=K&all=1&sort=new|old|name&page=N → {items,hasMore,total,page}; default files only, newest; PAGE 48; totals cached
- GET /search?q= → {items} (prefix tokens, max 12 tokens, bm25 10/2/5/3, max 100)
- GET /media/:id → item + chatTitle, category, path[], album[], link
- GET /status → {chatId: {title,phase,scanned,indexed,cursor,running,waitUntil?,error?,lastSync?}}
- POST /reconcile/:chatId; POST /reindex/:chatId (404 if unknown)
- Public-but-signed: GET|HEAD /stream/:id (Range), GET /thumb/:id; GET /health

## Sorting (web)

Listing links carry explicit `sort=new|old|name`. `SortPref` saves it to localStorage (`tgi_sort`);
a listing URL without sort is `router.replace`d to the saved one.

## Gotchas

- mtcute RpcError: `text` is a template ("FLOOD*WAIT*%d"), the value is in `seconds`; use `floodSeconds()`/`errText()`.
- mtcute retries -503 internal errors forever when maxRetryCount=Infinity (downloads do): capped by middleware in client.ts.
- downloadAsIterable: offset % 4096 == 0 (we align to 512 KB); pass `throttle` or workers read the whole file ahead.
- File references expire: `getMessageFresh(…, force=true)` on retry.
- Stream body: never enqueue/close/error after `finish()` (`done` flag). Browser range aborts are normal.
- Every Telegram call: `withFlood` (user-facing calls pass `maxWait` so requests don't hang). One process per session file.
- Signed URL expiries are bucketed (thumbs daily, streams hourly); Next fetches use no-store.

## Workflow

- `docker compose up --build`; dev: `cd server && bun run dev`, `cd web && npm run dev` (API_URL=http://localhost:8080)
- Typecheck: `cd server && bun run typecheck`; `cd web && npm run typecheck`
- Inspect: `sqlite3 data/index.db "select * from sync_state"`, `"select kind,count(*) from media group by kind"`
- Where: parsing/title → extract.ts + lib/natural.ts; categories → telegram/categories.ts; sync → indexer/index.ts;
  endpoint → api/routes.ts + web/lib/api.ts; rendering → components/Feed.tsx; playback → stream/\* + Player.tsx
- Docs: https://ref.mtcute.dev, https://orm.drizzle.team, https://core.telegram.org/type/MessageMedia
