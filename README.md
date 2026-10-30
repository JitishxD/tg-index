# TG Index

A private, self-hosted web index and streamer for your Telegram channels and forum groups. You can browse a channel → topic → hashtag tree, search every message, and stream files with seeking straight from Telegram. Nothing is re-uploaded and nothing is transcoded.

> ⚠️ **Personal or small-group use only.** Read the [Disclaimer](#disclaimer) before you deploy.

## **📑 INDEX**

* [**✨ Features**](#features)
* [**🧠 How it works**](#how-it-works)
  * [Architecture](#architecture)
  * [Indexing](#indexing)
  * [Streaming](#streaming)
  * [Categories](#categories)
  * [Search](#search)
* [**📋 Requirements**](#requirements)
* [**🚀 Deployment**](#deployment)
  * [1. Telegram API credentials](#1-telegram-api-credentials)
  * [2. Configure `.env`](#2-configure-env)
  * [3. Log in to Telegram (once)](#3-log-in-to-telegram-once)
  * [4. Start](#4-start)
  * [Updating](#updating)
  * [Backups](#backups)
  * [Local development](#local-development)
* [**🖥️ Usage**](#usage)
* [**🔧 Configuration reference**](#configuration-reference)
* [**🔌 API reference**](#api-reference)
* [**🛠️ Operations**](#operations)
* [**🔒 Security model**](#security-model)
* [**⚠️ Limitations**](#limitations)
* [**🩺 Troubleshooting**](#troubleshooting)
* [**⚖️ Disclaimer**](#disclaimer)
* [**📄 License**](#license)

<a id="features"></a>
## ✨ Features

- **Many channels in one place.** Public or private channels and forum groups, mixed freely. Example: `CHANNELS=-1001234567890,mychannel`.
- **Automatic category tree.** Channel › forum topic › first hashtag, with counts that include sub-categories. A post `#anime Frieren Ep 3` in the topic "Shows" ends up under *Channel › Shows › #anime*.
- **Every message type is indexed.** Videos, audio, documents, photos, albums, voice notes, round videos, GIFs, stickers, text with link previews, polls, locations, contacts and dice. Use the **Files / All messages** toggle to switch views.
- **Full-text search** over titles, captions, file names and hashtags, with prefix matching and no diacritics needed. For example, `fri ep` finds `Frieren.S01E03.mkv`.
- **Natural sort by name**, so `Ep 2` comes before `Ep 10`. Each browser remembers its chosen sort.
- **Streaming with seeking** over HTTP Range, straight from Telegram's servers, with bounded memory per stream.
- **Works with external players.** For MKV, HEVC or AVI files, use *Open in VLC*, *Download*, or *Copy stream URL* (`mpv "URL"`).
- **Resumable indexing** that survives restarts, crashes and `FLOOD_WAIT` rate limits.
- **Live updates.** New, edited and deleted messages show up immediately, and a periodic catch-up fills any gaps.
- **Status page** with each channel's phase, progress, rate-limit waits and errors.
- **Password protection** using signed, expiring sessions and a per-IP limit on login attempts.
- **Automatic HTTPS** via Caddy and Let's Encrypt.

<a id="how-it-works"></a>
## 🧠 How it works

<a id="architecture"></a>
### Architecture

```
Browser
   │
   │ HTTPS
   ▼
 Caddy
   ├── /stream/*, /thumb/* ──► Server (Bun + Hono + mtcute)
   │                                  │
   │                                  ├── MTProto ──► Telegram
   │                                  │
   │                                  └── SQLite + FTS5
   │                                       (data/index.db)
   │
   ├── /api/* ──────────────────────► 404 (internal only)
   │
   └── Everything else ────────────► Web (Next.js)
                                         │
                                         │ Bearer API_SECRET
                                         │ (Docker network)
                                         ▼
                                  Server (Bun + Hono)
```

- **server**: a Telegram *user* session (mtcute) reads channel history into SQLite (Drizzle ORM, FTS5). It serves an internal JSON API and the public-but-signed `/stream` and `/thumb` endpoints.
- **web**: Next.js server components call the internal API. Only the web container's server ever talks to it; the browser never does.
- **caddy**: handles TLS, security headers and routing. `/api` is never exposed to the outside.

<a id="indexing"></a>
### Indexing

1. Each channel's history is read oldest → newest in pages of 100 messages.
2. Each page and the saved cursor (the highest message ID scanned) are written in **one transaction**, so a crash never loses or duplicates work.
3. On `FLOOD_WAIT_X`, the indexer sleeps exactly X seconds. Other errors are retried with exponential backoff, up to 5 minutes between attempts and 8 attempts in total. Fatal errors (banned, private channel) stop that channel only.
4. Once the first backfill finishes, live updates take over. Every `RESYNC_MINUTES`, a catch-up pass continues from the cursor.
5. Albums: Telegram attaches the caption to only one item, so the indexer copies the caption, hashtags and category to every sibling.

<a id="streaming"></a>
### Streaming

- Every media URL is HMAC-signed with an expiry: streams last about 6 hours (in hourly buckets) and thumbnails about 7 days (in daily buckets), so browsers can cache them.
- Bytes are pulled from Telegram only when the player asks for more. Read-ahead is capped by `STREAM_READ_AHEAD_MB`.
- An expired file reference is refreshed automatically. A stalled chunk (no data for 45 s) is retried up to 4 times.
- Only real video, audio and raster image types play inline. Anything else (HTML, SVG, PDF…) is forced to download inside a sandbox, so an uploaded file can never run script on your domain.

<a id="categories"></a>
### Categories

| `CATEGORY_MODE` | Tree |
|---|---|
| `auto` (default) | Channel › Topic (forums) › #firsthashtag |
| `topic` | Channel › Topic |
| `hashtag` | Channel › #firsthashtag |
| `chat` | Channel only |

Two forums can both have a topic called "General". Their slugs are made unique automatically.

<a id="search"></a>
### Search

You get SQLite FTS5 with the `unicode61 remove_diacritics` tokenizer. Every word is treated as a prefix, and results are ranked by BM25 with these weights: title 10, caption 2, file name 5, tags 3. Searches use at most 12 words and return at most 100 results.

<a id="requirements"></a>
## 📋 Requirements

- A Linux host with **Docker** and **Docker Compose v2**, at least 1 GB RAM, plus disk space for the index and thumbnails (usually small).
- A **domain** whose A/AAAA record points to the host, with ports **80 and 443** open. For a LAN-only setup, `localhost` works too.
- A **Telegram user account** that is a member of every channel you want to index.
- `API_ID` / `API_HASH` from <https://my.telegram.org/apps>.

<a id="deployment"></a>
## 🚀 Deployment

<a id="1-telegram-api-credentials"></a>
### 1. Telegram API credentials
Open <https://my.telegram.org/apps>, create an app, and copy the **api_id** and **api_hash**.

<a id="2-configure-env"></a>
### 2. Configure `.env`
```bash
cp .env.example .env
for k in API_SECRET STREAM_SECRET AUTH_SECRET; do
  sed -i "s|^$k=.*|$k=$(openssl rand -hex 32)|" .env
done
nano .env   # set API_ID, API_HASH, CHANNELS, SITE_PASSWORD, DOMAIN
chmod 600 .env
```
To find a private channel's ID, forward one of its posts to a bot such as @userinfobot. You can also open the channel in Telegram Web: the URL contains `-100…`.

<a id="3-log-in-to-telegram-once"></a>
### 3. Log in to Telegram (once)
```bash
docker compose run --rm server bun run login
```
Enter your phone number, the login code, and your 2FA password if you have one. The session is saved to `data/session`. **Treat this file like a password**: anyone who has it controls your Telegram account.

<a id="4-start"></a>
### 4. Start
```bash
docker compose up -d --build
docker compose logs -f server   # watch the backfill
```
Then open `https://$DOMAIN` and log in with `SITE_PASSWORD`.

<a id="updating"></a>
### Updating
```bash
git pull && docker compose up -d --build
```
New indexes are created automatically. If a release notes a **schema change**, delete `data/index.db*` and `data/thumbs/` but **keep `data/session`**. The index then rebuilds itself.

<a id="backups"></a>
### Backups
You only need `data/session`, to skip logging in again, and optionally `data/index.db`, to skip the re-index. Back up the database while it is running with:
```bash
docker compose exec server sh -c 'apt-get -qq install -y sqlite3 >/dev/null; sqlite3 data/index.db ".backup data/backup.db"'
```

<a id="local-development"></a>
### Local development
```bash
cd server && bun install && bun run login && bun run dev        # :8080
cd web && npm install && API_URL=http://localhost:8080 npm run dev  # :3000
```
Both processes read the environment variables from your shell, so `export $(grep -v '^#' .env | xargs)` first. Typecheck with `bun run typecheck` in `server/` and `npm run typecheck` in `web/`.

<a id="usage"></a>
## 🖥️ Usage

- **Home** shows a channel picker plus an **Everything** view.
- **Inside a channel** you get the sidebar tree, breadcrumbs, the **Files / All messages** toggle and **Newest / Oldest / Name** sorting.
- **Item page** has the player, *Open in VLC*, *Download*, *Copy stream URL*, *Open in Telegram*, and the album grid.
- **Search box** works on every page. Try `#tag`, file-name fragments, or caption words.
- **/status** shows indexer progress for each channel.
- **Logout** is in the top-right corner.

<a id="configuration-reference"></a>
## 🔧 Configuration reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_ID`, `API_HASH` | ✅ | — | Telegram app credentials |
| `CHANNELS` | ✅ | — | Comma-separated `-100…` IDs or usernames |
| `CATEGORY_MODE` | | `auto` | `auto` / `topic` / `hashtag` / `chat` |
| `API_SECRET` | ✅ | — | web → server bearer token (≥16 chars) |
| `STREAM_SECRET` | ✅ | — | HMAC key for signed media URLs (≥16 chars) |
| `AUTH_SECRET` | ✅ | — | HMAC key for login sessions (≥16 chars) |
| `SITE_PASSWORD` | ✅ | — | Login password (≥8 chars) |
| `DOMAIN` | | `localhost` | Hostname Caddy serves and gets a certificate for |
| `MAX_STREAMS` | | `8` | Maximum concurrent streams (503 beyond this) |
| `STREAM_READ_AHEAD_MB` | | `8` | Buffer per stream |
| `BACKFILL_DELAY_MS` | | `500` | Pause between pages of 100 messages |
| `RESYNC_MINUTES` | | `30` | Periodic catch-up (`0` = off) |

Rotating `STREAM_SECRET` invalidates media links that are already open. Rotating `AUTH_SECRET` or `SITE_PASSWORD` logs everyone out.

<a id="api-reference"></a>
## 🔌 API reference

The API is internal: it is only reachable on the Docker network, and every request needs the header `Authorization: Bearer $API_SECRET`.

| Method & path | Returns |
|---|---|
| `GET /api/categories` | `[{id,name,slug,kind,parentId,chatId,chatTitle,count,files}]` |
| `GET /api/chats` | `[{id,title,username,isForum,rootSlug,count,files,lastPost,cover}]` |
| `GET /api/media?category=&chat=&kind=&all=1&sort=new\|old\|name&page=` | `{items,hasMore,total,page}` (48 per page, files only by default) |
| `GET /api/search?q=` | `{items}` (max 100) |
| `GET /api/media/:id` | item + `chatTitle, category, path[], album[], link` |
| `GET /api/status` | `{chatId: {title,phase,scanned,indexed,cursor,running,waitUntil?,error?,lastSync?}}` |
| `POST /api/reconcile/:chatId` | Full rescan: refreshes rows, removes messages deleted while offline |
| `POST /api/reindex/:chatId` | Forgets progress and re-indexes from scratch |

The public endpoints need a signature: `GET|HEAD /stream/:id?exp=&sig=[&dl=1]` supports Range requests, and `GET /thumb/:id?exp=&sig=` serves thumbnails. `GET /health` returns `{ok:true}`.

Example (run from the host):
```bash
docker compose exec server sh -c 'curl -s -H "Authorization: Bearer $API_SECRET" "localhost:8080/api/search?q=frieren" | head -c 500'
```

<a id="operations"></a>
## 🛠️ Operations

```bash
# remove messages deleted while the server was offline (also fixes album categories)
docker compose exec server sh -c 'curl -fsS -X POST -H "Authorization: Bearer $API_SECRET" localhost:8080/api/reconcile/-1001234567890'

# re-index from scratch (e.g. after changing CATEGORY_MODE)
docker compose exec server sh -c 'curl -fsS -X POST -H "Authorization: Bearer $API_SECRET" localhost:8080/api/reindex/-1001234567890'

# logs
docker compose logs -f --tail=200 server
```
The single quotes matter: they make `$API_SECRET` expand *inside* the container rather than in your host shell.

<a id="security-model"></a>
## 🔒 Security model

- **One shared password** protects the site. Sessions are HMAC-signed, expire after 30 days, and can be revoked by changing the password or `AUTH_SECRET`. Login allows 10 failed attempts per IP every 15 minutes.
- **Two layers of auth:** the edge proxy checks the session, and every data fetch on the server checks it again.
- **Media URLs are signed bearer links.** Anyone you hand a link to can use it until it expires, which is up to about 7 hours for streams.
- **Uploaded content is untrusted.** Non-media files are never rendered inline (`nosniff`, `attachment`, `CSP: sandbox`).
- The Telegram credentials and `data/session` stay inside the server container only.
- Headers: HSTS (except on localhost), `X-Frame-Options: DENY`, `Referrer-Policy`, and `X-Robots-Tag: noindex`.

<a id="limitations"></a>
## ⚠️ Limitations

- **No transcoding.** MKV, HEVC, AVI and multi-audio files often won't play in a browser, so use VLC or mpv. Subtitles are not extracted.
- **Single process per session.** No horizontal scaling. Don't run two instances with the same `data/session`.
- **Throughput depends on Telegram.** Download speed is limited per account, and big channels take hours to backfill because of rate limits.
- **Deletions while offline** are only picked up by `reconcile`. Live delete events are best-effort.
- **No multi-user accounts or per-channel permissions.** Everyone with the password sees everything.
- Paging stops at page 10,000, and search returns at most 100 results.
- The in-memory login rate limit resets when the container restarts.

<a id="troubleshooting"></a>
## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| `Env X is weak or still the example value` | Generate it with `openssl rand -hex 32` |
| `FLOOD_WAIT_X` in the logs | Normal: the indexer waits and continues. Raise `BACKFILL_DELAY_MS` if it happens a lot |
| `-503 Timeout (upload.getFile)` | Telegram's file datacenter is struggling. Requests retry with a fresh reference, so try again later |
| `cannot open <channel>` / `CHANNEL_PRIVATE` | The logged-in account isn't a member, or the ID is wrong |
| `AUTH_KEY_UNREGISTERED` | The session was revoked. Run `bun run login` again |
| "Too many streams" (503) | Raise `MAX_STREAMS` or close other tabs |
| Login loops back to the login page over plain HTTP | Use HTTPS via Caddy. Secure cookies need it |
| Certificate errors | Check DNS and that ports 80/443 are reachable. See `docker compose logs caddy` |
| Video shows "can't play" | The codec isn't supported by the browser. Use *Open in VLC* |

<a id="disclaimer"></a>
## ⚖️ Disclaimer

This project is **not affiliated with Telegram**. It automates a user account through MTProto, which Telegram may rate-limit, restrict or ban under its [Terms of Service](https://telegram.org/tos). Use an account you can afford to lose. **You are solely responsible** for the content you index and share. Do not use it to distribute copyrighted material without permission, and keep instances private. Anyone who gets hold of `data/session` has full access to your Telegram account. The software is provided "as is", without warranty; see [LICENSE](LICENSE).

<a id="license"></a>
## 📄 License

[MIT](LICENSE)
