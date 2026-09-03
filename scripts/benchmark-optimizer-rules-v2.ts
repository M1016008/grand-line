import { listCards } from "../src/lib/cards";
import {
  buildStrictSyntheticBenchmarkOpponent,
  type BenchmarkOpponentDescriptor,
} from "../src/lib/deck-battle-benchmark";
import { isVerifiedOfficialCard } from "../src/lib/deck-intelligence-preferences";
import { runDeckOptimizer, type OptimizerGames } from "../src/lib/deck-optimizer";
import { activeRegulations } from "../src/lib/saved-decks";

async function main(): Promise<void> {
  const poolResult = await listCards({
    pageSize: 5_000,
    includeOfficialText: true,
  });
  const regulations = await activeRegulations();
  const verifiedPool = poolResult.cards.filter(isVerifiedOfficialCard);
  const leaders = verifiedPool.filter((card) => card.cardType === "LEADER");
  const decks = [];
  for (const leader of leaders) {
    try {
      decks.push(
        buildStrictSyntheticBenchmarkOpponent({
          leader,
          pool: verifiedPool,
          regulations,
        }),
      );
      if (decks.length === 2) break;
    } catch {
      // Try the next verified Leader when active restrictions cannot fill 50.
    }
  }
  const [baselineDeck, opponentDeck] = decks;
  if (!baselineDeck || !opponentDeck) {
    throw new Error("Two legal verified SSD-backed decks could not be constructed.");
  }

  const opponent: BenchmarkOpponentDescriptor = {
    kind: "synthetic",
    id: opponentDeck.id,
    name: opponentDeck.name,
    leaderId: opponentDeck.leader.id,
    synthetic: true,
  };
  const configurations: Array<{ candidateLimit: number; games: OptimizerGames }> = [
    { candidateLimit: 8, games: 300 },
    ...(process.argv.includes("--max")
      ? [{ candidateLimit: 20, games: 500 as OptimizerGames }]
      : []),
  ];

  for (const configuration of configurations) {
    const startedAt = performance.now();
    const result = runDeckOptimizer({
      leader: baselineDeck.leader,
      targetCards: baselineDeck.entries.map((entry) => ({
        cardId: entry.card.id,
        count: entry.count,
      })),
      variantProfile: "recommended",
      selectedStyle: "auto",
      selectedTags: [],
      pool: verifiedPool,
      regulations,
      persistedSynergies: [],
      opponentDeck,
      opponent,
      baseSeed: 1_001,
      seedStep: 97,
      cpuSkill: "level3",
      maxTurns: 10,
      optimizerGames: configuration.games,
      candidateLimit: configuration.candidateLimit,
    });
    const elapsedMs = performance.now() - startedAt;
    const candidateResolutionRates = result.candidates.map(
      (candidate) => candidate.candidateMetrics.resolutionRate,
    );
    const engineGuards =
      result.baseline.metrics.outcomes.engineGuard +
      result.candidates.reduce(
        (sum, candidate) => sum + candidate.candidateMetrics.outcomes.engineGuard,
        0,
      );
    const memory = process.memoryUsage();
    console.log(
      JSON.stringify({
        requestedCandidates: configuration.candidateLimit,
        candidates: result.candidates.length,
        gamesPerDeck: configuration.games,
        simulations: result.schedule.totalSimulations,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        baselineResolutionRate: result.baseline.metrics.resolutionRate,
        candidateResolutionRateRange: [
          Math.min(...candidateResolutionRates),
          Math.max(...candidateResolutionRates),
        ],
        engineGuards,
        heapUsedMiB: Math.round((memory.heapUsed / 1_048_576) * 10) / 10,
        rssMiB: Math.round((memory.rss / 1_048_576) * 10) / 10,
        maxRssKiB: process.resourceUsage().maxRSS,
        playerLeader: baselineDeck.leader.id,
        opponentLeader: opponentDeck.leader.id,
      }),
    );
  }
}

void main();
