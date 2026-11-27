/** Extract a YouTube video id from common URL shapes, or null if unsupported. */
export function parseYoutubeId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return isValidId(id) ? id : null;
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const v = url.searchParams.get('v');
      if (isValidId(v)) return v;

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
        return isValidId(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function isValidId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^[\w-]{11}$/.test(id);
}

export function youtubeEmbedUrl(id: string, origin?: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
    enablejsapi: '1',
  });
  if (origin) params.set('origin', origin);
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

/** Send a YouTube iframe API command via postMessage (needs enablejsapi=1). */
export function postYoutubeCommand(
  iframe: HTMLIFrameElement | null | undefined,
  func: string,
  args: unknown[] = [],
): void {
  iframe?.contentWindow?.postMessage(
    JSON.stringify({ event: 'command', func, args }),
    '*',
  );
}

export function youtubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export type OEmbedMeta = {
  title: string | null;
  authorName: string | null;
};

/** Best-effort title + author from oEmbed. */
export async function fetchYoutubeMeta(id: string): Promise<OEmbedMeta> {
  try {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`,
    );
    if (!res.ok) return { title: null, authorName: null };
    const data = (await res.json()) as { title?: string; author_name?: string };
    return {
      title: data.title?.trim() || null,
      authorName: data.author_name?.trim() || null,
    };
  } catch {
    return { title: null, authorName: null };
  }
}

export function titleFromUrl(url: string, youtubeId: string | null): string {
  if (youtubeId) return `YouTube · ${youtubeId}`;
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
  } catch {
    return url.slice(0, 48) || 'Untitled link';
  }
}
