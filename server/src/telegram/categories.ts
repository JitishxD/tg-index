import { tg } from "./client";
import { ensureCategory } from "../db";
import { errText, withFlood } from "../lib/flood";

const topicNames = new Map<number, Map<number, string>>(); // chatId -> topicId -> title
const lastLoad = new Map<number, number>();
const RELOAD_MIN_MS = 60_000;
const memo = new Map<string, { id: number; name: string; parentId: number | null }>();

/** In-memory front for ensureCategory: avoids a DB lookup per indexed message. */
function cat(chatId: number, kind: string, key: string, name: string, parentId: number | null, rename = true): number {
  const k = `${chatId}|${kind}|${key}`;
  const hit = memo.get(k);
  if (hit && hit.parentId === parentId && (!rename || hit.name === name)) return hit.id;
  const id = ensureCategory(chatId, kind, key, name, parentId, rename);
  memo.set(k, { id, name: rename || !hit ? name : hit.name, parentId });
  return id;
}

export async function loadTopics(chatId: number) {
  lastLoad.set(chatId, Date.now());
  // keep names we already know (deleted topics, or a failed reload)
  const map = new Map<number, string>(topicNames.get(chatId) ?? [[1, "General"]]);
  try {
    await withFlood(
      async () => {
        for await (const t of tg.iterForumTopics(chatId)) map.set(t.id, t.title);
      },
      { tries: 5, label: "topics" },
    );
  } catch (e) {
    console.warn(`[topics] could not list topics for ${chatId}: ${errText(e)}`);
  }
  topicNames.set(chatId, map);
}

export async function topicCategory(chatId: number, topicId: number, parentId: number): Promise<number> {
  if (!topicNames.get(chatId)?.has(topicId) && Date.now() - (lastLoad.get(chatId) ?? 0) > RELOAD_MIN_MS) await loadTopics(chatId); // topic created since startup
  const name = topicNames.get(chatId)?.get(topicId) ?? `Topic ${topicId}`; // renamed automatically once known
  return cat(chatId, "topic", String(topicId), name, parentId);
}

/** scope = topic id when the hashtag lives inside a forum topic, so "#x" in two topics are separate nodes. */
export function hashtagCategory(chatId: number, tag: string, parentId: number, scope: string | null): number {
  const t = tag.toLowerCase();
  return cat(chatId, "hashtag", scope ? `${scope}/${t}` : t, `#${tag}`, parentId, false);
}

export function chatCategory(chatId: number, title: string): number {
  return cat(chatId, "chat", "root", title, null);
}
