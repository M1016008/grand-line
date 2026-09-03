import { NextResponse } from "next/server";
import { z } from "zod";

import {
  BenchmarkOpponentResolutionError,
  resolveBenchmarkOpponent,
} from "@/lib/benchmark-opponent";
import { listCards } from "@/lib/cards";
import {
  BENCHMARK_SERVER_MAX_TURNS,
  BenchmarkDeckValidationError,
} from "@/lib/deck-battle-benchmark";
import { DeckCopyResolutionError } from "@/lib/deck-intelligence-compare";
import {
  FEATURE_TAG_IDS,
  MAIN_STYLE_IDS,
  MAX_FEATURE_TAGS,
  VARIANT_PROFILE_IDS,
} from "@/lib/deck-intelligence-preferences";
import {
  OPTIMIZER_MAX_CANDIDATE_LIMIT,
  runDeckOptimizer,
  DeckOptimizerError,
} from "@/lib/deck-optimizer";
import { CPU_LEVEL_VALUES } from "@/lib/practice-log";
import {
  activeRegulations,
  DeckRegulationsUnavailableError,
  getSavedDeck,
} from "@/lib/saved-decks";
import { readAiSynergiesForLeader } from "@/lib/synergy-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deckCardsSchema = z.array(
  z.object({
    cardId: z.string().min(1),
    count: z.number().int().positive(),
  }).strict(),
);

const opponentDescriptorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("saved"),
    id: z.string().min(1),
    name: z.string().min(1),
    leaderId: z.string().min(1),
    synthetic: z.literal(false),
  }).strict(),
  z.object({
    kind: z.literal("synthetic"),
    id: z.string().min(1),
    name: z.string().min(1),
    leaderId: z.string().min(1),
    synthetic: z.literal(true),
  }).strict(),
]);

const bodySchema = z.object({
  leaderId: z.string().min(1),
  variantProfile: z.enum(VARIANT_PROFILE_IDS),
  targetCards: deckCardsSchema,
  selectedStyle: z.enum(MAIN_STYLE_IDS),
  selectedTags: z
    .array(z.enum(FEATURE_TAG_IDS))
    .max(MAX_FEATURE_TAGS)
    .refine((tags) => new Set(tags).size === tags.length, {
      message: "selectedTags cannot contain duplicates.",
    }),
  opponent: opponentDescriptorSchema,
  baseSeed: z.number().int(),
  seedStep: z.number().int().positive(),
  cpuSkill: z.enum(CPU_LEVEL_VALUES),
  maxTurns: z.number().int().min(1).max(BENCHMARK_SERVER_MAX_TURNS),
  optimizerGames: z.union([z.literal(100), z.literal(300), z.literal(500)]),
  candidateLimit: z.number().int().min(1).max(OPTIMIZER_MAX_CANDIDATE_LIMIT),
}).strict();

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
    const [poolResult, regulations, savedOpponent, persistedSynergies] =
      await Promise.all([
        listCards({ pageSize: 5_000, includeOfficialText: true }),
        activeRegulations(),
        body.opponent.kind === "saved"
          ? getSavedDeck(body.opponent.id)
          : Promise.resolve(null),
        readAiSynergiesForLeader(body.leaderId),
      ]);
    const poolById = new Map(
      poolResult.cards.map((card) => [card.id, card]),
    );
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
    const opponent = resolveBenchmarkOpponent({
      requested:
        body.opponent.kind === "saved"
          ? { kind: "saved", deckId: body.opponent.id }
          : { kind: "synthetic", leaderId: body.opponent.leaderId },
      savedOpponent,
      poolById,
      pool: poolResult.cards,
      regulations,
    });

    const startedAt = Date.now();
    const optimizer = runDeckOptimizer({
      leader,
      targetCards: body.targetCards,
      variantProfile: body.variantProfile,
      selectedStyle: body.selectedStyle,
      selectedTags: body.selectedTags,
      pool: poolResult.cards,
      regulations,
      persistedSynergies,
      opponentDeck: opponent.deck,
      opponent: opponent.descriptor,
      baseSeed: body.baseSeed,
      seedStep: body.seedStep,
      cpuSkill: body.cpuSkill,
      maxTurns: body.maxTurns,
      optimizerGames: body.optimizerGames,
      candidateLimit: body.candidateLimit,
    });
    return NextResponse.json({
      optimizer,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof DeckRegulationsUnavailableError) {
      return NextResponse.json(
        { error: "restrictions_unavailable", detail: error.message },
        { status: 503 },
      );
    }
    if (error instanceof BenchmarkOpponentResolutionError) {
      return NextResponse.json(
        { error: error.code, detail: error.message },
        { status: 404 },
      );
    }
    if (
      error instanceof DeckCopyResolutionError ||
      error instanceof BenchmarkDeckValidationError ||
      error instanceof DeckOptimizerError
    ) {
      return NextResponse.json(
        {
          error:
            error instanceof DeckOptimizerError
              ? error.code
              : "optimizer_deck_invalid",
          detail: error.message,
        },
        { status: 422 },
      );
    }
    console.error("[/api/practice/optimizer] failed:", error);
    return NextResponse.json(
      { error: "optimizer_failed", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
