import { requireIdentity } from "../../../../cursor/identity";
import { createUploadSession } from "../../../../src/lib/audioUpload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "private, no-store" };

/** Start a chunked MP3 upload (avoids host single-body size caps). */
export async function POST(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Invalid upload request." },
      { status: 400, headers: NO_STORE },
    );
  }

  const row =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const filename = typeof row.filename === "string" ? row.filename : "";
  const mimeType = typeof row.mimeType === "string" ? row.mimeType : "audio/mpeg";
  const totalBytes =
    typeof row.byteSize === "number"
      ? row.byteSize
      : typeof row.totalBytes === "number"
        ? row.totalBytes
        : NaN;

  const result = await createUploadSession({
    userId: identity.sub,
    stage: identity.stage,
    filename,
    mimeType,
    totalBytes,
  });

  if ("error" in result) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers: NO_STORE },
    );
  }

  return Response.json(result, { status: 201, headers: NO_STORE });
}
