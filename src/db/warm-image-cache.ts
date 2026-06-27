/**
 * Warm the SSD-backed card image cache from `cards.image_url_jp`.
 *
 * This prevents card-list pages from issuing dozens of cold Bandai requests
 * while the user is scrolling. It is safe to rerun: cached images are skipped
 * unless `--force` is passed.
 */
import "@/lib/load-env";

import { createDatabaseClient, resolveDatabaseConfig } from "@/db/config";
import {
  fetchAndCacheCardImage,
  hasCachedCardImage,
  imageCacheRoot,
  parseAllowedCardImageUrl,
} from "@/lib/card-image-cache";

interface CliArgs {
  concurrency: number;
  force: boolean;
  limit: number;
  dryRun: boolean;
}

interface ImageRow {
  id: string;
  imageUrlJp: string;
}

interface WarmResult {
  id: string;
  status: "cached" | "downloaded" | "failed" | "invalid" | "dry-run";
  detail?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    concurrency: 8,
    force: false,
    limit: 0,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i] ?? 8));
    else if (arg === "--limit") args.limit = Math.max(0, Number(argv[++i] ?? 0));
    else if (arg === "--force") args.force = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run db:warm-images -- [--concurrency N] [--limit N] [--force] [--dry-run]");
      process.exit(0);
    }
  }

  return args;
}

async function loadImageRows(limit: number): Promise<ImageRow[]> {
  const config = resolveDatabaseConfig();
  const client = createDatabaseClient(config);
  try {
    console.log(`▶ Image cache target: ${config.label}`);
    console.log(`  cache dir: ${imageCacheRoot()}`);
    const result = await client.execute({
      sql: [
        "SELECT id, image_url_jp AS imageUrlJp",
        "FROM cards",
        "WHERE image_url_jp IS NOT NULL AND image_url_jp != ''",
        "ORDER BY set_code, id",
        limit > 0 ? "LIMIT ?" : "",
      ].filter(Boolean).join(" "),
      args: limit > 0 ? [limit] : [],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      imageUrlJp: String(row.imageUrlJp),
    }));
  } finally {
    client.close();
  }
}

async function warmOne(row: ImageRow, args: CliArgs): Promise<WarmResult> {
  let target: URL;
  try {
    target = parseAllowedCardImageUrl(row.imageUrlJp);
  } catch (err) {
    return { id: row.id, status: "invalid", detail: (err as Error).message };
  }

  if (!args.force && await hasCachedCardImage(target)) {
    return { id: row.id, status: "cached" };
  }

  if (args.dryRun) {
    return { id: row.id, status: "dry-run" };
  }

  try {
    const image = await fetchAndCacheCardImage(target);
    const detail = image.fetchedUrl === image.requestedUrl ? undefined : image.fetchedUrl;
    return { id: row.id, status: "downloaded", detail };
  } catch (err) {
    return { id: row.id, status: "failed", detail: (err as Error).message };
  }
}

async function runPool(rows: ImageRow[], args: CliArgs): Promise<WarmResult[]> {
  const results: WarmResult[] = [];
  let index = 0;
  let completed = 0;

  async function worker() {
    while (index < rows.length) {
      const row = rows[index++];
      const result = await warmOne(row, args);
      results.push(result);
      completed += 1;
      if (completed % 100 === 0 || completed === rows.length) {
        console.log(`  progress ${completed.toLocaleString()}/${rows.length.toLocaleString()}`);
      }
      if (result.status === "failed" || result.status === "invalid") {
        const detail = result.detail ? ` (${result.detail})` : "";
        console.log(`  ${result.status.padEnd(10)} ${result.id}${detail}`);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(args.concurrency, rows.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function count(results: WarmResult[], status: WarmResult["status"]) {
  return results.filter((result) => result.status === status).length;
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const rows = await loadImageRows(args.limit);

  console.log(`▶ Warming ${rows.length.toLocaleString()} card images`);
  console.log(`  concurrency=${args.concurrency} force=${args.force} dryRun=${args.dryRun}`);

  const results = await runPool(rows, args);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const failed = count(results, "failed") + count(results, "invalid");

  console.log("");
  console.log(
    [
      `cached=${count(results, "cached").toLocaleString()}`,
      `downloaded=${count(results, "downloaded").toLocaleString()}`,
      `failed=${count(results, "failed").toLocaleString()}`,
      `invalid=${count(results, "invalid").toLocaleString()}`,
      `dryRun=${count(results, "dry-run").toLocaleString()}`,
      `elapsed=${elapsed}s`,
    ].join(" "),
  );

  if (failed > 0) {
    throw new Error(`${failed} image(s) could not be cached.`);
  }

  console.log("✓ Image cache warm complete.");
}

main().catch((err) => {
  console.error("✗ image cache warm failed:", err);
  process.exit(1);
});
