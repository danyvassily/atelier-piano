export interface ParsedYouTubeUrl {
  videoId: string;
  startSeconds: number;
}

function parseTime(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | null {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return { videoId: trimmed, startSeconds: 0 };
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");
    let videoId = "";
    if (host === "youtu.be") videoId = url.pathname.slice(1).split("/")[0];
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
      else videoId = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] || "";
    }
    if (!/^[\w-]{11}$/.test(videoId)) return null;
    return {
      videoId,
      startSeconds: parseTime(url.searchParams.get("t") || url.searchParams.get("start")),
    };
  } catch {
    return null;
  }
}
