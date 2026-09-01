import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { MissingApiKeyError } from "@/ai/client";
import { DeckCoachValidationError } from "@/ai/deck-coach";
import {
  DeckCoachDeckNotFoundError,
  DeckCoachIllegalDeckError,
  DeckCoachUnknownCardError,
  DeckCoachUnverifiedFactsError,
  generateAndStoreDeckCoachGuide,
} from "@/lib/deck-coach";
import { DeckRegulationsUnavailableError } from "@/lib/saved-decks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ deckId: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { deckId } = await params;

  try {
    const guide = await generateAndStoreDeckCoachGuide(deckId, "easy");
    revalidatePath(`/decks/${deckId}`);
    return NextResponse.json({ guide });
  } catch (error) {
    if (error instanceof DeckCoachDeckNotFoundError) {
      return NextResponse.json(
        { error: "deck_not_found", detail: error.message },
        { status: 404 },
      );
    }
    if (error instanceof DeckCoachIllegalDeckError) {
      return NextResponse.json(
        {
          error: "illegal_deck",
          detail: error.message,
          violations: error.violations,
        },
        { status: 422 },
      );
    }
    if (error instanceof DeckRegulationsUnavailableError) {
      return NextResponse.json(
        {
          error: "restrictions_unavailable",
          detail:
            "制限情報を取得できないため、Deck Coachの生成を停止しました。",
        },
        { status: 503 },
      );
    }
    if (error instanceof DeckCoachUnknownCardError) {
      return NextResponse.json(
        { error: "unknown_card_id", detail: error.message },
        { status: 422 },
      );
    }
    if (error instanceof DeckCoachUnverifiedFactsError) {
      return NextResponse.json(
        { error: "unverified_card_facts", detail: error.message },
        { status: 409 },
      );
    }
    if (error instanceof MissingApiKeyError) {
      return NextResponse.json(
        {
          error: "missing_api_key",
          detail:
            "ANTHROPIC_API_KEY is not configured. Add it to .env.local and restart the dev server.",
        },
        { status: 503 },
      );
    }
    if (error instanceof DeckCoachValidationError) {
      return NextResponse.json(
        { error: "deck_coach_validation_failed", detail: error.message },
        { status: 422 },
      );
    }

    console.error("[/api/ai/deck-coach] failed:", error);
    return NextResponse.json(
      {
        error: "deck_coach_generation_failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
