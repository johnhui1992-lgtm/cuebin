import { requireIdentity } from "../../../cursor/identity";
import { sql } from "../../../src/lib/db";
import { normalizeSongs } from "../../../src/lib/playlist";
import type { Song } from "../../../src/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

type PlaylistRow = {
  songs: Song[] | string;
};

function parseSongs(value: Song[] | string): Song[] {
  if (typeof value === "string") {
    try {
      return normalizeSongs(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return normalizeSongs(value);
}

export async function GET(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  const rows = await sql<PlaylistRow>(
    "select songs from playlists where user_id = $1 and stage = $2",
    [identity.sub, identity.stage],
  );
  const songs = rows[0] ? parseSongs(rows[0].songs) : [];
  return Response.json({ songs }, { headers: NO_STORE });
}

export async function PUT(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json" },
      { status: 400, headers: NO_STORE },
    );
  }

  const songs = normalizeSongs(
    body && typeof body === "object" && "songs" in body
      ? (body as { songs: unknown }).songs
      : body,
  );

  await sql(
    `insert into playlists (user_id, stage, songs, updated_at)
     values ($1, $2, $3::jsonb, now())
     on conflict (user_id, stage) do update
     set songs = excluded.songs, updated_at = now()`,
    [identity.sub, identity.stage, JSON.stringify(songs)],
  );

  return Response.json({ ok: true, songs }, { headers: NO_STORE });
}
