import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { Player } from "@/components/Player";
import { Feed } from "@/components/Feed";
import { fmtDate, fmtSize } from "@/lib/format";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await api.get(Number(id)).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
  if (!m) notFound();

  const body = (() => {
    if (!m.stream) return <Feed items={[m]} />;
    if (m.kind === "video") return <Player src={m.stream} mime={m.mime} playable={m.playable} poster={m.thumb} />;
    if (m.kind === "round" || m.kind === "gif") return <Player src={m.stream} mime={m.mime} playable poster={m.thumb} />;
    if (m.kind === "audio" || m.kind === "voice") return <Player src={m.stream} mime={m.mime} playable audio />;
    if (m.kind === "photo" || m.kind === "sticker")
      return (
        <>
          <img className="full" src={m.stream} alt={m.title} />
          <div className="actions">
            <a href={`${m.stream}&dl=1`}>Download</a>
          </div>
        </>
      );
    return (
      <div className="actions">
        <a href={`${m.stream}&dl=1`}>Download {m.fileName}</a>
      </div>
    );
  })();

  return (
    <>
      <nav className="crumbs">
        <Link href="/">Home</Link>
        {m.path.map((p) => (
          <span key={p.id}>
            {" / "}
            <Link href={`/c/${p.slug}`}>{p.name}</Link>
          </span>
        ))}
      </nav>
      {body}
      <h1>{m.title}</h1>
      <p className="mut">
        {m.chatTitle} · {m.size ? `${fmtSize(m.size)} · ` : ""}
        {fmtDate(m.postedAt)}
        {m.width ? ` · ${m.width}×${m.height}` : ""} ·{" "}
        <a href={m.link} target="_blank" rel="noreferrer">
          Open in Telegram
        </a>
      </p>
      {m.caption && m.kind !== "text" && <div className="caption">{m.caption}</div>}
      {m.album.length > 1 && (
        <>
          <h2>Album ({m.album.length})</h2>
          <Feed items={m.album} />
        </>
      )}
    </>
  );
}
