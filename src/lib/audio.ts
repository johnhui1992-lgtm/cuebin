import { randomUUID } from "node:crypto";
import { MAX_LIBRARY_SONGS, MAX_MP3_BYTES } from "../constants";
import type { Song } from "../types";
import { sql } from "./db";

export type AudioRow = {
  id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  data: Buffer | Uint8Array | string;
};

const NO_STORE = { "cache-control": "private, no-store" };

export function audioHeaders(
  mimeType: string,
  byteSize: number,
  filename: string,
): HeadersInit {
  const safeName = filename.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
  return {
    ...NO_STORE,
    "content-type": mimeType || "audio/mpeg",
    "content-length": String(byteSize),
    "content-disposition": `inline; filename="${safeName}"`,
    "accept-ranges": "bytes",
  };
}

export function toBuffer(data: AudioRow["data"]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") {
    // pg may return hex (\x...) for bytea depending on config
    if (data.startsWith("\\x")) return Buffer.from(data.slice(2), "hex");
    return Buffer.from(data, "base64");
  }
  return Buffer.from(data);
}

export async function countUserSongs(
  userId: string,
  stage: string,
): Promise<number> {
  const rows = await sql<{ songs: Song[] | string }>(
    "select songs from playlists where user_id = $1 and stage = $2",
    [userId, stage],
  );
  if (!rows[0]) return 0;
  const value = rows[0].songs;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return Array.isArray(value) ? value.length : 0;
}

export async function countUserAudio(
  userId: string,
  stage: string,
): Promise<number> {
  const rows = await sql<{ n: string | number }>(
    "select count(*)::int as n from audio_files where user_id = $1 and stage = $2",
    [userId, stage],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function insertAudioFile(opts: {
  userId: string;
  stage: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ id: string } | { error: string; status: number }> {
  if (opts.bytes.byteLength === 0) {
    return { error: "empty_file", status: 400 };
  }
  if (opts.bytes.byteLength > MAX_MP3_BYTES) {
    return { error: "file_too_large", status: 413 };
  }

  const songCount = await countUserSongs(opts.userId, opts.stage);
  const audioCount = await countUserAudio(opts.userId, opts.stage);
  // Cap against playlist size (source of truth) and orphaned uploads.
  if (songCount >= MAX_LIBRARY_SONGS || audioCount >= MAX_LIBRARY_SONGS) {
    return { error: "library_full", status: 409 };
  }

  const id = randomUUID();
  const mime = opts.mimeType.startsWith("audio/")
    ? opts.mimeType.slice(0, 64)
    : "audio/mpeg";
  const filename = opts.filename.trim().slice(0, 200) || "track.mp3";

  await sql(
    `insert into audio_files (id, user_id, stage, filename, mime_type, byte_size, data)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      opts.userId,
      opts.stage,
      filename,
      mime,
      opts.bytes.byteLength,
      opts.bytes,
    ],
  );

  return { id };
}

export async function getAudioFile(
  userId: string,
  stage: string,
  id: string,
): Promise<AudioRow | null> {
  const rows = await sql<AudioRow>(
    `select id, filename, mime_type, byte_size, data
     from audio_files
     where user_id = $1 and stage = $2 and id = $3`,
    [userId, stage, id],
  );
  return rows[0] ?? null;
}

export async function deleteAudioFile(
  userId: string,
  stage: string,
  id: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }>(
    `delete from audio_files
     where user_id = $1 and stage = $2 and id = $3
     returning id`,
    [userId, stage, id],
  );
  return rows.length > 0;
}

/** Drop audio blobs no longer referenced by playlist song metadata. */
export async function pruneOrphanAudio(
  userId: string,
  stage: string,
  songs: Song[],
): Promise<void> {
  const keep = new Set(
    songs
      .filter((s) => s.source === "mp3" && typeof s.audioId === "string")
      .map((s) => s.audioId as string),
  );
  const rows = await sql<{ id: string }>(
    "select id from audio_files where user_id = $1 and stage = $2",
    [userId, stage],
  );
  for (const row of rows) {
    if (!keep.has(row.id)) {
      await deleteAudioFile(userId, stage, row.id);
    }
  }
}
