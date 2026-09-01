import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

test("Deck Intelligence compare exposes the paired Battle Benchmark flow", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "deck-battle-benchmark.tsx",
  );
  const domain = await source("src", "lib", "deck-battle-benchmark.ts");
  assert.match(component, /title="対戦ベンチマーク"/);
  assert.match(component, /3案を同条件で対戦比較/);
  assert.match(component, />対戦相手</);
  assert.match(component, />CPU</);
  assert.match(component, />試行数</);
  assert.match(component, /比較を実行/);
  assert.match(component, /Synthetic benchmark opponent/);
  assert.match(component, /active restrictionsで再検証/);
  assert.match(component, /試行上の勝率/);
  assert.match(component, /95% CI/);
  assert.match(component, /詳しい比較/);
  assert.match(component, /同一seedでの結果/);
  assert.match(component, /benchmark\.disclosureJa/);
  assert.match(domain, /公式カード効果・裁定を完全再現した実戦勝率ではありません/);
  assert.doesNotMatch(component, /Expected tournament win rate|最強構築/);
});

test("benchmark UI offers only Quick, Standard and Deep v1 sizes", async () => {
  const domain = await source("src", "lib", "deck-battle-benchmark.ts");
  assert.match(domain, /id: "quick"[\s\S]*games: 100/);
  assert.match(domain, /id: "standard"[\s\S]*games: 500/);
  assert.match(domain, /id: "deep"[\s\S]*games: 2_000/);
  assert.doesNotMatch(domain, /games: 10_000/);
});

test("benchmark route resolves facts once and revalidates saved opponents", async () => {
  const route = await source(
    "src",
    "app",
    "api",
    "practice",
    "benchmark",
    "route.ts",
  );
  const resolver = await source("src", "lib", "benchmark-opponent.ts");
  assert.equal(route.match(/listCards\(\{ pageSize: 5_000 \}\)/g)?.length, 1);
  assert.equal(route.match(/runPairedDeckBenchmark\(/g)?.length, 1);
  assert.match(route, /activeRegulations\(\)/);
  assert.match(route, /getSavedDeck/);
  assert.match(route, /resolveBenchmarkOpponent/);
  assert.match(resolver, /strictDeckIntelligencePracticeDeck/);
  assert.match(resolver, /buildStrictSyntheticBenchmarkOpponent/);
  assert.doesNotMatch(route, /buildPracticeDeck\(syntheticLeader, pool\)/);
  assert.match(route, /restrictions_unavailable/);
  assert.match(route, /benchmark_deck_invalid/);
});

test("Compare integration leaves single generation and existing draft apply in place", async () => {
  const proposer = await source(
    "src",
    "components",
    "grand-line",
    "ai-deck-proposer.tsx",
  );
  assert.match(proposer, /mode === "single" \? "おすすめ1案" : "3案を比較"/);
  assert.match(proposer, /applyDeckCopyEntries\(entries, poolById, replace\)/);
  assert.match(proposer, /<DeckBattleBenchmark/);
  assert.match(proposer, /response=\{response\}/);
});

test("Deck Optimizer UI is explicit, paired, and manual-apply only", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "deck-optimizer.tsx",
  );
  const route = await source(
    "src",
    "app",
    "api",
    "practice",
    "optimizer",
    "route.ts",
  );
  const domain = await source("src", "lib", "deck-optimizer.ts");
  assert.match(component, /title="改善候補"/);
  assert.match(component, /改善する構築を選ぶ/);
  assert.match(component, /改善候補を探す/);
  assert.match(component, /この入替を下書きに反映/);
  assert.match(component, /反映した下書きで再ベンチマーク/);
  assert.match(component, /増加/);
  assert.match(component, /減少/);
  assert.match(component, /候補 95% CI/);
  assert.match(component, /構築変化/);
  assert.match(domain, /公式環境での強さや大会勝率の改善を保証/);
  assert.doesNotMatch(component, /最強|真の最適解|大会勝率最大化|Best/);
  assert.match(route, /listCards\(\{ pageSize: 5_000 \}\)/);
  assert.match(route, /activeRegulations\(\)/);
  assert.match(route, /getSavedDeck/);
  assert.match(route, /readAiSynergiesForLeader/);
  assert.match(route, /resolveBenchmarkOpponent/);
  assert.match(route, /runDeckOptimizer/);
});

test("benchmark keeps primary metrics compact and advanced analysis collapsible", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "deck-battle-benchmark.tsx",
  );
  assert.match(component, /heuristicWinRate/);
  assert.match(component, /heuristicWinRateCi95/);
  assert.match(component, /firstPlayerWinRate/);
  assert.match(component, /secondPlayerWinRate/);
  assert.match(component, /avgTurns/);
  assert.match(component, /averageDonEfficiency/);
  assert.match(component, /aria-expanded=\{showDetails\}/);
  assert.match(component, /benchmark-detailed-comparison/);
  assert.equal(component.match(/benchmark\.disclosureJa/g)?.length, 1);
});

test("optimizer appears only after a completed benchmark and preserves variant overrides", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "deck-battle-benchmark.tsx",
  );
  assert.match(component, /\{result \? \(\s*<DeckOptimizer/);
  assert.match(component, /variantOverrides\[variant\.variantProfile\]/);
  assert.match(component, /setVariantOverrides/);
  assert.match(component, /candidate\.resultingDeck\.cards/);
  assert.match(component, /void runBenchmark\(\)/);
  assert.match(
    component,
    /onRebenchmark=\{\s*\(\) => \{\s*onAdvanceStep\(3\);\s*void runBenchmark\(\);\s*\}\}/,
  );
  assert.doesNotMatch(component, /onRebenchmark=\{\s*setVariantOverrides/);
});

test("benchmark start callback resets step completions while run is in progress", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "deck-battle-benchmark.tsx",
  );
  assert.match(component, /onBenchmarkStart\?\.\(\);/);
  assert.match(
    component,
    /async function runBenchmark\(\)\s*\{\s*onAdvanceStep\(3\);\s*onBenchmarkStart\?\.\(\);\s*setRunning\(true\);/,
  );
});

test("optimizer candidate emphasizes a thumbnail OUT to IN swap and visible apply state", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "deck-optimizer.tsx",
  );
  assert.match(component, /proxiedCardImage/);
  assert.match(component, /label="OUT"/);
  assert.match(component, /label="IN"/);
  assert.match(component, /→/);
  assert.match(component, /勝利数の純増減/);
  assert.match(component, /baselineMetrics\.heuristicWinRate/);
  assert.match(component, /candidateMetrics\.heuristicWinRate/);
  assert.match(component, /下書きに反映済み/);
  assert.match(component, /aria-expanded=\{expanded\}/);
  assert.equal(component.match(/\{OPTIMIZER_DISCLAIMER_JA\}/g)?.length, 1);
});

test("optimizer uses the completed benchmark CPU snapshot, not selector state", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "deck-battle-benchmark.tsx",
  );
  const optimizerInvocation = component.match(/<DeckOptimizer[\s\S]*?\/>/)?.[0];

  assert.ok(optimizerInvocation);
  assert.match(
    optimizerInvocation,
    /cpuSkill=\{result\.benchmark\.schedule\.cpuSkill\}/,
  );
  assert.doesNotMatch(optimizerInvocation, /cpuSkill=\{cpuSkill\}/);
});

test("optimizer uses the completed benchmark opponent descriptor", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "deck-battle-benchmark.tsx",
  );

  assert.match(component, /opponent=\{result\.benchmark\.opponent\}/);
});

test("the same benchmark condition snapshot is passed through to optimizer", async () => {
  const benchmarkComponent = await source(
    "src",
    "components",
    "grand-line",
    "deck-battle-benchmark.tsx",
  );
  const optimizerComponent = await source(
    "src",
    "components",
    "grand-line",
    "deck-optimizer.tsx",
  );
  const route = await source(
    "src",
    "app",
    "api",
    "practice",
    "optimizer",
    "route.ts",
  );

  assert.match(
    benchmarkComponent,
    /maxTurns=\{result\.benchmark\.schedule\.maxTurns\}/,
  );
  assert.match(optimizerComponent, /opponent,[\s\S]*cpuSkill,[\s\S]*maxTurns,/);
  assert.match(
    route,
    /cpuSkill: body\.cpuSkill,[\s\S]*maxTurns: body\.maxTurns/,
  );
});
