import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
const localPath = process.env.LOCAL_DB_PATH ?? "./data/grand-line.db";

const useTurso = Boolean(tursoUrl && tursoToken);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "turso",
  dbCredentials: useTurso
    ? { url: tursoUrl!, authToken: tursoToken! }
    : { url: `file:${localPath}` },
  verbose: true,
  strict: true,
  casing: "snake_case",
});
