import type { CardListItem } from "@/lib/cards";
import {
  simulateBatch,
  type BatchResult,
  type CpuSkill,
  type PracticeDeck,
  type PracticeDeckEntry,
} from "@/lib/practice-sim";

export interface TrainingOptions {
  targetDeck: PracticeDeck;
  opponentDeck: PracticeDeck;
  pool: CardListItem[];
  games: number;
  candidateGames: number;
  seed: number;
  cpuSkill: CpuSkill;
  focusCardIds?: string[];
  candidateLimit?: number;
}

export interface TrainingSwapCandidate {
  id: string;
  removeCardId: string;
  removeName: string;
  addCardId: string;
  addName: string;
  swapCount: number;
  baselineWinRate: number;
  candidateWinRate: number;
  delta: number;
  games: number;
  reason: string;
}

export interface TrainingResult {
  targetDeckName: string;
  opponentDeckName: string;
  games: number;
  candidateGames: number;
  seed: number;
  cpuSkill: CpuSkill;
  baseline: Omit<BatchResult, "replays">;
  candidates: TrainingSwapCandidate[];
  focusCardIds: string[];
  notes: string[];
}

const TARGET_DECK_SIZE = 50;
const MAX_COPIES = 4;
const DEFAULT_CANDIDATE_LIMIT = 18;
const MAX_CANDIDATE_EVALUATIONS = 5_000;

export function trainPracticeDeck(options: TrainingOptions): TrainingResult {
  const games = clampInt(options.games, 1, 10_000);
  const candidateGames = clampInt(options.candidateGames, 1, 500);
  const requestedCandidateLimit = clampInt(
    options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
    1,
    60,
  );
  const budgetedCandidateLimit = Math.max(
    1,
    Math.floor(MAX_CANDIDATE_EVALUATIONS / candidateGames),
  );
  const candidateLimit = Math.min(
    requestedCandidateLimit,
    budgetedCandidateLimit,
  );
  const focusCardIds = [...new Set(options.focusCardIds ?? [])].filter((id) =>
    options.targetDeck.entries.some((entry) => entry.card.id === id),
  );

  const baselineBatch = simulateBatch(
    options.targetDeck,
    options.opponentDeck,
    games,
    options.seed,
    options.cpuSkill,
  );
  const baseline = stripReplays(baselineBatch);
  const removeEntries = selectRemovalEntries(
    options.targetDeck,
    focusCardIds,
    baselineBatch,
  );
  const additions = selectAdditions(options.targetDeck, options.pool);
  const candidates: TrainingSwapCandidate[] = [];
  const seen = new Set<string>();

  for (const remove of removeEntries) {
    for (const add of additions) {
      const candidateDeck = swapCard(options.targetDeck, remove.card.id, add);
      if (!candidateDeck) continue;

      const key = `${remove.card.id}->${add.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const candidateBatch = simulateBatch(
        candidateDeck.deck,
        options.opponentDeck,
        candidateGames,
        options.seed + 50_000 + candidates.length * 997,
        options.cpuSkill,
      );
      candidates.push({
        id: key,
        removeCardId: remove.card.id,
        removeName: remove.card.name,
        addCardId: add.id,
        addName: add.name,
        swapCount: candidateDeck.swapCount,
        baselineWinRate: baseline.playerWinRate,
        candidateWinRate: candidateBatch.playerWinRate,
        delta: round1((candidateBatch.playerWinRate - baseline.playerWinRate) * 100),
        games: candidateGames,
        reason: swapReason(remove.card, add, options.targetDeck.leader),
      });

      if (candidates.length >= candidateLimit) break;
    }
    if (candidates.length >= candidateLimit) break;
  }

  candidates.sort(
    (a, b) =>
      b.delta - a.delta ||
      b.candidateWinRate - a.candidateWinRate ||
      a.removeCardId.localeCompare(b.removeCardId),
  );

  const notes = [
    "これは完全な強化学習ではなく、指定デッキをCPU同士の自己対戦で評価する一世代の探索です。",
    "候補は1種類のカード枠を別カードへ差し替えた場合の勝率差です。",
    "カード効果は現在の簡易CPUが理解できる範囲で評価されます。",
  ];
  if (candidateLimit < requestedCandidateLimit) {
    notes.push(
      `処理負荷を抑えるため、候補数を${requestedCandidateLimit}件から${candidateLimit}件に調整しました。`,
    );
  }

  return {
    targetDeckName: options.targetDeck.name,
    opponentDeckName: options.opponentDeck.name,
    games,
    candidateGames,
    seed: options.seed,
    cpuSkill: options.cpuSkill,
    baseline,
    candidates,
    focusCardIds,
    notes,
  };
}

function stripReplays(batch: BatchResult): Omit<BatchResult, "replays"> {
  const { replays: _replays, ...rest } = batch;
  return rest;
}

function selectRemovalEntries(
  deck: PracticeDeck,
  focusCardIds: string[],
  baseline: BatchResult,
): PracticeDeckEntry[] {
  const byId = new Map(deck.entries.map((entry) => [entry.card.id, entry]));
  const focused = focusCardIds
    .map((id) => byId.get(id))
    .filter((entry): entry is PracticeDeckEntry => Boolean(entry));
  if (focused.length > 0) return focused.slice(0, 6);

  const timing = new Map(
    baseline.metrics.cardTiming
      .filter((item) => item.side === "player")
      .map((item) => [item.cardId, item.uses]),
  );

  return deck.entries
    .slice()
    .sort((a, b) => {
      const valueA = cardTrainingValue(a.card, deck.leader) + (timing.get(a.card.id) ?? 0);
      const valueB = cardTrainingValue(b.card, deck.leader) + (timing.get(b.card.id) ?? 0);
      return valueA - valueB || a.card.id.localeCompare(b.card.id);
    })
    .slice(0, 6);
}

function selectAdditions(deck: PracticeDeck, pool: CardListItem[]): CardListItem[] {
  const leaderColors = new Set(deck.leader.colors);
  const counts = new Map(deck.entries.map((entry) => [entry.card.id, entry.count]));
  return pool
    .filter((card) => card.cardType !== "LEADER")
    .filter((card) => card.colors.some((color) => leaderColors.has(color)))
    .filter((card) => (counts.get(card.id) ?? 0) < MAX_COPIES)
    .sort(
      (a, b) =>
        cardTrainingValue(b, deck.leader) - cardTrainingValue(a, deck.leader) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 12);
}

function swapCard(
  deck: PracticeDeck,
  removeCardId: string,
  addCard: CardListItem,
): { deck: PracticeDeck; swapCount: number } | null {
  const addCardId = addCard.id;
  if (removeCardId === addCardId) return null;
  const removeEntry = deck.entries.find((entry) => entry.card.id === removeCardId);
  const addEntry = deck.entries.find((entry) => entry.card.id === addCardId);
  if (!removeEntry) return null;

  const replacementCard = addEntry?.card ?? addCard;
  const swapCount = Math.min(removeEntry.count, MAX_COPIES - (addEntry?.count ?? 0));
  if (swapCount <= 0) return null;

  const entries = deck.entries
    .map((entry) => ({ card: entry.card, count: entry.count }))
    .map((entry) =>
      entry.card.id === removeCardId
        ? { ...entry, count: entry.count - swapCount }
        : entry,
    )
    .filter((entry) => entry.count > 0);
  const existing = entries.find((entry) => entry.card.id === addCardId);
  if (existing) existing.count += swapCount;
  else entries.push({ card: replacementCard, count: swapCount });

  if (totalCount(entries) !== TARGET_DECK_SIZE) return null;

  return {
    deck: {
      ...deck,
      id: `${deck.id}:train:${removeCardId}:${addCardId}`,
      name: `${deck.name} train ${removeCardId}->${addCardId}`,
      entries: entries.sort((a, b) => {
        const ca = a.card.cost ?? 99;
        const cb = b.card.cost ?? 99;
        return ca - cb || a.card.id.localeCompare(b.card.id);
      }),
      source: "generated",
      totalCards: TARGET_DECK_SIZE,
    },
    swapCount,
  };
}

function cardTrainingValue(card: CardListItem, leader: CardListItem): number {
  const leaderFeatures = new Set(leader.features);
  const feature = card.features.some((item) => leaderFeatures.has(item)) ? 28 : 0;
  const curve = card.cost === null ? 0 : Math.max(0, 16 - Math.abs(card.cost - 3) * 3);
  const power = (card.power ?? 0) / 800;
  const counter = (card.counter ?? 0) / 700;
  const mechanics = card.mechanics.filter((item) =>
    ["Rush", "OnPlay", "OnAttack", "Draw", "Search", "KORemoval", "Blocker"].includes(item),
  ).length * 4;
  return feature + curve + power + counter + mechanics + (card.hasTrigger ? 2 : 0);
}

function swapReason(
  remove: CardListItem,
  add: CardListItem,
  leader: CardListItem,
): string {
  const leaderFeatures = new Set(leader.features);
  const addFeature = add.features.find((feature) => leaderFeatures.has(feature));
  if (addFeature) {
    return `${leader.name} と特徴「${addFeature}」を共有するカードを試す候補です。`;
  }
  if (add.mechanics.includes("Search") || add.mechanics.includes("Draw")) {
    return "手札の安定性を上げるカードを試す候補です。";
  }
  if (add.mechanics.includes("Rush") || add.mechanics.includes("KORemoval")) {
    return "打点または除去でテンポを上げるカードを試す候補です。";
  }
  return `${remove.name} の枠を、曲線と基礎性能が高いカードで試す候補です。`;
}

function totalCount(entries: PracticeDeckEntry[]): number {
  return entries.reduce((acc, entry) => acc + entry.count, 0);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
