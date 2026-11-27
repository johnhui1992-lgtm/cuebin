import type { Song, TagSource } from "../types";
import { emptyTagSource } from "../types";

const MAX_SONGS = 500;
const MAX_STRING = 500;
const MAX_TAGS = 32;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 64))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

function asTagMap(value: unknown): Record<string, TagSource> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, TagSource> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === "auto" || raw === "manual") {
      out[key.slice(0, 64)] = raw;
    }
  }
  return out;
}

export function normalizeSongs(raw: unknown): Song[] {
  if (!Array.isArray(raw)) return [];
  const songs: Song[] = [];
  for (const item of raw.slice(0, MAX_SONGS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.url !== "string") continue;
    const title =
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim().slice(0, MAX_STRING)
        : row.url.slice(0, MAX_STRING);
    const tagSourceRaw =
      row.tagSource && typeof row.tagSource === "object"
        ? (row.tagSource as Record<string, unknown>)
        : null;
    songs.push({
      id: row.id.slice(0, 80),
      url: row.url.slice(0, MAX_STRING),
      title,
      youtubeId:
        typeof row.youtubeId === "string"
          ? row.youtubeId.slice(0, 32)
          : row.youtubeId === null
            ? null
            : null,
      mood: asStringArray(row.mood),
      type: asStringArray(row.type),
      singer: asStringArray(row.singer),
      tagSource: tagSourceRaw
        ? {
            mood: asTagMap(tagSourceRaw.mood),
            type: asTagMap(tagSourceRaw.type),
            singer: asTagMap(tagSourceRaw.singer),
          }
        : emptyTagSource(),
      createdAt:
        typeof row.createdAt === "number" && Number.isFinite(row.createdAt)
          ? row.createdAt
          : Date.now(),
    });
  }
  return songs;
}
