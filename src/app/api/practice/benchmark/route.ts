import { NextResponse } from "next/server";
import { z } from "zod";

import { listCards } from "@/lib/cards";
import {
  BenchmarkOpponentResolutionError,
  resolveBenchmarkOpponent,
} from "@/lib/benchmark-opponent";
import {
  BENCHMARK_SERVER_MAX_GAMES,
  BenchmarkDeckValidationError,
  strictDeckIntelligencePracticeDeck,
} from "@/lib/deck-battle-benchmark";
import { runRulesDeckBenchmark } from "@/lib/deck-rules-benchmark";
import { DeckCopyResolutionError } from "@/lib/deck-intelligence-compare";
import {
  VARIANT_PROFILE_IDS,
  VARIANT_PROFILE_LABELS,
} from "@/lib/deck-intelligence-preferences";
import { CPU_LEVEL_VALUES } from "@/lib/practice-log";
import {
  activeRegulations,
  DeckRegulationsUnavailableError,
  getSavedDeck,
} from "@/lib/saved-decks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deckCardsSchema = z.array(
  z.object({
    cardId: z.string().min(1),
    count: z.number().int().positive(),
  }),
);

const opponentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), deckId: z.string().min(1) }),
  z.object({ kind: z.literal("synthetic"), leaderId: z.string().min(1) }),
]);

const bodySchema = z
  .object({
    leaderId: z.string().min(1),
    variants: z
      .array(
        z.object({
          variantProfile: z.enum(VARIANT_PROFILE_IDS),
          cards: deckCardsSchema,
        }),
      )
      .length(3),
    opponent: opponentSchema,
    games: z.number().int().min(1).max(BENCHMARK_SERVER_MAX_GAMES),
    cpuSkill: z.enum(CPU_LEVEL_VALUES),
  })
  .strict()
  .refine(
    (body) =>
      VARIANT_PROFILE_IDS.every(
        (profile) =>
          body.variants.filter(
            (variant) => variant.variantProfile === profile,
          ).length === 1,
      ),
    { message: "Exactly one of each Deck Intelligence variant is required." },
  );

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: "invalid_request", detail: (error as Error).message },
      { status: 400 },
    );
  }

  try {
    const [pool, regulations, savedOpponent] = await Promise.all([
      listCards({ pageSize: 5_000, includeOfficialText: true }),
      activeRegulations(),
      body.opponent.kind === "saved"
        ? getSavedDeck(body.opponent.deckId)
        : Promise.resolve(null),
    ]);
    const poolById = new Map(pool.cards.map((card) => [card.id, card]));
    const leader = poolById.get(body.leaderId);
    if (!leader || leader.cardType !== "LEADER") {
      return NextResponse.json(
        {
          error: "leader_not_found",
          detail: `${body.leaderId} is not an available leader.`,
        },
        { status: 404 },
      );
    }

    const variants = body.variants.map((variant) => ({
      variantProfile: variant.variantProfile,
      deck: strictDeckIntelligencePracticeDeck({
        id: `deck-intelligence:${leader.id}:${variant.variantProfile}`,
        name: `${leader.name} — ${VARIANT_PROFILE_LABELS[variant.variantProfile]}`,
        leader,
        cards: variant.cards,
        poolById,
        regulations,
      }),
    }));
    const opponent = resolveBenchmarkOpponent({
      requested: body.opponent,
      savedOpponent,
      poolById,
      pool: pool.cards,
      regulations,
    });
    const startedAt = Date.now();
    const benchmark = runRulesDeckBenchmark({
      variants,
      opponentDeck: opponent.deck,
      opponent: opponent.descriptor,
      cards: pool.cards,
      games: body.games,
      cpuSkill: body.cpuSkill,
    });
    return NextResponse.json({
      benchmark,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof BenchmarkOpponentResolutionError) {
      return NextResponse.json(
        { error: error.code, detail: error.message },
        { status: 404 },
      );
    }
    if (error instanceof DeckRegulationsUnavailableError) {
      return NextResponse.json(
        { error: "restrictions_unavailable", detail: error.message },
        { status: 503 },
      );
    }
    if (
      error instanceof DeckCopyResolutionError ||
      error instanceof BenchmarkDeckValidationError
    ) {
      return NextResponse.json(
        {
          error: "benchmark_deck_invalid",
          detail: error.message,
          violations:
            error instanceof BenchmarkDeckValidationError
              ? error.violations
              : [],
        },
        { status: 422 },
      );
    }
    console.error("[/api/practice/benchmark] failed:", error);
    return NextResponse.json(
      { error: "benchmark_failed", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
