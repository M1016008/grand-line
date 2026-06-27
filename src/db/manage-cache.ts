/**
 * Manage local cache storage without growing the card database.
 *
 * Card images live on the filesystem, not in SQLite. This command removes
 * corrupt cache pairs and images no longer referenced by `cards.image_url_jp`,
 * then reports the DB and cache footprint so growth is visible.
 */
import "@/lib/load-env";

import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { createDatabaseClient, resolveDatabaseConfig } from "@/db/config";
import {
  imageCacheKey,
  imageCacheRoot,
  parseAllowedCardImageUrl,
  type CachedImageMeta,
} from "@/lib/card-image-cache";

interface CliArgs {
  dryRun: boolean;
  maxImageCacheMb: number;
}

interface CacheFilePair {
  key: string;
  bodyPath: string;
  metaPath: string;
  hasBody: boolean;
  hasMeta: boolean;
  bodyBytes: number;
  metaBytes: number;
  cachedAt?: string;
  sourceUrl?: string;
  invalidReason?: string;
}

interface ExpectedImages {
  keys: Set<string>;
  invalidUrls: number;
}

const DEFAULT_IMAGE_CACHE_MAX_MB = 2048;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    maxImageCacheMb: readEnvNumber("IMAGE_CACHE_MAX_MB", DEFAULT_IMAGE_CACHE_MAX_MB),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--max-image-cache-mb") args.maxImageCacheMb = readFlagNumber(arg, argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return {
    ...args,
    maxImageCacheMb: Math.max(0, args.maxImageCacheMb),
  };
}

function printUsage() {
  console.log(`Usage:
  npm run db:manage-cache -- [--dry-run] [--max-image-cache-mb N]

Environment:
  IMAGE_CACHE_MAX_MB  Soft warning budget for current card image cache. Default: ${DEFAULT_IMAGE_CACHE_MAX_MB}
`);
}

function readEnvNumber(key: string, fallback: number): number {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readFlagNumber(flag: string, raw: string | undefined): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) {
    throw new Error(`${flag} requires a number`);
  }
  return parsed;
}

async function loadExpectedImages(): Promise<ExpectedImages> {
  const config = resolveDatabaseConfig();
  const client = createDatabaseClient(config);
  try {
    const result = await client.execute(`
      SELECT image_url_jp AS imageUrlJp
      FROM cards
      WHERE image_url_jp IS NOT NULL AND image_url_jp != ''
    `);

    let invalidUrls = 0;
    const keys = new Set<string>();
    for (const row of result.rows) {
      try {
        keys.add(imageCacheKey(parseAllowedCardImageUrl(String(row.imageUrlJp))));
      } catch {
        invalidUrls += 1;
      }
    }

    return { keys, invalidUrls };
  } finally {
    client.close();
  }
}

async function scanImageCache(root: string): Promise<CacheFilePair[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const keys = new Set<string>();
  for (const name of names) {
    if (name.endsWith(".bin") || name.endsWith(".json")) {
      keys.add(path.basename(name, path.extname(name)));
    }
  }

  const entries = await Promise.all(
    [...keys].map(async (key): Promise<CacheFilePair> => {
      const bodyPath = path.join(root, `${key}.bin`);
      const metaPath = path.join(root, `${key}.json`);
      const [body, meta] = await Promise.all([statMaybe(bodyPath), statMaybe(metaPath)]);
      const entry: CacheFilePair = {
        key,
        bodyPath,
        metaPath,
        hasBody: Boolean(body),
        hasMeta: Boolean(meta),
        bodyBytes: body?.size ?? 0,
        metaBytes: meta?.size ?? 0,
      };

      if (!body) entry.invalidReason = "missing image body";
      else if (!meta) entry.invalidReason = "missing metadata";
      else await readCacheMetadata(entry);

      return entry;
    }),
  );

  return entries;
}

async function statMaybe(filePath: string) {
  try {
    return await stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readCacheMetadata(entry: CacheFilePair) {
  let meta: CachedImageMeta;
  try {
    meta = JSON.parse(await readFile(entry.metaPath, "utf-8")) as CachedImageMeta;
  } catch {
    entry.invalidReason = "invalid metadata";
    return;
  }

  entry.cachedAt = meta.cachedAt;
  entry.sourceUrl = meta.sourceUrl;

  try {
    const sourceKey = imageCacheKey(parseAllowedCardImageUrl(meta.sourceUrl));
    if (sourceKey !== entry.key) {
      entry.invalidReason = "metadata source/key mismatch";
    }
  } catch {
    entry.invalidReason = "metadata source URL is not allowed";
  }
}

async function removeEntry(entry: CacheFilePair, dryRun: boolean) {
  if (dryRun) return;
  await Promise.all([
    entry.hasBody ? rm(entry.bodyPath, { force: true }) : Promise.resolve(),
    entry.hasMeta ? rm(entry.metaPath, { force: true }) : Promise.resolve(),
  ]);
}

async function fileSize(filePath: string) {
  const file = await statMaybe(filePath);
  return file?.size ?? 0;
}

function bytes(entries: CacheFilePair[]) {
  return entries.reduce((sum, entry) => sum + entry.bodyBytes + entry.metaBytes, 0);
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function reportDatabaseFiles() {
  const config = resolveDatabaseConfig();
  console.log(`Cache target: ${config.label}`);

  if (config.kind !== "local") {
    console.log("Database file sizes: remote Turso target");
    return;
  }

  await mkdir(path.dirname(config.localPath), { recursive: true });
  const db = await fileSize(config.localPath);
  const wal = await fileSize(`${config.localPath}-wal`);
  const shm = await fileSize(`${config.localPath}-shm`);
  console.log(`Database files: db=${formatBytes(db)} wal=${formatBytes(wal)} shm=${formatBytes(shm)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const root = imageCacheRoot();
  const expected = await loadExpectedImages();
  const entries = await scanImageCache(root);

  const invalid = entries.filter((entry) => entry.invalidReason);
  const valid = entries.filter((entry) => !entry.invalidReason);
  const orphan = valid.filter((entry) => !expected.keys.has(entry.key));
  const referenced = valid.filter((entry) => expected.keys.has(entry.key));
  const deletable = [...invalid, ...orphan];
  const beforeBytes = bytes(entries);
  const deleteBytes = bytes(deletable);
  const afterBytes = beforeBytes - deleteBytes;
  const budgetBytes = args.maxImageCacheMb * 1024 * 1024;

  await reportDatabaseFiles();
  console.log(`Image cache dir: ${root}`);
  console.log(`Referenced image URLs in DB: ${expected.keys.size.toLocaleString()}`);
  if (expected.invalidUrls > 0) {
    console.log(`Invalid DB image URLs: ${expected.invalidUrls.toLocaleString()}`);
  }
  console.log(
    [
      `Image cache entries: total=${entries.length.toLocaleString()}`,
      `referenced=${referenced.length.toLocaleString()}`,
      `orphan=${orphan.length.toLocaleString()}`,
      `invalid=${invalid.length.toLocaleString()}`,
    ].join(" "),
  );
  console.log(`Image cache size: ${formatBytes(beforeBytes)} -> ${formatBytes(afterBytes)}`);
  console.log(`Dry run: ${args.dryRun ? "yes" : "no"}`);

  for (const entry of invalid.slice(0, 20)) {
    console.log(`  invalid ${entry.key} (${entry.invalidReason})`);
  }
  if (invalid.length > 20) {
    console.log(`  ...${(invalid.length - 20).toLocaleString()} more invalid entries`);
  }
  for (const entry of orphan.slice(0, 20)) {
    console.log(`  orphan  ${entry.key}${entry.sourceUrl ? ` (${entry.sourceUrl})` : ""}`);
  }
  if (orphan.length > 20) {
    console.log(`  ...${(orphan.length - 20).toLocaleString()} more orphan entries`);
  }

  await Promise.all(deletable.map((entry) => removeEntry(entry, args.dryRun)));

  if (budgetBytes > 0 && afterBytes > budgetBytes) {
    console.log(
      `Warning: referenced image cache is ${formatBytes(afterBytes)}, above IMAGE_CACHE_MAX_MB=${args.maxImageCacheMb}.`,
    );
    console.log("No current card image was deleted; lower growth by pruning stale DB card rows first.");
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Cache management complete: removed=${args.dryRun ? 0 : deletable.length.toLocaleString()} entries reclaimed=${args.dryRun ? "0 B" : formatBytes(deleteBytes)} elapsed=${elapsed}s`,
  );
}

main().catch((err) => {
  console.error("Cache management failed:", err);
  process.exit(1);
});
