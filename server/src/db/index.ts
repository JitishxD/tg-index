import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { and, eq, lte, sql } from "drizzle-orm";
import { config } from "../config";
import { slugify } from "../lib/slug";
import * as schema from "./schema";
import { chats, categories, media, syncState } from "./schema";

mkdirSync(config.dataDir, { recursive: true });
export const sqlite = new Database(`${config.dataDir}/index.db`, { create: true });
sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA cache_size=-32000; PRAGMA temp_store=MEMORY; PRAGMA mmap_size=268435456;");

// Bootstrap. Keep in sync with schema.ts (indexes may be added freely: CREATE INDEX IF NOT EXISTS is not a schema change)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, username TEXT,
  is_forum INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_state (
  chat_id INTEGER PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  UNIQUE(chat_id, kind, key)
);
CREATE INDEX IF NOT EXISTS categories_parent ON categories(parent_id);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL, msg_id INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
  file_name TEXT, sort_name TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL, mime TEXT NOT NULL,
  duration INTEGER, width INTEGER, height INTEGER, has_thumb INTEGER NOT NULL DEFAULT 0,
  grouped_id TEXT, tags TEXT NOT NULL DEFAULT '', posted_at INTEGER NOT NULL, extra TEXT,
  UNIQUE(chat_id, msg_id)
);
CREATE INDEX IF NOT EXISTS media_cat ON media(category_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS media_chat ON media(chat_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS media_posted ON media(posted_at DESC);
CREATE INDEX IF NOT EXISTS media_kind ON media(kind, posted_at DESC);
CREATE INDEX IF NOT EXISTS media_group ON media(chat_id, grouped_id);
CREATE INDEX IF NOT EXISTS media_name ON media(sort_name, msg_id);
CREATE INDEX IF NOT EXISTS media_chat_name ON media(chat_id, sort_name, msg_id);
CREATE INDEX IF NOT EXISTS media_cat_name ON media(category_id, sort_name, msg_id);

CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
  title, caption, file_name, tags, content='media', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS media_ai AFTER INSERT ON media BEGIN
  INSERT INTO media_fts(rowid,title,caption,file_name,tags) VALUES (new.id,new.title,new.caption,coalesce(new.file_name,''),new.tags);
END;
CREATE TRIGGER IF NOT EXISTS media_ad AFTER DELETE ON media BEGIN
  INSERT INTO media_fts(media_fts,rowid,title,caption,file_name,tags) VALUES('delete',old.id,old.title,old.caption,coalesce(old.file_name,''),old.tags);
END;
CREATE TRIGGER IF NOT EXISTS media_au AFTER UPDATE OF title,caption,file_name,tags ON media BEGIN
  INSERT INTO media_fts(media_fts,rowid,title,caption,file_name,tags) VALUES('delete',old.id,old.title,old.caption,coalesce(old.file_name,''),old.tags);
  INSERT INTO media_fts(rowid,title,caption,file_name,tags) VALUES (new.id,new.title,new.caption,coalesce(new.file_name,''),new.tags);
END;
`);

// Keep query-planner statistics fresh (cheap; only analyzes what changed).
const optimize = () => {
  try {
    sqlite.exec("PRAGMA optimize");
  } catch {}
};
try {
  sqlite.exec("PRAGMA optimize=0x10002");
} catch {}
setInterval(optimize, 6 * 3600_000).unref?.();

export const db = drizzle({ client: sqlite, schema });

export type MediaRow = typeof media.$inferSelect;
export type MediaInput = Omit<MediaRow, "id">;

/** Kinds shown in the default ("files only") view. */
export const FILE_KINDS = ["video", "audio", "document"];
/** Kinds whose bytes can be served via /stream. */
export const DOWNLOADABLE = new Set(["video", "audio", "document", "voice", "photo", "sticker", "round", "gif"]);
/** Every kind extract.ts can produce. */
export const ALL_KINDS = new Set([...DOWNLOADABLE, "text", "poll", "location", "contact", "dice", "other"]);

/** Bumped on every effective write; used by the API to cache aggregate queries. */
let version = 0;
export const dataVersion = () => version;
const bump = () => void version++;

const totalChanges = sqlite.query<{ n: number }, []>("SELECT total_changes() AS n");

/** Runs `fn` in a transaction and bumps dataVersion only if a row actually changed. `after` runs in the same tx, uncounted. */
function tx(fn: () => void, after?: () => void) {
  let changed = false;
  sqlite.transaction(() => {
    const before = totalChanges.get()!.n;
    fn();
    changed = totalChanges.get()!.n !== before;
    after?.();
  })();
  if (changed) bump();
}

const P = sql.placeholder;
const MEDIA_FIELDS = [
  "chatId",
  "msgId",
  "categoryId",
  "kind",
  "title",
  "caption",
  "fileName",
  "sortName",
  "size",
  "mime",
  "duration",
  "width",
  "height",
  "hasThumb",
  "groupedId",
  "tags",
  "postedAt",
  "extra",
] as const;
const UPDATE_FIELDS = MEDIA_FIELDS.filter((f) => f !== "chatId" && f !== "msgId" && f !== "postedAt");

export const q = {
  upsertChat: db
    .insert(chats)
    .values({ id: P("id"), title: P("title"), username: P("username"), isForum: P("isForum") })
    .onConflictDoUpdate({ target: chats.id, set: { title: sql`excluded.title`, username: sql`excluded.username`, isForum: sql`excluded.is_forum` } })
    .prepare(),
  getChat: db
    .select()
    .from(chats)
    .where(eq(chats.id, P("id")))
    .prepare(),

  getSync: db
    .select()
    .from(syncState)
    .where(eq(syncState.chatId, P("chatId")))
    .prepare(),
  /** Cursor only moves forward. */
  setCursor: db
    .insert(syncState)
    .values({ chatId: P("chatId"), cursor: P("cursor") })
    .onConflictDoUpdate({ target: syncState.chatId, set: { cursor: sql.raw(`max("sync_state"."cursor", excluded."cursor")`) } })
    .prepare(),
  markDone: db
    .insert(syncState)
    .values({ chatId: P("chatId"), cursor: 0, done: 1 })
    .onConflictDoUpdate({ target: syncState.chatId, set: { done: 1 } })
    .prepare(),
  resetSync: db
    .insert(syncState)
    .values({ chatId: P("chatId"), cursor: 0, done: 0 })
    .onConflictDoUpdate({ target: syncState.chatId, set: { cursor: 0, done: 0 } })
    .prepare(),

  findCategory: db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.chatId, P("chatId")), eq(categories.kind, P("kind")), eq(categories.key, P("key"))))
    .prepare(),
  insertCategory: db
    .insert(categories)
    .values({ chatId: P("chatId"), kind: P("kind"), key: P("key"), name: P("name"), slug: P("slug"), parentId: P("parentId") })
    .returning({ id: categories.id })
    .prepare(),
  updateCategory: db
    .update(categories)
    .set({ name: sql`${P("name")}`, parentId: sql`${P("parentId")}` })
    .where(eq(categories.id, P("id")))
    .prepare(),

  // Only touches the row (and FTS) when something actually changed.
  upsertMedia: db
    .insert(media)
    .values(Object.fromEntries(MEDIA_FIELDS.map((f) => [f, P(f)])) as any)
    .onConflictDoUpdate({
      target: [media.chatId, media.msgId],
      set: Object.fromEntries(UPDATE_FIELDS.map((f) => [f, sql.raw(`excluded.${media[f].name}`)])),
      setWhere: sql.raw(UPDATE_FIELDS.map((f) => `"media"."${media[f].name}" IS NOT excluded.${media[f].name}`).join(" OR ")),
    })
    .prepare(),
  deleteMedia: db
    .delete(media)
    .where(and(eq(media.chatId, P("chatId")), eq(media.msgId, P("msgId"))))
    .prepare(),
  getMedia: db
    .select()
    .from(media)
    .where(eq(media.id, P("id")))
    .prepare(),
  msgIdsUpTo: db
    .select({ msgId: media.msgId })
    .from(media)
    .where(and(eq(media.chatId, P("chatId")), lte(media.msgId, P("max"))))
    .prepare(),
  album: db
    .select()
    .from(media)
    .where(and(eq(media.chatId, P("chatId")), eq(media.groupedId, P("g"))))
    .orderBy(media.msgId)
    .prepare(),
};

export function saveRows(rows: MediaInput[]) {
  if (!rows.length) return;
  tx(() => {
    for (const r of rows) q.upsertMedia.run(r as any);
  });
}

export function deleteRows(chatId: number, msgIds: number[]) {
  if (!msgIds.length) return;
  tx(() => {
    for (const msgId of msgIds) q.deleteMedia.run({ chatId, msgId });
  });
}

/** One history page: upserts, removals of no-longer-indexable messages, and the cursor, atomically. */
export function saveBatch(chatId: number, rows: MediaInput[], drop: number[], cursor: number) {
  tx(
    () => {
      for (const r of rows) q.upsertMedia.run(r as any);
      for (const msgId of drop) q.deleteMedia.run({ chatId, msgId });
    },
    () => q.setCursor.run({ chatId, cursor }),
  );
}

export function ensureCategory(chatId: number, kind: string, key: string, name: string, parentId: number | null, rename = true): number {
  const ex = q.findCategory.get({ chatId, kind, key });
  if (ex) {
    if ((rename && ex.name !== name) || ex.parentId !== parentId) {
      q.updateCategory.run({ id: ex.id, name: rename ? name : ex.name, parentId });
      bump();
    }
    return ex.id;
  }
  const base = slugify(name);
  bump();
  try {
    return q.insertCategory.get({ chatId, kind, key, name, slug: base, parentId })!.id;
  } catch {
    // slug collision (e.g. two forums both have "General")
    return q.insertCategory.get({ chatId, kind, key, name, slug: `${base}-${Math.abs(chatId) % 100000}-${kind[0]}${slugify(key)}`, parentId })!.id;
  }
}

const propagateStmt = sqlite.prepare(
  `UPDATE media SET
    caption     = (SELECT m2.caption     FROM media m2 WHERE m2.chat_id=media.chat_id AND m2.grouped_id=media.grouped_id AND m2.caption<>'' ORDER BY m2.msg_id LIMIT 1),
    tags        = (SELECT m2.tags        FROM media m2 WHERE m2.chat_id=media.chat_id AND m2.grouped_id=media.grouped_id AND m2.caption<>'' ORDER BY m2.msg_id LIMIT 1),
    category_id = (SELECT m2.category_id FROM media m2 WHERE m2.chat_id=media.chat_id AND m2.grouped_id=media.grouped_id AND m2.caption<>'' ORDER BY m2.msg_id LIMIT 1)
  WHERE chat_id=? AND grouped_id IS NOT NULL AND caption=''
    AND EXISTS (SELECT 1 FROM media m2 WHERE m2.chat_id=media.chat_id AND m2.grouped_id=media.grouped_id AND m2.caption<>'')`,
);
/** Albums: Telegram puts the caption on only one item. Copy caption, tags and category to siblings. */
export function propagateAlbumCaptions(chatId: number) {
  if (propagateStmt.run(chatId).changes) bump();
}
