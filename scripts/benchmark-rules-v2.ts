import { listCards } from "../src/lib/cards";
import {
  buildStrictSyntheticBenchmarkOpponent,
  type BenchmarkOpponentDescriptor,
} from "../src/lib/deck-battle-benchmark";
import { runRulesDeckBenchmark } from "../src/lib/deck-rules-benchmark";
import { activeRegulations } from "../src/lib/saved-decks";

async function main(): Promise<void> {
  const pool = await listCards({
    pageSize: 5_000,
    includeOfficialText: true,
  });
  const regulations = await activeRegulations();
  const leaders = pool.cards.filter((card) => card.cardType === "LEADER");
  let playerDeck = null;
  let opponentDeck = null;
  for (const leader of leaders) {
    try {
      const candidate = buildStrictSyntheticBenchmarkOpponent({
        leader,
        pool: pool.cards,
        regulations,
      });
      if (!playerDeck) playerDeck = candidate;
      else {
        opponentDeck = candidate;
        break;
      }
    } catch {
      // Try the next Leader when current restrictions cannot produce 50 cards.
    }
  }
  if (!playerDeck || !opponentDeck) {
    throw new Error("Two legal SSD-backed benchmark decks could not be constructed.");
  }

  const opponent: BenchmarkOpponentDescriptor = {
    kind: "synthetic",
    id: opponentDeck.id,
    name: opponentDeck.name,
    leaderId: opponentDeck.leader.id,
    synthetic: true,
  };

  for (const games of [100, 500]) {
    const started = performance.now();
    const result = runRulesDeckBenchmark({
      variants: (["recommended", "consistency", "specialization"] as const).map(
        (variantProfile) => ({ variantProfile, deck: playerDeck }),
      ),
      opponentDeck,
      opponent,
      cards: pool.cards,
      games,
      cpuSkill: "level3",
      replaySampleSize: 0,
    });
    const elapsedMs = performance.now() - started;
    const variants = Object.values(result.variants);
    const totalGames = variants.reduce((sum, metrics) => sum + metrics.games, 0);
    const resolvedGames = variants.reduce(
      (sum, metrics) => sum + metrics.resolvedGames,
      0,
    );
    const engineGuards = variants.reduce(
      (sum, metrics) => sum + metrics.outcomes.engineGuard,
      0,
    );
    console.log(
      JSON.stringify({
        gamesPerVariant: games,
        totalGames,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        resolutionRate:
          Math.round((resolvedGames / totalGames) * 1_000_000) / 1_000_000,
        inconclusiveRate:
          Math.round(((totalGames - resolvedGames) / totalGames) * 1_000_000) /
          1_000_000,
        engineGuards,
        playerLeader: playerDeck.leader.id,
        opponentLeader: opponentDeck.leader.id,
      }),
    );
  }
}

void main();
