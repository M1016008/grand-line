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
  assert.match(component, /3案を対戦ベンチマーク/);
  assert.match(component, /Battle Benchmark \/ 対戦ベンチマーク/);
  assert.match(component, /構築による挙動差/);
  assert.match(component, /1\. Opponent/);
  assert.match(component, /2\. CPU level/);
  assert.match(component, /3\. Benchmark size/);
  assert.match(component, /4\. Run/);
  assert.match(component, /Synthetic benchmark opponent/);
  assert.match(component, /active restrictionsで再検証/);
  assert.match(component, /Heuristic win rate/);
  assert.match(component, /95% CI/);
  assert.match(component, /Paired outcomes/);
  assert.match(component, /BENCHMARK_DISCLOSURE_JA/);
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
  assert.equal(route.match(/listCards\(\{ pageSize: 5_000 \}\)/g)?.length, 1);
  assert.equal(route.match(/runPairedDeckBenchmark\(/g)?.length, 1);
  assert.match(route, /activeRegulations\(\)/);
  assert.match(route, /getSavedDeck/);
  assert.match(route, /strictDeckIntelligencePracticeDeck/);
  assert.match(route, /buildPracticeDeck\(syntheticLeader, pool\)/);
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
  assert.match(proposer, /applyDeckCopyEntries\(target\.cards, poolById, replace\)/);
  assert.match(proposer, /<DeckBattleBenchmark/);
  assert.match(proposer, /response=\{response\}/);
});
