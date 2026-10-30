import Link from "next/link";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";

export default async function Home() {
  const chats = await api.chats();
  const files = chats.reduce((n, c) => n + c.files, 0);
  const count = chats.reduce((n, c) => n + c.count, 0);
  return (
    <>
      <h2>What do you want to browse?</h2>
      <div className="picker">
        <Link href="/all" className="pick">
          <div className="pick-cover everything">∞</div>
          <div className="meta">
            <h3>Everything</h3>
            <div className="mut">
              {files} files · {count} messages · {chats.length} channels
            </div>
          </div>
        </Link>
        {chats.map((ch) => (
          <Link key={ch.id} href={ch.rootSlug ? `/c/${ch.rootSlug}` : "/all"} className="pick">
            <div className="pick-cover" style={ch.cover ? { backgroundImage: `url(${ch.cover})` } : undefined}>
              {!ch.cover && ch.title.slice(0, 1).toUpperCase()}
              {ch.isForum && <span className="badge">Forum</span>}
            </div>
            <div className="meta">
              <h3>{ch.title}</h3>
              <div className="mut">
                {ch.files} files · {ch.count} messages
                {ch.lastPost ? ` · ${fmtDate(ch.lastPost)}` : ""}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
