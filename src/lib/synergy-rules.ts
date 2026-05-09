/**
 * Phase 3.5 — rule-based synergy detection.
 *
 * The full synergy pipeline is layered:
 *
 *    1. Rule layer (this file). Runs deterministically over the
 *       `mechanics[]` + `features[]` arrays and emits "obvious" edges
 *       like {Blocker, Counter} → defense_combo or
 *       {feature: 麦わらの一味, feature: 麦わらの一味} → feature_chain.
 *       No LLM, no DB writes — just pure functions.
 *
 *    2. AI layer (`src/ai/synergy.ts`). Calls Claude with a tool-use
 *       schema for the harder cases (effect interactions that don't
 *       reduce to keyword overlap). The output is filtered against the
 *       same `card_synergies` schema and tagged `detected_by = "ai"`.
 *
 *    3. UI layer. Reads from `card_synergies` (no recompute on every
 *       render) and renders the d3-force graph. Per AGENTS.md, AI-tagged
 *       edges show a hint badge so the user can sanity-check before
 *       building around them.
 *
 * The output of *this* file is meant to be cheap and high-precision —
 * better to miss a subtle synergy and let the AI catch it than to
 * spam false-positive edges that break the graph's signal-to-noise.
 */

import type { CardListItem } from "@/lib/cards";
import type { SynergyRelationType } from "@/db/schema";

export interface RuleSynergy {
  fromCardId: string;
  toCardId: string;
  relationType: SynergyRelationType;
  /** 0–10 inclusive. Rule-based scores cap at 7 so AI augmentation can outscore. */
  strength: number;
  reasoningJa: string;
  reasoningEn: string;
}

interface DetectorContext {
  /** The leader the deck is built around (synergy is leader-relative). */
  leader: CardListItem;
  /** Every card under consideration (typically: deck pool filtered by leader colors). */
  pool: CardListItem[];
  /** Quick lookup by id. */
  byId: Map<string, CardListItem>;
}

type Detector = (ctx: DetectorContext) => RuleSynergy[];

/**
 * Collect every rule-based edge for a leader + card pool.
 *
 * Edges are deduplicated by (from, to, relationType) — the highest
 * `strength` wins on duplicates. Self-loops are dropped so the d3
 * graph never has to handle them.
 */
export function detectRuleSynergies(
  leader: CardListItem,
  pool: CardListItem[],
): RuleSynergy[] {
  const ctx: DetectorContext = {
    leader,
    pool,
    byId: new Map(pool.map((c) => [c.id, c])),
  };

  const merged = new Map<string, RuleSynergy>();
  for (const detector of DETECTORS) {
    for (const edge of detector(ctx)) {
      if (edge.fromCardId === edge.toCardId) continue;
      const key = `${edge.fromCardId}::${edge.toCardId}::${edge.relationType}`;
      const existing = merged.get(key);
      if (!existing || edge.strength > existing.strength) {
        merged.set(key, edge);
      }
    }
  }
  return [...merged.values()].sort(
    (a, b) =>
      b.strength - a.strength ||
      a.fromCardId.localeCompare(b.fromCardId) ||
      a.toCardId.localeCompare(b.toCardId),
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Detectors                                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Leader → card direct connection: any card that shares ≥1 feature with the
 * leader gets an edge tagged `leader_direct`. Strength scales with feature
 * overlap (1 shared = 4, 2 = 5, 3+ = 6). Caps below the 7 ceiling so AI
 * detectors can win on close calls.
 */
const detectLeaderFeatureLinks: Detector = (ctx) => {
  const leaderFeatures = new Set(ctx.leader.features);
  if (leaderFeatures.size === 0) return [];

  const out: RuleSynergy[] = [];
  for (const card of ctx.pool) {
    if (card.id === ctx.leader.id) continue;
    const shared = card.features.filter((f) => leaderFeatures.has(f));
    if (shared.length === 0) continue;
    const strength = Math.min(6, 3 + shared.length);
    out.push({
      fromCardId: ctx.leader.id,
      toCardId: card.id,
      relationType: "leader_direct",
      strength,
      reasoningJa: `リーダー特徴 ${shared.join(", ")} と一致。`,
      reasoningEn: `Shares feature(s) with leader: ${shared.join(", ")}.`,
    });
  }
  return out;
};

/** {Blocker, Counter ≥2000} → defense_combo edges between defenders. */
const detectDefenseCombos: Detector = (ctx) => {
  const defenders = ctx.pool.filter(
    (c) =>
      c.cardType === "CHARACTER" &&
      (c.mechanics.includes("Blocker") || (c.counter ?? 0) >= 2000),
  );
  const out: RuleSynergy[] = [];
  for (let i = 0; i < defenders.length; i++) {
    for (let j = i + 1; j < defenders.length; j++) {
      const a = defenders[i];
      const b = defenders[j];
      if (!shareFeatures(a, b)) continue; // only link defenders that share an archetype
      out.push({
        fromCardId: a.id,
        toCardId: b.id,
        relationType: "defense_combo",
        strength: 5,
        reasoningJa: `[ブロッカー] / 高カウンターの守備札同士。`,
        reasoningEn: `Both are defensive ([Blocker] or counter ≥2000) sharing an archetype.`,
      });
    }
  }
  return out;
};

/** {Search/Look/Draw} → resource_engine edges with feature-sharing finishers. */
const detectResourceToFinisherEdges: Detector = (ctx) => {
  const enablers = ctx.pool.filter((c) =>
    c.mechanics.some((m) => m === "Search" || m === "Look" || m === "Draw"),
  );
  const finishers = ctx.pool.filter(
    (c) => (c.cost ?? 0) >= 6 || c.mechanics.includes("Rush"),
  );
  const out: RuleSynergy[] = [];
  for (const e of enablers) {
    for (const f of finishers) {
      if (e.id === f.id) continue;
      if (!shareFeatures(e, f)) continue;
      out.push({
        fromCardId: e.id,
        toCardId: f.id,
        relationType: "resource_engine",
        strength: 5,
        reasoningJa: `${e.name} のサーチ/ドロー → ${f.name} に到達。`,
        reasoningEn: `${e.name}'s search/draw chains into ${f.name}.`,
      });
    }
  }
  return out;
};

/** {Rush, OnAttack, PowerBuff} → tempo_combo edges with same archetype. */
const detectTempoCombos: Detector = (ctx) => {
  const aggressors = ctx.pool.filter(
    (c) =>
      c.mechanics.includes("Rush") ||
      c.mechanics.includes("OnAttack") ||
      c.mechanics.includes("PowerBuff"),
  );
  const out: RuleSynergy[] = [];
  for (let i = 0; i < aggressors.length; i++) {
    for (let j = i + 1; j < aggressors.length; j++) {
      const a = aggressors[i];
      const b = aggressors[j];
      if (!shareFeatures(a, b)) continue;
      out.push({
        fromCardId: a.id,
        toCardId: b.id,
        relationType: "tempo_combo",
        strength: 4,
        reasoningJa: `${a.name} と ${b.name} はテンポ系効果 + 特徴一致。`,
        reasoningEn: `${a.name} and ${b.name} are both tempo-pushing and share an archetype.`,
      });
    }
  }
  return out;
};

/**
 * Removal toolbox edges. {Banish, Trash, RestOpponentCard, ReturnToHand}
 * cards link to the leader as `anti_meta` so the synergy graph clusters
 * them visually around the leader rather than scattering them.
 */
const detectAntiMetaTools: Detector = (ctx) => {
  const out: RuleSynergy[] = [];
  for (const card of ctx.pool) {
    if (card.id === ctx.leader.id) continue;
    const tags = card.mechanics.filter(
      (m) =>
        m === "Banish" ||
        m === "Trash" ||
        m === "RestOpponentCard" ||
        m === "ReturnToHand",
    );
    if (tags.length === 0) continue;
    out.push({
      fromCardId: ctx.leader.id,
      toCardId: card.id,
      relationType: "anti_meta",
      strength: 3 + Math.min(2, tags.length - 1),
      reasoningJa: `除去手段 (${tags.join(", ")}) を持つメタ対応札。`,
      reasoningEn: `Removal toolbox (${tags.join(", ")}) — useful against problem boards.`,
    });
  }
  return out;
};

/**
 * Generic feature_chain edges between non-leader cards that share ≥2
 * features. Strength is 3 (lower than leader_direct) so the leader stays
 * visually central in the synergy graph.
 */
const detectFeatureChains: Detector = (ctx) => {
  const out: RuleSynergy[] = [];
  for (let i = 0; i < ctx.pool.length; i++) {
    for (let j = i + 1; j < ctx.pool.length; j++) {
      const a = ctx.pool[i];
      const b = ctx.pool[j];
      if (a.id === ctx.leader.id || b.id === ctx.leader.id) continue;
      const shared = a.features.filter((f) => b.features.includes(f));
      if (shared.length < 2) continue;
      out.push({
        fromCardId: a.id,
        toCardId: b.id,
        relationType: "feature_chain",
        strength: 3,
        reasoningJa: `特徴 ${shared.join(", ")} を共有。`,
        reasoningEn: `Shares features ${shared.join(", ")}.`,
      });
    }
  }
  return out;
};

const DETECTORS: Detector[] = [
  detectLeaderFeatureLinks,
  detectDefenseCombos,
  detectResourceToFinisherEdges,
  detectTempoCombos,
  detectAntiMetaTools,
  detectFeatureChains,
];

/* ──────────────────────────────────────────────────────────────────────── */
/* helpers                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

function shareFeatures(a: CardListItem, b: CardListItem): boolean {
  const setA = new Set(a.features);
  return b.features.some((f) => setA.has(f));
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Card-relative compatibility (no leader required)                          */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Find rule-based synergies relative to a single card. Used by the card
 * detail page's "相性の良いカード Top 5" section, which doesn't have a
 * leader anchor — we want to surface compatible cards across the whole
 * pool regardless of who the leader is.
 *
 * Logic mirrors the leader-relative detectors but flips the perspective:
 * the *target* card is one endpoint of every emitted edge.
 *
 * Caller is expected to pre-filter `pool` (e.g. drop other LEADER cards
 * if it wants character/event/stage-only results).
 */
export function detectCompatibilityFor(
  target: CardListItem,
  pool: CardListItem[],
): RuleSynergy[] {
  const out: RuleSynergy[] = [];
  const targetIsDefender =
    target.cardType === "CHARACTER" &&
    (target.mechanics.includes("Blocker") || (target.counter ?? 0) >= 2000);
  const targetIsAggressor =
    target.mechanics.includes("Rush") ||
    target.mechanics.includes("OnAttack") ||
    target.mechanics.includes("PowerBuff");
  const targetIsEnabler = target.mechanics.some(
    (m) => m === "Search" || m === "Look" || m === "Draw",
  );
  const targetIsFinisher =
    (target.cost ?? 0) >= 6 || target.mechanics.includes("Rush");

  for (const other of pool) {
    if (other.id === target.id) continue;
    const shared = target.features.filter((f) => other.features.includes(f));

    // Defense combo — both defenders + share an archetype.
    const otherIsDefender =
      other.cardType === "CHARACTER" &&
      (other.mechanics.includes("Blocker") || (other.counter ?? 0) >= 2000);
    if (targetIsDefender && otherIsDefender && shared.length > 0) {
      out.push({
        fromCardId: target.id,
        toCardId: other.id,
        relationType: "defense_combo",
        strength: 5,
        reasoningJa: `2まいともあいてのこうげきを止めるカード。ならべておくと、相手の大ダメージを何回でもブロックできるよ。`,
        reasoningEn: `Both are defensive (Blocker / counter ≥2000) sharing the ${shared[0]} archetype.`,
      });
    }

    // Tempo combo — both aggressors + share an archetype.
    const otherIsAggressor =
      other.mechanics.includes("Rush") ||
      other.mechanics.includes("OnAttack") ||
      other.mechanics.includes("PowerBuff");
    if (targetIsAggressor && otherIsAggressor && shared.length > 0) {
      out.push({
        fromCardId: target.id,
        toCardId: other.id,
        relationType: "tempo_combo",
        strength: 4,
        reasoningJa: `2まいともすぐにこうげきできる速攻系。ターンの最初から相手にプレッシャーをかけて、ライフをけずれるよ。`,
        reasoningEn: `Both push tempo (Rush/OnAttack/PowerBuff) sharing ${shared[0]}.`,
      });
    }

    // Resource → finisher (both directions: target as enabler or finisher).
    const otherIsEnabler = other.mechanics.some(
      (m) => m === "Search" || m === "Look" || m === "Draw",
    );
    const otherIsFinisher =
      (other.cost ?? 0) >= 6 || other.mechanics.includes("Rush");
    if (targetIsEnabler && otherIsFinisher && shared.length > 0 && other.id !== target.id) {
      out.push({
        fromCardId: target.id,
        toCardId: other.id,
        relationType: "resource_engine",
        strength: 5,
        reasoningJa: `${target.name} でデッキから${other.name}をさがして引きこめる。フィニッシャーまでスムーズにつなげるコンボ。`,
        reasoningEn: `${target.name} (search/draw) chains into finisher ${other.name}.`,
      });
    } else if (targetIsFinisher && otherIsEnabler && shared.length > 0) {
      out.push({
        fromCardId: other.id,
        toCardId: target.id,
        relationType: "resource_engine",
        strength: 5,
        reasoningJa: `${other.name} でデッキから${target.name}をさがして手に入れられる。大きなフィニッシャーをにぎるコンボ。`,
        reasoningEn: `${other.name} (search/draw) reaches finisher ${target.name}.`,
      });
    }

    // Feature chain — non-leader cards sharing ≥2 features.
    if (
      target.cardType !== "LEADER" &&
      other.cardType !== "LEADER" &&
      shared.length >= 2
    ) {
      out.push({
        fromCardId: target.id,
        toCardId: other.id,
        relationType: "feature_chain",
        strength: 3,
        reasoningJa: `「${shared.slice(0, 2).join("」「")}」のとくちょうをいっしょに持ってる仲間カード。同じデッキに入れると場がそろうよ。`,
        reasoningEn: `Shares ${shared.length} features with ${target.name}.`,
      });
    }
  }

  // Dedup on (from, to, relationType), strongest wins.
  const merged = new Map<string, RuleSynergy>();
  for (const e of out) {
    const key = `${e.fromCardId}::${e.toCardId}::${e.relationType}`;
    const existing = merged.get(key);
    if (!existing || e.strength > existing.strength) merged.set(key, e);
  }
  return [...merged.values()];
}
