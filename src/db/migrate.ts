/**
 * Apply Drizzle migrations to the configured Turso/libSQL database.
 *
 * Usage:
 *   npm run db:migrate
 *
 * Reads TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, or falls back to a local
 * SQLite file at LOCAL_DB_PATH. Both `0000_init_schema.sql` and the
 * hand-authored `0001_fts5_translations.sql` are picked up automatically
 * via the journal.
 */
import "dotenv/config";

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const localPath = process.env.LOCAL_DB_PATH ?? "./data/grand-line.db";

  if (!url) {
    await mkdir(path.dirname(localPath), { recursive: true });
  }

  const client = url
    ? createClient({ url, authToken })
    : createClient({ url: `file:${localPath}` });

  const db = drizzle(client);

  const target = url ? `Turso (${url})` : `local file (${localPath})`;
  console.log(`▶ Applying migrations to ${target}…`);

  await migrate(db, { migrationsFolder: "./drizzle/migrations" });

  console.log("✓ Migrations applied.");
  client.close();
}

main().catch((err) => {
  console.error("✗ Migration failed:", err);
  process.exit(1);
});
