/** Listing sort, shared by proxy.ts (cookie), server pages and Listing. No server-only imports here. */
export const SORT_COOKIE = "tgi_sort";

export const SORTS = [
  { v: "new", label: "Newest" },
  { v: "old", label: "Oldest" },
  { v: "name", label: "Name" },
] as const;

export type Sort = (typeof SORTS)[number]["v"];

export const isSort = (s: unknown): s is Sort => s === "new" || s === "old" || s === "name";

/** First valid candidate wins (e.g. URL param, then cookie), default "new". */
export const pickSort = (...candidates: unknown[]): Sort => (candidates.find(isSort) as Sort | undefined) ?? "new";
