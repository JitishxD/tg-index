import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verifySession } from "./auth";

export interface Media {
  id: number;
  chatId: number;
  msgId: number;
  title: string;
  caption: string;
  kind: string;
  mime: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  postedAt: number;
  fileName: string | null;
  tags: string[];
  categoryId: number | null;
  groupedId: string | null;
  extra: Record<string, any> | null;
  thumb: string | null;
  stream: string | null;
  playable: boolean;
}
export interface Crumb {
  id: number;
  name: string;
  slug: string;
}
export interface MediaDetail extends Media {
  chatTitle?: string;
  category: Crumb | null;
  path: Crumb[];
  album: Media[];
  link: string;
}
export interface Category {
  id: number;
  name: string;
  slug: string;
  kind: "chat" | "topic" | "hashtag";
  parentId: number | null;
  chatId: number;
  chatTitle: string;
  count: number; // inclusive of descendants
  files: number; // inclusive of descendants
}
export interface Chat {
  id: number;
  title: string;
  username: string | null;
  isForum: boolean;
  rootSlug: string | null;
  count: number;
  files: number;
  lastPost: number | null;
  cover: string | null;
}
export interface Page {
  items: Media[];
  hasMore: boolean;
  total: number;
  page: number;
}
export interface ChatStatus {
  title: string;
  phase: "backfill" | "catch-up" | "reconcile" | null;
  scanned: number;
  indexed: number;
  cursor: number;
  running: boolean;
  waitUntil?: number;
  error?: string;
  lastSync?: number;
}
export type Status = Record<string, ChatStatus>;

const API_URL = process.env.API_URL ?? "http://localhost:8080";
const TIMEOUT_MS = 20_000;

async function call<T>(path: string): Promise<T> {
  // Defense in depth: even if proxy.ts were bypassed, no data leaves without a valid session.
  if (!(await verifySession((await cookies()).get(COOKIE)?.value))) redirect("/login");
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${process.env.API_SECRET}` },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) throw Object.assign(new Error("not found"), { status: 404 });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export const api = {
  categories: () => call<Category[]>("/categories"),
  chats: () => call<Chat[]>("/chats"),
  media: (p: { category?: string; page?: number; sort?: string; all?: boolean }) => {
    const s = new URLSearchParams();
    if (p.category) s.set("category", p.category);
    if (p.page) s.set("page", String(p.page));
    if (p.sort) s.set("sort", p.sort);
    if (p.all) s.set("all", "1");
    return call<Page>(`/media?${s}`);
  },
  search: (q: string) => call<{ items: Media[] }>(`/search?q=${encodeURIComponent(q.slice(0, 500))}`),
  get: (id: number) => call<MediaDetail>(`/media/${id}`),
  status: () => call<Status>("/status"),
};
