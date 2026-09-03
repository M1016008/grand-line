import { NextResponse } from "next/server";
import { z } from "zod";

import { listCards } from "@/lib/cards";
import { activeRegulations } from "@/lib/saved-decks";
import { resolveRulesPracticeOpponentDeck, resolveRulesPracticePlayerDeck } from "@/lib/practice-rules-deck";
import { rulesPracticeCpuSkillSchema, rulesPracticeDeckRequestSchema, rulesPracticeOpponentRequestSchema } from "@/lib/practice-rules-request";
import { runRulesPracticeMatch } from "@/lib/practice-rules";
import { saveRulesPracticeRun } from "@/lib/practice-rules-storage";
import { resolvePracticeStoragePolicy } from "@/lib/practice-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  player: rulesPracticeDeckRequestSchema,
  opponent: rulesPracticeOpponentRequestSchema,
  seed: z.number().int(),
  cpuSkill: rulesPracticeCpuSkillSchema,
  firstPlayer: z.enum(["player", "opponent"]).optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
}).strict();

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", detail: parsed.error.message }, { status: 400 });
  }
  try {
    const [{ cards }, regulations] = await Promise.all([
      listCards({ pageSize: 5_000, includeOfficialText: true }),
      activeRegulations(),
    ]);
    const playerDeck = resolveRulesPracticePlayerDeck({ request: parsed.data.player, pool: cards, regulations });
    const opponentDeck = resolveRulesPracticeOpponentDeck({ leaderId: parsed.data.opponent.leaderId, pool: cards, regulations });
    const execution = runRulesPracticeMatch({
      playerDeck, opponentDeck, cards, seed: parsed.data.seed,
      cpuSkill: parsed.data.cpuSkill, firstPlayer: parsed.data.firstPlayer,
      maxTurns: parsed.data.maxTurns,
    });
    const save = await saveRulesPracticeRun({
      mode: "match", cpuSkill: parsed.data.cpuSkill, result: execution.result,
      games: [execution.game], storagePolicy: resolvePracticeStoragePolicy(1, "full", 1),
    });
    return NextResponse.json({ match: execution.result, save });
  } catch (err) {
    console.error("[/api/practice/match] failed:", err);
    return NextResponse.json({ error: "practice_match_failed", detail: (err as Error).message }, { status: 422 });
  }
}
