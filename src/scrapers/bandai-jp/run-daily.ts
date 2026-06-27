/**
 * Daily local refresh for the Grand Line card database.
 *
 * This job is intentionally local-only. The production data source for this
 * workstation is the SSD-backed libSQL/SQLite file selected by
 * GRAND_LINE_DATABASE_MODE=local and LOCAL_DB_PATH.
 */
import "@/lib/load-env";

import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { resolveDatabaseConfig } from "@/db/config";

interface CliArgs {
  checkOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  return {
    checkOnly: argv.includes("--check") || argv.includes("--dry-run"),
  };
}

function run(
  label: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: { allowFailure?: boolean } = {},
): boolean {
  console.log("");
  console.log(`▶ ${label}`);
  console.log(`  ${command} ${args.join(" ")}`);

  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
  });

  if (result.status !== 0) {
    const message = `${label} failed with exit code ${result.status ?? "unknown"}`;
    if (options.allowFailure) {
      console.error(`✗ ${message}`);
      return false;
    }
    throw new Error(message);
  }

  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = resolveDatabaseConfig();

  if (config.kind !== "local") {
    throw new Error(
      "Daily scraping is local-only. Set GRAND_LINE_DATABASE_MODE=local and LOCAL_DB_PATH before running scrape:daily.",
    );
  }

  await mkdir(path.dirname(config.localPath), { recursive: true });

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GRAND_LINE_DATABASE_MODE: "local",
    LOCAL_DB_PATH: config.localPath,
    TURSO_DATABASE_URL: "",
    TURSO_AUTH_TOKEN: "",
  };

  const delayMs = process.env.DAILY_SCRAPE_DELAY_MS ?? "8000";
  const optimize = process.env.DAILY_SCRAPE_OPTIMIZE !== "false";
  const warmImages = process.env.DAILY_IMAGE_CACHE_WARM !== "false";
  const imageConcurrency = process.env.DAILY_IMAGE_CACHE_CONCURRENCY ?? "8";
  const failures: string[] = [];

  console.log(`▶ Daily scrape target: ${config.label}`);

  if (args.checkOnly) {
    run("Print database status", "npm", ["run", "db:status"], childEnv);
    run("Check Bandai set discovery", "npm", ["run", "scrape:discover", "--", "--dry-run"], childEnv);
    run("Check banned/restricted parsing", "npm", ["run", "scrape:regulations", "--", "--dry-run"], childEnv);
    console.log("");
    console.log("✓ Daily scrape check complete.");
    return;
  }

  run("Apply migrations", "npm", ["run", "db:migrate"], childEnv);
  run("Discover new Bandai sets", "npm", ["run", "scrape:discover", "--", "--no-scrape"], childEnv);
  if (!run(
    "Refresh all known card sets",
    "npm",
    ["run", "scrape:bandai-jp:all", "--", "--delay-ms", delayMs],
    childEnv,
    { allowFailure: true },
  )) {
    failures.push("card set refresh");
  }

  if (!run("Refresh banned/restricted cards", "npm", ["run", "scrape:regulations"], childEnv, { allowFailure: true })) {
    failures.push("banned/restricted refresh");
  }

  if (optimize) {
    if (!run("Prune practice storage", "npm", ["run", "db:optimize"], childEnv, { allowFailure: true })) {
      failures.push("practice storage prune");
    }
    if (!run("Optimize site data", "npm", ["run", "db:optimize:site"], childEnv, { allowFailure: true })) {
      failures.push("site data optimize");
    }
  }

  if (warmImages) {
    if (!run(
      "Warm card image cache",
      "npm",
      ["run", "db:warm-images", "--", "--concurrency", imageConcurrency],
      childEnv,
      { allowFailure: true },
    )) {
      failures.push("image cache warm");
    }
  }

  run("Print final database status", "npm", ["run", "db:status"], childEnv);

  if (failures.length > 0) {
    throw new Error(`Daily scrape finished with failed step(s): ${failures.join(", ")}`);
  }

  console.log("");
  console.log("✓ Daily scrape complete.");
}

main().catch((err) => {
  console.error("✗ Daily scrape failed:", err);
  process.exit(1);
});
