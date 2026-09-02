import test from "node:test";
import assert from "node:assert/strict";

import type { CardListItem } from "@/lib/cards";
import type { PracticeDeck } from "@/lib/practice-sim";
import { calculateDeckCoverage } from "./coverage";
import { BattleEffectRegistry } from "./effect-registry";
import {
  acceptAttack,
  attachDon,
  chooseEffectTarget,
  createBattleState,
  declareCharacterAttack,
  declareLeaderAttack,
  playCard,
  resolveTriggerChoice,
  useCounterCard,
} from "./engine";
import {
  GOLDEN_BLOCKER,
  GOLDEN_BOUNCE,
  GOLDEN_CARDS,
  GOLDEN_DRAW,
  GOLDEN_KO,
  GOLDEN_LEADER,
  GOLDEN_ON_ATTACK,
  GOLDEN_REST,
  GOLDEN_RUSH,
  GOLDEN_SEARCH,
  GOLDEN_TRIGGER_DRAW,
} from "./golden-fixtures";
import { effectiveCharacterPower, legalTargets, totalCardsInSide } from "./selectors";
import type { BattleSide, BattleState, BattleZoneCard } from "./state";

const FILLER = card({ id: "TEST-001", name: "テストカード", cost: 1, power: 1_000 });
const LOW_TARGET = card({ id: "TEST-002", name: "低コスト対象", cost: 2, power: 7_000 });
const HIGH_TARGET = card({ id: "TEST-003", name: "高コスト対象", cost: 5, power: 8_000 });
const SEARCH_HIT = card({
  id: "TEST-004",
  name: "モンキー・D・ルフィ",
  cost: 3,
  power: 4_000,
  features: ["麦わらの一味"],
});
const REGISTRY = new BattleEffectRegistry([
  ...GOLDEN_CARDS,
  FILLER,
  LOW_TARGET,
  HIGH_TARGET,
  SEARCH_HIT,
]);

test("OnPlay draw resolves and total cards are conserved", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_DRAW];
  state.player.deck = [FILLER, FILLER];
  const before = totalCardsInSide(state, "player");
  const next = playCard(state, "player", 0, REGISTRY);
  assert.equal(next.player.board.at(-1)?.card.id, GOLDEN_DRAW.id);
  assert.equal(next.player.hand.length, 1);
  assert.equal(next.player.deck.length, 1);
  assert.equal(totalCardsInSide(next, "player"), before);
  assert.match(next.log.join("\n"), /1枚ドロー/);
});

test("KO moves the chosen legal target to trash", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_KO];
  state.opponent.board = [zone(LOW_TARGET, "low"), zone(HIGH_TARGET, "high")];
  const pending = playCard(state, "player", 0, REGISTRY);
  assert.equal(pending.pending?.type, "effect_target");
  const next = chooseEffectTarget(pending, "low", REGISTRY);
  assert.deepEqual(next.opponent.board.map((item) => item.instanceId), ["high"]);
  assert.equal(next.opponent.trash.at(-1)?.id, LOW_TARGET.id);
});

test("bounce moves the chosen card to hand, never trash", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_BOUNCE];
  state.opponent.board = [zone(LOW_TARGET, "bounce")];
  const pending = playCard(state, "player", 0, REGISTRY);
  const next = chooseEffectTarget(pending, "bounce", REGISTRY);
  assert.equal(next.opponent.board.length, 0);
  assert.equal(next.opponent.hand.at(-1)?.id, LOW_TARGET.id);
  assert.equal(next.opponent.trash.length, 0);
});

test("RestOpponentCard rests the target without moving zones", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_REST];
  state.opponent.board = [zone(LOW_TARGET, "rest")];
  const pending = playCard(state, "player", 0, REGISTRY);
  const next = chooseEffectTarget(pending, "rest", REGISTRY);
  assert.equal(next.opponent.board[0]?.rested, true);
  assert.equal(next.opponent.trash.length, 0);
});

test("basic Search checks the top cards and moves only a matching card to hand", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_SEARCH];
  state.player.deck = [FILLER, SEARCH_HIT, HIGH_TARGET, FILLER, LOW_TARGET, FILLER];
  const before = totalCardsInSide(state, "player");
  const next = playCard(state, "player", 0, REGISTRY);
  assert.equal(next.player.hand.some((item) => item.id === SEARCH_HIT.id), true);
  assert.equal(next.player.deck.at(-1)?.id, LOW_TARGET.id);
  assert.equal(totalCardsInSide(next, "player"), before);
});

test("Search removes one matching copy rather than every duplicate card id", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_SEARCH];
  state.player.deck = [SEARCH_HIT, SEARCH_HIT, FILLER];
  const before = totalCardsInSide(state, "player");
  const next = playCard(state, "player", 0, REGISTRY);
  assert.equal(next.player.hand.filter((item) => item.id === SEARCH_HIT.id).length, 1);
  assert.equal(next.player.deck.filter((item) => item.id === SEARCH_HIT.id).length, 1);
  assert.equal(totalCardsInSide(next, "player"), before);
});

test("Search applies the printed color filter", () => {
  const colorSearch = card({
    id: "TEST-COLOR-SEARCH",
    name: "色指定サーチ",
    mechanics: ["OnPlay", "Search"],
    effectText:
      "[登場時]自分のデッキの上から5枚を見て、緑の特徴《ワノ国》を持つカード1枚までを公開し、手札に加える。その後、残りを好きな順番でデッキの下に置く。",
  });
  const redWano = card({ id: "TEST-RED-WANO", name: "赤ワノ国", features: ["ワノ国"] });
  const greenWano = card({
    id: "TEST-GREEN-WANO",
    name: "緑ワノ国",
    colors: ["green"],
    features: ["ワノ国"],
  });
  const registry = new BattleEffectRegistry([colorSearch, redWano, greenWano]);
  const state = battleState();
  state.player.hand = [colorSearch];
  state.player.deck = [redWano, greenWano];
  const next = playCard(state, "player", 0, registry);
  assert.equal(next.player.hand.at(-1)?.id, greenWano.id);
  assert.equal(next.player.deck.some((item) => item.id === redWano.id), true);
});

test("EVENT without a structured main effect stays in hand and spends no DON", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_TRIGGER_DRAW];
  const next = playCard(state, "player", 0, REGISTRY);
  assert.equal(next.player.hand[0]?.id, GOLDEN_TRIGGER_DRAW.id);
  assert.equal(next.player.trash.length, 0);
  assert.equal(next.player.donRested, 0);
  assert.match(next.log.at(-1) ?? "", /使用できません/);
});

test("Rush attacks on its play turn and non-Rush cannot", () => {
  const rushState = battleState();
  rushState.player.board = [zone(GOLDEN_RUSH, "rush", 2)];
  const rushed = declareCharacterAttack(rushState, "player", "rush", REGISTRY, "level1");
  assert.equal(rushed.player.board[0]?.rested, true);

  const normalState = battleState();
  normalState.player.board = [zone(GOLDEN_ON_ATTACK, "normal", 2)];
  const blocked = declareCharacterAttack(normalState, "player", "normal", REGISTRY, "level1");
  assert.equal(blocked.player.board[0]?.rested, false);
  assert.match(blocked.log.at(-1) ?? "", /登場ターン/);
});

test("Blocker intercepts and is KO'd to trash when attack power wins", () => {
  const state = battleState();
  state.opponent.board = [zone(GOLDEN_BLOCKER, "blocker")];
  const next = declareLeaderAttack(state, "player", REGISTRY, "level3");
  assert.equal(next.opponent.board.length, 0);
  assert.equal(next.opponent.trash.at(-1)?.id, GOLDEN_BLOCKER.id);
  assert.equal(next.opponent.lifeCards.length, 1);
  assert.match(next.log.join("\n"), /ブロック/);
});

test("hand counter is consumed to trash and contributes its printed amount", () => {
  const state = battleState();
  state.activePlayer = "opponent";
  state.player.hand = [GOLDEN_REST];
  const pending = declareLeaderAttack(state, "opponent", REGISTRY, "level3");
  assert.equal(pending.pending?.type, "defense");
  const countered = useCounterCard(pending, 0);
  assert.equal(countered.player.hand.length, 0);
  assert.equal(countered.player.trash.at(-1)?.id, GOLDEN_REST.id);
  const resolved = acceptAttack(countered, REGISTRY);
  assert.equal(resolved.player.lifeCards.length, 1);
  assert.match(resolved.log.join("\n"), /5000 対 7000/);
});

test("supported Trigger resolves, draws, and sends the event to trash", () => {
  const state = battleState();
  state.opponent.lifeCards = [GOLDEN_TRIGGER_DRAW];
  state.opponent.deck = [FILLER];
  const before = totalCardsInSide(state, "opponent");
  const next = declareLeaderAttack(state, "player", REGISTRY, "level1");
  assert.equal(next.opponent.lifeCards.length, 0);
  assert.equal(next.opponent.trash.at(-1)?.id, GOLDEN_TRIGGER_DRAW.id);
  assert.equal(next.opponent.hand.at(-1)?.id, FILLER.id);
  assert.equal(totalCardsInSide(next, "opponent"), before);
  assert.match(next.log.join("\n"), /Trigger:/);
});

test("player life reveal pauses for Trigger choice and decline moves it to hand", () => {
  const state = battleState();
  state.activePlayer = "opponent";
  state.player.lifeCards = [GOLDEN_TRIGGER_DRAW];
  const defense = declareLeaderAttack(state, "opponent", REGISTRY, "level3");
  const revealed = acceptAttack(defense, REGISTRY);
  assert.equal(revealed.pending?.type, "trigger");
  const declined = resolveTriggerChoice(revealed, false, REGISTRY);
  assert.equal(declined.player.hand.at(-1)?.id, GOLDEN_TRIGGER_DRAW.id);
  assert.equal(declined.player.trash.length, 0);
});

test("play-self Trigger fails closed to hand when board already has five cards", () => {
  const triggerCharacter = card({
    id: "TEST-TRIGGER",
    name: "登場トリガー",
    triggerText: "[トリガー]このカードを登場させる。",
    hasTrigger: true,
    mechanics: ["Trigger"],
  });
  const registry = new BattleEffectRegistry([...GOLDEN_CARDS, triggerCharacter, FILLER]);
  const state = battleState();
  state.activePlayer = "opponent";
  state.player.lifeCards = [triggerCharacter];
  state.player.board = Array.from({ length: 5 }, (_, index) => zone(FILLER, `full-${index}`));
  const before = totalCardsInSide(state, "player");
  const defense = declareLeaderAttack(state, "opponent", registry, "level3");
  const revealed = acceptAttack(defense, registry);
  const next = resolveTriggerChoice(revealed, true, registry);
  assert.equal(next.player.board.length, 5);
  assert.equal(next.player.hand.at(-1)?.id, triggerCharacter.id);
  assert.equal(totalCardsInSide(next, "player"), before);
});

test("life never becomes negative and an attack into zero life ends the game", () => {
  const state = battleState();
  state.opponent.lifeCards = [];
  const next = declareLeaderAttack(state, "player", REGISTRY, "level1");
  assert.equal(next.opponent.lifeCards.length, 0);
  assert.equal(next.winner, "player");
});

test("OnAttack target choice applies deterministic structured modifier", () => {
  const state = battleState();
  state.player.board = [zone(GOLDEN_ON_ATTACK, "attacker", 1)];
  state.opponent.board = [zone(HIGH_TARGET, "debuff")];
  const pending = declareCharacterAttack(state, "player", "attacker", REGISTRY, "level1");
  assert.equal(pending.pending?.type, "effect_target");
  const next = chooseEffectTarget(pending, "debuff", REGISTRY);
  assert.equal(next.opponent.board[0]?.powerModifier, -2_000);
});

test("target filters honor owner, state, maxCost, feature, color and count", () => {
  const state = battleState();
  state.opponent.board = [
    zone({ ...LOW_TARGET, colors: ["green"], features: ["麦わらの一味"] }, "legal"),
    zone({ ...HIGH_TARGET, colors: ["green"], features: ["麦わらの一味"] }, "too-high"),
    zone({ ...LOW_TARGET, colors: ["red"], features: ["海軍"] }, "wrong-feature"),
  ];
  const targets = legalTargets(state, "player", {
    owner: "opponent",
    zones: ["character"],
    state: "active",
    maxCost: 2,
    minCost: 1,
    feature: "麦わらの一味",
    color: "green",
    count: 1,
  });
  assert.deepEqual(targets.map((target) => target.instanceId), ["legal"]);
});

test("DON attach adds 1000 power, refresh-safe counts never become negative", () => {
  let state = battleState();
  state.player.board = [zone(GOLDEN_ON_ATTACK, "don-target")];
  state.player.donTotal = 2;
  state = attachDon(state, "player", "don-target");
  assert.equal(state.player.donRested, 1);
  assert.equal(effectiveCharacterPower(state.player.board[0]), 6_000);
  state = attachDon(state, "player", "don-target");
  state = attachDon(state, "player", "don-target");
  assert.equal(state.player.donRested, 2);
  assert.ok(state.player.donRested <= state.player.donTotal);
  assert.ok(state.player.lifeCards.length >= 0);
});

test("board max5 fails closed before spending DON or removing hand", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_DRAW];
  state.player.board = Array.from({ length: 5 }, (_, index) => zone(FILLER, `slot-${index}`));
  const next = playCard(state, "player", 0, REGISTRY);
  assert.equal(next.player.hand.length, 1);
  assert.equal(next.player.board.length, 5);
  assert.equal(next.player.donRested, 0);
});

test("same seed and decks produce identical state and coverage counts copies", () => {
  const deck = practiceDeck([
    { card: GOLDEN_BLOCKER, count: 4 },
    { card: GOLDEN_RUSH, count: 4 },
    { card: FILLER, count: 42 },
  ]);
  assert.deepEqual(createBattleState(deck, deck, 9301), createBattleState(deck, deck, 9301));
  const coverage = calculateDeckCoverage(deck, REGISTRY);
  assert.equal(coverage.totalCards, 50);
  assert.equal(coverage.supportedCards, 46);
  assert.equal(coverage.partialCards, 4);
  assert.equal(coverage.complete, false);
});

function battleState(): BattleState {
  return {
    seed: 9301,
    turn: 2,
    activePlayer: "player",
    player: side("player"),
    opponent: side("opponent"),
    log: [],
    sequence: 20,
  };
}

function side(name: string): BattleSide {
  return {
    deckName: name,
    leader: GOLDEN_LEADER,
    deck: [],
    hand: [],
    lifeCards: [FILLER],
    board: [],
    trash: [],
    donTotal: 10,
    donRested: 0,
    donDeck: 0,
    leaderRested: false,
    leaderAttachedDon: 0,
    leaderPowerModifier: 0,
  };
}

function zone(cardValue: CardListItem, instanceId: string, playedTurn = 1): BattleZoneCard {
  return {
    instanceId,
    card: cardValue,
    rested: false,
    playedTurn,
    attachedDon: 0,
    powerModifier: 0,
    costModifier: 0,
  };
}

function card(
  input: Pick<CardListItem, "id" | "name"> & Partial<CardListItem>,
): CardListItem {
  return {
    setCode: input.id.split("-")[0],
    cardType: "CHARACTER",
    colors: ["red"],
    attributes: [],
    features: [],
    mechanics: [],
    cost: 1,
    power: 1_000,
    counter: null,
    life: null,
    rarity: null,
    hasTrigger: false,
    imageUrlJp: null,
    effectText: null,
    triggerText: null,
    source: "official_jp",
    verified: true,
    ...input,
  };
}

function practiceDeck(
  entries: PracticeDeck["entries"],
): PracticeDeck {
  return {
    id: "golden",
    name: "golden",
    leader: GOLDEN_LEADER,
    entries,
    source: "generated",
    totalCards: entries.reduce((sum, entry) => sum + entry.count, 0),
  };
}
