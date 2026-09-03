import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { practiceRuns } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(requested)
    ? Math.min(100, Math.max(1, Math.floor(requested)))
    : 20;
  try {
    const rows = await db.select({
      id: practiceRuns.id,
      mode: practiceRuns.mode,
      cpuSkill: practiceRuns.cpuSkill,
      rulesVersion: practiceRuns.rulesVersion,
      playerLeaderId: practiceRuns.playerLeaderId,
      opponentLeaderId: practiceRuns.opponentLeaderId,
      gameCount: practiceRuns.gameCount,
      summaryMetrics: practiceRuns.summaryMetrics,
      createdAt: practiceRuns.createdAt,
    }).from(practiceRuns).orderBy(desc(practiceRuns.createdAt)).limit(limit);
    return NextResponse.json({
      runs: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
      })),
    });
  } catch (err) {
    if (/no such table: practice_/i.test(err instanceof Error ? err.message : String(err))) {
      return NextResponse.json({ runs: [], needsMigration: true });
    }
    throw err;
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error: "legacy_replay_ingest_disabled",
      detail: "Practice runs are now persisted server-side.",
    },
    { status: 410 },
  );
}
