import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";

export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export type DatabaseConfig =
  | {
      kind: "turso";
      url: string;
      authToken?: string;
      label: string;
    }
  | {
      kind: "local";
      url: string;
      localPath: string;
      label: string;
    };

const DEFAULT_LOCAL_DB_PATH = "./data/grand-line.db";
const DEFAULT_SHARED_DB_PATH_FILE = path.join(
  homedir(),
  ".config",
  "grand-line",
  "database-path",
);
const LOCAL_MODES = new Set(["local", "file", "sqlite", "ssd"]);
const TURSO_MODES = new Set(["turso", "remote", "cloud"]);

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function localConfig(localPath: string): DatabaseConfig {
  return {
    kind: "local",
    url: `file:${localPath}`,
    localPath,
    label: `local file · ${localPath}`,
  };
}

function tursoConfig(url: string, authToken?: string): DatabaseConfig {
  return {
    kind: "turso",
    url,
    authToken,
    label: `Turso · ${url}`,
  };
}

export interface ResolveDatabaseOptions {
  /** Test/embedding override. undefined reads the workstation-shared pointer. */
  sharedLocalDbPath?: string | null;
}

export function readSharedLocalDbPath(
  env: DatabaseEnvironment = process.env,
): string | undefined {
  const pointerFile =
    clean(env.GRAND_LINE_SHARED_DB_PATH_FILE) ?? DEFAULT_SHARED_DB_PATH_FILE;

  try {
    const configured = readFileSync(pointerFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    return clean(configured);
  } catch {
    return undefined;
  }
}

export function isMockDataAllowed(
  env: DatabaseEnvironment = process.env,
): boolean {
  return ["1", "true", "yes"].includes(
    clean(env.GRAND_LINE_ALLOW_MOCK_DATA)?.toLowerCase() ?? "",
  );
}

export function resolveDatabaseConfig(
  env: DatabaseEnvironment = process.env,
  options: ResolveDatabaseOptions = {},
): DatabaseConfig {
  const mode = clean(env.GRAND_LINE_DATABASE_MODE ?? env.DATABASE_MODE)?.toLowerCase();
  const envLocalPath = clean(env.LOCAL_DB_PATH);
  const sharedLocalDbPath =
    options.sharedLocalDbPath === undefined
      ? !envLocalPath && !(mode && TURSO_MODES.has(mode))
        ? readSharedLocalDbPath(env)
        : undefined
      : clean(options.sharedLocalDbPath ?? undefined);
  const localPath =
    envLocalPath ?? sharedLocalDbPath ?? DEFAULT_LOCAL_DB_PATH;
  const tursoUrl = clean(env.TURSO_DATABASE_URL);
  const tursoToken = clean(env.TURSO_AUTH_TOKEN);

  if (mode && LOCAL_MODES.has(mode)) {
    return localConfig(localPath);
  }

  if (mode && TURSO_MODES.has(mode)) {
    if (!tursoUrl) {
      throw new Error(
        "GRAND_LINE_DATABASE_MODE is set to Turso, but TURSO_DATABASE_URL is empty.",
      );
    }
    return tursoConfig(tursoUrl, tursoToken);
  }

  // A project-local path or the workstation-shared pointer is an explicit
  // local choice. Only an explicit Turso mode may override it.
  if (envLocalPath || sharedLocalDbPath) {
    return localConfig(localPath);
  }

  if (tursoUrl) {
    return tursoConfig(tursoUrl, tursoToken);
  }

  return localConfig(localPath);
}

export function createDatabaseClient(config = resolveDatabaseConfig()): Client {
  if (config.kind === "turso") {
    return config.authToken
      ? createClient({ url: config.url, authToken: config.authToken })
      : createClient({ url: config.url });
  }

  return createClient({ url: config.url });
}
