import {
  analyzeDeckCoach,
  DECK_COACH_PROMPT_VERSION,
  type DeckCoachAiReference,
  type DeckCoachAnalysisInput,
} from "@/ai/deck-coach";
import { CARD_COACH_PROMPT_VERSION } from "@/ai/card-coach";
import { db } from "@/db";
import {
  isMissingCardCoachGuidesTableError,
  readCardRefsByIdsFromDb,
  readStoredCardCoachGuideFromDb,
  readVerifiedCardFactsByIdsFromDb,
} from "@/lib/card-coach-storage";
import {
  buildDeckCoachMetrics,
  selectDeckCoachReferenceCardIds,
} from "@/lib/deck-coach-metrics";
import {
  deckCoachStaleState,
  hashDeckCoachDeck,
  hashDeckCoachSourceData,
} from "@/lib/deck-coach-source-data";
import {
  isMissingDeckCoachGuidesTableError,
  readAllCardIdsFromDb,
  readStoredDeckCoachGuideFromDb,
  writeStoredDeckCoachGuideToDb,
} from "@/lib/deck-coach-storage";
import type {
  DeckCoachGuide,
  DeckCoachGuideView,
  DeckCoachLevel,
  StoredDeckCoachGuide,
} from "@/lib/deck-coach-schema";
import { validateDeck, type DeckRegulations } from "@/lib/deck-rules";
import {
  activeRegulations,
  DeckRegulationsUnavailableError,
  getSavedDeck,
  type SavedDeckDetail,
} from "@/lib/saved-decks";

export class DeckCoachDeckNotFoundError extends Error {
  constructor(deckId: string) {
    super(`${deckId} was not found.`);
    this.name = "DeckCoachDeckNotFoundError";
  }
}

export class DeckCoachIllegalDeckError extends Error {
  constructor(
    message: string,
    public readonly violations: SavedDeckDetail["ruleReport"]["violations"],
  ) {
    super(message);
    this.name = "DeckCoachIllegalDeckError";
  }
}

export class DeckCoachUnknownCardError extends Error {
  constructor(public readonly cardId: string) {
    super(`Unknown card id in saved deck: ${cardId}`);
    this.name = "DeckCoachUnknownCardError";
  }
}

export class DeckCoachUnverifiedFactsError extends Error {
  constructor(public readonly cardId: string) {
    super(
      `${cardId} does not have verified official facts. Deck Coach only accepts source=official_jp/official_en and verified=1.`,
    );
    this.name = "DeckCoachUnverifiedFactsError";
  }
}

export interface PreparedDeckCoachGeneration {
  input: DeckCoachAnalysisInput;
  deckHash: string;
  sourceDataHash: string;
}

export interface AssembleDeckCoachGenerationInput {
  deck: SavedDeckDetail;
  regulations: DeckRegulations;
  knownCardIds: Iterable<string>;
  verifiedFacts: Awaited<
    ReturnType<typeof readVerifiedCardFactsByIdsFromDb>
  >;
  aiDerivedReferences?: DeckCoachAiReference[];
  level?: DeckCoachLevel;
}

export function assembleDeckCoachGeneration(
  source: AssembleDeckCoachGenerationInput,
): PreparedDeckCoachGeneration {
  const level = source.level ?? "easy";
  if (!source.deck.ruleReport.legal) {
    throw new DeckCoachIllegalDeckError(
      "Deck Coach requires deck.ruleReport.legal === true.",
      source.deck.ruleReport.violations,
    );
  }

  const known = new Set(source.knownCardIds);
  const ids = [
    source.deck.leader.id,
    ...source.deck.entries.map((entry) => entry.card.id),
  ];
  for (const id of ids) {
    if (!known.has(id)) throw new DeckCoachUnknownCardError(id);
    if (!source.verifiedFacts.has(id)) {
      throw new DeckCoachUnverifiedFactsError(id);
    }
  }

  const leader = source.verifiedFacts.get(source.deck.leader.id)!;
  if (leader.cardType !== "LEADER") {
    throw new DeckCoachIllegalDeckError(
      `${leader.id} is not a leader card.`,
      source.deck.ruleReport.violations,
    );
  }
  const cards = source.deck.entries.map((entry) => ({
    card: source.verifiedFacts.get(entry.card.id)!,
    count: entry.count,
  }));
  const currentRuleReport = validateDeck(
    { id: leader.id, name: leader.name, colors: leader.colors },
    cards.map((entry) => ({
      id: entry.card.id,
      cardType: entry.card.cardType,
      colors: entry.card.colors,
      count: entry.count,
    })),
    source.regulations,
  );
  if (!currentRuleReport.legal || currentRuleReport.totalCount !== 50) {
    throw new DeckCoachIllegalDeckError(
      "The saved deck is no longer legal under current active restrictions.",
      currentRuleReport.violations,
    );
  }

  const systemMetrics = buildDeckCoachMetrics(leader, cards);
  const aiDerivedReferences = source.aiDerivedReferences ?? [];
  const composition = {
    leaderId: leader.id,
    cards: cards
      .map((entry) => ({ cardId: entry.card.id, count: entry.count }))
      .sort((a, b) => a.cardId.localeCompare(b.cardId)),
  };
  const deckHash = hashDeckCoachDeck(composition);
  const restrictionSnapshot = {
    perCardMax: [...(source.regulations.perCardMax ?? new Map()).entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    ),
    pairBans: [...(source.regulations.pairBans ?? [])].sort(
      (a, b) =>
        a.cardIdA.localeCompare(b.cardIdA) ||
        a.cardIdB.localeCompare(b.cardIdB),
    ),
  };
  const factsSnapshot = {
    leader,
    cards: cards
      .map((entry) => ({ ...entry.card, count: entry.count }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  const sourceDataHash = hashDeckCoachSourceData({
    promptVersion: DECK_COACH_PROMPT_VERSION,
    deckHash,
    verifiedFacts: factsSnapshot,
    activeRestrictions: restrictionSnapshot,
    systemMetrics,
    aiDerivedReferences,
  });

  return {
    input: {
      deck: {
        id: source.deck.id,
        name: source.deck.name,
        leader,
        cards,
      },
      systemMetrics,
      aiDerivedReferences,
      knownCardIds: [...known],
      level,
    },
    deckHash,
    sourceDataHash,
  };
}

export async function prepareDeckCoachGeneration(
  deckId: string,
  level: DeckCoachLevel = "easy",
): Promise<PreparedDeckCoachGeneration> {
  const deck = await getSavedDeck(deckId);
  if (!deck) throw new DeckCoachDeckNotFoundError(deckId);
  if (!deck.ruleReport.legal || deck.ruleReport.totalCount !== 50) {
    throw new DeckCoachIllegalDeckError(
      "Deck Coach requires a currently legal 50-card saved deck.",
      deck.ruleReport.violations,
    );
  }

  // getSavedDeck already performs a current validation. Fetch again here so
  // the exact fail-closed restriction snapshot used for the prompt is hashed.
  const regulations = await activeRegulations();
  const knownCardIds = await readAllCardIdsFromDb(db);
  const deckIds = [deck.leader.id, ...deck.entries.map((entry) => entry.card.id)];
  const verifiedFacts = await readVerifiedCardFactsByIdsFromDb(db, deckIds);
  const base = assembleDeckCoachGeneration({
    deck,
    regulations,
    knownCardIds,
    verifiedFacts,
    level,
  });
  const aiDerivedReferences = await loadFreshCardCoachReferences(
    selectDeckCoachReferenceCardIds(base.input.systemMetrics),
  );

  return assembleDeckCoachGeneration({
    deck,
    regulations,
    knownCardIds,
    verifiedFacts,
    aiDerivedReferences,
    level,
  });
}

export async function getDeckCoachGuideForPage(
  deckId: string,
  level: DeckCoachLevel = "easy",
): Promise<DeckCoachGuideView | null> {
  let stored: StoredDeckCoachGuide | null;
  try {
    stored = await readStoredDeckCoachGuideFromDb(db, deckId, level);
  } catch (error) {
    if (!isMissingDeckCoachGuidesTableError(error)) throw error;
    return null;
  }
  if (!stored) return null;

  let current: PreparedDeckCoachGeneration | null = null;
  let generationBlockedReason: string | null = null;
  try {
    current = await prepareDeckCoachGeneration(deckId, level);
  } catch (error) {
    if (!isDeckCoachGenerationBlockedError(error)) throw error;
    generationBlockedReason = generationBlockedMessage(error);
  }
  return toGuideView(stored, current, generationBlockedReason);
}

export async function generateAndStoreDeckCoachGuide(
  deckId: string,
  level: DeckCoachLevel = "easy",
): Promise<DeckCoachGuideView> {
  const prepared = await prepareDeckCoachGeneration(deckId, level);
  const result = await analyzeDeckCoach(prepared.input);
  const generatedAt = new Date();
  await writeStoredDeckCoachGuideToDb(db, {
    deckId,
    level,
    guide: result.guide,
    deckHash: prepared.deckHash,
    sourceDataHash: prepared.sourceDataHash,
    promptVersion: DECK_COACH_PROMPT_VERSION,
    aiModelVersion: result.modelVersion,
    generatedAt,
    updatedAt: generatedAt,
  });
  return toGuideView(
    {
      deckId,
      level,
      guide: result.guide,
      deckHash: prepared.deckHash,
      sourceDataHash: prepared.sourceDataHash,
      promptVersion: DECK_COACH_PROMPT_VERSION,
      aiModelVersion: result.modelVersion,
      generatedAt: generatedAt.toISOString(),
      updatedAt: generatedAt.toISOString(),
    },
    prepared,
    null,
  );
}

async function loadFreshCardCoachReferences(
  cardIds: string[],
): Promise<DeckCoachAiReference[]> {
  const { prepareCardCoachGeneration } = await import("@/lib/card-coach");
  const references: DeckCoachAiReference[] = [];
  for (const cardId of cardIds) {
    let stored;
    try {
      stored = await readStoredCardCoachGuideFromDb(db, cardId, "easy");
    } catch (error) {
      if (isMissingCardCoachGuidesTableError(error)) return [];
      throw error;
    }
    if (!stored || stored.promptVersion !== CARD_COACH_PROMPT_VERSION) continue;
    const current = await prepareCardCoachGeneration(cardId, "easy");
    if (stored.sourceDataHash !== current.sourceDataHash) continue;
    references.push({
      cardId,
      roles: stored.guide.roles,
      purposeJa: stored.guide.purposeJa,
      timing: stored.guide.timing,
      source: "card_coach",
    });
  }
  return references;
}

async function toGuideView(
  stored: StoredDeckCoachGuide,
  current: PreparedDeckCoachGeneration | null,
  generationBlockedReason: string | null,
): Promise<DeckCoachGuideView> {
  const stale = deckCoachStaleState(
    { deckHash: stored.deckHash, sourceDataHash: stored.sourceDataHash },
    current
      ? {
          deckHash: current.deckHash,
          sourceDataHash: current.sourceDataHash,
        }
      : null,
  );
  const cardRefs = await readCardRefsByIdsFromDb(
    db,
    collectGuideCardIds(stored.guide),
  );
  return {
    ...stored,
    currentDeckHash: current?.deckHash ?? null,
    currentSourceDataHash: current?.sourceDataHash ?? null,
    ...stale,
    generationBlockedReason,
    cardRefs,
  };
}

function collectGuideCardIds(guide: DeckCoachGuide): string[] {
  const ids = new Set<string>();
  for (const entry of guide.keyCards) ids.add(entry.cardId);
  for (const id of guide.mulligan.keepCardIds) ids.add(id);
  for (const id of guide.mulligan.flexibleCardIds) ids.add(id);
  for (const id of guide.mulligan.returnCardIds) ids.add(id);
  for (const entry of guide.donPlan) {
    for (const id of entry.referencedCardIds) ids.add(id);
  }
  for (const combo of guide.combos) {
    for (const id of combo.cardIds) ids.add(id);
  }
  return [...ids];
}

function isDeckCoachGenerationBlockedError(error: unknown): boolean {
  return (
    error instanceof DeckCoachDeckNotFoundError ||
    error instanceof DeckCoachIllegalDeckError ||
    error instanceof DeckCoachUnknownCardError ||
    error instanceof DeckCoachUnverifiedFactsError ||
    error instanceof DeckRegulationsUnavailableError
  );
}

function generationBlockedMessage(error: unknown): string {
  if (error instanceof DeckRegulationsUnavailableError) {
    return "制限情報を取得できないため、Deck Coachを再生成できません。";
  }
  if (error instanceof DeckCoachIllegalDeckError) {
    return "現在のルールでは合法デッキではないため、Deck Coachを再生成できません。";
  }
  if (error instanceof DeckCoachUnverifiedFactsError) {
    return "公式確認済みデータが不足しているため、Deck Coachを再生成できません。";
  }
  return "元データを確認できないため、Deck Coachを再生成できません。";
}

export const _deckCoachLibTestInternals = {
  collectGuideCardIds,
  loadFreshCardCoachReferences,
};
