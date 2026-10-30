export const fmtSize = (b: number) => {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
};
export const fmtDur = (s: number | null) => {
  if (!s) return "";
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
};
export const fmtDate = (t: number) => new Date(t * 1000).toLocaleDateString();
