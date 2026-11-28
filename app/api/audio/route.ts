import { requireIdentity } from "../../../cursor/identity";
import { insertAudioFile } from "../../../src/lib/audio";
import { MAX_MP3_BYTES } from "../../../src/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "private, no-store" };

function isMp3File(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return (
    name.endsWith(".mp3") ||
    type === "audio/mpeg" ||
    type === "audio/mp3" ||
    type === "audio/mpeg3"
  );
}

/** Upload an owned .mp3; bytes land in Postgres audio_files. */
export async function POST(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "invalid_form" },
      { status: 400, headers: NO_STORE },
    );
  }

  const entry = form.get("file");
  if (!(entry instanceof File)) {
    return Response.json(
      { error: "missing_file" },
      { status: 400, headers: NO_STORE },
    );
  }

  if (!isMp3File(entry)) {
    return Response.json(
      { error: "mp3_only" },
      { status: 415, headers: NO_STORE },
    );
  }

  if (entry.size > MAX_MP3_BYTES) {
    return Response.json(
      { error: "file_too_large", maxBytes: MAX_MP3_BYTES },
      { status: 413, headers: NO_STORE },
    );
  }

  const bytes = Buffer.from(await entry.arrayBuffer());
  const result = await insertAudioFile({
    userId: identity.sub,
    stage: identity.stage,
    filename: entry.name,
    mimeType: entry.type || "audio/mpeg",
    bytes,
  });

  if ("error" in result) {
    return Response.json(
      { error: result.error },
      { status: result.status, headers: NO_STORE },
    );
  }

  return Response.json(
    {
      id: result.id,
      filename: entry.name,
      byteSize: bytes.byteLength,
      url: `/api/audio/${result.id}`,
    },
    { status: 201, headers: NO_STORE },
  );
}
