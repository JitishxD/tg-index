import { api } from "@/lib/api";
import { VideoCard } from "@/components/VideoCard";
import { Feed } from "@/components/Feed";

const FILES = new Set(["video", "audio", "document"]);

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  const { items } = q ? await api.search(q) : { items: [] };
  const files = items.filter((m) => FILES.has(m.kind));
  const other = items.filter((m) => !FILES.has(m.kind));
  return (
    <>
      <h2>
        Results for “{q}” <span className="mut">({items.length})</span>
      </h2>
      <div className="grid">
        {files.map((m) => (
          <VideoCard key={m.id} m={m} />
        ))}
      </div>
      {other.length > 0 && (
        <>
          <h2>
            Messages <span className="mut">({other.length})</span>
          </h2>
          <Feed items={other} />
        </>
      )}
    </>
  );
}
