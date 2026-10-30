import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

type Kind = "stream" | "thumb";
const mac = (data: string) => createHmac("sha256", config.streamSecret).update(data).digest("base64url");

/**
 * Signed relative URL. `bucket` rounds the expiry up to a multiple of N seconds so the URL
 * stays identical for a while, which lets browsers cache thumbnails/streams.
 */
export function signPath(kind: Kind, id: number, ttl = config.streamTtlSec, bucket = 0) {
  let exp = Math.floor(Date.now() / 1000) + ttl;
  if (bucket) exp = Math.ceil(exp / bucket) * bucket;
  return `/${kind}/${id}?exp=${exp}&sig=${mac(`${kind}:${id}:${exp}`)}`;
}

export function verify(kind: Kind, id: number, exp?: string, sig?: string): boolean {
  if (!exp || !sig || !Number.isFinite(id) || Number(exp) < Date.now() / 1000) return false;
  const a = Buffer.from(mac(`${kind}:${id}:${exp}`));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
