import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lab = readFileSync(new URL("../components/grand-line/practice-lab.tsx", import.meta.url), "utf8");
const matchRoute = readFileSync(new URL("../app/api/practice/match/route.ts", import.meta.url), "utf8");
const batchRoute = readFileSync(new URL("../app/api/practice/batch/route.ts", import.meta.url), "utf8");
const runsRoute = readFileSync(new URL("../app/api/practice/runs/route.ts", import.meta.url), "utf8");

test("Practice Match and Batch use server-authoritative Rules APIs", () => {
  assert.doesNotMatch(lab, /\bsimulateMatch\b/);
  assert.doesNotMatch(lab, /fetch\("\/api\/practice\/runs"/);
  assert.match(lab, /fetch\("\/api\/practice\/match"/);
  assert.match(lab, /player: rulesPlayerRequest\(\)/);
  for (const route of [matchRoute, batchRoute]) {
    assert.match(route, /pageSize: 5_000, includeOfficialText: true/);
    assert.match(route, /activeRegulations\(\)/);
  }
});

test("legacy ingest is disabled and Match board never guesses final card identities", () => {
  assert.match(runsRoute, /legacy_replay_ingest_disabled/);
  assert.match(runsRoute, /status: 410/);
  assert.doesNotMatch(lab, /function replayBoardCards/);
  assert.match(lab, /playerBoardCount=/);
  assert.match(lab, /Rules Kernel Practice v2/);
  assert.match(lab, /旧evaluation engine/);
  assert.match(lab, /簡易局面ドリル/);
});
