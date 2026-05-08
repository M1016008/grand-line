/**
 * POST /api/admin/discover-sets
 *
 * Re-fetches the Bandai cardlist root, parses the `<select id="series">`
 * dropdown, and inserts any seriesIds we don't already know into
 * `scrape_targets` (status: 'discovered', last_scraped_at: null).
 *
 * Returns the diff so the UI can render a "new sets found: …" panel
 * with per-row "取り込む" buttons that hit POST /api/admin/scrape-set.
 *
 * No auth: this is a personal tool. If we ever ship it publicly, gate
 * with a session check before doing anything destructive.
 */

import { NextResponse } from "next/server";

import { db } from "@/db";
import { scrapeTargets } from "@/db/schema";
import { discover } from "@/scrapers/bandai-jp/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  // Read existing scrape_targets so the diff doesn't re-suggest already-
  // discovered (but possibly not-yet-scraped) sets.
  const existing = await db
    .select({ seriesId: scrapeTargets.seriesId })
    .from(scrapeTargets);
  const knownDb = new Set(existing.map((r) => r.seriesId));

  let report;
  try {
    report = await discover({ knownDbSeriesIds: knownDb });
  } catch (err) {
    return NextResponse.json(
      {
        error: "discover_failed",
        detail: (err as Error).message,
      },
      { status: 502 },
    );
  }

  // Persist any newly-resolved options. Conflict on set_code means the
  // user manually added it via SERIES_PARAM with the same code; skip.
  let inserted = 0;
  for (const opt of report.newOptions) {
    if (!opt.setCode) continue;
    const result = await db
      .insert(scrapeTargets)
      .values({
        setCode: opt.setCode,
        seriesId: opt.seriesId,
        nameJa: opt.label,
        source: "discovered",
        lastScrapedAt: null,
      })
      .onConflictDoNothing()
      .returning({ setCode: scrapeTargets.setCode });
    if (result.length > 0) inserted += 1;
  }

  return NextResponse.json({
    fetchedAt: report.fetchedAt.toISOString(),
    totalDropdownEntries: report.options.length,
    newSets: report.newOptions.map((o) => ({
      setCode: o.setCode,
      seriesId: o.seriesId,
      label: o.label,
    })),
    unresolved: report.unresolvedOptions.map((o) => ({
      seriesId: o.seriesId,
      label: o.label,
    })),
    inserted,
  });
}
