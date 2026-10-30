export function SearchBox() {
  return (
    <form action="/search">
      <input name="q" placeholder="Search titles, captions, #tags…" style={{ width: "100%" }} />
    </form>
  );
}
