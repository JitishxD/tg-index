/**
 * Builds a key whose plain (binary) string order equals natural order:
 * "Ep 2" < "Ep 10", "S01E09" < "S01E10". Stored in media.sort_name.
 */
export function naturalKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip diacritics
    .toLowerCase()
    .replace(/\.(?=[a-z0-9]*[a-z])[a-z0-9]{1,5}$/, "") // drop extension (".mkv"), keep "1.5"
    .replace(/[\s._\-–—]+/g, " ")
    .trim()
    .replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, "").padStart(12, "0"))
    .slice(0, 300);
}
