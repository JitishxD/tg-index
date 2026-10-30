import type { Context } from "hono";
import { tg } from "../telegram/client";
import { q, DOWNLOADABLE, type MediaRow } from "../db";
import { config } from "../config";
import { getMessageFresh } from "../telegram/messageCache";
import { errText, isFileRefError, sleep } from "../lib/flood";
import { parseRange } from "./range";
import { verify } from "../lib/sign";

const PART = 512 * 1024; // offsets must be % 4096; 512 KB divides 1 MB as Telegram requires
const CHUNK_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 4;
let active = 0;

/**
 * MIME types that may be rendered inline on our origin. Everything else (text/html, image/svg+xml,
 * application/xhtml+xml, application/pdf, …) is attacker-controlled and could run script on this
 * domain, so it is served as an opaque download.
 */
const INLINE_SAFE = /^(?:video|audio)\/[a-z0-9.+-]+$|^image\/(?:jpeg|png|gif|webp|avif|bmp)$/i;

class Gone extends Error {}

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback. */
function contentDisposition(type: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * One Telegram download from `offset` with bounded read-ahead.
 * Without `throttle`, mtcute's workers keep fetching the rest of the file into memory
 * even when the client is paused.
 */
function openDownload(media: any, offset: number, size: number) {
  const ac = new AbortController();
  const waiters = new Set<() => void>(); // insertion order = chunk order
  const wake = () => {
    const ws = [...waiters];
    waiters.clear();
    for (const w of ws) w();
  };
  let requested = 0;
  let consumed = 0;

  const it = tg.downloadAsIterable(media, {
    offset,
    partSize: PART / 1024,
    fileSize: size,
    abortSignal: ac.signal,
    throttle: async (n: number) => {
      while (!ac.signal.aborted && requested - consumed >= config.readAheadBytes) await new Promise<void>((r) => waiters.add(r));
      requested += n;
    },
  });

  return {
    /** file offset of the next chunk */
    pos: offset,
    async next(): Promise<Uint8Array | null> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const r = await Promise.race([
          it.next(),
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(new Error(`no data from Telegram for ${CHUNK_TIMEOUT_MS / 1000}s`)), CHUNK_TIMEOUT_MS);
          }),
        ]);
        if (r.done) return null;
        consumed += r.value.length;
        wake();
        return r.value;
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      if (ac.signal.aborted) return;
      ac.abort();
      wake();
      void it.return?.(undefined)?.catch(() => {});
    },
  };
}

/** Pull-based body: Telegram is only read when the client actually wants more bytes. */
function bodyFor(v: MediaRow, start: number, end: number, signal: AbortSignal): ReadableStream<Uint8Array> {
  let pos = start;
  let dl: ReturnType<typeof openDownload> | null = null;
  let attempts = 0;
  let done = false; // after this, never touch the controller again

  active++;
  const finish = () => {
    if (done) return;
    done = true;
    active--;
    dl?.close();
    dl = null;
    signal.removeEventListener("abort", finish);
  };
  signal.addEventListener("abort", finish, { once: true });
  if (signal.aborted) finish(); // client already gone: don't leak the slot

  return new ReadableStream<Uint8Array>(
    {
      async pull(ctrl) {
        while (!done) {
          try {
            if (!dl) {
              const msg = await getMessageFresh(v.chatId, v.msgId, attempts > 0);
              if (done) return;
              const media = msg?.media as any;
              if (!media || !("fileSize" in media)) throw new Gone("message or media is gone");
              dl = openDownload(media, pos - (pos % PART), v.size);
            }
            const chunk = await dl.next();
            if (done) return;
            if (!chunk) throw new Error(`short read at byte ${dl.pos}`);
            const from = Math.max(0, pos - dl.pos);
            const to = Math.min(chunk.length, end - dl.pos + 1);
            dl.pos += chunk.length;
            if (to > from) {
              ctrl.enqueue(chunk.subarray(from, to));
              pos += to - from;
              attempts = 0;
              if (pos > end) {
                finish();
                ctrl.close();
              }
              return;
            }
          } catch (e) {
            dl?.close();
            dl = null;
            if (done) return;
            if (e instanceof Gone || ++attempts >= MAX_ATTEMPTS) {
              console.error(`[stream ${v.id}] ${errText(e)}`);
              finish();
              ctrl.error(e);
              return;
            }
            console.warn(`[stream ${v.id}] retry ${attempts} at byte ${pos}: ${errText(e)}`);
            if (!isFileRefError(e)) await sleep(1000 * attempts);
          }
        }
      },
      cancel: () => finish(),
    },
    { highWaterMark: 2 },
  );
}

export async function streamHandler(c: Context) {
  const id = Number(c.req.param("id"));
  if (!verify("stream", id, c.req.query("exp"), c.req.query("sig"))) return c.text("Forbidden", 403);
  const v = q.getMedia.get({ id });
  if (!v || !DOWNLOADABLE.has(v.kind)) return c.text("Not found", 404);

  const mime = v.kind === "photo" ? "image/jpeg" : v.mime;
  const safe = INLINE_SAFE.test(mime);
  const ext = v.kind === "photo" ? "jpg" : mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
  const name = v.fileName || `${v.title}.${ext}`;
  const inline = safe && !c.req.query("dl");

  const base: Record<string, string> = {
    "Content-Type": safe ? mime : "application/octet-stream",
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", name),
    "X-Content-Type-Options": "nosniff",
  };
  if (!safe) base["Content-Security-Policy"] = "sandbox; default-src 'none'";

  // Photos (and anything with unknown size) are small: buffer them, no ranges.
  if (v.kind === "photo" || !v.size) {
    const headers = { ...base, "Cache-Control": "private, max-age=86400" };
    if (c.req.method === "HEAD") return new Response(null, { headers: v.size ? { ...headers, "Content-Length": String(v.size) } : headers });
    try {
      const msg = await getMessageFresh(v.chatId, v.msgId);
      if (!msg?.media) return c.text("Gone", 410);
      const buf = await tg.downloadAsBuffer(msg.media as any, { abortSignal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(60_000)]) });
      const body = new ArrayBuffer(buf.byteLength);
      new Uint8Array(body).set(buf);
      return new Response(body, { headers: { ...headers, "Content-Length": String(buf.byteLength) } });
    } catch (e) {
      if (!c.req.raw.signal.aborted) console.warn(`[stream ${v.id}] ${errText(e)}`);
      return c.text("Telegram did not deliver the file, try again", 502);
    }
  }

  const headers: Record<string, string> = { ...base, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };

  const range = parseRange(c.req.header("range"), v.size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${v.size}` } });
  if (c.req.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(v.size) } });
  if (active >= config.maxStreams) return c.text("Too many streams, try again shortly", 503, { "Retry-After": "5" });

  const { start, end } = range ?? { start: 0, end: v.size - 1 };
  return new Response(bodyFor(v, start, end, c.req.raw.signal), {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${v.size}` } : {}),
    },
  });
}
