import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { buildTree, pathOf } from "@/lib/tree";
import { SORT_COOKIE, pickSort } from "@/lib/sort";
import { CategoryTree } from "@/components/CategoryTree";
import { Listing } from "@/components/Listing";

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string; sort?: string; all?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const all = sp.all === "1";
  const sort = pickSort(sp.sort, (await cookies()).get(SORT_COOKIE)?.value);
  const [cats, data] = await Promise.all([api.categories(), api.media({ category: slug, page, sort, all })]);
  const cat = cats.find((c) => c.slug === slug);
  if (!cat) notFound();
  const path = pathOf(cats, cat.id);
  const tree = buildTree(cats.filter((c) => c.chatId === cat.chatId));
  return (
    <div className="with-side">
      <aside className="side">
        <Link href="/" className="back">
          ← All channels
        </Link>
        <CategoryTree nodes={tree} active={slug} all={all} />
      </aside>
      <section>
        <nav className="crumbs">
          <Link href="/">Home</Link>
          {path.map((p) => (
            <span key={p.id}>
              {" / "}
              {p.slug === slug ? <b>{p.name}</b> : <Link href={`/c/${p.slug}${all ? "?all=1" : ""}`}>{p.name}</Link>}
            </span>
          ))}
        </nav>
        <Listing base={`/c/${encodeURIComponent(slug)}`} data={data} page={page} all={all} sort={sort} />
      </section>
    </div>
  );
}
