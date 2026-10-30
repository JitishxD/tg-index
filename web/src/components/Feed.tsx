import Link from "next/link";
import type { Media } from "@/lib/api";
import { VideoCard } from "./VideoCard";
import { fmtDate, fmtDur } from "@/lib/format";

/** Only http(s) links from message data are ever rendered as hrefs. */
const safeUrl = (u: unknown): string | null => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

/** Chat-like list of every message type; consecutive album items are grouped. */
export function Feed({ items }: { items: Media[] }) {
  const blocks: Media[][] = [];
  for (const m of items) {
    const last = blocks[blocks.length - 1];
    if (m.groupedId && last?.[0].groupedId === m.groupedId) last.push(m);
    else blocks.push([m]);
  }
  return (
    <div className="feed">
      {blocks.map((b) => {
        const caption = b.find((x) => x.caption)?.caption;
        return (
          <article key={b[0].id} className="msg">
            {b.length > 1 ? <Album items={b} /> : <Item m={b[0]} />}
            {caption && !isTextOnly(b[0]) && <div className="caption">{caption}</div>}
            <div className="mut small">{fmtDate(b[0].postedAt)}</div>
          </article>
        );
      })}
    </div>
  );
}

const isTextOnly = (m: Media) => m.kind === "text";

function Album({ items }: { items: Media[] }) {
  return (
    <div className="album">
      {items.map((m) =>
        m.kind === "photo" || m.thumb ? (
          <Link key={m.id} href={`/v/${m.id}`} className="album-cell" style={{ backgroundImage: m.thumb ? `url(${m.thumb})` : undefined }}>
            {m.kind === "video" && <span className="dur">▶ {fmtDur(m.duration)}</span>}
          </Link>
        ) : (
          <VideoCard key={m.id} m={m} />
        ),
      )}
    </div>
  );
}

function Item({ m }: { m: Media }) {
  const x = m.extra ?? {};
  switch (m.kind) {
    case "photo":
      return (
        <Link href={`/v/${m.id}`}>
          <img className="photo" src={m.thumb ?? m.stream ?? ""} alt="" loading="lazy" />
        </Link>
      );
    case "sticker":
      return m.thumb ? <img className="sticker" src={m.thumb} alt={x.emoji ?? ""} loading="lazy" /> : <span className="big">{x.emoji ?? "🖼"}</span>;
    case "voice":
    case "round":
    case "gif":
      return m.kind === "voice" ? (
        <audio controls preload="none" src={m.stream ?? undefined} />
      ) : (
        <video
          className="photo"
          controls={m.kind === "round"}
          autoPlay={m.kind === "gif"}
          loop
          muted={m.kind === "gif"}
          playsInline
          preload="none"
          poster={m.thumb ?? undefined}
          src={m.stream ?? undefined}
        />
      );
    case "text": {
      const url = safeUrl(x.url);
      return (
        <>
          <div className="caption">{m.caption}</div>
          {url && (
            <a className="preview" href={url} target="_blank" rel="noreferrer noopener">
              <b>{x.siteName ?? url}</b>
              {x.title && <div>{x.title}</div>}
              {x.description && <div className="mut small">{x.description}</div>}
            </a>
          )}
        </>
      );
    }
    case "poll":
      return (
        <div className="poll">
          <b>📊 {x.question}</b> {x.quiz ? <span className="mut">(quiz)</span> : null}
          <ul>
            {(x.answers ?? []).map((a: any, i: number) => (
              <li key={i}>
                {a.text} <span className="mut">{x.voters ? `${Math.round(((a.voters ?? 0) / x.voters) * 100)}%` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "location": {
      const lat = Number(x.lat);
      const lng = Number(x.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return <div className="mut">📍 Location</div>;
      return (
        <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`} target="_blank" rel="noreferrer noopener">
          📍 {x.title ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`} {x.address && <span className="mut">{x.address}</span>}
        </a>
      );
    }
    case "contact":
      return (
        <div>
          👤 {x.name} <span className="mut">{x.phone}</span>
        </div>
      );
    case "dice":
      return (
        <span className="big">
          {x.emoji} {x.value}
        </span>
      );
    case "video":
    case "audio":
    case "document":
      return <VideoCard m={m} row />;
    default:
      return <div className="mut">Unsupported message ({x.type ?? m.kind})</div>;
  }
}
