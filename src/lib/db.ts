import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const pooledUrl = process.env.DATABASE_URL?.trim() ?? "";
/** Prefer unpooled for large BYTEA reads/writes (poolers can drop/fail big params). */
const directUrl =
  process.env.DATABASE_URL_UNPOOLED?.trim() || pooledUrl;

/** Next route bundles can each get a fresh module scope — share via globalThis. */
const g = globalThis as typeof globalThis & {
  __cuebinPgPool?: pg.Pool;
  __cuebinPgDirect?: pg.Pool;
  __cuebinPglite?: Promise<PGlite>;
  __cuebinAudioSchema?: Promise<void>;
};

async function withPg<T>(
  poolKey: "__cuebinPgPool" | "__cuebinPgDirect",
  connectionString: string,
  text: string,
  params: unknown[],
): Promise<T[]> {
  g[poolKey] ??= new pg.Pool({ connectionString, max: 5 });
  return (await g[poolKey]!.query(text, params)).rows as T[];
}

async function withLocal<T>(
  text: string,
  params: unknown[],
): Promise<T[]> {
  g.__cuebinPglite ??= startLocal().catch((error: unknown) => {
    g.__cuebinPglite = undefined;
    throw error;
  });
  return (await (await g.__cuebinPglite).query<T>(text, params)).rows;
}

/** General queries (playlist JSON, counts) — pooled URL is fine. */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (pooledUrl !== "") {
    return withPg<T>("__cuebinPgPool", pooledUrl, text, params);
  }
  return withLocal<T>(text, params);
}

/**
 * Large BYTEA upload/download — use direct/unpooled connection when available.
 * Cursor/Neon poolers often reject or truncate multi‑MB parameters.
 */
export async function sqlDirect<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (directUrl !== "") {
    return withPg<T>("__cuebinPgDirect", directUrl, text, params);
  }
  return withLocal<T>(text, params);
}

/** Make sure audio_files exists even if build-time migrate skipped 002. */
export async function ensureAudioSchema(): Promise<void> {
  if (!g.__cuebinAudioSchema) {
    g.__cuebinAudioSchema = (async () => {
      const statements = [
        `create table if not exists audio_files (
          id text not null,
          user_id text not null,
          stage text not null default 'production',
          filename text not null,
          mime_type text not null default 'audio/mpeg',
          byte_size integer not null,
          data bytea not null,
          created_at timestamptz not null default now(),
          primary key (user_id, stage, id)
        )`,
        `create index if not exists audio_files_user_stage_idx
          on audio_files (user_id, stage)`,
      ];
      for (const statement of statements) {
        await sqlDirect(statement, []);
      }
    })().catch((error: unknown) => {
      g.__cuebinAudioSchema = undefined;
      throw error;
    });
  }
  await g.__cuebinAudioSchema;
}

async function startLocal(): Promise<PGlite> {
  const db = new PGlite();
  const files = (await readdir("migrations").catch(() => []))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  return db;
}
