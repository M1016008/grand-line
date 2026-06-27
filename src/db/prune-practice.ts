/**
 * Prune heavy practice replay storage while keeping compact game summaries.
 *
 * Defaults:
 *   - Drop full event streams older than 14 days.
 *   - Drop whole practice runs older than 90 days, while keeping the latest 50.
 *
 * Usage:
 *   npm run db:prune:practice
 *   npm run db:prune:practice -- --dry-run
 *   npm run db:prune:practice -- --event-days 7 --run-days 60 --keep-runs 25
 *   npm run db:prune:practice -- --vacuum
 */
import "@/lib/load-env";

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";

import { resolveDatabaseConfig } from "@/db/config";

interface CliArgs {
  dryRun: boolean;
  eventDays: number;
  runDays: number;
  keepRuns: number;
  vacuum: boolean;
}

const DEFAULT_EVENT_DAYS = 14;
const DEFAULT_RUN_DAYS = 90;
const DEFAULT_KEEP_RUNS = 50;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    eventDays: readEnvInt("PRACTICE_EVENT_RETENTION_DAYS", DEFAULT_EVENT_DAYS),
    runDays: readEnvInt("PRACTICE_RUN_RETENTION_DAYS", DEFAULT_RUN_DAYS),
    keepRuns: readEnvInt("PRACTICE_KEEP_RECENT_RUNS", DEFAULT_KEEP_RUNS),
    vacuum: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--vacuum") args.vacuum = true;
    else if (arg === "--event-days") args.eventDays = readFlagInt(arg, argv[++i]);
    else if (arg === "--run-days") args.runDays = readFlagInt(arg, argv[++i]);
    else if (arg === "--keep-runs") args.keepRuns = readFlagInt(arg, argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return {
    ...args,
    eventDays: Math.max(0, args.eventDays),
    runDays: Math.max(0, args.runDays),
    keepRuns: Math.max(0, args.keepRuns),
  };
}

function readEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function readFlagInt(flag: string, raw: string | undefined): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) {
    throw new Error(`${flag} requires an integer value`);
  }
  return Math.floor(parsed);
}

function printUsage() {
  console.log(`Usage:
  npm run db:prune:practice -- [--dry-run] [--event-days N] [--run-days N] [--keep-runs N] [--vacuum]
`);
}

async function buildClient(): Promise<{ client: Client; target: string }> {
  const config = resolveDatabaseConfig();

  if (config.kind === "turso") {
    return {
      client: createClient(
        config.authToken
          ? { url: config.url, authToken: config.authToken }
          : { url: config.url },
      ),
      target: config.label,
    };
  }

  await mkdir(path.dirname(config.localPath), { recursive: true });
  return {
    client: createClient({ url: config.url }),
    target: config.label,
  };
}

async function scalar(client: Client, sql: string, args: Array<string | number> = []) {
  const result = await client.execute({ sql, args });
  return Number(result.rows[0]?.n ?? 0);
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = ?",
    args: [tableName],
  });
  return Number(result.rows[0]?.n ?? 0) > 0;
}

function cutoffSeconds(days: number): number {
  return Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
}

function oldRunWhereSql(): string {
  return `
    created_at < ?
    AND id NOT IN (
      SELECT id FROM practice_runs
      ORDER BY created_at DESC
      LIMIT ?
    )
  `;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { client, target } = await buildClient();

  try {
    console.log(`▶ Practice prune target: ${target}`);
    console.log(
      `  eventDays=${args.eventDays} runDays=${args.runDays} keepRuns=${args.keepRuns} dryRun=${args.dryRun} vacuum=${args.vacuum}`,
    );

    const hasPracticeTables =
      (await tableExists(client, "practice_runs")) &&
      (await tableExists(client, "practice_games")) &&
      (await tableExists(client, "practice_events"));

    if (!hasPracticeTables) {
      console.log("✓ Practice tables are not installed yet; nothing to prune.");
      return;
    }

    await client.execute("PRAGMA foreign_keys = ON");

    const eventCutoff = cutoffSeconds(args.eventDays);
    const runCutoff = cutoffSeconds(args.runDays);
    const oldRunWhere = oldRunWhereSql();

    const eventRows = await scalar(
      client,
      `
        SELECT COUNT(*) AS n
        FROM practice_events
        WHERE game_id IN (
          SELECT g.id
          FROM practice_games g
          INNER JOIN practice_runs r ON r.id = g.run_id
          WHERE r.created_at < ?
        )
      `,
      [eventCutoff],
    );
    const gamesInExpiredRuns = await scalar(
      client,
      `
        SELECT COUNT(*) AS n
        FROM practice_games
        WHERE run_id IN (SELECT id FROM practice_runs WHERE ${oldRunWhere})
      `,
      [runCutoff, args.keepRuns],
    );
    const expiredRuns = await scalar(
      client,
      `SELECT COUNT(*) AS n FROM practice_runs WHERE ${oldRunWhere}`,
      [runCutoff, args.keepRuns],
    );

    console.log(`  event rows to delete:       ${eventRows.toLocaleString()}`);
    console.log(`  expired games to delete:    ${gamesInExpiredRuns.toLocaleString()}`);
    console.log(`  expired runs to delete:     ${expiredRuns.toLocaleString()}`);

    if (args.dryRun) {
      console.log("✓ Dry run complete; no rows were deleted.");
      return;
    }

    await client.execute({
      sql: `
        DELETE FROM practice_events
        WHERE game_id IN (
          SELECT g.id
          FROM practice_games g
          INNER JOIN practice_runs r ON r.id = g.run_id
          WHERE r.created_at < ?
        )
      `,
      args: [eventCutoff],
    });
    await client.execute({
      sql: `
        DELETE FROM practice_events
        WHERE game_id IN (
          SELECT id
          FROM practice_games
          WHERE run_id IN (SELECT id FROM practice_runs WHERE ${oldRunWhere})
        )
      `,
      args: [runCutoff, args.keepRuns],
    });
    await client.execute({
      sql: `
        DELETE FROM practice_games
        WHERE run_id IN (SELECT id FROM practice_runs WHERE ${oldRunWhere})
      `,
      args: [runCutoff, args.keepRuns],
    });
    await client.execute({
      sql: `DELETE FROM practice_runs WHERE ${oldRunWhere}`,
      args: [runCutoff, args.keepRuns],
    });

    if (args.vacuum) {
      console.log("▶ Running VACUUM to compact free pages...");
      await client.execute("VACUUM");
    }

    console.log("✓ Practice prune complete.");
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("✗ Practice prune failed:", err);
  process.exit(1);
});
