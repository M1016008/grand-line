import { createClient, type Client } from "@libsql/client";

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

export function resolveDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const mode = clean(env.GRAND_LINE_DATABASE_MODE ?? env.DATABASE_MODE)?.toLowerCase();
  const localPath = clean(env.LOCAL_DB_PATH) ?? DEFAULT_LOCAL_DB_PATH;
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
