import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { MissingApiKeyError } from "@/ai/client";
import { CardCoachValidationError } from "@/ai/card-coach";
import {
  CardCoachCardNotFoundError,
  CardCoachUnverifiedFactsError,
  generateAndStoreCardCoachGuide,
} from "@/lib/card-coach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ cardId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  const { cardId } = await params;

  try {
    const guide = await generateAndStoreCardCoachGuide(cardId, "easy");
    revalidatePath(`/cards/${cardId}`);
    return NextResponse.json({ guide });
  } catch (err) {
    if (err instanceof CardCoachCardNotFoundError) {
      return NextResponse.json(
        { error: "card_not_found", detail: err.message },
        { status: 404 },
      );
    }

    if (err instanceof CardCoachUnverifiedFactsError) {
      return NextResponse.json(
        { error: "unverified_card_facts", detail: err.message },
        { status: 409 },
      );
    }

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

    if (err instanceof CardCoachValidationError) {
      return NextResponse.json(
        { error: "card_coach_validation_failed", detail: err.message },
        { status: 422 },
      );
    }

    console.error("[/api/ai/card-coach] failed:", err);
    return NextResponse.json(
      { error: "card_coach_generation_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
