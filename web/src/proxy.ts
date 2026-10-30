import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifySession } from "@/lib/auth";
import { SORT_COOKIE, isSort } from "@/lib/sort";

export async function proxy(req: NextRequest) {
  if (!(await verifySession(req.cookies.get(COOKIE)?.value))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  // Remember the listing sort server-side: no client redirect, no flash, no double render.
  const sort = req.nextUrl.searchParams.get("sort");
  if (isSort(sort) && req.cookies.get(SORT_COOKIE)?.value !== sort) {
    res.cookies.set(SORT_COOKIE, sort, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  }
  return res;
}

// /login (page + its server action) and static assets are public. Everything else needs a session;
// lib/api.ts re-checks the session on every data fetch anyway.
export const config = { matcher: ["/((?!login|_next/|favicon.ico).*)"] };
