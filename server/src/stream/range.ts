export type Range = { start: number; end: number } | "invalid" | null;

/** Parses a single-range "bytes=a-b", "bytes=a-", or "bytes=-n" header. Multi-range is ignored (full 200). */
export function parseRange(header: string | undefined, size: number): Range {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start: number, end: number;
  if (m[1] === "" && m[2] === "") return "invalid";
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}
