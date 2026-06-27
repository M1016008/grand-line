// NOTE: not using `import "server-only"` here because the same module is
// reused from CLI scripts (scraper, migrate). `@libsql/client` requires
// native Node bindings, so bundling it from a client component would fail
// at build time anyway — that gives us the same protection for free.

import { drizzle } from "drizzle-orm/libsql";

import { createDatabaseClient } from "./config";
import * as schema from "./schema";

const client = createDatabaseClient();

export const db = drizzle(client, {
  schema,
  casing: "snake_case",
  logger: process.env.NODE_ENV === "development",
});

export type Database = typeof db;

export { schema };
