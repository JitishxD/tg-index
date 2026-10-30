import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { and, asc, count, desc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import { db, q, dataVersion, DOWNLOADABLE, FILE_KINDS, ALL_KINDS, type MediaRow } from "../db";
import { categories, chats, media, mediaFts } from "../db/schema";
import { config } from "../config";
import { signPath } from "../lib/sign";
import { indexerStatus, reconcile, reindex, listChats, hasChat } from "../indexer";

export const api = new Hono();
api.use("*", bearerAuth({ token: config.apiSecret }));

const P = sql.placeholder;
const PAGE = 48;
const MAX_PAGE = 10_000; // deeper OFFSETs get slow and nobody pages that far
const DAY = 86400;
const IS_FILE = sql`${media.kind} IN ('video','audio','document')`;

/** Cache results until the next effective DB write. The whole cache is dropped on a new version, so it never grows unbounded. */
const memo = new Map<string, unknown>();
let memoVersion = -1;
function cached<T>(key: string, fn: () => T): T {
  const v = dataVersion();
  if (v !== memoVersion || memo.size > 1000) {
    memo.clear();
    memoVersion = v;
  }
  if (memo.has(key)) return memo.get(key) as T;
  const data = fn();
  memo.set(key, data);
  return data;
}

const present = (m: MediaRow) => ({
  id: m.id,
  chatId: m.chatId,
  msgId: m.msgId,
  title: m.title,
  caption: m.caption,
  kind: m.kind,
  mime: m.mime,
  size: m.size,
  duration: m.duration,
  width: m.width,
  height: m.height,
  postedAt: m.postedAt,
  fileName: m.fileName,
  tags: m.tags ? m.tags.split(" ") : [],
  categoryId: m.categoryId,
  groupedId: m.groupedId,
  extra: m.extra ? JSON.parse(m.extra) : null,
  thumb: m.hasThumb ? signPath("thumb", m.id, 7 * DAY, DAY) : null,
  stream: DOWNLOADABLE.has(m.kind) ? signPath("stream", m.id, config.streamTtlSec, 3600) : null,
  playable: (m.kind === "video" && /mp4|webm/.test(m.mime)) || m.kind === "audio" || m.kind === "voice",
});

// ---------- categories (tree, inclusive counts) ----------
type Cat = { id: number; name: string; slug: string; kind: string; parentId: number | null; chatId: number; chatTitle: string; count: number; files: number };

const catRowsStmt = db
  .select({ id: categories.id, name: categories.name, slug: categories.slug, kind: categories.kind, parentId: categories.parentId, chatId: categories.chatId, chatTitle: chats.title })
  .from(categories)
  .innerJoin(chats, eq(chats.id, categories.chatId))
  .orderBy(chats.title, desc(sql`${categories.kind}='chat'`), desc(sql`${categories.kind}='topic' AND ${categories.key}='1'`), categories.name)
  .prepare();
const catCountsStmt = db
  .select({ cid: media.categoryId, n: count(), files: sql<number>`coalesce(sum(${IS_FILE}),0)` })
  .from(media)
  .groupBy(media.categoryId)
  .prepare();

function categoryIndex() {
  return cached("cats", () => {
    const active = new Set(listChats().map((c) => c.id));
    const list: Cat[] = catRowsStmt
      .all()
      .filter((r) => active.has(r.chatId))
      .map((r) => ({ ...r, count: 0, files: 0 }));
    const byId = new Map(list.map((c) => [c.id, c]));
    const bySlug = new Map(list.map((c) => [c.slug, c]));
    const kids = new Map<number, number[]>();
    for (const c of list) {
      if (c.parentId == null) continue;
      const a = kids.get(c.parentId);
      if (a) a.push(c.id);
      else kids.set(c.parentId, [c.id]);
    }
    for (const row of catCountsStmt.all()) {
      let n = row.cid != null ? byId.get(row.cid) : undefined;
      for (let depth = 0; n && depth < 32; depth++) {
        n.count += row.n;
        n.files += row.files ?? 0;
        n = n.parentId != null ? byId.get(n.parentId) : undefined;
      }
    }
    return { list, byId, bySlug, kids };
  });
}

function subtree(rootId: number): number[] {
  const { kids } = categoryIndex();
  const out: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue; // defensive: never loop on a corrupted parent chain
    seen.add(id);
    out.push(id);
    const k = kids.get(id);
    if (k) stack.push(...k);
  }
  return out;
}

function categoryPath(id: number | null) {
  const { byId } = categoryIndex();
  const out: { id: number; name: string; slug: string }[] = [];
  let n = id != null ? byId.get(id) : undefined;
  while (n && out.length < 32) {
    out.unshift({ id: n.id, name: n.name, slug: n.slug });
    n = n.parentId != null ? byId.get(n.parentId) : undefined;
  }
  return out;
}

api.get("/categories", (c) => c.json(categoryIndex().list));

// ---------- chats (home page picker) ----------
const chatStatsStmt = db
  .select({ chatId: media.chatId, count: count(), files: sql<number>`coalesce(sum(${IS_FILE}),0)`, lastPost: sql<number | null>`max(${media.postedAt})` })
  .from(media)
  .groupBy(media.chatId)
  .prepare();
const coverStmt = db
  .select({ id: media.id })
  .from(media)
  .where(and(eq(media.chatId, P("chatId")), eq(media.hasThumb, 1), inArray(media.kind, ["video", "photo"])))
  .orderBy(desc(media.postedAt))
  .limit(1)
  .prepare();

api.get("/chats", (c) => {
  const data = cached("chats", () => {
    const stats = new Map(chatStatsStmt.all().map((s) => [s.chatId, s]));
    const roots = new Map(
      categoryIndex()
        .list.filter((x) => x.kind === "chat")
        .map((x) => [x.chatId, x.slug]),
    );
    return listChats().map((ch) => {
      const s = stats.get(ch.id);
      return {
        id: ch.id,
        title: ch.title,
        username: q.getChat.get({ id: ch.id })?.username ?? null,
        isForum: ch.isForum,
        rootSlug: roots.get(ch.id) ?? null,
        count: s?.count ?? 0,
        files: s?.files ?? 0,
        lastPost: s?.lastPost ?? null,
        coverId: coverStmt.get({ chatId: ch.id })?.id ?? null,
      };
    });
  });
  return c.json(data.map(({ coverId, ...x }) => ({ ...x, cover: coverId ? signPath("thumb", coverId, 7 * DAY, DAY) : null })));
});

// ---------- listing ----------
/** sort: "new" (default) | "old" | "name" (natural sort on file name / title) */
function orderFor(sort: string | undefined) {
  if (sort === "old") return [asc(media.postedAt), asc(media.msgId)];
  if (sort === "name") return [asc(media.sortName), asc(media.msgId)];
  return [desc(media.postedAt), desc(media.msgId)];
}

api.get("/media", (c) => {
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(c.req.query("page") ?? 1)) || 1));
  const slug = c.req.query("category") || undefined;
  const chat = Number(c.req.query("chat")) || undefined;
  const kind = c.req.query("kind") || undefined;
  const all = c.req.query("all") === "1";
  const empty = { items: [], hasMore: false, total: 0, page };

  if (kind && !ALL_KINDS.has(kind)) return c.json(empty);

  const conds: SQL[] = [];
  if (slug) {
    const cat = categoryIndex().bySlug.get(slug);
    if (!cat) return c.json(empty);
    // a channel root = the whole chat (index on chat_id); otherwise the category subtree
    conds.push(cat.kind === "chat" ? eq(media.chatId, cat.chatId) : inArray(media.categoryId, subtree(cat.id)));
  }
  if (chat) conds.push(eq(media.chatId, chat));
  if (kind) conds.push(eq(media.kind, kind));
  else if (!all) conds.push(inArray(media.kind, FILE_KINDS));
  const where = conds.length ? and(...conds) : undefined;

  const rows = db
    .select()
    .from(media)
    .where(where)
    .orderBy(...orderFor(c.req.query("sort")))
    .limit(PAGE + 1)
    .offset((page - 1) * PAGE)
    .all();
  const total =
    page === 1 && rows.length <= PAGE ? rows.length : cached(`total|${slug ?? ""}|${chat ?? ""}|${kind ?? ""}|${all ? 1 : 0}`, () => db.select({ n: count() }).from(media).where(where).get()?.n ?? 0);
  return c.json({ items: rows.slice(0, PAGE).map(present), hasMore: rows.length > PAGE, total, page });
});

// ---------- search ----------
const searchStmt = db
  .select(getTableColumns(media))
  .from(mediaFts)
  .innerJoin(media, eq(media.id, mediaFts.rowid))
  .where(sql`media_fts MATCH ${P("q")}`)
  .orderBy(sql`bm25(media_fts, 10, 2, 5, 3)`)
  .limit(100)
  .prepare();

api.get("/search", (c) => {
  const fts = (c.req.query("q") ?? "")
    .slice(0, 500)
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ""))
    .filter((t) => /[\p{L}\p{N}]/u.test(t)) // tokens without letters/digits produce empty phrases
    .slice(0, 12)
    .map((t) => `"${t}"*`)
    .join(" ");
  if (!fts) return c.json({ items: [] });
  try {
    return c.json({ items: searchStmt.all({ q: fts }).map(present) });
  } catch (e) {
    console.warn("[search]", (e as Error).message);
    return c.json({ items: [] });
  }
});

// ---------- detail ----------
api.get("/media/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id)) return c.json({ error: "not found" }, 404);
  const m = q.getMedia.get({ id });
  if (!m) return c.json({ error: "not found" }, 404);
  const chat = q.getChat.get({ id: m.chatId });
  const album = m.groupedId ? q.album.all({ chatId: m.chatId, g: m.groupedId }).map(present) : [];
  const link = chat?.username ? `https://t.me/${chat.username}/${m.msgId}` : `https://t.me/c/${String(-m.chatId).replace(/^100/, "")}/${m.msgId}`;
  const path = categoryPath(m.categoryId);
  return c.json({ ...present(m), chatTitle: chat?.title, category: path.at(-1) ?? null, path, album, link });
});

// ---------- admin / ops ----------
api.get("/status", (c) => c.json(indexerStatus));
api.post("/reconcile/:chatId", (c) => {
  const id = Number(c.req.param("chatId"));
  if (!hasChat(id)) return c.json({ error: "unknown chat" }, 404);
  void reconcile(id).catch((e) => console.error("[reconcile]", e));
  return c.json({ started: true });
});
api.post("/reindex/:chatId", (c) => {
  const id = Number(c.req.param("chatId"));
  if (!hasChat(id)) return c.json({ error: "unknown chat" }, 404);
  void reindex(id).catch((e) => console.error("[reindex]", e));
  return c.json({ started: true });
});
