"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, SESSION_TTL, checkPassword, createSession } from "@/lib/auth";

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;
const MAX_TRACKED = 10_000;
const fails = new Map<string, { n: number; reset: number }>();

function retryAfter(ip: string): number {
  const f = fails.get(ip);
  if (!f) return 0;
  if (f.reset < Date.now()) {
    fails.delete(ip);
    return 0;
  }
  return f.n >= MAX_FAILS ? f.reset - Date.now() : 0;
}

function recordFail(ip: string) {
  const now = Date.now();
  if (fails.size >= MAX_TRACKED) for (const [k, v] of fails) if (v.reset < now) fails.delete(k);
  if (fails.size >= MAX_TRACKED) fails.clear(); // bounded memory under a distributed attack
  const f = fails.get(ip);
  if (!f || f.reset < now) fails.set(ip, { n: 1, reset: now + WINDOW_MS });
  else f.n++;
}

/** Only same-origin paths; rejects "//host", "/\host", control chars and loops back to /login. */
function safeNext(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f]/.test(raw)) return "/";
  try {
    const base = "http://local.invalid";
    const u = new URL(raw, base);
    if (u.origin !== base || u.pathname.startsWith("/login")) return "/";
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}

export async function login(_: unknown, form: FormData) {
  const h = await headers();
  // Caddy replaces any client-supplied X-Forwarded-For with the real peer address.
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";

  const wait = retryAfter(ip);
  if (wait > 0) return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.` };

  const ok = await checkPassword(String(form.get("password") ?? "").slice(0, 1024));
  if (!ok) {
    recordFail(ip);
    await new Promise((r) => setTimeout(r, 800)); // slow down brute force
    return { error: "Wrong password" };
  }
  fails.delete(ip);

  const proto = h.get("x-forwarded-proto");
  (await cookies()).set(COOKIE, await createSession(), {
    httpOnly: true,
    secure: proto ? proto === "https" : process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  redirect(safeNext(String(form.get("next") ?? "/")));
}
