import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

test("Deck Intelligence is rendered after and outside the 360px manual-builder sidebar", async () => {
  const builder = await source(
    "src",
    "components",
    "grand-line",
    "deck-builder.tsx",
  );
  const sidebarEnd = builder.indexOf("</aside>");
  const intelligence = builder.indexOf('<section aria-label="Deck Intelligence"');
  const manualGrid = builder.indexOf("lg:grid-cols-[minmax(0,1fr)_360px]");

  assert.notEqual(manualGrid, -1);
  assert.ok(intelligence > sidebarEnd);
  assert.match(builder.slice(intelligence), /<AiDeckProposer/);
  assert.match(builder, /<div className="space-y-8">/);
});

test("workflow navigation exposes five Japanese steps in order with explicit states", async () => {
  const workflow = await source(
    "src",
    "components",
    "grand-line",
    "deck-intelligence-workflow.tsx",
  );
  const labels = ["構築条件", "構築案", "対戦比較", "改善候補", "下書き"];
  let previous = -1;
  for (const label of labels) {
    const position = workflow.indexOf(`"${label}"`);
    assert.ok(position > previous, `${label} should follow the preceding step`);
    previous = position;
  }
  assert.match(workflow, /upcoming: "未実行"/);
  assert.match(workflow, /current: "現在"/);
  assert.match(workflow, /complete: "完了"/);
  assert.match(workflow, /aria-current=\{status === "current" \? "step" : undefined\}/);
  assert.match(workflow, /aria-expanded=\{expanded\}/);
  assert.match(workflow, /disabled=\{!enabledSteps\.has\(step\)\}/);
});

test("workflow and result layouts retain mobile overflow and responsive columns", async () => {
  const workflow = await source(
    "src",
    "components",
    "grand-line",
    "deck-intelligence-workflow.tsx",
  );
  const proposer = await source(
    "src",
    "components",
    "grand-line",
    "ai-deck-proposer.tsx",
  );
  const benchmark = await source(
    "src",
    "components",
    "grand-line",
    "deck-battle-benchmark.tsx",
  );
  const optimizer = await source(
    "src",
    "components",
    "grand-line",
    "deck-optimizer.tsx",
  );
  const header = await source(
    "src",
    "components",
    "grand-line",
    "site-header.tsx",
  );

  assert.match(workflow, /overflow-x-auto/);
  assert.match(workflow, /min-w-\[680px\]/);
  assert.match(proposer, /sm:grid-cols-2/);
  assert.match(proposer, /xl:grid-cols-3/);
  assert.match(benchmark, /overflow-x-auto/);
  assert.match(benchmark, /min-w-\[680px\]/);
  assert.match(optimizer, /sm:grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/);
  assert.match(header, /min-w-0 flex-1 items-center gap-1 overflow-x-auto/);
  assert.match(header, /shrink-0 whitespace-nowrap/);
});

test("workflow state keeps a single expanded step and exposes benchmark then optimizer", async () => {
  const proposer = await source(
    "src",
    "components",
    "grand-line",
    "ai-deck-proposer.tsx",
  );
  const benchmark = await source(
    "src",
    "components",
    "grand-line",
    "deck-battle-benchmark.tsx",
  );

  assert.match(proposer, /useState<DeckIntelligenceStep \| null>\(1\)/);
  assert.match(proposer, /setExpandedStep\(step\)/);
  assert.match(proposer, /variantProposal \? \(\s*<DeckBattleBenchmark/);
  assert.match(benchmark, /\{result \? \(\s*<DeckOptimizer/);
  assert.match(proposer, /if \(variantProposal\) enabledSteps\.add\(3\)/);
  assert.match(proposer, /if \(benchmarkComplete\) enabledSteps\.add\(4\)/);
  assert.match(proposer, /if \(appliedDraft\) enabledSteps\.add\(5\)/);
});
