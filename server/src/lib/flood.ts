export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type TgError = { code?: number; text?: string; message?: string; seconds?: number } | null | undefined;

const errStr = (e: unknown) => {
  const x = e as TgError;
  return `${x?.text ?? ""} ${x?.message ?? ""}`;
};

/** Human-readable error text (mtcute's `text` is a template like "FLOOD_WAIT_%d"; `message` has the value). */
export const errText = (e: unknown) => (e as TgError)?.message ?? String(e);

/**
 * Seconds to wait if `e` is a flood error, else null.
 * mtcute RpcError: text = "FLOOD_WAIT_%d", seconds = 11, message = "... FLOOD_WAIT_11".
 */
export function floodSeconds(e: unknown): number | null {
  const x = e as TgError;
  const s = errStr(e);
  const isFlood = x?.code === 420 || /FLOOD_WAIT|FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT/.test(s);
  if (!isFlood) return null;
  if (typeof x?.seconds === "number" && Number.isFinite(x.seconds)) return x.seconds;
  const m = /_WAIT_(\d+)/.exec(s);
  return m ? Number(m[1]) : 30;
}

/** Errors that retrying cannot fix. */
const FATAL = /CHANNEL_PRIVATE|CHANNEL_INVALID|CHAT_FORBIDDEN|CHAT_ADMIN_REQUIRED|USER_BANNED_IN_CHANNEL|PEER_ID_INVALID|AUTH_KEY_UNREGISTERED|AUTH_KEY_DUPLICATED|SESSION_REVOKED|USER_DEACTIVATED/;
export const isFatal = (e: unknown) => FATAL.test(errStr(e));

export function isFileRefError(e: unknown): boolean {
  const t = errStr(e);
  return t.includes("FILE_REFERENCE") || t.includes("File ref expired") || t.includes("FILEREF_UPGRADE_NEEDED");
}

/** Retries `fn` on FLOOD_WAIT by sleeping. Waits longer than `maxWait` seconds are rethrown (use for user-facing calls). */
export async function withFlood<T>(fn: () => Promise<T>, opts: { tries?: number; maxWait?: number; label?: string; onWait?: (s: number) => void } = {}): Promise<T> {
  const { tries = 5, maxWait = Infinity, label = "telegram", onWait } = opts;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const s = floodSeconds(e);
      if (s == null || i >= tries || s > maxWait) throw e;
      onWait?.(s + 1);
      console.warn(`[flood] ${label}: waiting ${s + 1}s`);
      await sleep((s + 1) * 1000);
    }
  }
}
