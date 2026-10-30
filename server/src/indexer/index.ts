import type { Message } from "@mtcute/bun";
import { tg } from "../telegram/client";
import { config } from "../config";
import { q, saveRows, saveBatch, deleteRows, propagateAlbumCaptions, type MediaInput } from "../db";
import { extractMedia } from "../telegram/extract";
import { chatCategory, loadTopics } from "../telegram/categories";
import { invalidate } from "../telegram/messageCache";
import { errText, floodSeconds, isFatal, sleep, withFlood } from "../lib/flood";

type ChatInfo = { id: number; title: string; isForum: boolean };
type Phase = "backfill" | "catch-up" | "reconcile";
export type ChatStatus = {
  title: string;
  phase: Phase | null;
  scanned: number;
  indexed: number;
  cursor: number;
  running: boolean;
  waitUntil?: number;
  error?: string;
  lastSync?: number;
};

const PAGE = 100;
const MAX_ATTEMPTS = 8;
const chats = new Map<number, ChatInfo>();
export const indexerStatus: Record<string, ChatStatus> = {};

export const listChats = () => [...chats.values()];
export const hasChat = (id: number) => chats.has(id);

// ---------- per-chat mutex (sync / reconcile / reindex never overlap) ----------
const locks = new Map<number, Promise<unknown>>();
function exclusive<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(chatId) ?? Promise.resolve()).catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(chatId, tail);
  void tail.then(() => {
    if (locks.get(chatId) === tail) locks.delete(chatId);
  });
  return run;
}

function begin(chat: ChatInfo, phase: Phase, cursor: number): ChatStatus {
  const prev = indexerStatus[chat.id];
  return (indexerStatus[chat.id] = { title: chat.title, phase, scanned: 0, indexed: 0, cursor, running: true, lastSync: prev?.lastSync });
}
function finish(st: ChatStatus) {
  Object.assign(st, { running: false, phase: null, error: undefined, waitUntil: undefined, lastSync: Date.now() });
}

/**
 * Album siblings inside one page get the caption/tags/category of the captioned item *before* saving,
 * so re-scans upsert identical values (no caption flip-flop, no FTS churn). Albums split across
 * pages are still handled by propagateAlbumCaptions().
 */
function propagateInPage(rows: MediaInput[]) {
  const src = new Map<string, MediaInput>();
  for (const r of rows) if (r.groupedId && r.caption && !src.has(r.groupedId)) src.set(r.groupedId, r);
  if (!src.size) return;
  for (const r of rows) {
    if (!r.groupedId || r.caption) continue;
    const s = src.get(r.groupedId);
    if (!s) continue;
    r.caption = s.caption;
    r.tags = s.tags;
    r.categoryId = s.categoryId;
  }
}

async function toRows(chat: ChatInfo, msgs: Message[]) {
  const rows: MediaInput[] = [];
  const drop: number[] = [];
  for (const m of msgs) {
    if (m.isService) continue;
    const r = await extractMedia(m, chat);
    if (r) rows.push(r);
    else drop.push(m.id);
  }
  propagateInPage(rows);
  return { rows, drop };
}

/** Walks history oldest → newest after `pos.id`; `pos` is advanced per page so a retry resumes where it stopped. */
async function walk(chat: ChatInfo, pos: { id: number }, st: ChatStatus, onPage: (msgs: Message[], last: number) => Promise<void>) {
  for (;;) {
    const page = await withFlood(() => tg.getHistory(chat.id, { reverse: true, offset: { id: pos.id + 1, date: 0 }, limit: PAGE }), {
      tries: 50,
      label: chat.title,
      onWait: (s) => (st.waitUntil = Date.now() + s * 1000),
    });
    st.waitUntil = undefined;
    if (!page.length) return;
    const last = page.reduce((m, x) => Math.max(m, x.id), pos.id);
    if (last <= pos.id) return; // no progress: never loop forever
    await onPage(page, last);
    pos.id = last;
    st.cursor = last;
    st.scanned += page.length;
    if (config.backfillDelayMs > 0) await sleep(config.backfillDelayMs);
  }
}

/** Retries `fn` with backoff; FLOOD_WAITs sleep exactly as long as Telegram asks. */
async function withRetry(chat: ChatInfo, st: ChatStatus, fn: () => Promise<void>): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fn();
      return true;
    } catch (e) {
      const msg = errText(e);
      if (isFatal(e) || attempt >= MAX_ATTEMPTS) {
        console.error(`[indexer] ${chat.title}: ${st.phase} failed: ${msg}`);
        Object.assign(st, { running: false, error: msg, waitUntil: undefined });
        return false;
      }
      const flood = floodSeconds(e);
      const wait = flood != null ? (flood + 1) * 1000 : Math.min(300_000, 5_000 * 2 ** (attempt - 1));
      console.warn(`[indexer] ${chat.title}: ${msg} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`);
      Object.assign(st, { error: msg, waitUntil: Date.now() + wait });
      await sleep(wait);
    }
  }
}

/** Backfill (first run) or catch-up (later): continues after the stored cursor. Must run inside exclusive(). */
async function syncLocked(chat: ChatInfo) {
  const initial = q.getSync.get({ chatId: chat.id });
  const st = begin(chat, initial?.done ? "catch-up" : "backfill", initial?.cursor ?? 0);
  if (st.phase === "backfill") console.log(`[indexer] ${chat.title}: backfill from #${st.cursor}`);
  let pages = 0;

  const ok = await withRetry(chat, st, async () => {
    const pos = { id: q.getSync.get({ chatId: chat.id })?.cursor ?? 0 };
    await walk(chat, pos, st, async (msgs, last) => {
      const { rows, drop } = await toRows(chat, msgs);
      saveBatch(chat.id, rows, drop, last);
      st.indexed += rows.length;
      if (++pages % 20 === 0) {
        propagateAlbumCaptions(chat.id);
        console.log(`[indexer] ${chat.title}: scanned ${st.scanned}, indexed ${st.indexed}, at #${last}`);
      }
    });
  });
  if (!ok) return;

  q.markDone.run({ chatId: chat.id });
  propagateAlbumCaptions(chat.id);
  if (st.phase === "backfill" || st.scanned) console.log(`[indexer] ${chat.title}: ${st.phase} done (scanned ${st.scanned}, indexed ${st.indexed})`);
  finish(st);
}

let syncing = false;
async function syncAll() {
  if (syncing) return;
  syncing = true;
  try {
    for (const chat of chats.values()) await exclusive(chat.id, () => syncLocked(chat));
  } finally {
    syncing = false;
  }
}

async function store(msg: Message) {
  const chat = chats.get(msg.chat.id);
  if (!chat || msg.isService) return;
  const row = await extractMedia(msg, chat);
  if (row) saveRows([row]);
  else deleteRows(chat.id, [msg.id]);
  if (msg.groupedIdUnique) propagateAlbumCaptions(chat.id);
}

export async function startIndexer() {
  for (const ref of config.channels) {
    try {
      const c = await withFlood(() => tg.getChat(ref), { tries: 10, label: `getChat ${ref}` });
      const isForum = Boolean((c.raw as any).forum);
      chats.set(c.id, { id: c.id, title: c.displayName, isForum });
      q.upsertChat.run({ id: c.id, title: c.displayName, username: c.username ?? null, isForum: isForum ? 1 : 0 });
      chatCategory(c.id, c.displayName); // root node exists even before the first message is indexed
      if (isForum) await loadTopics(c.id);
      await tg.openChat(c.id).catch(() => {});
    } catch (e) {
      // one broken channel must not take the whole server down
      console.error(`[indexer] cannot open ${ref}: ${errText(e)}`);
      indexerStatus[String(ref)] = { title: String(ref), phase: null, scanned: 0, indexed: 0, cursor: 0, running: false, error: errText(e) };
    }
  }

  tg.onNewMessage.add((m) => void store(m).catch((e) => console.error("[upd:new]", errText(e))));
  tg.onEditMessage.add((m) => {
    invalidate(m.chat.id, m.id);
    void store(m).catch((e) => console.error("[upd:edit]", errText(e)));
  });
  tg.onDeleteMessage.add((u) => {
    if (u.channelId == null || !chats.has(u.channelId)) return;
    deleteRows(u.channelId, u.messageIds);
    for (const id of u.messageIds) invalidate(u.channelId, id);
  });

  void syncAll();
  if (config.resyncMinutes > 0) setInterval(() => void syncAll(), config.resyncMinutes * 60_000).unref?.();
}

/** Forget progress and re-index a chat from scratch (e.g. after changing CATEGORY_MODE). */
export function reindex(chatId: number) {
  const chat = chats.get(chatId);
  if (!chat) throw new Error("unknown chat");
  return exclusive(chatId, async () => {
    q.resetSync.run({ chatId });
    await syncLocked(chat);
  });
}

/** Full rescan: refreshes every row and removes messages deleted while the server was offline. */
export function reconcile(chatId: number) {
  const chat = chats.get(chatId);
  if (!chat) throw new Error("unknown chat");
  return exclusive(chatId, async () => {
    const st = begin(chat, "reconcile", 0);
    const seen = new Set<number>();
    const pos = { id: 0 };
    const ok = await withRetry(chat, st, () =>
      walk(chat, pos, st, async (msgs, last) => {
        for (const m of msgs) seen.add(m.id);
        const { rows, drop } = await toRows(chat, msgs);
        saveBatch(chat.id, rows, drop, last);
        st.indexed += rows.length;
      }),
    );
    if (!ok) return;
    // only ids <= last scanned: messages posted after the scan finished are not "gone"
    const gone = q.msgIdsUpTo
      .all({ chatId, max: pos.id })
      .map((r) => r.msgId)
      .filter((id) => !seen.has(id));
    deleteRows(chatId, gone);
    propagateAlbumCaptions(chatId);
    console.log(`[indexer] ${chat.title}: reconcile done (scanned ${st.scanned}, removed ${gone.length})`);
    finish(st);
  });
}
