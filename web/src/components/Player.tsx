"use client";
import { useEffect, useState } from "react";

type Props = { src: string; mime: string; playable: boolean; poster?: string | null; audio?: boolean };

const label = (mime: string) => (mime.includes("matroska") ? "MKV" : mime.includes("avi") ? "AVI" : mime);

/** Plays mp4/webm/audio directly in the browser; anything else → use an external player. */
export function Player({ src, mime, playable, poster, audio }: Props) {
  const [failed, setFailed] = useState(!playable);
  const [abs, setAbs] = useState(src);
  const [copied, setCopied] = useState(false);

  useEffect(() => setAbs(new URL(src, window.location.href).href), [src]); // client-only: avoids hydration mismatch

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(abs);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this URL:", abs);
    }
  };

  return (
    <>
      {failed ? (
        <div className="warn">
          Your browser can't play this {audio ? "audio" : "video"} ({label(mime)}). Use an external player like <b>VLC</b> or <b>mpv</b>: click “Open in VLC”, or copy the stream URL and open it in
          your player (e.g. <code>mpv "URL"</code>, or VLC → Media → Open Network Stream).
        </div>
      ) : audio ? (
        <audio controls preload="metadata" src={src} onError={() => setFailed(true)} style={{ width: "100%" }} />
      ) : (
        <video controls playsInline preload="metadata" poster={poster ?? undefined} src={src} onError={() => setFailed(true)} />
      )}
      <div className="actions">
        <a href={`vlc://${abs}`}>Open in VLC</a>
        <a href={`${src}&dl=1`}>Download</a>
        <button onClick={copy}>{copied ? "Copied!" : "Copy stream URL"}</button>
      </div>
    </>
  );
}
