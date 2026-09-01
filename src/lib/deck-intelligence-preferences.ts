import type { CardListItem } from "@/lib/cards";

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

export const MAX_FEATURE_TAGS = 3;
export const MAIN_STYLE_SCORE_CAP = 14;
export const FEATURE_TAG_SCORE_CAP = 9;

export interface DeckPreferenceSelection {
  selectedStyle: MainStyle;
  selectedTags: FeatureTag[];
}

export interface DeckCandidateScore {
  leaderAffinity: number;
  mainStyle: number;
  featureTags: number;
  total: number;
}

export interface RankedDeckCandidate {
  card: CardListItem;
  score: DeckCandidateScore;
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

export function rankDeckCandidates(
  leader: CardListItem,
  cards: CardListItem[],
  selection: DeckPreferenceSelection,
): RankedDeckCandidate[] {
  return cards
    .map((card) => ({ card, score: scoreDeckCandidate(leader, card, selection) }))
    .sort(
      (a, b) =>
        b.score.total - a.score.total ||
        b.score.leaderAffinity - a.score.leaderAffinity ||
        b.score.mainStyle - a.score.mainStyle ||
        b.score.featureTags - a.score.featureTags ||
        a.card.id.localeCompare(b.card.id),
    );
}

export function scoreDeckCandidate(
  leader: CardListItem,
  card: CardListItem,
  selection: DeckPreferenceSelection,
): DeckCandidateScore {
  const leaderFeatures = new Set(leader.features);
  const sharedFeatures = card.features.filter((feature) =>
    leaderFeatures.has(feature),
  ).length;
  const leaderAffinity = Math.min(
    20,
    sharedFeatures * 8 + genericRoleScore(card),
  );
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
  return {
    leaderAffinity,
    mainStyle,
    featureTags,
    total: leaderAffinity + mainStyle + featureTags,
  };
}

function genericRoleScore(card: CardListItem): number {
  let score = 0;
  if ((card.counter ?? 0) >= 1000) score += 1;
  if (
    hasAnyMechanic(card, [
      "Blocker",
      "Search",
      "Draw",
      "Trash",
      "RestOpponentCard",
      "ReturnToHand",
    ])
  ) {
    score += 2;
  }
  if (hasAnyMechanic(card, ["Rush", "DoubleAttack", "Banish"])) score += 1;
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
      (hasAnyMechanic(card, ["OnAttack", "DoubleAttack", "Banish"]) ? 2 : 0)
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
      (hasAnyMechanic(card, ["DuringOpponentTurn", "ActivateOpponentTurn"]) ? 3 : 0) +
      (hasMechanic(card, "Counter") ? 2 : 0)
    );
  }
  if (style === "removal") {
    return countMechanics(card, [
      "Trash",
      "RestOpponentCard",
      "ReturnToHand",
      "PowerDebuff",
      "CostReduction",
      "CostIncrease",
    ]) * 3;
  }
  if (style === "control") {
    return (
      countMechanics(card, [
        "Trash",
        "RestOpponentCard",
        "ReturnToHand",
        "PowerDebuff",
        "CostReduction",
        "CostIncrease",
      ]) *
        2 +
      (hasAnyMechanic(card, ["Draw", "Search"]) ? 3 : 0) +
      (hasMechanic(card, "Blocker") ? 3 : 0) +
      (cost >= 6 ? 2 : 0)
    );
  }
  if (style === "resource") {
    return (
      (hasMechanic(card, "Search") ? 5 : 0) +
      (hasMechanic(card, "Draw") ? 4 : 0) +
      (hasMechanic(card, "Look") ? 2 : 0) +
      (hasMechanic(card, "DonActivate") ? 3 : 0)
    );
  }
  if (style === "combo") {
    return countMechanics(card, [
      "ActivateMain",
      "DonAttached",
      "DonAttach",
      "PlayFromTrash",
      "PlayFromLife",
    ]) * 3;
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
      countMechanics(card, ["DonActivate", "DonAttach"]) * 5 +
      (cost >= 6 ? 4 : 0) +
      (power >= 7000 ? 2 : 0)
    );
  }
  return (
    (cost >= 2 && cost <= 5 ? 3 : 0) +
    (counter >= 1000 ? 2 : 0) +
    (hasMechanic(card, "OnPlay") ? 2 : 0) +
    (hasAnyMechanic(card, ["Blocker", "Search", "Draw", "Rush"]) ? 2 : 0)
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
    if (hasMechanic(card, "Search")) return Math.min(3, 2 + Number(sharedFeatures > 0));
    return hasMechanic(card, "Look") ? 1 : 0;
  }
  if (tag === "blocker_focus") return hasMechanic(card, "Blocker") ? 3 : 0;
  if (tag === "wide_board") {
    return Math.min(
      3,
      (cost <= 4 ? 1 : 0) +
        (hasAnyMechanic(card, ["OnPlay", "PlayCard", "PlayFromHand"])
          ? 2
          : 0),
    );
  }
  if (tag === "high_cost_focus") {
    return Math.min(3, (cost >= 6 ? 2 : 0) + (power >= 7000 ? 1 : 0));
  }
  if (tag === "bounce_focus") return hasMechanic(card, "ReturnToHand") ? 3 : 0;
  if (tag === "hand_disruption") {
    return hasAnyMechanic(card, ["Discard", "DiscardOpponent", "HandDisruption"])
      ? 3
      : 0;
  }
  if (tag === "cost_manipulation") {
    return hasAnyMechanic(card, ["CostReduction", "CostIncrease"]) ? 3 : 0;
  }
  if (tag === "life_manipulation") {
    return hasAnyMechanic(card, [
      "AddToLife",
      "RemoveFromLife",
      "RestoreLife",
      "PlayFromLife",
    ])
      ? 3
      : hasMechanic(card, "Trigger")
        ? 1
        : 0;
  }
  if (tag === "trash_utilization") {
    return hasAnyMechanic(card, [
      "PlayFromTrash",
      "TrashRecursion",
      "TrashCondition",
    ])
      ? 3
      : hasMechanic(card, "Trash")
        ? 1
        : 0;
  }
  if (tag === "counter_focus") {
    return Math.min(
      3,
      (counter >= 2000 ? 3 : counter >= 1000 ? 2 : 0) +
        (hasMechanic(card, "Counter") ? 1 : 0),
    );
  }
  if (tag === "finisher_focus") {
    return Math.min(
      3,
      (cost >= 7 ? 1 : 0) +
        (power >= 7000 ? 1 : 0) +
        (hasAnyMechanic(card, ["Rush", "DoubleAttack", "Banish"]) ? 1 : 0),
    );
  }
  return 0;
}

function hasMechanic(card: CardListItem, mechanic: string): boolean {
  return card.mechanics.includes(mechanic);
}

function hasAnyMechanic(card: CardListItem, mechanics: string[]): boolean {
  return mechanics.some((mechanic) => hasMechanic(card, mechanic));
}

function countMechanics(card: CardListItem, mechanics: string[]): number {
  return mechanics.filter((mechanic) => hasMechanic(card, mechanic)).length;
}
