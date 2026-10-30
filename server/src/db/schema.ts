// Drizzle schema. MUST mirror the DDL in ./index.ts
import { sqliteTable, integer, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const chats = sqliteTable("chats", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  username: text("username"),
  isForum: integer("is_forum").notNull().default(0),
});

/** Indexer progress: history is walked oldest → newest, `cursor` = highest msg id scanned. */
export const syncState = sqliteTable("sync_state", {
  chatId: integer("chat_id").primaryKey(),
  cursor: integer("cursor").notNull().default(0),
  done: integer("done").notNull().default(0), // 1 once the first full backfill reached the newest message
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  kind: text("kind").notNull(), // chat | topic | hashtag
  key: text("key").notNull(), // "root" | topicId | "tag" | "topicId/tag"
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  parentId: integer("parent_id").references((): AnySQLiteColumn => categories.id, { onDelete: "cascade" }),
});

export const media = sqliteTable("media", {
  id: integer("id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  msgId: integer("msg_id").notNull(),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  caption: text("caption").notNull().default(""),
  fileName: text("file_name"),
  sortName: text("sort_name").notNull().default(""), // natural-sort key, see lib/natural.ts
  size: integer("size").notNull(),
  mime: text("mime").notNull(),
  duration: integer("duration"),
  width: integer("width"),
  height: integer("height"),
  hasThumb: integer("has_thumb").notNull().default(0),
  groupedId: text("grouped_id"),
  tags: text("tags").notNull().default(""),
  postedAt: integer("posted_at").notNull(),
  extra: text("extra"), // JSON string, see AGENT.md
});

/** FTS5 virtual table (created in raw SQL). Declared here only so it can be queried with Drizzle. */
export const mediaFts = sqliteTable("media_fts", {
  rowid: integer("rowid"),
  title: text("title"),
  caption: text("caption"),
  fileName: text("file_name"),
  tags: text("tags"),
});
