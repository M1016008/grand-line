import type { CardListItem } from "@/lib/cards";
import { cpuSkillRank, type CpuSkill } from "@/lib/practice-log";
import type { PracticeDeck } from "@/lib/practice-sim";
import { applyTargetedAction, drawCards, searchDeck } from "./actions";
import { BattleEffectRegistry } from "./effect-registry";
import { isTargetedAction, type EffectAction, type EffectTrigger } from "./effects";
import {
  blockerTargets,
  chooseDeterministicTarget,
  effectiveCharacterPower,
  effectiveLeaderPower,
  legalTargets,
} from "./selectors";
import {
  DEFAULT_BATTLE_CONFIG,
  appendBattleLog,
  otherPlayer,
  sideOf,
  withSide,
  type AttackContext,
  type BattlePlayer,
  type BattleSide,
  type BattleState,
  type BattleTargetRef,
  type BattleZoneCard,
} from "./state";

export function createBattleState(
  playerDeck: PracticeDeck,
  opponentDeck: PracticeDeck,
  seed: number,
): BattleState {
  const rng = mulberry32(seed);
  const state: BattleState = {
    seed,
    turn: 1,
    activePlayer: "player",
    player: setupSide(playerDeck, rng),
    opponent: setupSide(opponentDeck, rng),
    log: [],
    sequence: 0,
  };
  return beginTurn(state, "player", true);
}

export function playCard(
  state: BattleState,
  actor: BattlePlayer,
  handIndex: number,
  registry: BattleEffectRegistry,
): BattleState {
  if (state.winner || state.pending || state.activePlayer !== actor) return state;
  const side = sideOf(state, actor);
  const card = side.hand[handIndex];
  if (!card) return appendBattleLog(state, "選択した手札が見つかりません。");
  const definition = registry.get(card.id);
  if (
    card.cardType === "EVENT" &&
    !definition.effects.some((effect) => effect.trigger === "main")
  ) {
    return appendBattleLog(
      state,
      `${card.name} は構造化済みの[メイン]効果がないため使用できません。`,
    );
  }
  const cost = card.cost ?? 0;
  if (cost > availableDon(side)) {
    return appendBattleLog(state, `${card.name} はDON!!が足りません。`);
  }
  if (
    (card.cardType === "CHARACTER" || card.cardType === "STAGE") &&
    side.board.length >= DEFAULT_BATTLE_CONFIG.boardLimit
  ) {
    return appendBattleLog(state, "キャラ/ステージエリアがいっぱいです。");
  }

  const nextSide: BattleSide = {
    ...side,
    hand: side.hand.filter((_, index) => index !== handIndex),
    donRested: Math.min(side.donTotal, side.donRested + cost),
  };
  let next = withSide(state, actor, nextSide);
  if (card.cardType === "CHARACTER" || card.cardType === "STAGE") {
    const placed = addToBoard(next, actor, card, false);
    next = placed.state;
    next = appendBattleLog(
      next,
      `${actorLabel(actor)}: ${card.id} ${card.name} を登場`,
      `→ coverage: ${definition.status}`,
    );
    return resolveCardTrigger(next, actor, card, "on_play", registry);
  }

  next = withSide(next, actor, {
    ...sideOf(next, actor),
    trash: [...sideOf(next, actor).trash, card],
  });
  next = appendBattleLog(
    next,
    `${actorLabel(actor)}: ${card.id} ${card.name} を使用`,
    `→ coverage: ${definition.status}`,
  );
  return resolveCardTrigger(next, actor, card, "main", registry);
}

export function chooseEffectTarget(
  state: BattleState,
  instanceId: string,
  registry: BattleEffectRegistry,
): BattleState {
  if (state.pending?.type !== "effect_target") return state;
  const pending = state.pending;
  const target = pending.legalTargets.find((item) => item.instanceId === instanceId);
  if (!target || !isTargetedAction(pending.action)) return state;
  const applied = applyTargetedAction({ ...state, pending: undefined }, pending.action, target);
  let next = appendBattleLog(applied.state, ...applied.log);
  next = resolveActions(
    next,
    pending.actor,
    pending.sourceCardId,
    pending.sourceName,
    pending.trigger,
    pending.remainingActions,
    registry,
  );
  return continueQueuedAttack(next, registry);
}

export function attachDon(
  state: BattleState,
  actor: BattlePlayer,
  targetInstanceId: string,
): BattleState {
  if (state.winner || state.pending || state.activePlayer !== actor) return state;
  const side = sideOf(state, actor);
  if (availableDon(side) <= 0) return appendBattleLog(state, "付与できるアクティブDON!!がありません。");
  if (targetInstanceId === `${actor}:leader`) {
    return appendBattleLog(
      withSide(state, actor, {
        ...side,
        donRested: side.donRested + 1,
        leaderAttachedDon: side.leaderAttachedDon + 1,
      }),
      `${actorLabel(actor)}: リーダーへDON!!を1枚付与（このターン+1000）`,
    );
  }
  const target = side.board.find((zone) => zone.instanceId === targetInstanceId);
  if (!target) return state;
  return appendBattleLog(
    withSide(state, actor, {
      ...side,
      donRested: side.donRested + 1,
      board: side.board.map((zone) =>
        zone.instanceId === targetInstanceId
          ? { ...zone, attachedDon: zone.attachedDon + 1 }
          : zone,
      ),
    }),
    `${actorLabel(actor)}: ${target.card.name}へDON!!を1枚付与（このターン+1000）`,
  );
}

export function declareLeaderAttack(
  state: BattleState,
  actor: BattlePlayer,
  registry: BattleEffectRegistry,
  cpuSkill: CpuSkill,
): BattleState {
  if (state.winner || state.pending || state.activePlayer !== actor || state.turn === 1) {
    return state;
  }
  const side = sideOf(state, actor);
  if (side.leaderRested) return state;
  const rested = withSide(state, actor, { ...side, leaderRested: true });
  const defender = otherPlayer(actor);
  const attack: AttackContext = {
    attacker: actor,
    defender,
    attackerName: side.leader.name,
    attackPower: effectiveLeaderPower(rested, actor),
    target: leaderTarget(rested, defender),
  };
  return continueAttack(appendBattleLog(rested, `${side.leader.name} でリーダーへ攻撃`), attack, registry, cpuSkill);
}

export function declareCharacterAttack(
  state: BattleState,
  actor: BattlePlayer,
  instanceId: string,
  registry: BattleEffectRegistry,
  cpuSkill: CpuSkill,
): BattleState {
  if (state.winner || state.pending || state.activePlayer !== actor || state.turn === 1) {
    return state;
  }
  const side = sideOf(state, actor);
  const zone = side.board.find((item) => item.instanceId === instanceId);
  if (!zone || zone.rested) return state;
  if (zone.playedTurn >= state.turn && !registry.isRush(zone.card.id)) {
    return appendBattleLog(state, `${zone.card.name} は登場ターン中のため攻撃できません。`);
  }
  const next = withSide(state, actor, {
    ...side,
    board: side.board.map((item) =>
      item.instanceId === instanceId ? { ...item, rested: true } : item,
    ),
  });
  const attack: AttackContext = {
    attacker: actor,
    defender: otherPlayer(actor),
    attackerName: zone.card.name,
    attackPower: effectiveCharacterPower(zone),
    target: leaderTarget(next, otherPlayer(actor)),
  };
  let prepared = appendBattleLog(next, `${zone.card.id} ${zone.card.name} でリーダーへ攻撃`);
  prepared = { ...prepared, queuedAttack: attack };
  prepared = resolveCardTrigger(prepared, actor, zone.card, "on_attack", registry);
  return continueQueuedAttack(prepared, registry, cpuSkill);
}

export function chooseBlocker(state: BattleState, instanceId: string): BattleState {
  if (state.pending?.type !== "defense") return state;
  const blocker = state.pending.blockerOptions.find((item) => item.instanceId === instanceId);
  if (!blocker) return state;
  const side = sideOf(state, blocker.owner);
  const next = withSide(state, blocker.owner, {
    ...side,
    board: side.board.map((zone) =>
      zone.instanceId === instanceId ? { ...zone, rested: true } : zone,
    ),
  });
  return appendBattleLog(
    {
      ...next,
      pending: { ...state.pending, selectedBlocker: blocker, target: blocker },
    },
    `→ ${blocker.label} がブロック`,
  );
}

export function useCounterCard(state: BattleState, handIndex: number): BattleState {
  if (state.pending?.type !== "defense") return state;
  const defender = state.pending.defender;
  const side = sideOf(state, defender);
  const card = side.hand[handIndex];
  const counter = card?.counter ?? 0;
  if (!card || counter <= 0) return state;
  const next = withSide(state, defender, {
    ...side,
    hand: side.hand.filter((_, index) => index !== handIndex),
    trash: [...side.trash, card],
  });
  return appendBattleLog(
    {
      ...next,
      pending: { ...state.pending, counterPower: state.pending.counterPower + counter },
    },
    `→ ${card.id} ${card.name} をカウンターで使用（+${counter}、手札→トラッシュ）`,
  );
}

export function acceptAttack(
  state: BattleState,
  registry: BattleEffectRegistry,
): BattleState {
  if (state.pending?.type !== "defense") return state;
  const pending = state.pending;
  let next: BattleState = { ...state, pending: undefined };
  next = resolveAttackHit(next, pending, registry);
  return completeCpuTurnIfReady(next);
}

export function resolveTriggerChoice(
  state: BattleState,
  activate: boolean,
  registry: BattleEffectRegistry,
): BattleState {
  if (state.pending?.type !== "trigger") return state;
  const pending = state.pending;
  let next: BattleState = { ...state, pending: undefined };
  if (!activate) {
    const side = sideOf(next, pending.defender);
    next = withSide(next, pending.defender, {
      ...side,
      hand: [...side.hand, pending.revealedCard],
    });
    next = appendBattleLog(next, "→ Triggerを使わず手札へ");
  } else {
    next = activateRevealedTrigger(next, pending.defender, pending.revealedCard, pending.effect, registry);
  }
  return completeCpuTurnIfReady(next);
}

export function endPlayerTurn(
  state: BattleState,
  registry: BattleEffectRegistry,
  cpuSkill: CpuSkill,
): BattleState {
  if (state.winner || state.pending || state.activePlayer !== "player") return state;
  let next = beginTurn({ ...state, activePlayer: "opponent" }, "opponent", false);
  if (next.winner) return next;
  next = runCpuMain(next, registry, cpuSkill);
  if (next.winner || next.pending) return next;
  next = declareLeaderAttack(next, "opponent", registry, cpuSkill);
  if (next.pending) return { ...next, resumePlayerTurn: true };
  return beginTurn({ ...next, turn: next.turn + 1 }, "player", false);
}

function runCpuMain(
  state: BattleState,
  registry: BattleEffectRegistry,
  cpuSkill: CpuSkill,
): BattleState {
  const maxPlays = [1, 1, 2, 2, 3][cpuSkillRank(cpuSkill) - 1] ?? 1;
  let next = state;
  for (let count = 0; count < maxPlays; count++) {
    const side = next.opponent;
    const candidates = side.hand
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => (card.cost ?? 0) <= availableDon(side))
      .filter(({ card }) =>
        card.cardType === "EVENT"
          ? registry.get(card.id).effects.some((effect) => effect.trigger === "main")
          : side.board.length < DEFAULT_BATTLE_CONFIG.boardLimit,
      )
      .sort((a, b) =>
        (b.card.cost ?? 0) - (a.card.cost ?? 0) || a.card.id.localeCompare(b.card.id),
      );
    const selected = candidates[0];
    if (!selected) break;
    next = playCard(next, "opponent", selected.index, registry);
    if (next.pending || next.winner) break;
  }
  return next;
}

function continueQueuedAttack(
  state: BattleState,
  registry: BattleEffectRegistry,
  cpuSkill: CpuSkill = "level3",
): BattleState {
  if (state.pending || !state.queuedAttack) return state;
  const attack = state.queuedAttack;
  return continueAttack({ ...state, queuedAttack: undefined }, attack, registry, cpuSkill);
}

function continueAttack(
  state: BattleState,
  attack: AttackContext,
  registry: BattleEffectRegistry,
  cpuSkill: CpuSkill,
): BattleState {
  const blockers = blockerTargets(state, attack.defender, (cardId) => registry.isBlocker(cardId));
  if (attack.defender === "player") {
    return {
      ...state,
      pending: {
        type: "defense",
        ...attack,
        blockerOptions: blockers,
        counterPower: 0,
      },
    };
  }
  return resolveCpuDefense(state, attack, blockers, registry, cpuSkill);
}

function resolveCpuDefense(
  state: BattleState,
  attack: AttackContext,
  blockers: BattleTargetRef[],
  registry: BattleEffectRegistry,
  cpuSkill: CpuSkill,
): BattleState {
  const rank = cpuSkillRank(cpuSkill);
  let next = state;
  let target = attack.target;
  if (blockers.length > 0 && rank >= 2) {
    target = blockers[0];
    const side = sideOf(next, attack.defender);
    next = withSide(next, attack.defender, {
      ...side,
      board: side.board.map((zone) =>
        zone.instanceId === target.instanceId ? { ...zone, rested: true } : zone,
      ),
    });
    next = appendBattleLog(next, `→ CPU: ${target.label} がブロック`);
  }
  const defenseBase = targetDefensePower(next, target);
  const needed = Math.max(0, attack.attackPower - defenseBase);
  if (needed > 0 && rank >= 2) {
    const countered = consumeCpuCounters(next, attack.defender, needed, rank);
    next = countered.state;
    if (countered.amount > 0) {
      next = appendBattleLog(next, `→ CPUは手札${countered.usedNames.join("、")}をカウンター使用（+${countered.amount}）`);
    }
    return resolveAttackHit(
      next,
      { type: "defense", ...attack, target, blockerOptions: [], counterPower: countered.amount },
      registry,
    );
  }
  return resolveAttackHit(
    next,
    { type: "defense", ...attack, target, blockerOptions: [], counterPower: 0 },
    registry,
  );
}

function resolveAttackHit(
  state: BattleState,
  attack: Extract<BattleState["pending"], { type: "defense" }>,
  registry: BattleEffectRegistry,
): BattleState {
  const defense = targetDefensePower(state, attack.target) + attack.counterPower;
  if (attack.attackPower < defense) {
    return appendBattleLog(state, `→ ${attack.attackPower} 対 ${defense}、攻撃を防いだ`);
  }
  if (attack.target.zone === "character") {
    const side = sideOf(state, attack.target.owner);
    const zone = side.board.find((item) => item.instanceId === attack.target.instanceId);
    if (!zone) return state;
    return appendBattleLog(
      withSide(state, attack.target.owner, {
        ...side,
        board: side.board.filter((item) => item.instanceId !== zone.instanceId),
        trash: [...side.trash, zone.card],
      }),
      `→ ${zone.card.name} をバトルでKO（トラッシュへ）`,
    );
  }
  return dealLifeDamage(state, attack.defender, registry);
}

function dealLifeDamage(
  state: BattleState,
  defender: BattlePlayer,
  registry: BattleEffectRegistry,
): BattleState {
  const side = sideOf(state, defender);
  const [revealed, ...lifeCards] = side.lifeCards;
  if (!revealed) {
    return appendBattleLog({ ...state, winner: otherPlayer(defender) }, "→ ライフ0への攻撃が通り決着");
  }
  let next = withSide(state, defender, { ...side, lifeCards });
  next = appendBattleLog(next, `→ Life reveal: ${revealed.id} ${revealed.name}`);
  const definition = registry.get(revealed.id);
  const effect = definition.effects.find((item) => item.trigger === "trigger");
  if (!revealed.triggerText || !effect) {
    const current = sideOf(next, defender);
    next = withSide(next, defender, { ...current, hand: [...current.hand, revealed] });
    return appendBattleLog(
      next,
      revealed.triggerText
        ? `→ Trigger ${definition.status}: 未対応のため発動せず手札へ`
        : "→ Triggerなし、手札へ",
    );
  }
  if (defender === "player") {
    return {
      ...next,
      pending: { type: "trigger", defender, revealedCard: revealed, effect },
    };
  }
  return activateRevealedTrigger(next, defender, revealed, effect, registry);
}

function activateRevealedTrigger(
  state: BattleState,
  defender: BattlePlayer,
  card: CardListItem,
  effect: ReturnType<BattleEffectRegistry["get"]>["effects"][number],
  registry: BattleEffectRegistry,
): BattleState {
  const playSelf = effect.actions.some((action) => action.type === "play_self");
  let next = state;
  if (
    playSelf &&
    sideOf(next, defender).board.length >= DEFAULT_BATTLE_CONFIG.boardLimit
  ) {
    const side = sideOf(next, defender);
    return appendBattleLog(
      withSide(next, defender, { ...side, hand: [...side.hand, card] }),
      `Trigger: ${card.id} ${card.name}`,
      "→ board max5のため発動できず手札へ",
    );
  }
  if (!playSelf) {
    const side = sideOf(next, defender);
    next = withSide(next, defender, { ...side, trash: [...side.trash, card] });
  }
  next = appendBattleLog(next, `Trigger: ${card.id} ${card.name}`, "→ 発動");
  return resolveActions(next, defender, card.id, card.name, "trigger", effect.actions, registry, card);
}

function resolveCardTrigger(
  state: BattleState,
  actor: BattlePlayer,
  card: CardListItem,
  trigger: EffectTrigger,
  registry: BattleEffectRegistry,
): BattleState {
  const definition = registry.get(card.id);
  const effect = definition.effects.find((item) => item.trigger === trigger);
  if (!effect) {
    if (card.mechanics.some((mechanic) => triggerMechanics(trigger).includes(mechanic))) {
      return appendBattleLog(
        state,
        `→ ${trigger} ${definition.status}: ${definition.unsupportedReasons.join(" / ") || "未対応"}`,
      );
    }
    return state;
  }
  let next = appendBattleLog(state, `${card.id} ${triggerLabel(trigger)}`, `→ ${effect.sourceText}`);
  if (definition.status === "partial") next = appendBattleLog(next, "→ このカードの他効果はpartial");
  return resolveActions(next, actor, card.id, card.name, trigger, effect.actions, registry, card);
}

function resolveActions(
  state: BattleState,
  actor: BattlePlayer,
  sourceCardId: string,
  sourceName: string,
  trigger: EffectTrigger,
  actions: EffectAction[],
  registry: BattleEffectRegistry,
  sourceCard?: CardListItem,
): BattleState {
  let next = state;
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    if (isTargetedAction(action)) {
      const targets = legalTargets(next, actor, action.target);
      if (targets.length === 0) {
        next = appendBattleLog(next, "→ 合法対象なし");
        continue;
      }
      if (actor === "player") {
        return {
          ...next,
          pending: {
            type: "effect_target",
            actor,
            sourceCardId,
            sourceName,
            action,
            remainingActions: actions.slice(index + 1),
            legalTargets: targets,
            trigger,
          },
        };
      }
      const chosen = chooseDeterministicTarget(next, targets);
      if (chosen) {
        const applied = applyTargetedAction(next, action, chosen);
        next = appendBattleLog(applied.state, ...applied.log);
      }
      continue;
    }
    if (action.type === "draw") {
      const applied = drawCards(next, actor, action.count);
      next = appendBattleLog(applied.state, ...applied.log);
    } else if (action.type === "search") {
      const applied = searchDeck(next, actor, action);
      next = appendBattleLog(applied.state, ...applied.log);
    } else if (action.type === "play_self" && sourceCard) {
      const placed = addToBoard(next, actor, sourceCard, action.rested ?? false);
      next = appendBattleLog(placed.state, `→ ${sourceCard.name} をTriggerで登場`);
    } else if (action.type === "add_life") {
      next = addLife(next, actor, action.count);
    } else if (action.type === "take_life") {
      next = takeOwnLife(next, actor, action.count, action.destination);
    }
  }
  void registry;
  return next;
}

function addToBoard(
  state: BattleState,
  actor: BattlePlayer,
  card: CardListItem,
  rested: boolean,
): { state: BattleState; zone?: BattleZoneCard } {
  const side = sideOf(state, actor);
  if (side.board.length >= DEFAULT_BATTLE_CONFIG.boardLimit) {
    return { state: appendBattleLog(state, "→ board max5のため登場できません") };
  }
  const zone: BattleZoneCard = {
    instanceId: `${actor}:${card.id}:${state.turn}:${state.sequence}`,
    card,
    rested,
    playedTurn: state.turn,
    attachedDon: 0,
    powerModifier: 0,
    costModifier: 0,
  };
  return {
    zone,
    state: {
      ...withSide(state, actor, { ...side, board: [...side.board, zone] }),
      sequence: state.sequence + 1,
    },
  };
}

function beginTurn(state: BattleState, actor: BattlePlayer, firstTurn: boolean): BattleState {
  let next = withSide(state, actor, refreshSide(sideOf(state, actor)));
  next = { ...next, activePlayer: actor };
  if (!firstTurn) {
    const drawn = drawCards(next, actor, 1);
    next = drawn.state;
    if (drawn.log[0]?.includes("山札不足")) {
      return appendBattleLog({ ...next, winner: otherPlayer(actor) }, `${actorLabel(actor)}が山札切れ`);
    }
  }
  next = withSide(next, actor, addDon(sideOf(next, actor), firstTurn ? 1 : 2));
  return appendBattleLog(next, `Turn ${state.turn}: ${actorLabel(actor)}のターン`);
}

function completeCpuTurnIfReady(state: BattleState): BattleState {
  if (state.pending || !state.resumePlayerTurn || state.winner) return state;
  const { resumePlayerTurn: _ignored, ...base } = state;
  void _ignored;
  return beginTurn({ ...base, turn: base.turn + 1 }, "player", false);
}

function targetDefensePower(state: BattleState, target: BattleTargetRef): number {
  if (target.zone === "leader") return effectiveLeaderPower(state, target.owner);
  const zone = sideOf(state, target.owner).board.find((item) => item.instanceId === target.instanceId);
  return zone ? effectiveCharacterPower(zone) : 0;
}

function consumeCpuCounters(
  state: BattleState,
  defender: BattlePlayer,
  needed: number,
  rank: number,
): { state: BattleState; amount: number; usedNames: string[] } {
  const side = sideOf(state, defender);
  const candidates = side.hand
    .map((card, index) => ({ card, index, counter: card.counter ?? 0 }))
    .filter((entry) => entry.counter > 0)
    .sort((a, b) => a.counter - b.counter || a.card.id.localeCompare(b.card.id));
  const used: typeof candidates = [];
  let amount = 0;
  const limit = rank >= 4 ? 3 : 1;
  for (const candidate of candidates) {
    if (amount >= needed || used.length >= limit) break;
    used.push(candidate);
    amount += candidate.counter;
  }
  const usedIndexes = new Set(used.map((item) => item.index));
  return {
    amount,
    usedNames: used.map((item) => item.card.name),
    state: withSide(state, defender, {
      ...side,
      hand: side.hand.filter((_, index) => !usedIndexes.has(index)),
      trash: [...side.trash, ...used.map((item) => item.card)],
    }),
  };
}

function addLife(state: BattleState, actor: BattlePlayer, count: number): BattleState {
  let side = sideOf(state, actor);
  let moved = 0;
  for (let index = 0; index < count; index++) {
    const [card, ...deck] = side.deck;
    if (!card) break;
    side = { ...side, deck, lifeCards: [card, ...side.lifeCards] };
    moved++;
  }
  return appendBattleLog(withSide(state, actor, side), `→ Lifeに${moved}枚追加`);
}

function takeOwnLife(
  state: BattleState,
  actor: BattlePlayer,
  count: number,
  destination: "hand" | "trash",
): BattleState {
  const side = sideOf(state, actor);
  const moved = side.lifeCards.slice(0, count);
  const rest = side.lifeCards.slice(count);
  return appendBattleLog(
    withSide(state, actor, {
      ...side,
      lifeCards: rest,
      [destination]: [...side[destination], ...moved],
    }),
    `→ Lifeから${moved.length}枚を${destination === "hand" ? "手札" : "トラッシュ"}へ`,
  );
}

function setupSide(deck: PracticeDeck, rng: () => number): BattleSide {
  const pile = deck.entries.flatMap((entry) =>
    Array.from({ length: entry.count }, () => entry.card),
  );
  shuffle(pile, rng);
  const hand = pile.splice(0, 5);
  const lifeCards = pile.splice(0, deck.leader.life ?? 5).reverse();
  return {
    deckName: deck.name,
    leader: deck.leader,
    deck: pile,
    hand,
    lifeCards,
    board: [],
    trash: [],
    donTotal: 0,
    donRested: 0,
    donDeck: 10,
    leaderRested: false,
    leaderAttachedDon: 0,
    leaderPowerModifier: 0,
  };
}

function refreshSide(side: BattleSide): BattleSide {
  return {
    ...side,
    donRested: 0,
    leaderRested: false,
    leaderAttachedDon: 0,
    leaderPowerModifier: 0,
    board: side.board.map((zone) => ({
      ...zone,
      rested: false,
      attachedDon: 0,
      powerModifier: 0,
      costModifier: 0,
    })),
  };
}

function addDon(side: BattleSide, amount: number): BattleSide {
  const actual = Math.max(0, Math.min(amount, side.donDeck, 10 - side.donTotal));
  return {
    ...side,
    donTotal: side.donTotal + actual,
    donDeck: side.donDeck - actual,
  };
}

function availableDon(side: BattleSide): number {
  return Math.max(0, side.donTotal - side.donRested);
}

function leaderTarget(state: BattleState, owner: BattlePlayer): BattleTargetRef {
  const leader = sideOf(state, owner).leader;
  return {
    owner,
    zone: "leader",
    instanceId: `${owner}:leader`,
    cardId: leader.id,
    label: `${leader.name} (リーダー)`,
  };
}

function actorLabel(actor: BattlePlayer): string {
  return actor === "player" ? "あなた" : "CPU";
}

function triggerLabel(trigger: EffectTrigger): string {
  return trigger === "on_play"
    ? "登場時"
    : trigger === "on_attack"
      ? "アタック時"
      : trigger === "trigger"
        ? "Trigger"
        : trigger;
}

function triggerMechanics(trigger: EffectTrigger): string[] {
  return trigger === "on_play"
    ? ["OnPlay"]
    : trigger === "on_attack"
      ? ["OnAttack"]
      : trigger === "trigger"
        ? ["Trigger"]
        : trigger === "main"
          ? ["MainPhase"]
          : ["ActivateMain"];
}

function shuffle<T>(items: T[], rng: () => number): void {
  for (let index = items.length - 1; index > 0; index--) {
    const target = Math.floor(rng() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
