import { requireIdentity } from "../../../../../../../cursor/identity";
import { saveUploadChunk } from "../../../../../../../src/lib/audioUpload";
import { UPLOAD_CHUNK_BYTES } from "../../../../../../../src/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "private, no-store" };

type RouteContext = {
  params: Promise<{ id: string; index: string }>;
};

/** Receive one binary chunk of a chunked MP3 upload. */
export async function PUT(request: Request, context: RouteContext) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  const { id, index: indexRaw } = await context.params;
  const chunkIndex = Number(indexRaw);
  if (!id || id.length > 80 || !Number.isInteger(chunkIndex)) {
    return Response.json(
      { error: "bad_chunk", message: "Invalid upload chunk." },
      { status: 400, headers: NO_STORE },
    );
  }

  let bytes: Buffer;
  try {
    const buf = Buffer.from(await request.arrayBuffer());
    bytes = buf;
  } catch {
    return Response.json(
      { error: "read_failed", message: "Couldn’t read upload chunk." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (bytes.byteLength > UPLOAD_CHUNK_BYTES + 64) {
    return Response.json(
      { error: "chunk_too_large", message: "Upload chunk was too large." },
      { status: 413, headers: NO_STORE },
    );
  }

  const result = await saveUploadChunk({
    userId: identity.sub,
    stage: identity.stage,
    sessionId: id,
    chunkIndex,
    bytes,
  });

  if ("error" in result) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers: NO_STORE },
    );
  }

  return Response.json(
    { ok: true, chunkIndex, byteSize: bytes.byteLength },
    { headers: NO_STORE },
  );
}
