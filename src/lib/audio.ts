import { randomUUID } from "node:crypto";
import { MAX_LIBRARY_SONGS, MAX_MP3_BYTES } from "../constants";
import type { Song } from "../types";
import { ensureAudioSchema, sql, sqlDirect } from "./db";

export type AudioRow = {
  id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  data: Buffer | Uint8Array | string;
};

export function audioHeaders(
  mimeType: string,
  byteSize: number,
  filename: string,
): HeadersInit {
  const safeName = filename.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
  return {
    "cache-control": "private, no-store",
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
  await ensureAudioSchema();
  const rows = await sqlDirect<{ n: string | number }>(
    "select count(*)::int as n from audio_files where user_id = $1 and stage = $2",
    [userId, stage],
  );
  return Number(rows[0]?.n ?? 0);
}

function pgErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function pgErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 240);
  return "database_error";
}

export async function insertAudioFile(opts: {
  userId: string;
  stage: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ id: string } | { error: string; status: number; message: string }> {
  if (opts.bytes.byteLength === 0) {
    return {
      error: "empty_file",
      status: 400,
      message: "That file was empty.",
    };
  }
  if (opts.bytes.byteLength > MAX_MP3_BYTES) {
    return {
      error: "file_too_large",
      status: 413,
      message: "MP3 must be 15 MB or smaller.",
    };
  }

  try {
    await ensureAudioSchema();
  } catch (error) {
    return {
      error: "schema_error",
      status: 500,
      message: `Couldn’t prepare audio storage (${pgErrorMessage(error)}).`,
    };
  }

  const songCount = await countUserSongs(opts.userId, opts.stage);
  const audioCount = await countUserAudio(opts.userId, opts.stage);
  if (songCount >= MAX_LIBRARY_SONGS || audioCount >= MAX_LIBRARY_SONGS) {
    return {
      error: "library_full",
      status: 409,
      message: "Library is full (30 songs). Remove one to add another.",
    };
  }

  const id = randomUUID();
  const mime = opts.mimeType.startsWith("audio/")
    ? opts.mimeType.slice(0, 64)
    : "audio/mpeg";
  const filename = opts.filename.trim().slice(0, 200) || "track.mp3";

  try {
    await sqlDirect(
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
  } catch (error) {
    const code = pgErrorCode(error);
    const detail = pgErrorMessage(error);
    if (code === "42P01" || /audio_files/i.test(detail)) {
      return {
        error: "schema_error",
        status: 500,
        message: "Audio storage table is missing. Try again in a moment.",
      };
    }
    if (code === "57014" || /timeout|cancel/i.test(detail)) {
      return {
        error: "timeout",
        status: 504,
        message: "Upload timed out — try a smaller MP3.",
      };
    }
    if (/too large|payload|max.*size|body/i.test(detail)) {
      return {
        error: "file_too_large",
        status: 413,
        message: "File was rejected as too large by the host.",
      };
    }
    return {
      error: "db_error",
      status: 500,
      message: `Couldn’t save MP3 (${detail}).`,
    };
  }

  return { id };
}

export async function getAudioFile(
  userId: string,
  stage: string,
  id: string,
): Promise<AudioRow | null> {
  await ensureAudioSchema();
  const rows = await sqlDirect<AudioRow>(
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
  await ensureAudioSchema();
  const rows = await sqlDirect<{ id: string }>(
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
  await ensureAudioSchema();
  const keep = new Set(
    songs
      .filter((s) => s.source === "mp3" && typeof s.audioId === "string")
      .map((s) => s.audioId as string),
  );
  const rows = await sqlDirect<{ id: string }>(
    "select id from audio_files where user_id = $1 and stage = $2",
    [userId, stage],
  );
  for (const row of rows) {
    if (!keep.has(row.id)) {
      await deleteAudioFile(userId, stage, row.id);
    }
  }
}
