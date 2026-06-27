/**
 * POST /api/ai/playstyle/[cardId]
 *
 * Generates and persists the "このカードの使い方" guide for one card.
 * The response mirrors `CardPlaystyle`, so the card detail panel can update
 * immediately without a full reload.
 */

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { analyzePlaystyle } from "@/ai/playstyle";
import { MissingApiKeyError } from "@/ai/client";
import { db, schema } from "@/db";
import { getCard } from "@/lib/cards";
import type { CardPlaystyle } from "@/lib/playstyle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ cardId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  const { cardId } = await params;
  const card = await getCard(cardId);

  if (!card) {
    return NextResponse.json(
      { error: "card_not_found", detail: `${cardId} was not found.` },
      { status: 404 },
    );
  }

  try {
    const result = await analyzePlaystyle(card);
    const generatedAt = new Date();
    const playstyle: CardPlaystyle = {
      cardId: card.id,
      whenToPlayJa: result.record.when_to_play_ja,
      shinesInJa: result.record.shines_in_ja,
      vsOpponentJa: result.record.vs_opponent_ja,
      aiModelVersion: result.modelVersion,
      generatedAt: generatedAt.toISOString(),
    };

    await db
      .insert(schema.cardPlaystyles)
      .values({
        cardId: playstyle.cardId,
        whenToPlayJa: playstyle.whenToPlayJa,
        shinesInJa: playstyle.shinesInJa,
        vsOpponentJa: playstyle.vsOpponentJa,
        aiModelVersion: playstyle.aiModelVersion,
        generatedAt,
      })
      .onConflictDoUpdate({
        target: schema.cardPlaystyles.cardId,
        set: {
          whenToPlayJa: playstyle.whenToPlayJa,
          shinesInJa: playstyle.shinesInJa,
          vsOpponentJa: playstyle.vsOpponentJa,
          aiModelVersion: playstyle.aiModelVersion,
          generatedAt,
        },
      });

    revalidatePath(`/cards/${card.id}`);

    return NextResponse.json({ playstyle });
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

    console.error("[/api/ai/playstyle] failed:", err);
    return NextResponse.json(
      { error: "playstyle_generation_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
