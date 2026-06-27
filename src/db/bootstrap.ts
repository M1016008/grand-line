/**
 * One-shot bootstrap: take a freshly-migrated empty DB to a fully
 * seeded state using only locally-cached fixtures (no live Bandai
 * requests). Idempotent — safe to re-run.
 *
 *   npm run db:bootstrap
 *
 * Steps:
 *   1. Apply every drizzle migration that hasn't run yet.
 *   2. Re-scrape every set in `data/raw/bandai-jp/*.html` using the
 *      `--from-fixture` mode — this populates cards, translations,
 *      memberships, and seeds card_sets.
 *   3. Re-scrape regulations from `data/raw/bandai-jp/regulations.html`.
 *
 * Prereqs:
 *   - The 54 set HTML files must already exist under data/raw/bandai-jp/
 *     (they are produced by `npm run scrape:bandai-jp:all`).
 *   - The regulation fixture must exist (produced by
 *     `npm run scrape:regulations`).
 *
 * Designed for the Turso swap: point .env.local at the new Turso DB,
 * run this script, get an identical seeded DB without re-fetching from
 * Bandai.
 */
import "@/lib/load-env";

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveDatabaseConfig } from "@/db/config";

const FIXTURE_DIR = path.resolve("data/raw/bandai-jp");

function run(cmd: string, args: string[]): void {
  console.log(`▶ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with code ${result.status}`);
  }
}

async function main() {
  const config = resolveDatabaseConfig();
  console.log(`▶ Bootstrap target: ${config.label}`);
  console.log("");

  // 1. Migrations
  run("npx", ["tsx", "src/db/migrate.ts"]);

  // 2. Discover available set fixtures.
  if (!existsSync(FIXTURE_DIR)) {
    throw new Error(
      `Fixture directory missing: ${FIXTURE_DIR}\nRun \`npm run scrape:bandai-jp:all\` once against any DB to populate fixtures.`,
    );
  }
  const setFixtures = readdirSync(FIXTURE_DIR)
    .filter(
      (f) =>
        f.endsWith(".html") &&
        !f.startsWith("regulations") &&
        f !== "cardlist-root.html",
    )
    .map((f) => f.replace(/\.html$/, ""))
    .sort();
  if (setFixtures.length === 0) {
    throw new Error(
      `No set fixtures found in ${FIXTURE_DIR}. Run scrape:bandai-jp:all first.`,
    );
  }
  console.log(`▶ Replaying ${setFixtures.length} set fixtures…`);

  // Use the existing run-all CLI in fixture mode — single subprocess to
  // amortise the libsql connection cost.
  run("npx", [
    "tsx",
    "src/scrapers/bandai-jp/run-all.ts",
    "--from-fixture",
    "--only",
    setFixtures.join(","),
  ]);

  // 3. Regulations
  const regFixture = path.join(FIXTURE_DIR, "regulations.html");
  if (existsSync(regFixture)) {
    run("npx", ["tsx", "src/scrapers/bandai-jp/run-regulations.ts", "--from-fixture"]);
  } else {
    console.log(
      "⚠ regulations.html fixture missing — skipping ban list seed. Run `npm run scrape:regulations` once to populate it.",
    );
  }

  console.log("");
  console.log("✓ Bootstrap complete.");
  console.log("  Run `npm run db:status` to verify the row counts.");
}

main().catch((err) => {
  console.error("✗ Bootstrap failed:", err);
  process.exit(1);
});
