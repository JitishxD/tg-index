import type { Message } from "@mtcute/bun";
import { tg } from "./client";
import { withFlood } from "../lib/flood";

const TTL = 10 * 60_000;
const MAX_ENTRIES = 5_000;
const BATCH_WINDOW_MS = 8;
const BATCH_MAX = 100; // channels.getMessages limit

type Waiter = { resolve: (m: Message | null) => void; reject: (e: unknown) => void };

const cache = new Map<string, { msg: Message; at: number }>();
const inflight = new Map<string, Promise<Message | null>>();
const queues = new Map<number, Map<number, Waiter[]>>();

function remember(key: string, msg: Message, at: number) {
  cache.delete(key);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { msg, at });
}

async function flush(chatId: number, q: Map<number, Waiter[]>) {
  if (queues.get(chatId) !== q) return; // already flushed (size limit hit)
  queues.delete(chatId);
  const ids = [...q.keys()];
  try {
    const msgs = await withFlood(() => tg.getMessages(chatId, ids), { tries: 2, maxWait: 30, label: "getMessages" });
    const now = Date.now();
    ids.forEach((id, i) => {
      const m = msgs[i] ?? null;
      const key = `${chatId}:${id}`;
      if (m?.media) remember(key, m, now);
      else cache.delete(key);
      for (const w of q.get(id)!) w.resolve(m);
    });
  } catch (e) {
    for (const ws of q.values()) for (const w of ws) w.reject(e);
  }
}

function enqueue(chatId: number, msgId: number, w: Waiter) {
  let q = queues.get(chatId);
  if (!q) {
    const fresh = new Map<number, Waiter[]>();
    queues.set(chatId, fresh);
    setTimeout(() => void flush(chatId, fresh), BATCH_WINDOW_MS);
    q = fresh;
  }
  const list = q.get(msgId);
  if (list) list.push(w);
  else q.set(msgId, [w]);
  if (q.size >= BATCH_MAX) void flush(chatId, q);
}

/**
 * Fetches a message (fresh file reference), cached for 10 minutes.
 * Concurrent calls are deduplicated and batched per chat into one getMessages request.
 */
export function getMessageFresh(chatId: number, msgId: number, force = false): Promise<Message | null> {
  const key = `${chatId}:${msgId}`;
  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.msg);
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = new Promise<Message | null>((resolve, reject) => enqueue(chatId, msgId, { resolve, reject })).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function invalidate(chatId: number, msgId: number) {
  cache.delete(`${chatId}:${msgId}`);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > TTL) cache.delete(k);
}, 60_000).unref?.();
