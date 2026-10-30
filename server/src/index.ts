import { Hono } from "hono";
import { tg } from "./telegram/client";
import { config } from "./config";
import { sqlite } from "./db";
import { startIndexer } from "./indexer";
import { api } from "./api/routes";
import { streamHandler } from "./stream/handler";
import { thumbHandler } from "./stream/thumb";

process.on("unhandledRejection", (e) => console.error("[unhandled]", e));

const me = await tg.start(); // uses the saved session; run `bun run login` first
console.log(`[tg] connected as ${me.displayName}${me.isBot ? " (bot)" : ""}`);
await startIndexer(); // resolves chats + registers live handlers; backfill runs in the background

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/api", api);
app.on(["GET", "HEAD"], "/stream/:id", streamHandler);
app.get("/thumb/:id", thumbHandler);
app.onError((e, c) => {
  console.error(e);
  return c.json({ error: "internal" }, 500);
});

Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 255 });
console.log(`[http] listening on :${config.port}`);

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    await tg.destroy().catch(() => {});
    try {
      sqlite.close();
    } catch {}
    process.exit(0);
  });
