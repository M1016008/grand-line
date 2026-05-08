/**
 * POST /api/ai/decks/[leaderId]
 *
 * Body: { preference?: string }
 * Returns: DeckSuggestion JSON
 *
 * Hits Claude (Opus, tool-use) and validates the output against the
 * deck-rules validator before returning. Retries up to twice on rule
 * violations (the suggestion lib injects the violation feedback into
 * the conversation so the next attempt can correct).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { proposeDeck, DeckSuggestionError } from "@/ai/deck-suggestion";
import { MissingApiKeyError } from "@/ai/client";
import { getCard, listCards } from "@/lib/cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  preference: z.string().max(200).optional(),
});

interface RouteContext {
  params: Promise<{ leaderId: string }>;
}

export async function POST(req: Request, { params }: RouteContext) {
  const { leaderId } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await req.json().catch(() => ({}));
    body = bodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", detail: (err as Error).message },
      { status: 400 },
    );
  }

  const leader = await getCard(leaderId);
  if (!leader || leader.cardType !== "LEADER") {
    return NextResponse.json(
      { error: "not_a_leader", detail: `${leaderId} is not a leader card.` },
      { status: 404 },
    );
  }

  // Pull a generous pool — buildCandidatePool will compress further.
  const pool = await listCards({}, 5000);

  try {
    const suggestion = await proposeDeck({
      leader,
      pool: pool.cards,
      preference: body.preference,
    });
    return NextResponse.json(suggestion);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json(
        {
          error: "missing_api_key",
          detail:
            "ANTHROPIC_API_KEY is not configured. Add it to .env.local and restart the dev server.",
        },
        { status: 503 },
      );
    }
    if (err instanceof DeckSuggestionError) {
      return NextResponse.json(
        {
          error: "deck_suggestion_failed",
          detail: err.message,
          attempts: err.attempts,
          violations: err.violations,
        },
        { status: 422 },
      );
    }
    console.error("[/api/ai/decks] unexpected error:", err);
    return NextResponse.json(
      { error: "internal_error", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
