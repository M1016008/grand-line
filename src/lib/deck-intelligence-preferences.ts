import type { CardListItem } from "@/lib/cards";
import type { DeckRegulations } from "@/lib/deck-rules";
import type { Mechanic } from "@/lib/mechanics";
import {
  detectRuleSynergies,
  type RuleSynergy,
} from "@/lib/synergy-rules";

export const MAIN_STYLE_IDS = [
  "auto",
  "aggressive",
  "midrange",
  "defensive",
  "removal",
  "control",
  "resource",
  "combo",
  "tempo",
  "ramp",
  "balanced",
] as const;

export type MainStyle = (typeof MAIN_STYLE_IDS)[number];

export const MAIN_STYLE_LABELS: Record<MainStyle, string> = {
  auto: "おまかせ",
  aggressive: "攻撃型",
  midrange: "ミッドレンジ型",
  defensive: "防御型",
  removal: "除去型",
  control: "コントロール型",
  resource: "リソース型",
  combo: "コンボ型",
  tempo: "テンポ型",
  ramp: "ランプ型",
  balanced: "バランス型",
};

export const FEATURE_TAG_IDS = [
  "trigger_focus",
  "search_focus",
  "blocker_focus",
  "wide_board",
  "high_cost_focus",
  "bounce_focus",
  "hand_disruption",
  "cost_manipulation",
  "life_manipulation",
  "trash_utilization",
  "counter_focus",
  "finisher_focus",
] as const;

export type FeatureTag = (typeof FEATURE_TAG_IDS)[number];

export const FEATURE_TAG_LABELS: Record<FeatureTag, string> = {
  trigger_focus: "トリガー重視",
  search_focus: "サーチ多め",
  blocker_focus: "ブロッカー多め",
  wide_board: "横展開",
  high_cost_focus: "高コスト重視",
  bounce_focus: "バウンス",
  hand_disruption: "手札破壊",
  cost_manipulation: "コスト操作",
  life_manipulation: "ライフ操作",
  trash_utilization: "トラッシュ活用",
  counter_focus: "カウンター重視",
  finisher_focus: "フィニッシャー重視",
};

export const VARIANT_PROFILE_IDS = [
  "recommended",
  "consistency",
  "specialization",
] as const;

export type VariantProfile = (typeof VARIANT_PROFILE_IDS)[number];

export const VARIANT_PROFILE_LABELS: Record<VariantProfile, string> = {
  recommended: "推奨構築",
  consistency: "安定構築",
  specialization: "特化構築",
};

export const VARIANT_PROFILE_FOCUS_LABELS: Record<VariantProfile, string> = {
  recommended: "推奨",
  consistency: "安定性重視",
  specialization: "特化度重視",
};

/**
 * Mechanic names emitted by the current extractor and observed in the real DB.
 * Empty arrays are deliberate: those tags use printed stats instead of a
 * synthetic mechanic (for example Counter is not an extracted mechanic).
 */
export const FEATURE_TAG_MECHANIC_SIGNALS: Record<
  FeatureTag,
  readonly Mechanic[]
> = {
  trigger_focus: ["Trigger"],
  search_focus: ["Search", "Look"],
  blocker_focus: ["Blocker"],
  wide_board: ["OnPlay"],
  high_cost_focus: [],
  bounce_focus: ["ReturnToHand"],
  hand_disruption: ["Discard"],
  cost_manipulation: ["CostReduction"],
  life_manipulation: ["AddToLife", "Trigger"],
  trash_utilization: ["PlayFromTrash", "OnKO"],
  counter_focus: [],
  finisher_focus: ["Rush", "Banish", "PowerBuff", "OnAttack"],
};

export const MAX_FEATURE_TAGS = 3;
export const MAIN_STYLE_SCORE_CAP = 14;
export const FEATURE_TAG_SCORE_CAP = 9;
export const RELATIONSHIP_SCORE_CAP = 12;
export const VARIANT_PROFILE_SCORE_CAP = 5;

export interface DeckPreferenceSelection {
  selectedStyle: MainStyle;
  selectedTags: FeatureTag[];
}

export interface DeckCandidateRelationshipEvidence {
  leaderDirect: number;
  compatibleRelationships: number;
  synergyData: number;
  searchability: number;
  featureSupport: number;
}

export interface DeckCandidateRankingContext {
  evidenceByCardId: ReadonlyMap<string, DeckCandidateRelationshipEvidence>;
}

export interface PreparedDeckCandidateRanking<T extends CardListItem = CardListItem> {
  eligiblePool: T[];
  analysisPool: T[];
  rankingContext: DeckCandidateRankingContext;
  effectiveSelection: DeckPreferenceSelection;
  aptitudes: LeaderStyleAptitude[];
  effectiveStyle: Exclude<MainStyle, "auto">;
}

export interface DeckCandidateScore {
  leaderAffinity: number;
  mainStyle: number;
  variantProfile: number;
  featureTags: number;
  relationships: number;
  total: number;
}

export interface RankedDeckCandidate {
  card: CardListItem;
  score: DeckCandidateScore;
}

export interface LeaderStyleAptitude {
  style: MainStyle;
  /** Deterministic 0-100 score. */
  score: number;
  /** UI-friendly 1-5 star band derived from score. */
  stars: 1 | 2 | 3 | 4 | 5;
  signals: {
    leaderEffectMechanics: number;
    leaderFeatures: number;
    legalCardPool: number;
    supportCards: number;
    synergySupport: number;
  };
}

export class DeckPreferenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckPreferenceValidationError";
  }
}

export function isMainStyle(value: unknown): value is MainStyle {
  return MAIN_STYLE_IDS.includes(value as MainStyle);
}

export function isFeatureTag(value: unknown): value is FeatureTag {
  return FEATURE_TAG_IDS.includes(value as FeatureTag);
}

export function resolveDeckPreferences(
  selectedStyle: unknown = "auto",
  selectedTags: unknown = [],
): DeckPreferenceSelection {
  if (!isMainStyle(selectedStyle)) {
    throw new DeckPreferenceValidationError(
      `Unknown main style: ${String(selectedStyle)}`,
    );
  }
  if (!Array.isArray(selectedTags)) {
    throw new DeckPreferenceValidationError("selectedTags must be an array.");
  }
  if (selectedTags.length > MAX_FEATURE_TAGS) {
    throw new DeckPreferenceValidationError(
      `Select at most ${MAX_FEATURE_TAGS} feature tags.`,
    );
  }
  if (!selectedTags.every(isFeatureTag)) {
    throw new DeckPreferenceValidationError("selectedTags contains an unknown tag.");
  }
  if (new Set(selectedTags).size !== selectedTags.length) {
    throw new DeckPreferenceValidationError(
      "selectedTags cannot contain duplicates.",
    );
  }
  return { selectedStyle, selectedTags: [...selectedTags] };
}

/** Filter once for both ranking and aptitude so legal-pool rules stay aligned. */
export function eligibleDeckCandidates<T extends CardListItem>(
  leader: CardListItem,
  cards: T[],
  regulations: DeckRegulations = {},
): T[] {
  const leaderColors = new Set(leader.colors);
  return cards.filter(
    (card) =>
      card.id !== leader.id &&
      card.cardType !== "LEADER" &&
      ["CHARACTER", "EVENT", "STAGE"].includes(card.cardType) &&
      isVerifiedOfficialCard(card) &&
      card.colors.some((color) => leaderColors.has(color)) &&
      (regulations.perCardMax?.get(card.id) ?? 4) > 0,
  );
}

export function isVerifiedOfficialCard(
  card: Pick<CardListItem, "verified" | "source">,
): boolean {
  return (
    card.verified &&
    (card.source === "official_jp" || card.source === "official_en")
  );
}

/**
 * Reuses the established rule-synergy graph and folds optional persisted AI
 * edges into compact ranking evidence. The edge detection itself remains in
 * synergy-rules.ts; no relationship rule is reimplemented here.
 */
export function buildDeckCandidateRankingContext(
  leader: CardListItem,
  cards: CardListItem[],
  persistedSynergies: RuleSynergy[] = [],
): DeckCandidateRankingContext {
  const ruleSynergies = detectRuleSynergies(leader, cards);
  const evidenceByCardId = new Map<string, DeckCandidateRelationshipEvidence>();
  const featureCounts = new Map<string, number>();

  for (const card of cards) {
    for (const feature of card.features) {
      featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + 1);
    }
  }

  const evidenceFor = (cardId: string) => {
    let evidence = evidenceByCardId.get(cardId);
    if (!evidence) {
      evidence = {
        leaderDirect: 0,
        compatibleRelationships: 0,
        synergyData: 0,
        searchability: 0,
        featureSupport: 0,
      };
      evidenceByCardId.set(cardId, evidence);
    }
    return evidence;
  };

  for (const card of cards) {
    const supportedFeatures = card.features.filter(
      (feature) => (featureCounts.get(feature) ?? 0) >= 2,
    ).length;
    evidenceFor(card.id).featureSupport = Math.min(2, supportedFeatures);
  }

  for (const edge of ruleSynergies) {
    for (const cardId of edgeCardIds(edge, leader.id)) {
      const evidence = evidenceFor(cardId);
      if (edge.relationType === "leader_direct") {
        evidence.leaderDirect = Math.max(evidence.leaderDirect, edge.strength);
      } else {
        evidence.compatibleRelationships = Math.min(
          10,
          evidence.compatibleRelationships + edge.strength,
        );
      }
      if (edge.relationType === "resource_engine") {
        evidence.searchability = Math.max(evidence.searchability, edge.strength);
      }
    }
  }

  for (const edge of persistedSynergies) {
    for (const cardId of edgeCardIds(edge, leader.id)) {
      const evidence = evidenceFor(cardId);
      evidence.synergyData = Math.max(evidence.synergyData, edge.strength);
      if (edge.relationType === "leader_direct") {
        evidence.leaderDirect = Math.max(evidence.leaderDirect, edge.strength);
      }
    }
  }

  return { evidenceByCardId };
}

/**
 * Shared preparation for every deterministic Deck Intelligence consumer.
 * Optimizer and AI proposal generation use the same legality filter,
 * relationship graph, aptitude calculation, and auto-style resolution.
 */
export function prepareDeckCandidateRanking<T extends CardListItem>(
  leader: CardListItem,
  cards: T[],
  selection: DeckPreferenceSelection,
  regulations: DeckRegulations = {},
  persistedSynergies: RuleSynergy[] = [],
): PreparedDeckCandidateRanking<T> {
  const eligiblePool = eligibleDeckCandidates(leader, cards, regulations);
  const analysisPool = seedAnalysisPool(leader, eligiblePool);
  const rankingContext = buildDeckCandidateRankingContext(
    leader,
    analysisPool,
    persistedSynergies,
  );
  const aptitudes = calculateLeaderStyleAptitudesFromContext(
    leader,
    analysisPool,
    eligiblePool.length,
    rankingContext,
  );
  const effectiveStyle =
    selection.selectedStyle === "auto"
      ? recommendedMainStyle(aptitudes)
      : selection.selectedStyle;
  return {
    eligiblePool,
    analysisPool,
    rankingContext,
    effectiveSelection: { ...selection, selectedStyle: effectiveStyle },
    aptitudes,
    effectiveStyle,
  };
}

export function rankDeckCandidates(
  leader: CardListItem,
  cards: CardListItem[],
  selection: DeckPreferenceSelection,
  context?: DeckCandidateRankingContext,
  variantProfile: VariantProfile = "recommended",
): RankedDeckCandidate[] {
  return cards
    .map((card) => ({
      card,
      score: scoreDeckCandidate(
        leader,
        card,
        selection,
        context,
        variantProfile,
      ),
    }))
    .sort(
      (a, b) =>
        b.score.total - a.score.total ||
        b.score.leaderAffinity - a.score.leaderAffinity ||
        b.score.mainStyle - a.score.mainStyle ||
        b.score.variantProfile - a.score.variantProfile ||
        b.score.relationships - a.score.relationships ||
        b.score.featureTags - a.score.featureTags ||
        a.card.id.localeCompare(b.card.id),
    );
}

export function scoreDeckCandidate(
  leader: CardListItem,
  card: CardListItem,
  selection: DeckPreferenceSelection,
  context?: DeckCandidateRankingContext,
  variantProfile: VariantProfile = "recommended",
): DeckCandidateScore {
  const sharedFeatures = countSharedFeatures(leader, card);
  const evidence = context?.evidenceByCardId.get(card.id);
  const directAffinity = evidence
    ? evidence.leaderDirect * 2
    : sharedFeatures * 8;
  const leaderAffinity = Math.min(20, directAffinity + genericRoleScore(card));
  const mainStyle = Math.min(
    MAIN_STYLE_SCORE_CAP,
    mainStyleScore(card, selection.selectedStyle),
  );
  const featureTags = Math.min(
    FEATURE_TAG_SCORE_CAP,
    selection.selectedTags.reduce(
      (sum, tag) => sum + featureTagScore(card, tag, sharedFeatures),
      0,
    ),
  );
  const profileScore = Math.min(
    VARIANT_PROFILE_SCORE_CAP,
    variantProfileScore(
      card,
      variantProfile,
      mainStyle,
      featureTags,
      evidence,
    ),
  );
  const relationships = evidence
    ? Math.min(
        RELATIONSHIP_SCORE_CAP,
        Math.min(3, Math.ceil(evidence.compatibleRelationships / 4)) +
          Math.min(3, Math.ceil(evidence.synergyData / 3)) +
          Math.min(2, Math.ceil(evidence.searchability / 3)) +
          evidence.featureSupport,
      )
    : 0;
  return {
    leaderAffinity,
    mainStyle,
    variantProfile: profileScore,
    featureTags,
    relationships,
    total:
      leaderAffinity +
      mainStyle +
      profileScore +
      featureTags +
      relationships,
  };
}

function variantProfileScore(
  card: CardListItem,
  profile: VariantProfile,
  mainStyle: number,
  featureTags: number,
  evidence: DeckCandidateRelationshipEvidence | undefined,
): number {
  if (profile === "recommended") return 0;

  if (profile === "consistency") {
    const cost = card.cost ?? 99;
    const counter = card.counter ?? 0;
    const searchable =
      (evidence?.searchability ?? 0) > 0 ||
      hasAnyMechanic(card, ["Search", "Look"]);
    const supportedCore =
      (evidence?.leaderDirect ?? 0) > 0 &&
      (evidence?.featureSupport ?? 0) > 0;
    return (
      (searchable ? 2 : 0) +
      (supportedCore ? 1 : 0) +
      (counter >= 2000 ? 2 : counter >= 1000 ? 1 : 0) +
      (cost >= 2 && cost <= 5 ? 1 : 0)
    );
  }

  // Specialization reinforces the already-selected style/tag signals, but
  // stays within its own small cap. It never changes the style or tag cap.
  return (
    Math.min(3, Math.ceil(mainStyle / 4)) +
    (featureTags >= 6 ? 2 : featureTags >= 3 ? 1 : 0)
  );
}

/**
 * Score every main style from leader mechanics/features, legal pool depth,
 * style-support availability, and the shared relationship graph.
 */
export function calculateLeaderStyleAptitudes(
  leader: CardListItem,
  cards: CardListItem[],
  regulations: DeckRegulations = {},
  persistedSynergies: RuleSynergy[] = [],
): LeaderStyleAptitude[] {
  const eligible = eligibleDeckCandidates(leader, cards, regulations);
  const analysisPool = seedAnalysisPool(leader, eligible);
  const context = buildDeckCandidateRankingContext(
    leader,
    analysisPool,
    persistedSynergies,
  );
  return calculateLeaderStyleAptitudesFromContext(
    leader,
    analysisPool,
    eligible.length,
    context,
  );
}

/** Use when the caller already built the relationship graph for ranking. */
export function calculateLeaderStyleAptitudesFromContext(
  leader: CardListItem,
  analysisPool: CardListItem[],
  legalPoolSize: number,
  context: DeckCandidateRankingContext,
): LeaderStyleAptitude[] {
  const styles = MAIN_STYLE_IDS.filter(
    (style): style is Exclude<MainStyle, "auto"> => style !== "auto",
  );
  const aptitudes = styles.map((style) =>
    calculateOneAptitude(leader, analysisPool, legalPoolSize, style, context),
  );
  const strongest = aptitudes.reduce(
    (best, aptitude) => (aptitude.score > best.score ? aptitude : best),
    aptitudes[0],
  );
  return [
    {
      style: "auto",
      score: strongest.score,
      stars: strongest.stars,
      signals: strongest.signals,
    },
    ...aptitudes,
  ];
}

export function recommendedMainStyle(
  aptitudes: LeaderStyleAptitude[],
): Exclude<MainStyle, "auto"> {
  const ranked = aptitudes
    .filter(
      (aptitude): aptitude is LeaderStyleAptitude & {
        style: Exclude<MainStyle, "auto">;
      } => aptitude.style !== "auto",
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        MAIN_STYLE_IDS.indexOf(a.style) - MAIN_STYLE_IDS.indexOf(b.style),
    );
  return ranked[0]?.style ?? "balanced";
}

/** Small, style-neutral pre-cap that keeps graph construction bounded. */
export function seedAnalysisPool<T extends CardListItem>(
  leader: CardListItem,
  cards: T[],
  cap = 360,
): T[] {
  if (cards.length <= cap) return cards;
  const realStyles = MAIN_STYLE_IDS.filter((style) => style !== "auto");
  return [...cards]
    .sort((a, b) => {
      const score = (card: CardListItem) =>
        countSharedFeatures(leader, card) * 8 +
        genericRoleScore(card) +
        Math.max(...realStyles.map((style) => mainStyleScore(card, style)));
      return score(b) - score(a) || a.id.localeCompare(b.id);
    })
    .slice(0, cap);
}

function calculateOneAptitude(
  leader: CardListItem,
  cards: CardListItem[],
  legalPoolSize: number,
  style: Exclude<MainStyle, "auto">,
  context: DeckCandidateRankingContext,
): LeaderStyleAptitude {
  const leaderStyleRaw = mainStyleScore(leader, style);
  const leaderEffectMechanics = Math.min(
    30,
    Math.round((leaderStyleRaw / MAIN_STYLE_SCORE_CAP) * 30),
  );
  const support = cards.filter((card) => mainStyleScore(card, style) >= 3);
  const supportCards = Math.min(30, Math.round((support.length / 36) * 30));
  const directSupport = support.filter(
    (card) => (context.evidenceByCardId.get(card.id)?.leaderDirect ?? 0) > 0,
  ).length;
  const leaderFeatures = Math.min(15, Math.round((directSupport / 18) * 15));
  const relationshipTotal = support.reduce((sum, card) => {
    const evidence = context.evidenceByCardId.get(card.id);
    if (!evidence) return sum;
    return (
      sum +
      evidence.compatibleRelationships +
      evidence.synergyData +
      evidence.searchability
    );
  }, 0);
  const synergySupport = Math.min(
    15,
    Math.round((relationshipTotal / Math.max(1, support.length * 8)) * 15),
  );
  const legalCardPool = Math.min(10, Math.round((legalPoolSize / 50) * 10));
  const score = Math.min(
    100,
    leaderEffectMechanics +
      leaderFeatures +
      legalCardPool +
      supportCards +
      synergySupport,
  );
  return {
    style,
    score,
    stars: scoreToStars(score),
    signals: {
      leaderEffectMechanics,
      leaderFeatures,
      legalCardPool,
      supportCards,
      synergySupport,
    },
  };
}

function scoreToStars(score: number): 1 | 2 | 3 | 4 | 5 {
  if (score >= 75) return 5;
  if (score >= 60) return 4;
  if (score >= 45) return 3;
  if (score >= 30) return 2;
  return 1;
}

function edgeCardIds(edge: RuleSynergy, leaderId: string): string[] {
  return [edge.fromCardId, edge.toCardId].filter((id) => id !== leaderId);
}

function countSharedFeatures(a: CardListItem, b: CardListItem): number {
  const features = new Set(a.features);
  return b.features.filter((feature) => features.has(feature)).length;
}

function genericRoleScore(card: CardListItem): number {
  let score = 0;
  if ((card.counter ?? 0) >= 1000) score += 1;
  if (
    hasAnyMechanic(card, [
      "Blocker",
      "Search",
      "Look",
      "RestOpponentCard",
      "ReturnToHand",
    ])
  ) {
    score += 2;
  }
  if (hasAnyMechanic(card, ["Rush", "Banish", "PowerBuff"])) score += 1;
  return score;
}

function mainStyleScore(card: CardListItem, style: MainStyle): number {
  const cost = card.cost ?? 99;
  const power = card.power ?? 0;
  const counter = card.counter ?? 0;

  if (style === "auto") return 0;
  if (style === "aggressive") {
    return (
      (hasMechanic(card, "Rush") ? 6 : 0) +
      (cost <= 3 ? 4 : cost <= 5 ? 2 : 0) +
      (power >= 5000 ? 2 : 0) +
      (hasAnyMechanic(card, ["OnAttack", "Banish", "PowerBuff"]) ? 2 : 0)
    );
  }
  if (style === "midrange") {
    return (
      (cost >= 3 && cost <= 6 ? 5 : 0) +
      (hasMechanic(card, "OnPlay") ? 3 : 0) +
      (counter >= 1000 ? 2 : 0) +
      (power >= 5000 ? 2 : 0)
    );
  }
  if (style === "defensive") {
    return (
      (hasMechanic(card, "Blocker") ? 6 : 0) +
      (counter >= 2000 ? 4 : counter >= 1000 ? 2 : 0) +
      (hasMechanic(card, "DuringOpponentTurn") ? 3 : 0) +
      (hasMechanic(card, "AddToLife") ? 2 : 0)
    );
  }
  if (style === "removal") {
    return (
      countMechanics(card, [
        "RestOpponentCard",
        "ReturnToHand",
        "PowerDebuff",
        "CostReduction",
        "Banish",
      ]) * 3
    );
  }
  if (style === "control") {
    return (
      countMechanics(card, [
        "RestOpponentCard",
        "ReturnToHand",
        "PowerDebuff",
        "CostReduction",
      ]) *
        2 +
      (hasAnyMechanic(card, ["Search", "Look"]) ? 3 : 0) +
      (hasMechanic(card, "Blocker") ? 3 : 0) +
      (cost >= 6 ? 2 : 0)
    );
  }
  if (style === "resource") {
    return (
      (hasMechanic(card, "Search") ? 5 : 0) +
      (hasMechanic(card, "Look") ? 3 : 0) +
      (hasMechanic(card, "DonActivate") ? 4 : 0) +
      (hasMechanic(card, "ActivateMain") ? 1 : 0)
    );
  }
  if (style === "combo") {
    return (
      countMechanics(card, [
        "ActivateMain",
        "DonAttached",
        "DonActivate",
        "OnPlay",
      ]) * 3 +
      (hasMechanic(card, "PlayFromTrash") ? 2 : 0)
    );
  }
  if (style === "tempo") {
    return (
      countMechanics(card, ["ReturnToHand", "RestOpponentCard", "Rush"]) * 4 +
      (cost <= 4 ? 3 : 0) +
      (hasMechanic(card, "OnPlay") ? 2 : 0)
    );
  }
  if (style === "ramp") {
    return (
      (hasMechanic(card, "DonActivate") ? 6 : 0) +
      (hasMechanic(card, "ActivateMain") ? 2 : 0) +
      (cost >= 6 ? 4 : 0) +
      (power >= 7000 ? 2 : 0)
    );
  }
  return (
    (cost >= 2 && cost <= 5 ? 3 : 0) +
    (counter >= 1000 ? 2 : 0) +
    (hasMechanic(card, "OnPlay") ? 2 : 0) +
    (hasAnyMechanic(card, ["Blocker", "Search", "Look", "Rush"]) ? 2 : 0)
  );
}

function featureTagScore(
  card: CardListItem,
  tag: FeatureTag,
  sharedFeatures: number,
): number {
  const cost = card.cost ?? 99;
  const power = card.power ?? 0;
  const counter = card.counter ?? 0;

  if (tag === "trigger_focus") {
    return card.hasTrigger || hasMechanic(card, "Trigger") ? 3 : 0;
  }
  if (tag === "search_focus") {
    if (hasMechanic(card, "Search")) {
      return Math.min(3, 2 + Number(sharedFeatures > 0));
    }
    return hasMechanic(card, "Look") ? 1 : 0;
  }
  if (tag === "blocker_focus") return hasMechanic(card, "Blocker") ? 3 : 0;
  if (tag === "wide_board") {
    return Math.min(
      3,
      (cost <= 4 ? 1 : 0) + (hasMechanic(card, "OnPlay") ? 2 : 0),
    );
  }
  if (tag === "high_cost_focus") {
    return Math.min(3, (cost >= 6 ? 2 : 0) + (power >= 7000 ? 1 : 0));
  }
  if (tag === "bounce_focus") return hasMechanic(card, "ReturnToHand") ? 3 : 0;
  if (tag === "hand_disruption") return hasMechanic(card, "Discard") ? 3 : 0;
  if (tag === "cost_manipulation") {
    return hasMechanic(card, "CostReduction") ? 3 : 0;
  }
  if (tag === "life_manipulation") {
    return hasMechanic(card, "AddToLife")
      ? 3
      : card.hasTrigger || hasMechanic(card, "Trigger")
        ? 1
        : 0;
  }
  if (tag === "trash_utilization") {
    return hasMechanic(card, "PlayFromTrash")
      ? 3
      : hasMechanic(card, "OnKO")
        ? 1
        : 0;
  }
  if (tag === "counter_focus") {
    return counter >= 2000 ? 3 : counter >= 1000 ? 2 : 0;
  }
  if (tag === "finisher_focus") {
    return Math.min(
      3,
      (cost >= 7 ? 1 : 0) +
        (power >= 7000 ? 1 : 0) +
        (hasAnyMechanic(card, ["Rush", "Banish", "PowerBuff", "OnAttack"])
          ? 1
          : 0),
    );
  }
  return 0;
}

function hasMechanic(card: CardListItem, mechanic: string): boolean {
  return card.mechanics.includes(mechanic);
}

function hasAnyMechanic(card: CardListItem, mechanics: readonly string[]): boolean {
  return mechanics.some((mechanic) => hasMechanic(card, mechanic));
}

function countMechanics(card: CardListItem, mechanics: readonly string[]): number {
  return mechanics.filter((mechanic) => hasMechanic(card, mechanic)).length;
}
