import { api } from "@/lib/api";

export default async function StatusPage() {
  const s = await api.status();
  const now = Date.now();
  return (
    <>
      <h2>Indexer status</h2>
      <div className="feed">
        {Object.entries(s).map(([id, v]) => (
          <article key={id} className="msg">
            <b>{v.title}</b> <span className="mut">({id})</span>
            <div>
              {v.running ? `⏳ ${v.phase ?? "running"}` : v.error ? <span className="error">⚠ failed</span> : "✅ idle"} · scanned {v.scanned} · indexed {v.indexed}
              {v.cursor ? ` · up to #${v.cursor}` : ""}
              {v.waitUntil && v.waitUntil > now ? ` · waiting ${Math.ceil((v.waitUntil - now) / 1000)}s` : ""}
              {v.lastSync ? <span className="mut"> · last sync {new Date(v.lastSync).toLocaleString()}</span> : null}
            </div>
            {v.error && <div className="error small">{v.error}</div>}
          </article>
        ))}
        {!Object.keys(s).length && <p className="mut">No channels configured or resolved yet.</p>}
      </div>
    </>
  );
}
