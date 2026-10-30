function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Secrets must be long and must not be the example placeholder. */
function secret(name: string): string {
  const v = req(name);
  if (v.length < 16 || /^change-me/i.test(v)) throw new Error(`Env ${name} is weak or still the example value. Generate one with: openssl rand -hex 32`);
  return v;
}

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return v;
}

const MODES = ["auto", "topic", "hashtag", "chat"] as const;
const mode = (process.env.CATEGORY_MODE ?? "auto").trim() as (typeof MODES)[number];
if (!MODES.includes(mode)) throw new Error(`Env CATEGORY_MODE must be one of ${MODES.join(", ")}`);

export const config = {
  apiId: Number(req("API_ID")),
  apiHash: req("API_HASH"),
  channels: req("CHANNELS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^-?\d+$/.test(s) ? Number(s) : s)),
  // auto = channel > topic > hashtag tree; topic / hashtag = one level; chat = channel only
  categoryMode: mode,
  apiSecret: secret("API_SECRET"),
  streamSecret: secret("STREAM_SECRET"),
  port: num("PORT", 8080),
  dataDir: process.env.DATA_DIR ?? "./data",
  streamTtlSec: 6 * 3600,

  // Max concurrent Telegram-backed streams.
  maxStreams: Math.max(1, num("MAX_STREAMS", 8)),
  // How far a stream may download ahead of the client (bytes).
  readAheadBytes: Math.max(1, num("STREAM_READ_AHEAD_MB", 8)) * 1024 * 1024,
  // Pause between history pages (100 msgs) while indexing.
  backfillDelayMs: Math.max(0, num("BACKFILL_DELAY_MS", 500)),
  // Periodic catch-up for all chats, 0 = off (live updates still work).
  resyncMinutes: Math.max(0, num("RESYNC_MINUTES", 30)),
  // mtcute sleeps through FLOOD_WAITs up to this long by itself; longer ones surface to our handlers.
  floodMaxWaitSec: 60,
};

if (!Number.isInteger(config.apiId) || config.apiId <= 0) throw new Error("Env API_ID must be a positive integer");
if (!config.channels.length) throw new Error("Env CHANNELS is empty");
