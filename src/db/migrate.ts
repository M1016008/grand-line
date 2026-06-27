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
import "@/lib/load-env";

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { createDatabaseClient, resolveDatabaseConfig } from "@/db/config";

async function main() {
  const config = resolveDatabaseConfig();

  if (config.kind === "local") {
    await mkdir(path.dirname(config.localPath), { recursive: true });
  }

  const client = createDatabaseClient(config);
  const db = drizzle(client);

  console.log(`▶ Applying migrations to ${config.label}…`);

  await migrate(db, { migrationsFolder: "./drizzle/migrations" });

  console.log("✓ Migrations applied.");
  client.close();
}

main().catch((err) => {
  console.error("✗ Migration failed:", err);
  process.exit(1);
});
