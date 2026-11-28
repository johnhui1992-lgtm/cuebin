import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

/** Next route bundles can each get a fresh module scope — share via globalThis. */
const g = globalThis as typeof globalThis & {
  __cuebinPgPool?: pg.Pool;
  __cuebinPglite?: Promise<PGlite>;
};

export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (databaseUrl !== "") {
    g.__cuebinPgPool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await g.__cuebinPgPool.query(text, params)).rows as T[];
  }
  g.__cuebinPglite ??= startLocal().catch((error: unknown) => {
    g.__cuebinPglite = undefined;
    throw error;
  });
  return (await (await g.__cuebinPglite).query<T>(text, params)).rows;
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
