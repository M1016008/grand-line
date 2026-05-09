/**
 * Phase ③ — bulk playstyle generation CLI.
 *
 * Generates kid-friendly "いつ使うか / どこで強い / 対戦中の使い方"
 * descriptions for a bounded pool of cards. Pool defaults to the
 * "savings plan": all LEADERs + cards with substantial effect text +
 * non-trivial rarity (SR/SEC/L/SP/UR/PR with effect text).
 *
 *   npm run ai:playstyle -- --card OP01-001              # one card
 *   npm run ai:playstyle -- --leaders                    # all LEADER cards
 *   npm run ai:playstyle -- --major --dry-run            # see counts + cost
 *   npm run ai:playstyle -- --major --yes                # run it
 *   npm run ai:playstyle -- --skip-existing --major      # incremental re-run
 *
 * Cost: Sonnet ≈ $0.005/card. Default --major scope is ~500 cards ≈ $2.5.
 * Idempotent: upsert keys on card_id. Re-running just refreshes the text.
 */
import "@/lib/load-env";

import { eq, inArray } from "drizzle-orm";

import { analyzePlaystyle, type CardPlaystyleInput } from "@/ai/playstyle";
import { db } from "@/db";
import { cardPlaystyles, cardTranslations, cards } from "@/db/schema";
import type { CardListItem } from "@/lib/cards";

interface CliArgs {
  card?: string;
  leaders: boolean;
  major: boolean;
  all: boolean;
  /** Soft cap on pool size for testing. 0 = no cap. */
  limit: number;
  dryRun: boolean;
  yes: boolean;
  skipExisting: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    leaders: false,
    major: false,
    all: false,
    limit: 0,
    dryRun: false,
    yes: false,
    skipExisting: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--card") args.card = argv[++i];
    else if (a === "--leaders") args.leaders = true;
    else if (a === "--major") args.major = true;
    else if (a === "--all") args.all = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--skip-existing") args.skipExisting = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npm run ai:playstyle -- [--card X | --leaders | --major | --all] [--limit N] [--skip-existing] [--dry-run] [--yes]",
      );
      process.exit(0);
    }
  }
  if (!args.card && !args.leaders && !args.major && !args.all) {
    console.error("Specify one of: --card <id>, --leaders, --major, --all");
    process.exit(1);
  }
  return args;
}

async function loadCardsForPool(args: CliArgs): Promise<CardPlaystyleInput[]> {
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
      triggerText: cardTranslations.triggerText,
      source: cardTranslations.source,
      verified: cardTranslations.verified,
    })
    .from(cards)
    .leftJoin(cardTranslations, eq(cardTranslations.cardId, cards.id));

  const all = rows.map((r): CardPlaystyleInput => ({
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
    triggerText: r.triggerText,
    source: (r.source ?? "manual") as never,
    verified: Boolean(r.verified),
  } as CardListItem & { effectText: string | null; triggerText: string | null }));

  if (args.card) {
    return all.filter((c) => c.id === args.card);
  }
  if (args.leaders) {
    return all.filter((c) => c.cardType === "LEADER");
  }
  if (args.all) {
    return all;
  }
  // --major: LEADERs + competitive-rarity cards with effect text + high-cost
  // finishers. Tightened from "any effect-text card with cost ≥ 5" because
  // that scoped to ~900 cards ≈ $4.6 — over Yoshio's "minimize cost"
  // budget. SR/SEC/SP/UR cover the deck-defining cards; cost ≥ 7 catches
  // R-rarity finishers we'd otherwise miss. Result: ~500 cards ≈ $2.5.
  const competitiveRarities = new Set(["SR", "SEC", "L", "SP", "UR"]);
  return all.filter((c) => {
    if (c.cardType === "LEADER") return true;
    if (c.cardType === "DON") return false;
    const hasEffect = (c.effectText ?? "").trim().length > 0;
    if (!hasEffect) return false;
    if (c.rarity && competitiveRarities.has(c.rarity)) return true;
    if ((c.cost ?? 0) >= 7) return true;
    return false;
  });
}

const SONNET_PER_CARD_USD = 0.005;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let pool = await loadCardsForPool(args);

  if (args.skipExisting) {
    const ids = pool.map((c) => c.id);
    const existing = ids.length > 0
      ? await db
          .select({ cardId: cardPlaystyles.cardId })
          .from(cardPlaystyles)
          .where(inArray(cardPlaystyles.cardId, ids))
      : [];
    const have = new Set(existing.map((r) => r.cardId));
    const before = pool.length;
    pool = pool.filter((c) => !have.has(c.id));
    console.log(`  --skip-existing: ${before - pool.length} already done, ${pool.length} remain.`);
  }

  if (args.limit > 0) pool = pool.slice(0, args.limit);

  const estimated = (pool.length * SONNET_PER_CARD_USD).toFixed(2);
  console.log(`▶ Pool size: ${pool.length} cards`);
  console.log(`  Estimated spend: ~$${estimated} USD`);

  if (args.dryRun) {
    console.log("✋ --dry-run set — printing first 5 candidates and exiting:");
    for (const c of pool.slice(0, 5)) {
      console.log(`    ${c.id}  ${c.name}  rarity=${c.rarity ?? "?"}  cost=${c.cost ?? "?"}`);
    }
    return;
  }

  if (pool.length > 50 && !args.yes) {
    console.error(
      `✗ Pool size ${pool.length} > 50. Re-run with --yes to confirm spending ~$${estimated}.`,
    );
    process.exit(1);
  }

  let totalDone = 0;
  let totalFailed = 0;
  let lastModelVersion = "";
  for (let i = 0; i < pool.length; i++) {
    const card = pool[i];
    process.stdout.write(
      `[${i + 1}/${pool.length}] ${card.id} ${card.name.slice(0, 22)}…`,
    );
    try {
      const result = await callWithRetry(card);
      lastModelVersion = result.modelVersion;
      await db
        .insert(cardPlaystyles)
        .values({
          cardId: card.id,
          whenToPlayJa: result.record.when_to_play_ja,
          shinesInJa: result.record.shines_in_ja,
          vsOpponentJa: result.record.vs_opponent_ja,
          aiModelVersion: result.modelVersion,
        })
        .onConflictDoUpdate({
          target: cardPlaystyles.cardId,
          set: {
            whenToPlayJa: result.record.when_to_play_ja,
            shinesInJa: result.record.shines_in_ja,
            vsOpponentJa: result.record.vs_opponent_ja,
            aiModelVersion: result.modelVersion,
          },
        });
      totalDone += 1;
      console.log(` ✓`);
    } catch (err) {
      totalFailed += 1;
      console.log(` ✗ ${(err as Error).message}`);
    }
  }

  console.log("");
  console.log(
    `✓ Done. persisted=${totalDone} failed=${totalFailed} model=${lastModelVersion}`,
  );
}

async function callWithRetry(card: CardPlaystyleInput) {
  try {
    return await analyzePlaystyle(card);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    const status = (err as { status?: number }).status;
    const transient =
      status === 429 ||
      (status !== undefined && status >= 500) ||
      /overloaded|timeout|ECONNRESET|fetch failed|network/i.test(msg);
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 4000));
    return await analyzePlaystyle(card);
  }
}

main().catch((err) => {
  console.error("✗ run-analyze-playstyle failed:", err);
  process.exit(1);
});
