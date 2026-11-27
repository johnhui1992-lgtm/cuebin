import type { Song } from "./types";
import { loadSongs, saveSongs } from "./storage";

const DEBOUNCE_MS = 650;

export type SyncStatus = "loading" | "synced" | "offline" | "error";

type PlaylistResponse = {
  songs?: unknown;
};

function asSongs(value: unknown): Song[] | null {
  if (!Array.isArray(value)) return null;
  return value as Song[];
}

/** Fetch cloud playlist; migrate local sample/list when cloud is empty. */
export async function hydratePlaylistFromCloud(): Promise<{
  songs: Song[];
  status: SyncStatus;
}> {
  const local = loadSongs();
  try {
    const res = await fetch("/api/playlist", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401) {
      return { songs: local, status: "offline" };
    }
    if (!res.ok) {
      return { songs: local, status: "error" };
    }
    const data = (await res.json()) as PlaylistResponse;
    const cloud = asSongs(data.songs) ?? [];
    if (cloud.length === 0 && local.length > 0) {
      const put = await fetch("/api/playlist", {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ songs: local }),
        cache: "no-store",
      });
      if (!put.ok) {
        return { songs: local, status: "error" };
      }
      saveSongs(local);
      return { songs: local, status: "synced" };
    }
    if (cloud.length > 0) {
      saveSongs(cloud);
      return { songs: cloud, status: "synced" };
    }
    return { songs: local, status: "synced" };
  } catch {
    return { songs: local, status: "offline" };
  }
}

export async function pushPlaylistToCloud(songs: Song[]): Promise<SyncStatus> {
  try {
    const res = await fetch("/api/playlist", {
      method: "PUT",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ songs }),
      cache: "no-store",
    });
    if (res.status === 401) return "offline";
    if (!res.ok) return "error";
    return "synced";
  } catch {
    return "offline";
  }
}

export function createDebouncedCloudSave(
  onStatus?: (status: SyncStatus) => void,
): (songs: Song[]) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: Song[] = [];
  return (songs: Song[]) => {
    latest = songs;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void pushPlaylistToCloud(latest).then((status) => onStatus?.(status));
    }, DEBOUNCE_MS);
  };
}
