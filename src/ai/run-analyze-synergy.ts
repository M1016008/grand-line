/**
 * Phase 3.5b — bulk synergy analysis CLI.
 *
 * For a given leader, walk the colour-filtered candidate pool and call
 * `analyzeSynergy(leader, candidate)` for each card, persisting every
 * record the model emits into `card_synergies` with `detected_by='ai'`.
 *
 *   npm run ai:synergy -- --leader OP01-001 --limit 5      # tiny test
 *   npm run ai:synergy -- --leader OP01-001                # default 10 pairs
 *   npm run ai:synergy -- --leader OP01-001 --limit 0      # full pool (~$0.5)
 *   npm run ai:synergy -- --leader OP01-001 --dry-run      # prompt + cost only
 *
 * Cost guard: Sonnet costs ≈ $0.005 per pair. The CLI prints the
 * estimated spend before making any live calls and refuses to run a
 * full pool unless the user explicitly passed `--yes`.
 *
 * Idempotent: the per-row upsert keys on (from_card_id, to_card_id,
 * relation_type) so re-running just refreshes reasoning + strength.
 */
import "@/lib/load-env";

import { eq } from "drizzle-orm";

import { analyzeSynergy } from "@/ai/synergy";
import { db } from "@/db";
import { cardSynergies, cardTranslations, cards } from "@/db/schema";
import type { CardListItem } from "@/lib/cards";

interface CliArgs {
  leader: string;
  limit: number; // 0 = no limit
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {
    limit: 10,
    dryRun: false,
    yes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--leader") args.leader = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npm run ai:synergy -- --leader <id> [--limit N] [--dry-run] [--yes]",
      );
      process.exit(0);
    }
  }
  if (!args.leader) {
    console.error("Missing required --leader <id>");
    process.exit(1);
  }
  return args as CliArgs;
}

async function loadFullCard(id: string): Promise<
  | (CardListItem & { effectText: string | null })
  | null
> {
  const rows = await db
    .select({
      id: cards.id,
      setCode: cards.setCode,
      cardType: cards.cardType,
      colors: cards.colors,
      attributes: cards.attributes,
      features: cards.features,
      mechanics: cards.mechanics,
      cost: cards.cost,
      power: cards.power,
      counter: cards.counter,
      life: cards.life,
      rarity: cards.rarity,
      hasTrigger: cards.hasTrigger,
      imageUrlJp: cards.imageUrlJp,
      name: cardTranslations.name,
      effectText: cardTranslations.effectText,
      source: cardTranslations.source,
      verified: cardTranslations.verified,
    })
    .from(cards)
    .leftJoin(
      cardTranslations,
      eq(cardTranslations.cardId, cards.id),
    )
    .where(eq(cards.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    setCode: r.setCode,
    cardType: r.cardType,
    name: r.name ?? r.id,
    colors: (r.colors ?? []) as string[],
    attributes: (r.attributes ?? []) as string[],
    features: (r.features ?? []) as string[],
    mechanics: (r.mechanics ?? []) as string[],
    cost: r.cost,
    power: r.power,
    counter: r.counter,
    life: r.life,
    rarity: r.rarity,
    hasTrigger: r.hasTrigger,
    imageUrlJp: r.imageUrlJp,
    effectText: r.effectText,
    source: (r.source ?? "manual") as never,
    verified: Boolean(r.verified),
  };
}

async function loadCandidatePool(
  leaderColors: string[],
  leaderId: string,
): Promise<Array<CardListItem & { effectText: string | null }>> {
  // We pull every card sharing a colour with the leader. The CLI then
  // filters down by --limit before calling Claude. The filter happens
  // per-call (not in SQL) so we can add smarter ordering later without
  // changing the schema.
  const rows = await db
    .select({
      id: cards.id,
      setCode: cards.setCode,
      cardType: cards.cardType,
      colors: cards.colors,
      attributes: cards.attributes,
      features: cards.features,
      mechanics: cards.mechanics,
      cost: cards.cost,
      power: cards.power,
      counter: cards.counter,
      life: cards.life,
      rarity: cards.rarity,
      hasTrigger: cards.hasTrigger,
      imageUrlJp: cards.imageUrlJp,
      name: cardTranslations.name,
      effectText: cardTranslations.effectText,
      source: cardTranslations.source,
      verified: cardTranslations.verified,
    })
    .from(cards)
    .leftJoin(
      cardTranslations,
      eq(cardTranslations.cardId, cards.id),
    );
  const set = new Set(leaderColors);
  return rows
    .filter((r) => r.id !== leaderId)
    .filter((r) => r.cardType !== "LEADER")
    .filter((r) =>
      ((r.colors ?? []) as string[]).some((c) => set.has(c)),
    )
    .map((r) => ({
      id: r.id,
      setCode: r.setCode,
      cardType: r.cardType,
      name: r.name ?? r.id,
      colors: (r.colors ?? []) as string[],
      attributes: (r.attributes ?? []) as string[],
      features: (r.features ?? []) as string[],
      mechanics: (r.mechanics ?? []) as string[],
      cost: r.cost,
      power: r.power,
      counter: r.counter,
      life: r.life,
      rarity: r.rarity,
      hasTrigger: r.hasTrigger,
      imageUrlJp: r.imageUrlJp,
      effectText: r.effectText,
      source: (r.source ?? "manual") as never,
      verified: Boolean(r.verified),
    }));
}

const SONNET_PER_PAIR_USD = 0.005; // rough; tweak after observing actual usage

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const leader = await loadFullCard(args.leader);
  if (!leader) {
    console.error(`✗ Leader ${args.leader} not found in cards table.`);
    process.exit(1);
  }
  if (leader.cardType !== "LEADER") {
    console.error(`✗ ${args.leader} is ${leader.cardType}, not LEADER.`);
    process.exit(1);
  }

  const fullPool = await loadCandidatePool(leader.colors, leader.id);
  // Bias: cards that share ≥1 feature with the leader come first. The
  // model gets the most relevant pairs in the smallest sample.
  const leaderFeatures = new Set(leader.features);
  fullPool.sort((a, b) => {
    const aShare = a.features.some((f) => leaderFeatures.has(f)) ? 1 : 0;
    const bShare = b.features.some((f) => leaderFeatures.has(f)) ? 1 : 0;
    if (aShare !== bShare) return bShare - aShare;
    return a.id.localeCompare(b.id);
  });

  const pool =
    args.limit > 0 ? fullPool.slice(0, args.limit) : fullPool;
  const estimated = (pool.length * SONNET_PER_PAIR_USD).toFixed(2);
  console.log(
    `▶ Leader ${leader.id} ${leader.name} (${leader.colors.join("/")})`,
  );
  console.log(
    `  Candidates: ${pool.length} of ${fullPool.length} (--limit ${args.limit})`,
  );
  console.log(`  Estimated spend: ~$${estimated} USD`);

  if (args.dryRun) {
    console.log("✋ --dry-run set — printing first 3 candidates and exiting:");
    for (const c of pool.slice(0, 3)) {
      console.log(`    ${c.id}  ${c.name}  features=${c.features.join("/")}`);
    }
    return;
  }

  if (pool.length > 30 && !args.yes) {
    console.error(
      `✗ Pool size ${pool.length} > 30. Re-run with --yes to confirm spending ~$${estimated}.`,
    );
    process.exit(1);
  }

  // Run sequentially. Tool-use latency dominates ~5-10s/call, so 10
  // pairs ≈ 1-2 minutes. No need for parallelism at this scale.
  let totalRecords = 0;
  let totalRejected = 0;
  let lastModelVersion = "";
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[i];
    process.stdout.write(
      `[${i + 1}/${pool.length}] ${candidate.id} ${candidate.name.slice(0, 18)}…`,
    );
    try {
      const result = await analyzeSynergy(leader, candidate);
      lastModelVersion = result.modelVersion;
      for (const r of result.records) {
        await db
          .insert(cardSynergies)
          .values({
            fromCardId: r.from_card_id,
            toCardId: r.to_card_id,
            relationType: r.relation_type,
            strength: r.strength,
            reasoningJa: r.reasoning_ja,
            reasoningEn: r.reasoning_en,
            detectedBy: "ai",
            aiModelVersion: result.modelVersion,
          })
          .onConflictDoUpdate({
            target: [
              cardSynergies.fromCardId,
              cardSynergies.toCardId,
              cardSynergies.relationType,
            ],
            set: {
              strength: r.strength,
              reasoningJa: r.reasoning_ja,
              reasoningEn: r.reasoning_en,
              detectedBy: "ai",
              aiModelVersion: result.modelVersion,
            },
          });
      }
      totalRecords += result.records.length;
      totalRejected += result.rejected.length;
      console.log(
        ` ✓ records=${result.records.length} rejected=${result.rejected.length}`,
      );
    } catch (err) {
      console.log(` ✗ ${(err as Error).message}`);
    }
  }

  console.log("");
  console.log(
    `✓ Done. records persisted=${totalRecords} rejected=${totalRejected} model=${lastModelVersion}`,
  );
}

main().catch((err) => {
  console.error("✗ run-analyze-synergy failed:", err);
  process.exit(1);
});
