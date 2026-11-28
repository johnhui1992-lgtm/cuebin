import { requireIdentity } from "../../../../cursor/identity";
import {
  audioHeaders,
  deleteAudioFile,
  getAudioFile,
  toBuffer,
} from "../../../../src/lib/audio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "private, no-store" };

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  const { id } = await context.params;
  if (!id || id.length > 80) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const row = await getAudioFile(identity.sub, identity.stage, id);
  if (!row) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const buf = toBuffer(row.data);
  const bytes = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const size = bytes.byteLength;
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : size - 1;
      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end >= start &&
        end < size
      ) {
        const slice = bytes.slice(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            ...audioHeaders(row.mime_type, slice.byteLength, row.filename),
            "content-range": `bytes ${start}-${end}/${size}`,
            "content-length": String(slice.byteLength),
          },
        });
      }
    }
  }

  return new Response(bytes, {
    status: 200,
    headers: audioHeaders(row.mime_type, bytes.byteLength, row.filename),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const identity = await requireIdentity(_request);
  if (identity instanceof Response) return identity;

  const { id } = await context.params;
  if (!id || id.length > 80) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const ok = await deleteAudioFile(identity.sub, identity.stage, id);
  if (!ok) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  return Response.json({ ok: true }, { headers: NO_STORE });
}
