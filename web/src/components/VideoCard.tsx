import Link from "next/link";
import type { Media } from "@/lib/api";
import { fmtDate, fmtDur, fmtSize } from "@/lib/format";

const ICON: Record<string, string> = { video: "▶", audio: "🎵", voice: "🎤", photo: "🖼", document: "📄" };

export function VideoCard({ m, row }: { m: Media; row?: boolean }) {
  return (
    <Link href={`/v/${m.id}`} className={`card ${row ? "row" : ""}`} title={m.title}>
      <div className="thumb" style={m.thumb ? { backgroundImage: `url(${m.thumb})` } : undefined}>
        {!m.thumb && (ICON[m.kind] ?? "📄")}
        {m.duration ? <span className="dur">{fmtDur(m.duration)}</span> : null}
      </div>
      <div className="meta">
        <h3>{m.title}</h3>
        <div className="mut">
          {fmtSize(m.size)} · {fmtDate(m.postedAt)}
          {m.height ? ` · ${m.height}p` : ""}
        </div>
      </div>
    </Link>
  );
}
