/**
 * Game initialization: deck loading, shuffle, life setup, mulligan flow.
 *
 * The result of `initGame` is a `GameState` parked in `MULLIGAN` phase
 * with both players holding their initial 5-card hand. The caller then
 * applies one `MULLIGAN_DECIDE` action per player; once both decide,
 * the engine advances to TURN 1 → REFRESH for the go-first player.
 *
 * Determinism contract
 * ────────────────────
 * Given identical `InitConfig.seed` and identical deck lists, this
 * function returns bit-for-bit identical state. Both decks are shuffled
 * with seeds *derived from* the master seed, so the two shuffles are
 * independent yet reproducible. This is what makes paired-RNG ablation
 * work: swapping one card in deck A doesn't perturb deck B's shuffle.
 */

import { ENGINE_VERSION } from "./version";
import { createRng } from "./rng";
import {
  EMPTY_TURN_LOG,
  makeInstanceId,
  type CardInstance,
  type CardRegistry,
  type GameState,
  type LeaderOnField,
  type PlayerState,
} from "./state";

export interface DeckList {
  readonly leaderId: string;
  /** Main-deck card list. Counts must sum to 50. */
  readonly cards: ReadonlyArray<{ readonly cardId: string; readonly count: number }>;
  /** DON deck size — official rules: 10. Exposed for tests. */
  readonly donDeckSize?: number;
}

export interface InitConfig {
  readonly registry: CardRegistry;
  readonly deckA: DeckList;
  readonly deckB: DeckList;
  /** Master seed; per-deck shuffles derive from this. */
  readonly seed: string;
  /** Decided externally (RNG, user choice). */
  readonly goFirst: "A" | "B";
}

const STARTING_HAND_SIZE = 5;
const STANDARD_DON_DECK_SIZE = 10;
const STANDARD_MAIN_DECK_SIZE = 50;

function expandDeck(list: DeckList): string[] {
  const out: string[] = [];
  for (const { cardId, count } of list.cards) {
    for (let i = 0; i < count; i++) out.push(cardId);
  }
  return out;
}

function instantiate(
  cardIds: readonly string[],
  prefix: string,
): CardInstance[] {
  return cardIds.map((cardId, i) => ({
    instanceId: makeInstanceId(`${prefix}-${cardId}`, i),
    cardId,
  }));
}

function buildDonDeck(player: "A" | "B", size: number): CardInstance[] {
  const out: CardInstance[] = [];
  for (let i = 0; i < size; i++) {
    out.push({
      instanceId: `${player}-DON#${i}`,
      cardId: "DON!!",
    });
  }
  return out;
}

function validateDeck(list: DeckList, registry: CardRegistry, who: string): void {
  const leader = registry.get(list.leaderId);
  if (leader.cardType !== "LEADER") {
    throw new Error(`${who}: leaderId is not a LEADER card (${list.leaderId})`);
  }
  if (leader.life == null || leader.life <= 0) {
    throw new Error(`${who}: leader has no life value`);
  }
  let total = 0;
  for (const { cardId, count } of list.cards) {
    if (count < 1) throw new Error(`${who}: invalid count for ${cardId}`);
    if (count > 4) throw new Error(`${who}: more than 4 copies of ${cardId}`);
    if (!registry.has(cardId)) {
      throw new Error(`${who}: unknown card ${cardId}`);
    }
    total += count;
  }
  if (total !== STANDARD_MAIN_DECK_SIZE) {
    throw new Error(
      `${who}: main deck must be exactly ${STANDARD_MAIN_DECK_SIZE} cards, got ${total}`,
    );
  }
}

function buildPlayer(
  id: "A" | "B",
  list: DeckList,
  registry: CardRegistry,
  masterSeed: string,
): PlayerState {
  // Per-player shuffle seed derived from the master so paired-RNG
  // ablation gives both decks identical shuffles when seeds match.
  const shuffleRng = createRng(`${masterSeed}:${id}-shuffle`);
  const allCards = instantiate(expandDeck(list), id);
  shuffleRng.shuffle(allCards);

  const leaderData = registry.get(list.leaderId);
  const leader: LeaderOnField = {
    instanceId: `${id}-LEADER`,
    cardId: list.leaderId,
    state: "active",
    attachedDon: 0,
    powerModTurn: 0,
  };

  // Top of array = top of deck. Slice off life cards and starting hand.
  const lifeCount = leaderData.life ?? 0;
  const life: CardInstance[] = allCards.slice(0, lifeCount);
  const afterLife = allCards.slice(lifeCount);
  const hand: CardInstance[] = afterLife.slice(0, STARTING_HAND_SIZE);
  const deck: CardInstance[] = afterLife.slice(STARTING_HAND_SIZE);

  const donDeck = buildDonDeck(id, list.donDeckSize ?? STANDARD_DON_DECK_SIZE);

  return {
    id,
    leader,
    characters: [],
    stage: null,
    life,
    deck,
    hand,
    trash: [],
    donDeck,
    donArea: { active: 0, rested: 0 },
    didAttachDonThisTurn: false,
    didMulligan: false,
  };
}

export function initGame(config: InitConfig): GameState {
  validateDeck(config.deckA, config.registry, "deckA");
  validateDeck(config.deckB, config.registry, "deckB");

  const playerA = buildPlayer("A", config.deckA, config.registry, config.seed);
  const playerB = buildPlayer("B", config.deckB, config.registry, config.seed);

  return {
    engineVersion: ENGINE_VERSION,
    rngSeed: config.seed,
    turn: 0,
    phase: "MULLIGAN",
    activePlayer: config.goFirst,
    goFirst: config.goFirst,
    players: { A: playerA, B: playerB },
    pendingEffects: [],
    activeAttack: null,
    turnLog: EMPTY_TURN_LOG,
    winner: null,
    endCondition: null,
    eventSeq: 0,
  };
}
