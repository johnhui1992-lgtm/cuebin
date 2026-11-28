import { randomUUID } from "node:crypto";
import {
  MAX_MP3_BYTES,
  MAX_MP3_MB,
  UPLOAD_CHUNK_BYTES,
} from "../constants";
import { ensureAudioSchema, sqlDirect } from "./db";
import { insertAudioFile, toBuffer } from "./audio";

export type UploadSession = {
  id: string;
  filename: string;
  mime_type: string;
  total_bytes: number;
};

function isMp3Name(name: string, type: string): boolean {
  const n = name.toLowerCase();
  const t = type.toLowerCase();
  return (
    n.endsWith(".mp3") ||
    t === "audio/mpeg" ||
    t === "audio/mp3" ||
    t === "audio/mpeg3" ||
    t === "audio/x-mpeg" ||
    t === "audio/x-mp3" ||
    (t === "application/octet-stream" && n.endsWith(".mp3")) ||
    (t === "" && n.endsWith(".mp3"))
  );
}

export async function createUploadSession(opts: {
  userId: string;
  stage: string;
  filename: string;
  mimeType: string;
  totalBytes: number;
}): Promise<
  | { id: string; chunkSize: number; maxBytes: number }
  | { error: string; status: number; message: string }
> {
  if (!Number.isFinite(opts.totalBytes) || opts.totalBytes <= 0) {
    return {
      error: "empty_file",
      status: 400,
      message: "That file was empty.",
    };
  }
  if (opts.totalBytes > MAX_MP3_BYTES) {
    return {
      error: "file_too_large",
      status: 413,
      message: `MP3 must be ${MAX_MP3_MB} MB or smaller.`,
    };
  }
  if (!isMp3Name(opts.filename, opts.mimeType)) {
    return {
      error: "mp3_only",
      status: 415,
      message: "Only .mp3 files can be uploaded.",
    };
  }

  await ensureAudioSchema();
  const id = randomUUID();
  const filename = opts.filename.trim().slice(0, 200) || "track.mp3";
  const mime = opts.mimeType.startsWith("audio/")
    ? opts.mimeType.slice(0, 64)
    : "audio/mpeg";

  await sqlDirect(
    `insert into audio_upload_sessions
      (id, user_id, stage, filename, mime_type, total_bytes)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, opts.userId, opts.stage, filename, mime, opts.totalBytes],
  );

  return {
    id,
    chunkSize: UPLOAD_CHUNK_BYTES,
    maxBytes: MAX_MP3_BYTES,
  };
}

export async function getUploadSession(
  userId: string,
  stage: string,
  id: string,
): Promise<UploadSession | null> {
  await ensureAudioSchema();
  const rows = await sqlDirect<UploadSession>(
    `select id, filename, mime_type, total_bytes
     from audio_upload_sessions
     where user_id = $1 and stage = $2 and id = $3`,
    [userId, stage, id],
  );
  return rows[0] ?? null;
}

export async function saveUploadChunk(opts: {
  userId: string;
  stage: string;
  sessionId: string;
  chunkIndex: number;
  bytes: Buffer;
}): Promise<{ ok: true } | { error: string; status: number; message: string }> {
  if (
    !Number.isInteger(opts.chunkIndex) ||
    opts.chunkIndex < 0 ||
    opts.chunkIndex > 10_000
  ) {
    return {
      error: "bad_chunk",
      status: 400,
      message: "Invalid upload chunk.",
    };
  }
  if (opts.bytes.byteLength === 0) {
    return {
      error: "empty_chunk",
      status: 400,
      message: "Empty upload chunk.",
    };
  }
  if (opts.bytes.byteLength > UPLOAD_CHUNK_BYTES + 64) {
    return {
      error: "chunk_too_large",
      status: 413,
      message: "Upload chunk was too large.",
    };
  }

  const session = await getUploadSession(
    opts.userId,
    opts.stage,
    opts.sessionId,
  );
  if (!session) {
    return {
      error: "session_not_found",
      status: 404,
      message: "Upload session expired. Try again.",
    };
  }

  await sqlDirect(
    `insert into audio_upload_chunks
      (user_id, stage, session_id, chunk_index, byte_size, data)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, stage, session_id, chunk_index) do update
     set byte_size = excluded.byte_size, data = excluded.data`,
    [
      opts.userId,
      opts.stage,
      opts.sessionId,
      opts.chunkIndex,
      opts.bytes.byteLength,
      opts.bytes,
    ],
  );

  return { ok: true };
}

async function deleteUploadSession(
  userId: string,
  stage: string,
  sessionId: string,
): Promise<void> {
  await sqlDirect(
    `delete from audio_upload_chunks
     where user_id = $1 and stage = $2 and session_id = $3`,
    [userId, stage, sessionId],
  );
  await sqlDirect(
    `delete from audio_upload_sessions
     where user_id = $1 and stage = $2 and id = $3`,
    [userId, stage, sessionId],
  );
}

export async function completeUploadSession(opts: {
  userId: string;
  stage: string;
  sessionId: string;
}): Promise<
  | { id: string; filename: string; byteSize: number; url: string }
  | { error: string; status: number; message: string }
> {
  const session = await getUploadSession(
    opts.userId,
    opts.stage,
    opts.sessionId,
  );
  if (!session) {
    return {
      error: "session_not_found",
      status: 404,
      message: "Upload session expired. Try again.",
    };
  }

  const rows = await sqlDirect<{
    chunk_index: number;
    byte_size: number;
    data: Buffer | Uint8Array | string;
  }>(
    `select chunk_index, byte_size, data
     from audio_upload_chunks
     where user_id = $1 and stage = $2 and session_id = $3
     order by chunk_index asc`,
    [opts.userId, opts.stage, opts.sessionId],
  );

  if (rows.length === 0) {
    return {
      error: "missing_chunks",
      status: 400,
      message: "No upload chunks received. Try again.",
    };
  }

  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].chunk_index !== i) {
      return {
        error: "missing_chunks",
        status: 400,
        message: "Upload chunks are incomplete. Try again.",
      };
    }
  }

  const parts = rows.map((row) => toBuffer(row.data));
  const bytes = Buffer.concat(parts);
  if (bytes.byteLength !== session.total_bytes) {
    return {
      error: "size_mismatch",
      status: 400,
      message: `Upload incomplete (${bytes.byteLength} of ${session.total_bytes} bytes). Try again.`,
    };
  }

  const result = await insertAudioFile({
    userId: opts.userId,
    stage: opts.stage,
    filename: session.filename,
    mimeType: session.mime_type,
    bytes,
  });

  await deleteUploadSession(opts.userId, opts.stage, opts.sessionId);

  if ("error" in result) {
    return result;
  }

  return {
    id: result.id,
    filename: session.filename,
    byteSize: bytes.byteLength,
    url: `/api/audio/${result.id}`,
  };
}
