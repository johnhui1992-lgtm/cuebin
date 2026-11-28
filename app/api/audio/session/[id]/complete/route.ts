import { requireIdentity } from "../../../../../../cursor/identity";
import { completeUploadSession } from "../../../../../../src/lib/audioUpload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "private, no-store" };

type RouteContext = { params: Promise<{ id: string }> };

/** Assemble chunks into a permanent audio_files row. */
export async function POST(_request: Request, context: RouteContext) {
  const identity = await requireIdentity(_request);
  if (identity instanceof Response) return identity;

  const { id } = await context.params;
  if (!id || id.length > 80) {
    return Response.json(
      { error: "session_not_found", message: "Upload session expired. Try again." },
      { status: 404, headers: NO_STORE },
    );
  }

  const result = await completeUploadSession({
    userId: identity.sub,
    stage: identity.stage,
    sessionId: id,
  });

  if ("error" in result) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers: NO_STORE },
    );
  }

  return Response.json(result, { status: 201, headers: NO_STORE });
}
