/**
 * Deterministic 5-metric deck evaluation.
 *
 * Inspired by Hearthstone-style "tribal" scorecards, but tuned for One
 * Piece TCG: each metric maps a structural property of the deck (cost
 * curve, counter total, mechanics distribution, …) to a 0–100 score so
 * the radar chart in the deck builder can compare two decks at a glance.
 *
 * Design rules:
 *  - Pure function of the deck's card list. No randomness, no LLM calls.
 *    Re-running on the same deck always yields the same score.
 *  - Every metric exposes a `breakdown[]` listing the contributing
 *    factors so the UI can show a tooltip explaining *why* a score is
 *    high or low. Without this we'd fall into the "trust me, your deck
 *    scores 73" trap that other TCG tools land in.
 *  - Heuristic constants live at the top of each metric in named
 *    consts; tuning them is expected. Don't bury magic numbers in the
 *    middle of arithmetic.
 *
 * The composite score is a weighted average that favours stability
 * (Yoshio's roadmap states "competitive players want consistency"), but
 * the UI mainly displays the radar — the composite is just for sorting.
 */

export interface EvalCard {
  id: string;
  cardType: string;
  colors: string[];
  features: string[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  hasTrigger: boolean;
  mechanics: string[];
  count: number;
}

export interface MetricBreakdown {
  factor: string;
  contribution: number;
  cap: number;
  detail?: string;
}

export interface MetricScore {
  /** 0–100 inclusive. */
  score: number;
  breakdown: MetricBreakdown[];
}

export type MetricKey = "attack" | "stability" | "expansion" | "defense" | "meta";

export interface DeckEvaluation {
  attack: MetricScore;
  stability: MetricScore;
  expansion: MetricScore;
  defense: MetricScore;
  meta: MetricScore;
  /** Weighted average for sorting / quick glance. */
  composite: number;
}

const COMPOSITE_WEIGHTS: Record<MetricKey, number> = {
  attack: 1,
  stability: 1.2,
  expansion: 1,
  defense: 1,
  meta: 0.8,
};

/* ──────────────────────────────────────────────────────────────────────── */

export function evaluateDeck(cards: EvalCard[]): DeckEvaluation {
  const attack = scoreAttack(cards);
  const stability = scoreStability(cards);
  const expansion = scoreExpansion(cards);
  const defense = scoreDefense(cards);
  const meta = scoreMeta(cards);

  const totalWeight = Object.values(COMPOSITE_WEIGHTS).reduce((a, b) => a + b, 0);
  const composite =
    (attack.score * COMPOSITE_WEIGHTS.attack +
      stability.score * COMPOSITE_WEIGHTS.stability +
      expansion.score * COMPOSITE_WEIGHTS.expansion +
      defense.score * COMPOSITE_WEIGHTS.defense +
      meta.score * COMPOSITE_WEIGHTS.meta) /
    totalWeight;

  return {
    attack,
    stability,
    expansion,
    defense,
    meta,
    composite: round1(composite),
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* 攻撃力 (Attack) — finisher density × power level × on-attack synergy     */
/* ──────────────────────────────────────────────────────────────────────── */

function scoreAttack(cards: EvalCard[]): MetricScore {
  const TARGET_AVG_POWER = 6500;
  const BASELINE_POWER = 3000;
  const POWER_CAP = 60;
  const FINISHER_CAP = 20;
  const ONATTACK_CAP = 10;
  const BUFF_CAP = 10;

  const characters = cards.filter(
    (c) => c.cardType === "CHARACTER" && c.power !== null,
  );
  const charWeight = totalCount(characters) || 1;
  const avgPower =
    characters.reduce((acc, c) => acc + (c.power ?? 0) * c.count, 0) / charWeight;
  const powerScore = clampScore(
    ((avgPower - BASELINE_POWER) / (TARGET_AVG_POWER - BASELINE_POWER)) * POWER_CAP,
    POWER_CAP,
  );

  const finisherCount = totalCount(
    characters.filter(
      (c) => (c.cost ?? 0) >= 6 || c.mechanics.includes("Rush"),
    ),
  );
  const finisherScore = clampScore(finisherCount * 2, FINISHER_CAP);

  const onAttackCount = totalCount(cards.filter((c) => c.mechanics.includes("OnAttack")));
  const onAttackScore = clampScore(onAttackCount * 1.5, ONATTACK_CAP);

  const buffCount = totalCount(cards.filter((c) => c.mechanics.includes("PowerBuff")));
  const buffScore = clampScore(buffCount * 1, BUFF_CAP);

  return {
    score: round1(powerScore + finisherScore + onAttackScore + buffScore),
    breakdown: [
      {
        factor: "平均パワー",
        contribution: round1(powerScore),
        cap: POWER_CAP,
        detail: `キャラ平均 ${Math.round(avgPower)} (目標 ${TARGET_AVG_POWER})`,
      },
      {
        factor: "フィニッシャー枚数",
        contribution: round1(finisherScore),
        cap: FINISHER_CAP,
        detail: `cost≥6 または [速攻] ×${finisherCount}`,
      },
      {
        factor: "[アタック時] 効果",
        contribution: round1(onAttackScore),
        cap: ONATTACK_CAP,
        detail: `${onAttackCount} 枚`,
      },
      {
        factor: "パワーバフ",
        contribution: round1(buffScore),
        cap: BUFF_CAP,
        detail: `${buffCount} 枚`,
      },
    ],
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* 安定性 (Stability) — early-game density + draw/search + curve flatness   */
/* ──────────────────────────────────────────────────────────────────────── */

function scoreStability(cards: EvalCard[]): MetricScore {
  const LOW_CURVE_CAP = 40;
  const SEARCH_DRAW_CAP = 30;
  const VARIANCE_CAP = 30;

  const lowCurveCount = totalCount(
    cards.filter((c) => (c.cost ?? 99) <= 3 && c.cardType !== "LEADER"),
  );
  // 28+ low-cost cards is "very deployable"; 10 is the minimum baseline.
  const lowCurveScore = clampScore(((lowCurveCount - 10) / 18) * LOW_CURVE_CAP, LOW_CURVE_CAP);

  const searchDrawCount = totalCount(
    cards.filter(
      (c) =>
        c.mechanics.includes("Search") ||
        c.mechanics.includes("Draw") ||
        c.mechanics.includes("Look"),
    ),
  );
  const searchDrawScore = clampScore(searchDrawCount * 3, SEARCH_DRAW_CAP);

  const variance = costVariance(cards);
  const costedCount = totalCount(cards.filter((c) => typeof c.cost === "number"));
  // No deck → no shape to score. We'd otherwise hand out a free 30 points
  // for "0 variance" against an empty distribution, which misleads the radar.
  const varianceScore =
    costedCount < 5 ? 0 : clampScore(VARIANCE_CAP - variance * 6, VARIANCE_CAP);

  return {
    score: round1(lowCurveScore + searchDrawScore + varianceScore),
    breakdown: [
      {
        factor: "序盤展開 (cost ≤3)",
        contribution: round1(lowCurveScore),
        cap: LOW_CURVE_CAP,
        detail: `${lowCurveCount} 枚`,
      },
      {
        factor: "サーチ / ドロー / ルック",
        contribution: round1(searchDrawScore),
        cap: SEARCH_DRAW_CAP,
        detail: `${searchDrawCount} 枚`,
      },
      {
        factor: "コスト分布のなだらかさ",
        contribution: round1(varianceScore),
        cap: VARIANCE_CAP,
        detail: `分散 ${variance.toFixed(2)} (低いほど良)`,
      },
    ],
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* 展開力 (Expansion) — fast deployment, OnPlay value, Rush                 */
/* ──────────────────────────────────────────────────────────────────────── */

function scoreExpansion(cards: EvalCard[]): MetricScore {
  const LOW_CHAR_CAP = 35;
  const ONPLAY_CAP = 25;
  const RUSH_CAP = 20;
  const COSTREDUCE_CAP = 20;

  const lowCharCount = totalCount(
    cards.filter((c) => c.cardType === "CHARACTER" && (c.cost ?? 99) <= 4),
  );
  const lowCharScore = clampScore((lowCharCount / 30) * LOW_CHAR_CAP, LOW_CHAR_CAP);

  const onPlayCount = totalCount(cards.filter((c) => c.mechanics.includes("OnPlay")));
  const onPlayScore = clampScore(onPlayCount * 1.5, ONPLAY_CAP);

  const rushCount = totalCount(cards.filter((c) => c.mechanics.includes("Rush")));
  const rushScore = clampScore(rushCount * 4, RUSH_CAP);

  const costReduceCount = totalCount(
    cards.filter((c) => c.mechanics.includes("CostReduction")),
  );
  const costReduceScore = clampScore(costReduceCount * 3, COSTREDUCE_CAP);

  return {
    score: round1(lowCharScore + onPlayScore + rushScore + costReduceScore),
    breakdown: [
      {
        factor: "低コストキャラ (cost ≤4)",
        contribution: round1(lowCharScore),
        cap: LOW_CHAR_CAP,
        detail: `${lowCharCount} 枚`,
      },
      {
        factor: "[登場時] 効果",
        contribution: round1(onPlayScore),
        cap: ONPLAY_CAP,
        detail: `${onPlayCount} 枚`,
      },
      {
        factor: "[速攻]",
        contribution: round1(rushScore),
        cap: RUSH_CAP,
        detail: `${rushCount} 枚`,
      },
      {
        factor: "コスト軽減",
        contribution: round1(costReduceScore),
        cap: COSTREDUCE_CAP,
        detail: `${costReduceCount} 枚`,
      },
    ],
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* 防御力 (Defense) — counter density, blockers, restore, triggers          */
/* ──────────────────────────────────────────────────────────────────────── */

function scoreDefense(cards: EvalCard[]): MetricScore {
  const COUNTER_CAP = 35;
  const BLOCKER_CAP = 25;
  const RESTORE_CAP = 20;
  const TRIGGER_CAP = 20;

  const total = totalCount(cards) || 1;
  const counterTotal = cards.reduce((acc, c) => acc + (c.counter ?? 0) * c.count, 0);
  const counterAvg = counterTotal / total;
  // A "balanced" deck averages ~700–900 counter per card.
  const counterScore = clampScore((counterAvg / 1500) * COUNTER_CAP, COUNTER_CAP);

  const blockerCount = totalCount(cards.filter((c) => c.mechanics.includes("Blocker")));
  const blockerScore = clampScore(blockerCount * 3, BLOCKER_CAP);

  const restoreCount = totalCount(cards.filter((c) => c.mechanics.includes("RestoreLife")));
  const restoreScore = clampScore(restoreCount * 5, RESTORE_CAP);

  const triggerCount = totalCount(cards.filter((c) => c.hasTrigger));
  const triggerScore = clampScore(triggerCount * 1.5, TRIGGER_CAP);

  return {
    score: round1(counterScore + blockerScore + restoreScore + triggerScore),
    breakdown: [
      {
        factor: "平均カウンター値",
        contribution: round1(counterScore),
        cap: COUNTER_CAP,
        detail: `${Math.round(counterAvg)} / 1500`,
      },
      {
        factor: "[ブロッカー]",
        contribution: round1(blockerScore),
        cap: BLOCKER_CAP,
        detail: `${blockerCount} 枚`,
      },
      {
        factor: "ライフ回復",
        contribution: round1(restoreScore),
        cap: RESTORE_CAP,
        detail: `${restoreCount} 枚`,
      },
      {
        factor: "[トリガー] 持ち",
        contribution: round1(triggerScore),
        cap: TRIGGER_CAP,
        detail: `${triggerCount} 枚`,
      },
    ],
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* 対環境性能 (Meta) — removal toolbox, archetype flexibility               */
/* ──────────────────────────────────────────────────────────────────────── */

function scoreMeta(cards: EvalCard[]): MetricScore {
  const REMOVAL_CAP = 30;
  const REST_CAP = 20;
  const RETURN_CAP = 15;
  const FEATURE_CAP = 20;
  const COLOR_BONUS_CAP = 15;

  const removalCount = totalCount(
    cards.filter(
      (c) =>
        c.mechanics.includes("Banish") ||
        c.mechanics.includes("Trash") ||
        c.mechanics.includes("OnKO"),
    ),
  );
  const removalScore = clampScore(removalCount * 3, REMOVAL_CAP);

  const restOpponentCount = totalCount(
    cards.filter((c) => c.mechanics.includes("RestOpponentCard")),
  );
  const restScore = clampScore(restOpponentCount * 3, REST_CAP);

  const returnCount = totalCount(
    cards.filter((c) => c.mechanics.includes("ReturnToHand")),
  );
  const returnScore = clampScore(returnCount * 3, RETURN_CAP);

  const features = new Set(cards.flatMap((c) => c.features));
  const featureScore = clampScore(features.size * 2, FEATURE_CAP);

  const colorSet = new Set(cards.flatMap((c) => c.colors));
  const colorBonus = clampScore((colorSet.size - 1) * COLOR_BONUS_CAP, COLOR_BONUS_CAP);

  return {
    score: round1(removalScore + restScore + returnScore + featureScore + colorBonus),
    breakdown: [
      {
        factor: "除去 (バニッシュ / トラッシュ / KO)",
        contribution: round1(removalScore),
        cap: REMOVAL_CAP,
        detail: `${removalCount} 枚`,
      },
      {
        factor: "相手をレスト",
        contribution: round1(restScore),
        cap: REST_CAP,
        detail: `${restOpponentCount} 枚`,
      },
      {
        factor: "手札に戻す",
        contribution: round1(returnScore),
        cap: RETURN_CAP,
        detail: `${returnCount} 枚`,
      },
      {
        factor: "特徴の多様性",
        contribution: round1(featureScore),
        cap: FEATURE_CAP,
        detail: `${features.size} 種`,
      },
      {
        factor: "色の柔軟性",
        contribution: round1(colorBonus),
        cap: COLOR_BONUS_CAP,
        detail: `${colorSet.size} 色`,
      },
    ],
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* helpers                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

function totalCount(cards: EvalCard[]): number {
  return cards.reduce((acc, c) => acc + c.count, 0);
}

function clampScore(raw: number, cap: number): number {
  if (Number.isNaN(raw) || raw <= 0) return 0;
  return Math.min(raw, cap);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Sample variance of cost values weighted by count. Cards without a cost
 * (Leaders, DON!!) are excluded.
 */
function costVariance(cards: EvalCard[]): number {
  const costed = cards.filter((c) => typeof c.cost === "number");
  const n = totalCount(costed);
  if (n === 0) return 0;
  const mean = costed.reduce((acc, c) => acc + (c.cost ?? 0) * c.count, 0) / n;
  const variance =
    costed.reduce((acc, c) => acc + Math.pow((c.cost ?? 0) - mean, 2) * c.count, 0) /
    n;
  return variance;
}
