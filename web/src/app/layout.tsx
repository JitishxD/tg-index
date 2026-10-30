import "./globals.css";
import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";

export const metadata = { title: "TG Index", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            📺 TG Index
          </Link>
          <SearchBox />
          <nav className="topnav">
            <Link href="/">Channels</Link>
            <Link href="/all">All</Link>
            <Link href="/status">Status</Link>
            <form action="/logout" method="post" style={{ display: "inline" }}>
              <button type="submit" title="Log out">
                Logout
              </button>
            </form>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
