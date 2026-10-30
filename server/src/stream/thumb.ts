import type { Context } from "hono";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { tg } from "../telegram/client";
import { q } from "../db";
import { config } from "../config";
import { getMessageFresh } from "../telegram/messageCache";
import { errText } from "../lib/flood";
import { verify } from "../lib/sign";

const dir = `${config.dataDir}/thumbs`;
mkdirSync(dir, { recursive: true });

const MAX_JOBS = 4;
const TIMEOUT_MS = 30_000;
const MISS_TTL_MS = 10 * 60_000;
const HEADERS = {
  "Content-Type": "image/jpeg",
  // private: these are behind a signed URL for logged-in users; shared caches must not keep them
  "Cache-Control": "private, max-age=604800, immutable",
  "X-Content-Type-Options": "nosniff",
};

const inflight = new Map<number, Promise<boolean>>();
const misses = new Map<number, number>(); // id -> retry-after timestamp

// tiny semaphore: a 48-card page must not fire 48 downloads at once
let running = 0;
const queue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_JOBS) running++;
  else await new Promise<void>((r) => queue.push(r)); // slot handed over by the finisher
  try {
    return await fn();
  } finally {
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}

async function fetchThumb(id: number, chatId: number, msgId: number, path: string): Promise<boolean> {
  const msg = await getMessageFresh(chatId, msgId);
  const thumbs = ((msg?.media as any)?.thumbnails as any[] | undefined)?.filter((x) => !x.isVideo && x.type !== "i" && x.type !== "j") ?? [];
  if (!thumbs.length) return false;
  const sorted = thumbs.sort((a, b) => b.width - a.width);
  const t = sorted.find((x) => x.width <= 800) ?? sorted[sorted.length - 1];
  const buf = await tg.downloadAsBuffer(t, { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await Bun.write(tmp, buf);
    renameSync(tmp, path); // atomic: never serve half-written files
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return true;
}

/** Downloads thumbnails lazily and caches them on disk. Photos get an ~800px preview. */
export async function thumbHandler(c: Context) {
  const id = Number(c.req.param("id"));
  if (!verify("thumb", id, c.req.query("exp"), c.req.query("sig")) || !Number.isSafeInteger(id)) return c.text("Forbidden", 403);
  const path = `${dir}/${id}.jpg`;
  const file = Bun.file(path);

  if (!(await file.exists())) {
    if ((misses.get(id) ?? 0) > Date.now()) return c.text("No thumb", 404);
    const v = q.getMedia.get({ id });
    if (!v?.hasThumb) return c.text("No thumb", 404);
    let p = inflight.get(id);
    if (!p) {
      p = limited(() => fetchThumb(id, v.chatId, v.msgId, path))
        .catch((e) => {
          console.warn(`[thumb ${id}] ${errText(e)}`);
          return false;
        })
        .then((ok) => {
          if (ok) misses.delete(id);
          else misses.set(id, Date.now() + MISS_TTL_MS);
          return ok;
        })
        .finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    if (!(await p)) return c.text("No thumb", 404);
  }
  return new Response(Bun.file(path), { headers: HEADERS });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, t] of misses) if (t < now) misses.delete(k);
}, MISS_TTL_MS).unref?.();
