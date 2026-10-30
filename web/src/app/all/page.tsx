import { cookies } from "next/headers";
import { api } from "@/lib/api";
import { buildTree } from "@/lib/tree";
import { SORT_COOKIE, pickSort } from "@/lib/sort";
import { CategoryTree } from "@/components/CategoryTree";
import { Listing } from "@/components/Listing";

export default async function AllPage({ searchParams }: { searchParams: Promise<{ page?: string; sort?: string; all?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const all = sp.all === "1";
  const sort = pickSort(sp.sort, (await cookies()).get(SORT_COOKIE)?.value);
  const [cats, data] = await Promise.all([api.categories(), api.media({ page, sort, all })]);
  return (
    <div className="with-side">
      <aside className="side">
        <CategoryTree nodes={buildTree(cats)} all={all} />
      </aside>
      <section>
        <h2>Everything</h2>
        <Listing base="/all" data={data} page={page} all={all} sort={sort} />
      </section>
    </div>
  );
}
