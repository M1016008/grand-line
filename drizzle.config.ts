import "./src/lib/load-env";

import { defineConfig } from "drizzle-kit";

import { resolveDatabaseConfig } from "./src/db/config";

const dbConfig = resolveDatabaseConfig();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "turso",
  dbCredentials:
    dbConfig.kind === "turso" && dbConfig.authToken
      ? { url: dbConfig.url, authToken: dbConfig.authToken }
      : { url: dbConfig.url },
  verbose: true,
  strict: true,
  casing: "snake_case",
});
