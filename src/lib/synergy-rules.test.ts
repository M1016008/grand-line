import test from "node:test";
import assert from "node:assert/strict";

import { detectRuleSynergies } from "./synergy-rules";
import type { CardListItem } from "./cards";

function card(overrides: Partial<CardListItem>): CardListItem {
  return {
    id: "OP01-XXX",
    setCode: "OP01",
    cardType: "CHARACTER",
    name: "Test",
    colors: ["red"],
    features: ["麦わらの一味"],
    attributes: [],
    mechanics: [],
    cost: 3,
    power: 4000,
    counter: 1000,
    life: null,
    rarity: "C",
    hasTrigger: false,
    imageUrlJp: null,
    source: "manual",
    verified: false,
    ...overrides,
  };
}

const RED_LEADER = card({
  id: "OP01-001",
  cardType: "LEADER",
  name: "Red Leader",
  features: ["麦わらの一味", "超新星"],
  power: 5000,
  life: 5,
  rarity: "L",
});

const POOL: CardListItem[] = [
  RED_LEADER,
  card({
    id: "OP01-NAMI",
    name: "Nami",
    features: ["麦わらの一味"],
    cost: 1,
    power: 1000,
    mechanics: ["OnPlay", "Search"],
  }),
  card({
    id: "OP01-ZORO",
    name: "Zoro",
    features: ["麦わらの一味", "超新星"],
    cost: 3,
    power: 5000,
    mechanics: ["Blocker", "PowerBuff"],
    counter: 2000,
  }),
  card({
    id: "OP01-LUFFY-FINISHER",
    name: "Big Luffy",
    features: ["麦わらの一味", "超新星"],
    cost: 7,
    power: 8000,
    mechanics: ["Rush", "OnAttack"],
    counter: 0,
  }),
  card({
    id: "OP01-GREEN-OUTSIDER",
    name: "Green Friend",
    colors: ["green"],
    features: ["ビッグ・マム海賊団"],
    cost: 4,
    power: 5000,
    mechanics: ["Banish"],
  }),
  card({
    id: "OP01-DEFENDER",
    name: "Solid Wall",
    features: ["麦わらの一味"],
    cost: 4,
    power: 4000,
    counter: 2000,
    mechanics: ["Blocker"],
  }),
];

test("leader_direct edges fire for every feature-sharing card", () => {
  const edges = detectRuleSynergies(RED_LEADER, POOL);
  // Filter to leader_direct *specifically* — leader is also the source of
  // anti_meta edges to off-archetype removal, which we don't want to count
  // as feature-sharing.
  const leaderDirect = edges.filter(
    (e) => e.fromCardId === RED_LEADER.id && e.relationType === "leader_direct",
  );
  const linkedIds = new Set(leaderDirect.map((e) => e.toCardId));
  assert.ok(linkedIds.has("OP01-NAMI"));
  assert.ok(linkedIds.has("OP01-ZORO"));
  assert.ok(linkedIds.has("OP01-LUFFY-FINISHER"));
  assert.ok(linkedIds.has("OP01-DEFENDER"));
  assert.ok(!linkedIds.has("OP01-GREEN-OUTSIDER"));
});

test("leader_direct strength scales with feature overlap", () => {
  const edges = detectRuleSynergies(RED_LEADER, POOL);
  const leaderEdges = edges.filter((e) => e.fromCardId === RED_LEADER.id);
  const single = leaderEdges.find((e) => e.toCardId === "OP01-NAMI");
  const dual = leaderEdges.find((e) => e.toCardId === "OP01-ZORO");
  assert.ok(single && dual);
  assert.ok(dual.strength > single.strength, `${dual.strength} > ${single.strength}`);
});

test("resource_engine links Search/Draw card to a feature-sharing finisher", () => {
  const edges = detectRuleSynergies(RED_LEADER, POOL);
  const re = edges.find(
    (e) =>
      e.relationType === "resource_engine" &&
      e.fromCardId === "OP01-NAMI" &&
      e.toCardId === "OP01-LUFFY-FINISHER",
  );
  assert.ok(re, "expected NAMI → LUFFY-FINISHER resource_engine edge");
});

test("defense_combo edges only link defenders that share an archetype", () => {
  const edges = detectRuleSynergies(RED_LEADER, POOL);
  const defense = edges.filter((e) => e.relationType === "defense_combo");
  // ZORO and DEFENDER share 麦わらの一味 → expect an edge.
  assert.ok(
    defense.some(
      (e) =>
        (e.fromCardId === "OP01-ZORO" && e.toCardId === "OP01-DEFENDER") ||
        (e.fromCardId === "OP01-DEFENDER" && e.toCardId === "OP01-ZORO"),
    ),
  );
});

test("anti_meta edges fire for removal cards even off-archetype", () => {
  const edges = detectRuleSynergies(RED_LEADER, POOL);
  // GREEN-OUTSIDER has Banish; it should still link to leader as anti_meta
  // even though it doesn't share a feature.
  const am = edges.find(
    (e) =>
      e.relationType === "anti_meta" &&
      e.fromCardId === RED_LEADER.id &&
      e.toCardId === "OP01-GREEN-OUTSIDER",
  );
  assert.ok(am);
});

test("output is sorted by strength desc and deterministic", () => {
  const a = detectRuleSynergies(RED_LEADER, POOL);
  const b = detectRuleSynergies(RED_LEADER, POOL);
  assert.deepEqual(a, b);
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i - 1].strength >= a[i].strength);
  }
});

test("strength is bounded to [0, 7] for the rule layer", () => {
  const edges = detectRuleSynergies(RED_LEADER, POOL);
  for (const e of edges) {
    assert.ok(e.strength >= 0 && e.strength <= 7, `${e.strength} out of bounds`);
  }
});

test("self-loops are dropped", () => {
  const edges = detectRuleSynergies(RED_LEADER, POOL);
  for (const e of edges) {
    assert.notEqual(e.fromCardId, e.toCardId);
  }
});

test("empty pool → empty edge list, no crash", () => {
  const edges = detectRuleSynergies(RED_LEADER, []);
  assert.deepEqual(edges, []);
});
