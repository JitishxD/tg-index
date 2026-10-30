/**
 * HMAC-signed, expiring session tokens: "v1.<expUnix>.<base64url sig>".
 * Web Crypto only, so it runs in proxy.ts, route handlers and server actions alike.
 * SITE_PASSWORD is part of the HMAC key, so changing the password invalidates every session.
 */
export const COOKIE = "tgi_session";
export const SESSION_TTL = 30 * 86400; // seconds

const enc = new TextEncoder();
let keyP: Promise<CryptoKey> | undefined;

function secrets() {
  const password = process.env.SITE_PASSWORD ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (password.length < 8 || /^change-me/i.test(password) || password === "letmein") throw new Error("SITE_PASSWORD must be at least 8 characters and not the example value");
  if (secret.length < 16 || /^change-me/i.test(secret)) throw new Error("AUTH_SECRET must be random and at least 16 characters (openssl rand -hex 32)");
  return { password, secret };
}

function key(): Promise<CryptoKey> {
  return (keyP ??= (async () => {
    const { password, secret } = secrets();
    return crypto.subtle.importKey("raw", enc.encode(`${secret}\u0000${password}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  })());
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function mac(data: string): Promise<string> {
  return b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(data)));
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSession(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const body = `v1.${exp}`;
  return `${body}.${await mac(`session:${body}`)}`;
}

export async function verifySession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const m = /^v1\.(\d{1,12})\.([\w-]{43})$/.exec(token);
  if (!m || Number(m[1]) * 1000 < Date.now()) return false;
  return safeEqual(await mac(`session:v1.${m[1]}`), m[2]);
}

/** Compares HMACs of both values: constant time and no length leak. */
export async function checkPassword(input: string): Promise<boolean> {
  const { password } = secrets();
  const [a, b] = await Promise.all([mac(`pw:${input}`), mac(`pw:${password}`)]);
  return safeEqual(a, b);
}
