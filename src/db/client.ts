import "server-only";

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const localPath = process.env.LOCAL_DB_PATH ?? "./data/grand-line.db";

function buildClient(): Client {
  if (url && authToken) {
    return createClient({ url, authToken });
  }
  if (url) {
    // Anonymous Turso (e.g. local sqld) — auth token optional.
    return createClient({ url });
  }
  return createClient({ url: `file:${localPath}` });
}

const client = buildClient();

export const db = drizzle(client, {
  schema,
  casing: "snake_case",
  logger: process.env.NODE_ENV === "development",
});

export type Database = typeof db;

export { schema };
