import Link from "next/link";
import type { Page } from "@/lib/api";
import { SORTS, type Sort } from "@/lib/sort";
import { VideoCard } from "./VideoCard";
import { Feed } from "./Feed";

/** Shared toolbar + grid/feed + pager for /all and /c/[slug]. The sort is remembered via a cookie set in proxy.ts. */
export function Listing({ base, data, page, all, sort }: { base: string; data: Page; page: number; all: boolean; sort: Sort }) {
  const href = (o: { page?: number; sort: Sort; all?: boolean }) => {
    const s = new URLSearchParams();
    if ((o.page ?? 1) > 1) s.set("page", String(o.page));
    s.set("sort", o.sort);
    if (o.all) s.set("all", "1");
    return `${base}?${s}`;
  };
  return (
    <>
      <div className="toolbar">
        <span className="mut">{data.total} items</span>
        <div className="seg">
          <Link className={!all ? "on" : ""} href={href({ sort })}>
            Files
          </Link>
          <Link className={all ? "on" : ""} href={href({ sort, all: true })}>
            All messages
          </Link>
        </div>
        <div className="seg">
          {SORTS.map((s) => (
            <Link key={s.v} className={sort === s.v ? "on" : ""} href={href({ all, sort: s.v })} title={s.v === "name" ? "Natural sort by file name (Ep 2 before Ep 10)" : undefined}>
              {s.label}
            </Link>
          ))}
        </div>
      </div>
      {data.items.length === 0 ? (
        <p className="empty">Nothing here yet.</p>
      ) : all ? (
        <Feed items={data.items} />
      ) : (
        <div className="grid">
          {data.items.map((m) => (
            <VideoCard key={m.id} m={m} />
          ))}
        </div>
      )}
      <div className="pager">
        {page > 1 && <Link href={href({ page: page - 1, sort, all })}>← Prev</Link>}
        {data.hasMore && <Link href={href({ page: page + 1, sort, all })}>Next →</Link>}
      </div>
    </>
  );
}
