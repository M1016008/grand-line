/**
 * CLI: run a batch of CPU-vs-CPU games and persist results to the DB.
 *
 * Usage
 * ─────
 *   npm run sim -- --leader-a=OP01-001 --leader-b=OP02-001 --n=100
 *   npm run sim -- --deck-a=<deckId> --deck-b=<deckId> --n=100
 *
 * Flags
 * ─────
 *   --leader-a <id>       Required if --deck-a not given
 *   --leader-b <id>       Required if --deck-b not given
 *   --deck-a <deckId>     Use a stored deck for player A
 *   --deck-b <deckId>     Use a stored deck for player B
 *   --n <num>             Number of games (default 100)
 *   --seed <str>          seed_base for paired-RNG (default: random)
 *   --max-turns <num>     Game timeout (default 30)
 *   --quiet               Suppress per-game progress lines
 *   --no-persist          Skip DB writes (smoke test only)
 *
 * Output
 * ──────
 * Prints a one-line summary per game (omittable with --quiet) and a
 * final winrate / avg-turns block. Persists simulation_runs / games /
 * game_events / card_plays / analysis_results rows.
 */

import "../lib/load-env";

import { eq, inArray } from "drizzle-orm";

import { db, schema } from "../db/client";
import {
  createFastCpu,
  ENGINE_VERSION,
  makeRegistry,
  runGame,
  type CardData,
  type DeckList,
} from "../lib/engine";
import {
  createSimulationRun,
  finalizeRun,
  persistGame,
} from "../lib/engine/persistence";
import { persistRunMetrics, summarizeRun } from "../lib/engine/analytics";

function parseArgs(argv: readonly string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq >= 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function loadCardRegistry(cardIds: Iterable<string>): Promise<ReturnType<typeof makeRegistry>> {
  const ids = Array.from(new Set(cardIds));
  if (ids.length === 0) return makeRegistry([]);
  const rows = await db
    .select()
    .from(schema.cards)
    .where(inArray(schema.cards.id, ids));
  // Also load any card_effects so the engine can fire DSL effects.
  const effects = await db
    .select()
    .from(schema.cardEffects)
    .where(inArray(schema.cardEffects.cardId, ids));
  const effectMap = new Map<string, unknown>();
  for (const e of effects) {
    if (e.verified) effectMap.set(e.cardId, e.dslJson);
  }

  const data: CardData[] = rows.map((r) => {
    const eff = effectMap.get(r.id) as
      | { effects?: { on: string; actions: unknown[] }[] }
      | undefined;
    return {
      id: r.id,
      cardType: r.cardType,
      colors: r.colors as string[],
      features: r.features as string[],
      mechanics: r.mechanics as string[],
      cost: r.cost,
      power: r.power,
      counter: r.counter,
      life: r.life,
      hasTrigger: !!r.hasTrigger,
      // Parsed DSL is stored as raw JSON; the engine accepts shaped
      // TriggeredEffect[]. We rely on the verified=1 invariant to skip
      // re-parsing here (the DSL was Zod-validated at insert time).
      effect: eff?.effects as CardData["effect"],
    };
  });
  return makeRegistry(data);
}

async function loadDeckList(deckId: string): Promise<DeckList> {
  const deck = await db
    .select()
    .from(schema.decks)
    .where(eq(schema.decks.id, deckId))
    .get();
  if (!deck) throw new Error(`deck not found: ${deckId}`);
  const cards = await db
    .select()
    .from(schema.deckCards)
    .where(eq(schema.deckCards.deckId, deckId));
  return {
    leaderId: deck.leaderCardId,
    cards: cards.map((c) => ({ cardId: c.cardId, count: c.count })),
    donDeckSize: 10,
  };
}

/**
 * Build a deck list with all 50 cards of the leader's color. Used when
 * the caller specifies --leader-a/--leader-b without a stored deck:
 * we build a placeholder "filler deck" of the cheapest valid cards
 * sharing the leader's color so simulations still run.
 */
async function buildFillerDeck(leaderId: string): Promise<DeckList> {
  const leader = await db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, leaderId))
    .get();
  if (!leader || leader.cardType !== "LEADER") {
    throw new Error(`not a LEADER card: ${leaderId}`);
  }
  const colors = leader.colors as string[];
  // Pull up to 13 characters from any of the leader's colors, cost ≤ 5,
  // with counter values.
  const candidates = await db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.cardType, "CHARACTER"))
    .limit(50);
  const sameColor = candidates.filter((c) => {
    const cardColors = c.colors as string[];
    return cardColors.some((col) => colors.includes(col));
  });
  const picks = sameColor.slice(0, 13);
  if (picks.length < 13) {
    throw new Error(
      `not enough characters in DB sharing leader colors ${colors.join(",")}`,
    );
  }
  const cards: { cardId: string; count: number }[] = picks
    .slice(0, 12)
    .map((c) => ({ cardId: c.id, count: 4 }));
  cards.push({ cardId: picks[12]!.id, count: 2 });
  return { leaderId, cards, donDeckSize: 10 };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const n = Number(args.n ?? 100);
  const seedBase =
    typeof args.seed === "string" && args.seed
      ? args.seed
      : `seed-${Date.now()}`;
  const maxTurns = Number(args["max-turns"] ?? 30);
  const quiet = Boolean(args.quiet);
  const noPersist = Boolean(args["no-persist"]);

  // Resolve decks.
  let deckA: DeckList;
  let deckB: DeckList;
  if (typeof args["deck-a"] === "string") {
    deckA = await loadDeckList(args["deck-a"]);
  } else if (typeof args["leader-a"] === "string") {
    deckA = await buildFillerDeck(args["leader-a"]);
  } else {
    throw new Error("must specify --leader-a or --deck-a");
  }
  if (typeof args["deck-b"] === "string") {
    deckB = await loadDeckList(args["deck-b"]);
  } else if (typeof args["leader-b"] === "string") {
    deckB = await buildFillerDeck(args["leader-b"]);
  } else {
    throw new Error("must specify --leader-b or --deck-b");
  }

  const cardIds = new Set<string>([
    deckA.leaderId,
    deckB.leaderId,
    ...deckA.cards.map((c) => c.cardId),
    ...deckB.cards.map((c) => c.cardId),
  ]);
  const registry = await loadCardRegistry(cardIds);

  let runId = "";
  if (!noPersist) {
    runId = await createSimulationRun({
      leaderAId: deckA.leaderId,
      leaderBId: deckB.leaderId,
      deckASnapshot: [...deckA.cards],
      deckBSnapshot: [...deckB.cards],
      nGames: n,
      seedBase,
      cpuAMode: "fast",
      cpuBMode: "fast",
    });
    console.log(`▶ run ${runId}  ${deckA.leaderId} vs ${deckB.leaderId}  n=${n}  seed=${seedBase}  engine=${ENGINE_VERSION}`);
  }

  const cpu = createFastCpu();
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  for (let i = 0; i < n; i++) {
    const gameSeed = `${seedBase}:${i}`;
    const goFirst: "A" | "B" = i % 2 === 0 ? "A" : "B";
    const result = runGame({
      registry,
      deckA,
      deckB,
      seed: gameSeed,
      goFirst,
      cpuA: cpu,
      cpuB: cpu,
      maxTurns,
    });
    const w = result.finalState.winner;
    if (w === "A") winsA++;
    else if (w === "B") winsB++;
    else draws++;
    if (!quiet) {
      console.log(
        `  game ${i + 1}/${n}  goFirst=${goFirst}  winner=${w ?? "DRAW"}  turns=${result.finalState.turn}  end=${result.finalState.endCondition ?? "?"}`,
      );
    }
    if (!noPersist) {
      await persistGame(runId, i, gameSeed, result);
    }
  }

  console.log("");
  console.log("── Results ──");
  console.log(`A wins:  ${winsA}/${n}  (${((winsA / n) * 100).toFixed(1)}%)`);
  console.log(`B wins:  ${winsB}/${n}  (${((winsB / n) * 100).toFixed(1)}%)`);
  console.log(`Draws:   ${draws}/${n}  (${((draws / n) * 100).toFixed(1)}%)`);

  if (!noPersist) {
    const summary = await summarizeRun(runId);
    await persistRunMetrics(summary);
    await finalizeRun(runId, {
      winrateA: summary.winrateA,
      avgTurns: summary.avgTurns,
      endConditions: summary.endConditions,
    });
    console.log(`▶ persisted analytics for ${runId}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
