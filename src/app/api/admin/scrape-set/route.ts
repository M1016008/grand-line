/**
 * POST /api/admin/scrape-set { setCode: "OP16" }
 *
 * Fetches the Bandai cardlist for one set, parses, and upserts cards +
 * memberships. Updates `scrape_targets.last_scraped_at` if the set is
 * tracked there. Returns a summary on success.
 *
 * Hits the network — keep manual. The UI button asks for confirmation.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { scrapeTargets } from "@/db/schema";
import { fetchSetHtml } from "@/scrapers/bandai-jp/fetch";
import { parseSetHtml } from "@/scrapers/bandai-jp/parse";
import { upsertScrapedCards } from "@/scrapers/bandai-jp/upsert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  setCode: z.string().min(1).max(8),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", detail: (err as Error).message },
      { status: 400 },
    );
  }

  let fixture;
  try {
    fixture = await fetchSetHtml(body.setCode);
  } catch (err) {
    return NextResponse.json(
      { error: "fetch_failed", detail: (err as Error).message },
      { status: 404 },
    );
  }

  const cards = parseSetHtml(fixture, { lenient: true });
  if (cards.length === 0) {
    return NextResponse.json(
      { error: "no_cards_parsed", detail: "Bandai HTML had no .modalCol entries." },
      { status: 502 },
    );
  }

  const result = await upsertScrapedCards(cards, { scrapedSetCode: body.setCode });

  // Mark the scrape_target row as scraped, if any.
  await db
    .update(scrapeTargets)
    .set({ lastScrapedAt: new Date() })
    .where(eq(scrapeTargets.setCode, body.setCode));

  return NextResponse.json({
    setCode: body.setCode,
    parsed: cards.length,
    cardsUpserted: result.cardsUpserted,
    translationsUpserted: result.translationsUpserted,
    membershipsAdded: result.membershipsAdded,
  });
}
