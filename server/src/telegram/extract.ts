import type { Message } from "@mtcute/bun";
import type { MediaInput } from "../db";
import { config } from "../config";
import { naturalKey } from "../lib/natural";
import { chatCategory, hashtagCategory, topicCategory } from "./categories";

const HASHTAG = /#([\p{L}\p{N}_]+)/gu;
/** For these kinds the file name is the title (captions are often generic like "Brought to you by …"). */
const NAMED_KINDS = new Set(["video", "audio", "document"]);

function topicIdOf(msg: Message): number {
  const r = msg.replyToMessage;
  if (!r || !r.isForumTopic) return 1;
  return r.threadId ?? r.id ?? 1;
}

const joinName = (...parts: unknown[]) =>
  parts
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => (p as string).trim())
    .join(" ");

/**
 * Converts any non-service message into a row.
 * kinds: video | audio | document | voice | photo | sticker | round | gif |
 *        text | poll | location | contact | dice | other
 */
export async function extractMedia(msg: Message, chat: { id: number; title: string; isForum: boolean }): Promise<MediaInput | null> {
  if (msg.isService) return null;
  const m = msg.media as any;
  const caption = msg.text ?? "";
  if (!m && !caption.trim()) return null;

  let kind = "other";
  let fileName: string | null = null;
  let size = 0;
  let mime = "text/plain";
  let duration: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let hasThumb = 0;
  let extra: Record<string, unknown> | null = null;

  const doc = () => {
    fileName = m.fileName ?? null;
    size = m.fileSize ?? 0;
    mime = m.mimeType || "application/octet-stream";
    hasThumb = m.thumbnails?.length ? 1 : 0;
  };

  switch (m?.type) {
    case undefined:
      kind = "text";
      break;
    case "video":
      doc();
      kind = m.isRound ? "round" : m.isAnimation || m.isLegacyGif ? "gif" : "video";
      duration = Math.round(m.duration ?? 0);
      width = m.width ?? null;
      height = m.height ?? null;
      break;
    case "document":
      doc();
      kind = mime.startsWith("video/") ? "video" : "document";
      break;
    case "audio":
      doc();
      kind = "audio";
      duration = Math.round(m.duration ?? 0);
      extra = { performer: m.performer, track: m.title };
      break;
    case "voice":
      doc();
      kind = "voice";
      duration = Math.round(m.duration ?? 0);
      if (mime === "application/octet-stream") mime = "audio/ogg";
      break;
    case "photo":
      kind = "photo";
      size = m.fileSize ?? 0;
      mime = "image/jpeg";
      width = m.width ?? null;
      height = m.height ?? null;
      hasThumb = 1;
      break;
    case "sticker":
      doc();
      kind = "sticker";
      width = m.width ?? null;
      height = m.height ?? null;
      extra = { emoji: m.emoji };
      break;
    case "webpage": {
      kind = "text";
      const p = m.preview;
      extra = { url: p?.url, siteName: p?.siteName, title: p?.title, description: p?.description };
      break;
    }
    case "poll":
      kind = "poll";
      extra = {
        question: m.question,
        quiz: m.isQuiz,
        closed: m.isClosed,
        voters: m.voters,
        answers: (m.answers ?? []).map((a: any) => ({ text: a.text, voters: a.voters })),
      };
      break;
    case "location":
    case "live_location":
      kind = "location";
      extra = { lat: m.latitude, lng: m.longitude, live: m.type === "live_location" };
      break;
    case "venue":
      kind = "location";
      extra = { lat: m.location?.latitude, lng: m.location?.longitude, title: m.title, address: m.address };
      break;
    case "contact":
      kind = "contact";
      extra = { name: joinName(m.firstName, m.lastName), phone: m.phoneNumber };
      break;
    case "dice":
      kind = "dice";
      extra = { emoji: m.emoji, value: m.value };
      break;
    default:
      kind = "other";
      extra = { type: m.type };
  }

  // (casts: these are assigned inside the doc() closure, which TS flow analysis doesn't track)
  const name = fileName as string | null;
  const ex = extra as Record<string, unknown> | null;

  const tags = [...caption.matchAll(HASHTAG)].map((x) => x[1]);
  const firstLine = caption
    .replace(HASHTAG, "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  const audioName = kind === "audio" && ex?.track ? [ex.performer, ex.track].filter(Boolean).map(String).join(" - ") : "";
  const fallback = kind === "poll" && ex?.question ? String(ex.question) : `${kind} #${msg.id}`;
  const named = NAMED_KINDS.has(kind) ? name || audioName : "";
  const title = (named || firstLine || name || fallback).slice(0, 200);
  const sortName = naturalKey(name || title);

  // Category tree: channel > topic (forums) > first hashtag
  const mode = config.categoryMode;
  const root = chatCategory(chat.id, chat.title);
  let categoryId = root;
  let scope: string | null = null;
  if ((mode === "auto" || mode === "topic") && chat.isForum) {
    const topicId = topicIdOf(msg);
    categoryId = await topicCategory(chat.id, topicId, root);
    scope = String(topicId);
  }
  if ((mode === "auto" || mode === "hashtag") && tags.length) categoryId = hashtagCategory(chat.id, tags[0], categoryId, scope);

  return {
    chatId: chat.id,
    msgId: msg.id,
    categoryId,
    kind,
    title,
    caption,
    fileName: name,
    sortName,
    size,
    mime,
    duration,
    width,
    height,
    hasThumb,
    groupedId: msg.groupedIdUnique ?? null,
    tags: tags.join(" "),
    postedAt: Math.floor(msg.date.getTime() / 1000),
    extra: ex ? JSON.stringify(ex) : null,
  };
}
