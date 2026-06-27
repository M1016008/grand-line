import { NextResponse } from "next/server";
import { z } from "zod";

import { listCards } from "@/lib/cards";
import type { CardListItem } from "@/lib/cards";
import { normalizeCpuSkill, type CpuSkill } from "@/lib/practice-log";
import type { PracticeDeck } from "@/lib/practice-sim";
import { trainPracticeDeck } from "@/lib/practice-training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TRAINING_GAMES = 2_000;
const MAX_CANDIDATE_GAMES = 500;
const MAX_CANDIDATES = 60;
const MAX_CANDIDATE_BUDGET = 5_000;

const cpuSkillSchema = z.string().transform((value, ctx): CpuSkill => {
  const normalized = normalizeCpuSkill(value);
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid CPU level",
    });
    return "level1";
  }
  return normalized;
});

const cardSchema = z.object({
  id: z.string(),
  setCode: z.string(),
  cardType: z.string(),
  name: z.string(),
  colors: z.array(z.string()),
  features: z.array(z.string()),
  attributes: z.array(z.string()),
  cost: z.number().nullable(),
  power: z.number().nullable(),
  counter: z.number().nullable(),
  life: z.number().nullable(),
  rarity: z.string().nullable(),
  hasTrigger: z.boolean(),
  imageUrlJp: z.string().nullable(),
  mechanics: z.array(z.string()),
  source: z.enum(["official_jp", "official_en", "ai_translated", "manual"]),
  verified: z.boolean(),
}) satisfies z.ZodType<CardListItem>;

const practiceDeckSchema = z.object({
  id: z.string(),
  name: z.string(),
  leader: cardSchema,
  entries: z.array(
    z.object({
      card: cardSchema,
      count: z.number().int().positive(),
    }),
  ),
  source: z.enum(["draft", "generated"]),
  totalCards: z.number().int().positive(),
}) satisfies z.ZodType<PracticeDeck>;

const bodySchema = z.object({
  targetDeck: practiceDeckSchema,
  opponentDeck: practiceDeckSchema,
  games: z.number().int().min(1).max(MAX_TRAINING_GAMES),
  candidateGames: z.number().int().min(1).max(MAX_CANDIDATE_GAMES).optional(),
  seed: z.number().int(),
  cpuSkill: cpuSkillSchema,
  focusCardIds: z.array(z.string()).max(12).optional(),
  candidateLimit: z.number().int().min(1).max(MAX_CANDIDATES).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", detail: (err as Error).message },
      { status: 400 },
    );
  }

  try {
    const pool = await listCards({ pageSize: 5_000 });
    const candidateGames =
      body.candidateGames ??
      Math.max(20, Math.min(120, Math.floor(body.games / 2)));
    const requestedCandidateLimit = body.candidateLimit ?? 18;
    const candidateLimit = Math.min(
      requestedCandidateLimit,
      Math.max(1, Math.floor(MAX_CANDIDATE_BUDGET / candidateGames)),
    );
    const startedAt = Date.now();
    const result = trainPracticeDeck({
      targetDeck: body.targetDeck,
      opponentDeck: body.opponentDeck,
      pool: pool.cards,
      games: body.games,
      candidateGames,
      seed: body.seed,
      cpuSkill: body.cpuSkill,
      focusCardIds: body.focusCardIds,
      candidateLimit,
    });

    return NextResponse.json({
      training: result,
      elapsedMs: Date.now() - startedAt,
      usingMock: pool.usingMock,
    });
  } catch (err) {
    console.error("[/api/practice/train] failed:", err);
    return NextResponse.json(
      { error: "training_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
