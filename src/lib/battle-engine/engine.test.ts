import test from "node:test";
import assert from "node:assert/strict";

import type { CardListItem } from "@/lib/cards";
import type { PracticeDeck } from "@/lib/practice-sim";
import { addDeckCardsToLife } from "./actions";
import { calculateDeckCoverage } from "./coverage";
import { BattleEffectRegistry } from "./effect-registry";
import {
  acceptAttack,
  attachDon,
  chooseAttackTarget,
  chooseBlocker,
  chooseEffectTarget,
  createBattleState,
  declareCharacterAttack,
  declareLeaderAttack,
  endPlayerTurn,
  playCard,
  resolveSearchChoice,
  resolveTriggerChoice,
  skipEffectTarget,
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
  const pending = playCard(state, "player", 0, REGISTRY);
  assert.equal(pending.pending?.type, "search");
  const next = resolveSearchChoice(pending, 1, REGISTRY);
  assert.equal(next.player.hand.some((item) => item.id === SEARCH_HIT.id), true);
  assert.equal(next.player.deck.at(-1)?.id, LOW_TARGET.id);
  assert.equal(totalCardsInSide(next, "player"), before);
});

test("Search removes one matching copy rather than every duplicate card id", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_SEARCH];
  state.player.deck = [SEARCH_HIT, SEARCH_HIT, FILLER];
  const before = totalCardsInSide(state, "player");
  const pending = playCard(state, "player", 0, REGISTRY);
  const next = resolveSearchChoice(pending, 0, REGISTRY);
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
  const pending = playCard(state, "player", 0, registry);
  const next = resolveSearchChoice(pending, 1, registry);
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
  const rushTarget = declareCharacterAttack(rushState, "player", "rush", REGISTRY, "level1");
  const rushed = chooseAttackTarget(rushTarget, "opponent:leader", REGISTRY);
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
  const target = declareLeaderAttack(state, "player", REGISTRY, "level3");
  const next = chooseAttackTarget(target, "opponent:leader", REGISTRY);
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
  state.opponent.deck = [FILLER, FILLER];
  const before = totalCardsInSide(state, "opponent");
  const target = declareLeaderAttack(state, "player", REGISTRY, "level1");
  const next = chooseAttackTarget(target, "opponent:leader", REGISTRY);
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
  const target = declareLeaderAttack(state, "player", REGISTRY, "level1");
  const next = chooseAttackTarget(target, "opponent:leader", REGISTRY);
  assert.equal(next.opponent.lifeCards.length, 0);
  assert.equal(next.winner, "player");
});

test("OnAttack target choice applies deterministic structured modifier", () => {
  const state = battleState();
  state.player.board = [zone(GOLDEN_ON_ATTACK, "attacker", 1)];
  state.opponent.board = [zone(HIGH_TARGET, "debuff")];
  const attackTarget = declareCharacterAttack(state, "player", "attacker", REGISTRY, "level1");
  const pending = chooseAttackTarget(attackTarget, "opponent:leader", REGISTRY);
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

test("turn transition clears temporary modifiers and outgoing attached DON power", () => {
  let state = battleState();
  state.player.board = [
    { ...zone(GOLDEN_ON_ATTACK, "temporary"), attachedDon: 1, powerModifier: 2_000 },
  ];
  state.player.donTotal = 3;
  state.player.donRested = 1;
  state.opponent.board = [
    { ...zone(HIGH_TARGET, "debuffed"), powerModifier: -2_000, costModifier: -1 },
  ];
  state = endPlayerTurn(state, REGISTRY, "level1");
  assert.equal(state.player.board[0]?.attachedDon, 0);
  assert.equal(state.player.board[0]?.powerModifier, 0);
  assert.equal(state.opponent.board[0]?.powerModifier, 0);
  assert.equal(state.opponent.board[0]?.costModifier, 0);
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
  assert.equal(coverage.leaderStatus, "unsupported");
});

test("normal attack target choice includes Leader and rested Characters only, then KO moves to trash", () => {
  const state = battleState();
  state.opponent.board = [
    { ...zone(FILLER, "rested-target"), rested: true },
    zone(HIGH_TARGET, "active-target"),
  ];
  const pending = declareLeaderAttack(state, "player", REGISTRY, "level1");
  assert.equal(pending.pending?.type, "attack_target");
  if (pending.pending?.type !== "attack_target") return;
  assert.deepEqual(
    pending.pending.legalTargets.map((target) => target.instanceId),
    ["opponent:leader", "rested-target"],
  );
  assert.equal(chooseAttackTarget(pending, "active-target", REGISTRY), pending);
  const resolved = chooseAttackTarget(pending, "rested-target", REGISTRY);
  assert.equal(resolved.opponent.board.some((item) => item.instanceId === "rested-target"), false);
  assert.equal(resolved.opponent.trash.at(-1)?.id, FILLER.id);
});

test("CPU Character attack queue resumes after pending defense", () => {
  const state = battleState();
  state.opponent.deck = [FILLER, FILLER];
  state.player.deck = [FILLER, FILLER];
  state.player.lifeCards = [FILLER, FILLER, FILLER];
  state.opponent.board = [zone(HIGH_TARGET, "cpu-attacker", 1)];
  const leaderDefense = endPlayerTurn(state, REGISTRY, "level1");
  assert.equal(leaderDefense.pending?.type, "defense");
  const characterDefense = acceptAttack(leaderDefense, REGISTRY);
  assert.equal(characterDefense.pending?.type, "defense");
  assert.equal(
    characterDefense.pending?.type === "defense"
      ? characterDefense.pending.attackerName
      : undefined,
    HIGH_TARGET.name,
  );
  assert.equal(characterDefense.opponent.board[0]?.rested, true);
  const completed = acceptAttack(characterDefense, REGISTRY);
  assert.equal(completed.activePlayer, "player");
  assert.equal(completed.turn, 3);
});

test("CPU skips summoning-sick Characters, while Rush can attack on play turn", () => {
  for (const [candidate, expectedAttack] of [
    [zone(HIGH_TARGET, "sick", 2), false],
    [zone(GOLDEN_RUSH, "rush", 2), true],
  ] as const) {
    const state = battleState();
    state.opponent.deck = [FILLER, FILLER];
    state.player.deck = [FILLER, FILLER];
    state.player.lifeCards = [FILLER, FILLER, FILLER];
    state.opponent.board = [candidate];
    const first = endPlayerTurn(state, REGISTRY, "level1");
    const afterLeader = acceptAttack(first, REGISTRY);
    assert.equal(afterLeader.pending?.type === "defense", expectedAttack);
    if (expectedAttack) {
      assert.equal(afterLeader.opponent.board[0]?.rested, true);
    } else {
      assert.equal(afterLeader.activePlayer, "player");
    }
  }
});

test("a rested CPU Character cannot declare an attack", () => {
  const state = battleState();
  state.activePlayer = "opponent";
  state.opponent.board = [{ ...zone(HIGH_TARGET, "rested-cpu", 1), rested: true }];
  const next = declareCharacterAttack(state, "opponent", "rested-cpu", REGISTRY, "level1");
  assert.equal(next, state);
});

test("Leader OnAttack resolves through the attack pipeline and coverage reports Leader separately", () => {
  const leader = card({
    id: "TEST-L001",
    name: "アタック時リーダー",
    cardType: "LEADER",
    cost: null,
    life: 5,
    power: 5_000,
    mechanics: ["OnAttack"],
    effectText: "[アタック時]相手のコスト2以下のキャラ1枚までを、KOする。",
  });
  const registry = new BattleEffectRegistry([leader, FILLER, LOW_TARGET]);
  const state = battleState();
  state.player.leader = leader;
  state.opponent.board = [zone(LOW_TARGET, "leader-effect-target")];
  const selectedAttack = chooseAttackTarget(
    declareLeaderAttack(state, "player", registry, "level1"),
    "opponent:leader",
    registry,
  );
  assert.equal(selectedAttack.pending?.type, "effect_target");
  const resolved = chooseEffectTarget(selectedAttack, "leader-effect-target", registry);
  assert.equal(resolved.opponent.board.length, 0);
  const coverage = calculateDeckCoverage(
    { ...practiceDeck([{ card: FILLER, count: 50 }]), leader },
    registry,
  );
  assert.equal(coverage.leaderStatus, "supported");
});

test("Character-only KO and bounce targets never include the Stage area", () => {
  for (const effectCard of [GOLDEN_KO, GOLDEN_BOUNCE]) {
    const stage = card({ id: `STAGE-${effectCard.id}`, name: "対象外ステージ", cardType: "STAGE" });
    const state = battleState();
    state.player.hand = [effectCard];
    state.opponent.stage = zone(stage, "stage-zone");
    state.opponent.board = [zone(LOW_TARGET, "character-zone")];
    const pending = playCard(state, "player", 0, REGISTRY);
    assert.equal(pending.pending?.type, "effect_target");
    if (pending.pending?.type !== "effect_target") continue;
    assert.equal(
      pending.pending.legalTargets.some((target) => target.instanceId === "stage-zone"),
      false,
    );
    assert.equal(
      pending.pending.legalTargets.every((target) => target.zone === "character"),
      true,
    );
  }
});

test("Character field max5 is independent from the one-card Stage area and Stage replacement trashes the old Stage", () => {
  const oldStage = card({ id: "TEST-STAGE-OLD", name: "旧ステージ", cardType: "STAGE", cost: 0 });
  const newStage = card({ id: "TEST-STAGE-NEW", name: "新ステージ", cardType: "STAGE", cost: 0 });
  const registry = new BattleEffectRegistry([oldStage, newStage]);
  const state = battleState();
  state.player.board = Array.from({ length: 5 }, (_, index) => zone(FILLER, `char-${index}`));
  state.player.stage = zone(oldStage, "old-stage");
  state.player.hand = [newStage];
  const next = playCard(state, "player", 0, registry);
  assert.equal(next.player.board.length, 5);
  assert.equal(next.player.stage?.card.id, newStage.id);
  assert.equal(next.player.trash.at(-1)?.id, oldStage.id);
});

test("optional target can be declined without changing the target zone", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_KO];
  state.opponent.board = [zone(LOW_TARGET, "optional-target")];
  const pending = playCard(state, "player", 0, REGISTRY);
  const next = skipEffectTarget(pending, REGISTRY);
  assert.equal(next.opponent.board[0]?.instanceId, "optional-target");
  assert.equal(next.opponent.trash.length, 0);
});

test("Search lets Player choose among matches or choose zero, moves unmatched cards to bottom, and conserves duplicates", () => {
  const alternateHit = { ...SEARCH_HIT, id: "TEST-SEARCH-ALT", name: "ロロノア・ゾロ" };
  const registry = new BattleEffectRegistry([...GOLDEN_CARDS, SEARCH_HIT, alternateHit, FILLER]);
  const state = battleState();
  state.player.hand = [GOLDEN_SEARCH];
  state.player.deck = [SEARCH_HIT, FILLER, alternateHit, SEARCH_HIT];
  const before = totalCardsInSide(state, "player");
  const pending = playCard(state, "player", 0, registry);
  assert.equal(pending.pending?.type, "search");
  const chosen = resolveSearchChoice(pending, 2, registry);
  assert.equal(chosen.player.hand.at(-1)?.id, alternateHit.id);
  assert.deepEqual(chosen.player.deck.map((cardValue) => cardValue.id), [SEARCH_HIT.id, FILLER.id, SEARCH_HIT.id]);
  assert.equal(totalCardsInSide(chosen, "player"), before);

  const zeroState = battleState();
  zeroState.player.hand = [GOLDEN_SEARCH];
  zeroState.player.deck = [SEARCH_HIT, FILLER, SEARCH_HIT];
  const zeroPending = playCard(zeroState, "player", 0, registry);
  const zero = resolveSearchChoice(zeroPending, null, registry);
  assert.equal(zero.player.hand.length, 0);
  assert.deepEqual(zero.player.deck.map((cardValue) => cardValue.id), [SEARCH_HIT.id, FILLER.id, SEARCH_HIT.id]);
});

test("queued OnAttack continuation preserves Level1 and Level5 CPU defense behavior", () => {
  for (const [skill, expectCounter] of [["level1", false], ["level5", true]] as const) {
    const state = battleState();
    state.player.board = [zone(GOLDEN_ON_ATTACK, `attacker-${skill}`, 1)];
    state.opponent.board = [zone(LOW_TARGET, `effect-target-${skill}`)];
    state.opponent.hand = [GOLDEN_REST];
    state.opponent.lifeCards = [FILLER];
    const targetChoice = declareCharacterAttack(
      state,
      "player",
      `attacker-${skill}`,
      REGISTRY,
      skill,
    );
    const effectChoice = chooseAttackTarget(targetChoice, "opponent:leader", REGISTRY);
    const resolved = chooseEffectTarget(effectChoice, `effect-target-${skill}`, REGISTRY);
    assert.equal(resolved.opponent.hand.length === 0, expectCounter);
    assert.equal(resolved.opponent.lifeCards.length, expectCounter ? 1 : 0);
  }
});

test("Blocker selection is final and cannot rest a second Blocker", () => {
  const state = battleState();
  state.activePlayer = "opponent";
  state.player.board = [zone(GOLDEN_BLOCKER, "blocker-a"), zone(GOLDEN_BLOCKER, "blocker-b")];
  const defense = declareLeaderAttack(state, "opponent", REGISTRY, "level1");
  const first = chooseBlocker(defense, "blocker-a");
  const second = chooseBlocker(first, "blocker-b");
  assert.equal(second.player.board.find((item) => item.instanceId === "blocker-a")?.rested, true);
  assert.equal(second.player.board.find((item) => item.instanceId === "blocker-b")?.rested, false);
  assert.equal(second.pending?.type === "defense" ? second.pending.selectedBlocker?.instanceId : undefined, "blocker-a");
});

test("Character OnAttack self buff is reevaluated for the current battle", () => {
  const selfBuff = card({
    id: "TEST-SELF-BUFF",
    name: "自己強化キャラ",
    power: 5_000,
    mechanics: ["OnAttack", "PowerBuff"],
    effectText: "[アタック時]自分のキャラ1枚までを、このターン中、パワー+2000。",
  });
  const registry = new BattleEffectRegistry([selfBuff, GOLDEN_LEADER, FILLER]);
  const state = battleState();
  state.activePlayer = "opponent";
  state.opponent.board = [zone(selfBuff, "self-buff", 1)];
  const pending = declareCharacterAttack(
    state,
    "opponent",
    "self-buff",
    registry,
    "level1",
  );
  assert.equal(pending.pending?.type, "defense");
  assert.equal(
    pending.pending?.type === "defense" ? pending.pending.attackPower : undefined,
    7_000,
  );
});

test("Leader OnAttack self buff is reevaluated for the current battle", () => {
  const leader = card({
    id: "TEST-L-SELF-BUFF",
    name: "自己強化リーダー",
    cardType: "LEADER",
    cost: null,
    life: 5,
    power: 5_000,
    mechanics: ["OnAttack", "PowerBuff"],
    effectText: "[アタック時]自分のリーダーかキャラ1枚までを、このターン中、パワー+2000。",
  });
  const registry = new BattleEffectRegistry([leader, FILLER]);
  const state = battleState();
  state.activePlayer = "opponent";
  state.opponent.leader = leader;
  const pending = declareLeaderAttack(state, "opponent", registry, "level1");
  assert.equal(pending.pending?.type, "defense");
  assert.equal(
    pending.pending?.type === "defense" ? pending.pending.attackPower : undefined,
    7_000,
  );
});

test("OnAttack reevaluation includes attached DON and existing Character modifiers", () => {
  const selfBuff = card({
    id: "TEST-SELF-BUFF-DON",
    name: "DON込み自己強化",
    power: 5_000,
    mechanics: ["OnAttack", "PowerBuff"],
    effectText: "[アタック時]自分のキャラ1枚までを、このターン中、パワー+2000。",
  });
  const registry = new BattleEffectRegistry([selfBuff, GOLDEN_LEADER, FILLER]);
  const state = battleState();
  state.activePlayer = "opponent";
  state.opponent.board = [
    { ...zone(selfBuff, "buffed-with-don", 1), attachedDon: 1, powerModifier: 1_000 },
  ];
  const pending = declareCharacterAttack(
    state,
    "opponent",
    "buffed-with-don",
    registry,
    "level1",
  );
  assert.equal(
    pending.pending?.type === "defense" ? pending.pending.attackPower : undefined,
    9_000,
  );
});

test("Player target choices still reevaluate attack power and opponent reductions do not change attacker power", () => {
  const selfBuff = card({
    id: "TEST-CHOICE-BUFF",
    name: "選択自己強化",
    power: 5_000,
    mechanics: ["OnAttack", "PowerBuff"],
    effectText: "[アタック時]自分のキャラ1枚までを、このターン中、パワー+2000。",
  });
  const registry = new BattleEffectRegistry([
    selfBuff,
    GOLDEN_ON_ATTACK,
    GOLDEN_LEADER,
    HIGH_TARGET,
    FILLER,
  ]);
  const buffState = battleState();
  buffState.player.board = [zone(selfBuff, "choice-buff", 1)];
  buffState.opponent.leader = { ...GOLDEN_LEADER, power: 8_000 };
  const attackChoice = declareCharacterAttack(
    buffState,
    "player",
    "choice-buff",
    registry,
    "level1",
  );
  const effectChoice = chooseAttackTarget(attackChoice, "opponent:leader", registry);
  const resolvedBuff = chooseEffectTarget(effectChoice, "choice-buff", registry);
  assert.match(resolvedBuff.log.join("\n"), /7000 対 8000/);

  const reductionState = battleState();
  reductionState.player.board = [zone(GOLDEN_ON_ATTACK, "reduction-attacker", 1)];
  reductionState.opponent.board = [zone(HIGH_TARGET, "reduction-target")];
  reductionState.opponent.leader = { ...GOLDEN_LEADER, power: 6_000 };
  const reductionAttack = declareCharacterAttack(
    reductionState,
    "player",
    "reduction-attacker",
    registry,
    "level1",
  );
  const reductionEffect = chooseAttackTarget(
    reductionAttack,
    "opponent:leader",
    registry,
  );
  const resolvedReduction = chooseEffectTarget(
    reductionEffect,
    "reduction-target",
    registry,
  );
  assert.equal(resolvedReduction.opponent.board[0]?.powerModifier, -2_000);
  assert.match(resolvedReduction.log.join("\n"), /5000 対 6000/);
});

test("turn draw from the final deck card causes immediate defeat and stops the CPU attack queue", () => {
  const state = battleState();
  state.opponent.deck = [FILLER];
  state.opponent.board = [zone(HIGH_TARGET, "would-attack", 1)];
  const next = endPlayerTurn(state, REGISTRY, "level1");
  assert.equal(next.winner, "player");
  assert.equal(next.opponent.deck.length, 0);
  assert.equal(next.opponent.leaderRested, false);
  assert.equal(next.opponent.board[0]?.rested, false);
  assert.equal(next.pending, undefined);
  assert.equal(next.cpuAttackQueue, undefined);
});

test("OnPlay Draw from the final deck card causes immediate defeat", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_DRAW];
  state.player.deck = [FILLER];
  const next = playCard(state, "player", 0, REGISTRY);
  assert.equal(next.winner, "opponent");
  assert.equal(next.player.deck.length, 0);
});

test("Trigger Draw from the final deck card causes immediate defeat", () => {
  const state = battleState();
  state.activePlayer = "opponent";
  state.player.lifeCards = [GOLDEN_TRIGGER_DRAW];
  state.player.deck = [FILLER];
  const defense = declareLeaderAttack(state, "opponent", REGISTRY, "level1");
  const trigger = acceptAttack(defense, REGISTRY);
  assert.equal(trigger.pending?.type, "trigger");
  const next = resolveTriggerChoice(trigger, true, REGISTRY);
  assert.equal(next.winner, "opponent");
  assert.equal(next.player.deck.length, 0);
});

test("Search taking the final deck card causes immediate defeat", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_SEARCH];
  state.player.deck = [SEARCH_HIT];
  const pending = playCard(state, "player", 0, REGISTRY);
  assert.equal(pending.pending?.type, "search");
  const next = resolveSearchChoice(pending, 0, REGISTRY);
  assert.equal(next.winner, "opponent");
  assert.equal(next.player.deck.length, 0);
  assert.equal(next.pending, undefined);
  assert.equal(next.queuedAttack, undefined);
});

test("effect draw leaving one card does not cause deck-out defeat", () => {
  const state = battleState();
  state.player.hand = [GOLDEN_DRAW];
  state.player.deck = [FILLER, FILLER];
  const next = playCard(state, "player", 0, REGISTRY);
  assert.equal(next.player.deck.length, 1);
  assert.equal(next.winner, undefined);
});

test("deck-to-Life from the final card uses the same immediate deck-out rule", () => {
  const state = battleState();
  state.player.deck = [FILLER];
  const next = addDeckCardsToLife(state, "player", 1).state;
  assert.equal(next.player.lifeCards.at(0)?.id, FILLER.id);
  assert.equal(next.player.deck.length, 0);
  assert.equal(next.winner, "opponent");
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
