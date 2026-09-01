/**
 * POST /api/ai/decks/[leaderId]
 *
 * Body: { selectedStyle: MainStyle, selectedTags: FeatureTag[] }
 * Returns: DeckSuggestion JSON
 *
 * Hits Claude (Opus, tool-use) and validates the output against the
 * deck-rules validator before returning. Retries up to twice on rule
 * violations (the suggestion lib injects the violation feedback into
 * the conversation so the next attempt can correct).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  proposeDeck,
  DeckSuggestionError,
  isVerifiedOfficialDeckFact,
} from "@/ai/deck-suggestion";
import { MissingApiKeyError } from "@/ai/client";
import { getCard, listCards } from "@/lib/cards";
import {
  FEATURE_TAG_IDS,
  MAIN_STYLE_IDS,
  MAX_FEATURE_TAGS,
} from "@/lib/deck-intelligence-preferences";
import {
  activeRegulations,
  DeckRegulationsUnavailableError,
} from "@/lib/saved-decks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  selectedStyle: z.enum(MAIN_STYLE_IDS).default("auto"),
  selectedTags: z
    .array(z.enum(FEATURE_TAG_IDS))
    .max(MAX_FEATURE_TAGS)
    .refine((tags) => new Set(tags).size === tags.length, {
      message: "selectedTags cannot contain duplicates.",
    })
    .default([]),
}).strict();

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
  if (!isVerifiedOfficialDeckFact(leader)) {
    return NextResponse.json(
      {
        error: "unverified_leader",
        detail: `${leaderId} does not have verified official facts.`,
      },
      { status: 409 },
    );
  }

  let pool: Awaited<ReturnType<typeof listCards>>;
  let regulations: Awaited<ReturnType<typeof activeRegulations>>;
  try {
    // Pull a generous verified pool. buildCandidatePool applies the selected
    // style/tag ranking before its deterministic prompt-size cap.
    [pool, regulations] = await Promise.all([
      listCards({}, 5000),
      activeRegulations(),
    ]);
  } catch (err) {
    if (err instanceof DeckRegulationsUnavailableError) {
      return NextResponse.json(
        {
          error: "restrictions_unavailable",
          detail: "Active restrictions could not be loaded; proposal stopped.",
        },
        { status: 503 },
      );
    }
    throw err;
  }

  try {
    const suggestion = await proposeDeck({
      leader,
      pool: pool.cards,
      selectedStyle: body.selectedStyle,
      selectedTags: body.selectedTags,
      regulations,
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
