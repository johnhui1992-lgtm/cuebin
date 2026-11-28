import { requireIdentity } from "../../../cursor/identity";
import { insertAudioFile } from "../../../src/lib/audio";
import { MAX_MP3_BYTES, MAX_MP3_MB } from "../../../src/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "private, no-store" };

type UploadBlob = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

/** Duck-type File/Blob — `instanceof File` can fail across Node/undici realms. */
function asUploadBlob(entry: FormDataEntryValue | null): UploadBlob | null {
  if (entry == null || typeof entry === "string") return null;
  const blob = entry as Blob & { name?: string };
  if (typeof blob.arrayBuffer !== "function" || typeof blob.size !== "number") {
    return null;
  }
  const name =
    typeof blob.name === "string" && blob.name.trim()
      ? blob.name.trim()
      : "track.mp3";
  return {
    name,
    type: typeof blob.type === "string" ? blob.type : "",
    size: blob.size,
    arrayBuffer: () => blob.arrayBuffer(),
  };
}

function isMp3File(name: string, type: string): boolean {
  const n = name.toLowerCase();
  const t = type.toLowerCase();
  return (
    n.endsWith(".mp3") ||
    t === "audio/mpeg" ||
    t === "audio/mp3" ||
    t === "audio/mpeg3" ||
    t === "audio/x-mpeg" ||
    t === "audio/x-mp3" ||
    // iOS sometimes labels MP3s as octet-stream; allow when extension is .mp3
    (t === "application/octet-stream" && n.endsWith(".mp3")) ||
    (t === "" && n.endsWith(".mp3"))
  );
}

function jsonError(
  error: string,
  status: number,
  message: string,
  extra?: Record<string, unknown>,
) {
  return Response.json(
    { error, message, ...extra },
    { status, headers: NO_STORE },
  );
}

/** Upload an owned .mp3; bytes land in Postgres audio_files. */
export async function POST(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.slice(0, 160) : "invalid_form";
    return jsonError(
      "invalid_form",
      400,
      /large|size|limit|body/i.test(detail)
        ? "Upload was too large for the server to accept."
        : "Couldn’t read the upload. Try again.",
      { detail },
    );
  }

  const file = asUploadBlob(form.get("file"));
  if (!file) {
    return jsonError(
      "missing_file",
      400,
      "No MP3 file was received. Pick a .mp3 and try again.",
    );
  }

  if (!isMp3File(file.name, file.type)) {
    return jsonError(
      "mp3_only",
      415,
      "Only .mp3 files can be uploaded.",
      { filename: file.name, mimeType: file.type || null },
    );
  }

  if (file.size > MAX_MP3_BYTES) {
    return jsonError(
      "file_too_large",
      413,
      `MP3 must be ${MAX_MP3_MB} MB or smaller.`,
      { maxBytes: MAX_MP3_BYTES, byteSize: file.size },
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.slice(0, 160) : "read_failed";
    return jsonError(
      "read_failed",
      400,
      "Couldn’t read that MP3 from the device.",
      { detail },
    );
  }

  if (bytes.byteLength === 0) {
    return jsonError("empty_file", 400, "That file was empty.");
  }

  // Body may have been truncated by a proxy size limit — use chunked upload.
  if (file.size > 0 && bytes.byteLength < file.size) {
    return jsonError(
      "truncated",
      413,
      "Upload was truncated by the host. Cuebin will retry in smaller chunks — refresh and try again.",
      { expected: file.size, received: bytes.byteLength },
    );
  }

  const result = await insertAudioFile({
    userId: identity.sub,
    stage: identity.stage,
    filename: file.name,
    mimeType: file.type || "audio/mpeg",
    bytes,
  });

  if ("error" in result) {
    return jsonError(result.error, result.status, result.message);
  }

  return Response.json(
    {
      id: result.id,
      filename: file.name,
      byteSize: bytes.byteLength,
      url: `/api/audio/${result.id}`,
    },
    { status: 201, headers: NO_STORE },
  );
}
