import type { CardListItem } from "@/lib/cards";
import type { CpuSkill } from "@/lib/practice-log";
import type { PracticeDeck } from "@/lib/practice-sim";
import { createAutoBattlePolicy, type AutoBattlePolicy } from "./auto-policy";
import {
  createBattleTraceRecorder,
  emptyRulesBattleStats,
  summarizeBattleState,
  type BattleTraceEvent,
  type BattleTraceMode,
  type HeadlessStateSummary,
  type RulesBattleStats,
} from "./battle-trace";
import { calculateDeckCoverage, type DeckEffectCoverage } from "./coverage";
import { BattleEffectRegistry } from "./effect-registry";
import type { EffectTrigger } from "./effects";
import {
  acceptAttack,
  attachDon,
  chooseAttackTarget,
  chooseBlocker,
  chooseEffectTarget,
  createBattleState,
  declareCharacterAttack,
  declareLeaderAttack,
  endBattleTurn,
  playCard,
  resolveSearchChoice,
  resolveTriggerChoice,
  skipEffectTarget,
  useCounterCard,
} from "./engine";
import { totalCardsInSide } from "./selectors";
import {
  sideOf,
  type BattlePlayer,
  type BattleState,
  type PendingDefenseChoice,
} from "./state";

export type HeadlessBattleOutcome = BattlePlayer | "inconclusive";
export type HeadlessBattleReason =
  | "leader_damage"
  | "deck_out"
  | "effect_win"
  | "turn_limit"
  | "engine_guard";

export interface HeadlessBattleOptions {
  playerDeck: PracticeDeck;
  opponentDeck: PracticeDeck;
  cards: CardListItem[];
  seed: number;
  firstPlayer: BattlePlayer;
  playerPolicy?: AutoBattlePolicy;
  opponentPolicy?: AutoBattlePolicy;
  opponentSkill?: CpuSkill;
  traceMode?: BattleTraceMode;
  maxTurns?: number;
  maxActionsPerTurn?: number;
  maxPendingResolutions?: number;
}

export interface HeadlessBattleResult {
  outcome: HeadlessBattleOutcome;
  reason: HeadlessBattleReason;
  turns: number;
  seed: number;
  firstPlayer: BattlePlayer;
  playerCoverage: DeckEffectCoverage;
  opponentCoverage: DeckEffectCoverage;
  stats: RulesBattleStats;
  finalState: HeadlessStateSummary;
  trace?: BattleTraceEvent[];
}

export interface HeadlessBatchOptions
  extends Omit<
    HeadlessBattleOptions,
    "seed" | "firstPlayer" | "traceMode"
  > {
  games: number;
  seed: number;
  firstPlayer?: BattlePlayer;
  alternateFirstPlayer?: boolean;
}

export interface HeadlessBatchResult {
  games: number;
  outcomes: Record<HeadlessBattleOutcome, number>;
  reasons: Record<HeadlessBattleReason, number>;
  stats: RulesBattleStats;
}

interface RunnerContext {
  registry: BattleEffectRegistry;
  policies: Record<BattlePlayer, AutoBattlePolicy>;
  stats: RulesBattleStats;
  trace: ReturnType<typeof createBattleTraceRecorder>;
  initialTotals: Record<BattlePlayer, number>;
  maxActionsPerTurn: number;
  maxPendingResolutions: number;
  actionsThisTurn: number;
  pendingThisTurn: number;
  guardReached: boolean;
}

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_ACTIONS_PER_TURN = 100;
const DEFAULT_MAX_PENDING_RESOLUTIONS = 100;

export function runHeadlessBattle(
  options: HeadlessBattleOptions,
): HeadlessBattleResult {
  const traceMode = options.traceMode ?? "none";
  const registry = new BattleEffectRegistry(options.cards);
  const stats = emptyRulesBattleStats();
  let state = createBattleState(
    options.playerDeck,
    options.opponentDeck,
    options.seed,
    {
      firstPlayer: options.firstPlayer,
      choiceMode: "deferred",
      logLimit: 0,
    },
  );
  const context: RunnerContext = {
    registry,
    policies: {
      player: options.playerPolicy ?? createAutoBattlePolicy("level4"),
      opponent:
        options.opponentPolicy ??
        createAutoBattlePolicy(options.opponentSkill ?? "level3"),
    },
    stats,
    trace: createBattleTraceRecorder(traceMode),
    initialTotals: {
      player: totalCardsInSide(state, "player"),
      opponent: totalCardsInSide(state, "opponent"),
    },
    maxActionsPerTurn:
      options.maxActionsPerTurn ?? DEFAULT_MAX_ACTIONS_PER_TURN,
    maxPendingResolutions:
      options.maxPendingResolutions ?? DEFAULT_MAX_PENDING_RESOLUTIONS,
    actionsThisTurn: 0,
    pendingThisTurn: 0,
    guardReached: false,
  };
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  context.trace.push("battle_start", state, {
    actor: state.activePlayer,
    details: { seed: options.seed, firstPlayer: options.firstPlayer },
  });
  context.trace.push("turn_start", state, { actor: state.activePlayer });

  while (!state.winner && !context.guardReached && state.turn <= maxTurns) {
    const actor = state.activePlayer;
    context.actionsThisTurn = 0;
    context.pendingThisTurn = 0;
    state = runTurn(state, actor, context);
  }

  let outcome: HeadlessBattleOutcome;
  let reason: HeadlessBattleReason;
  if (context.guardReached) {
    outcome = "inconclusive";
    reason = "engine_guard";
    context.trace.push("guard", state, {
      actor: state.activePlayer,
      details: {
        maxActionsPerTurn: context.maxActionsPerTurn,
        maxPendingResolutions: context.maxPendingResolutions,
      },
    });
  } else if (state.winner) {
    outcome = state.winner;
    const loser = state.winner === "player" ? "opponent" : "player";
    if (sideOf(state, loser).deck.length === 0) {
      reason = "deck_out";
      stats.deckOut += 1;
    } else if (sideOf(state, loser).lifeCards.length === 0) {
      reason = "leader_damage";
    } else {
      reason = "effect_win";
    }
  } else {
    outcome = "inconclusive";
    reason = "turn_limit";
  }

  context.trace.push("game_end", state, {
    actor: state.winner,
    details: { outcome, reason },
  });
  return {
    outcome,
    reason,
    turns: Math.min(state.turn, maxTurns),
    seed: options.seed,
    firstPlayer: options.firstPlayer,
    playerCoverage: calculateDeckCoverage(options.playerDeck, registry),
    opponentCoverage: calculateDeckCoverage(options.opponentDeck, registry),
    stats,
    finalState: summarizeBattleState(state),
    trace: context.trace.events,
  };
}

/** Fixed-memory batch aggregation. Individual results and traces are discarded. */
export function runHeadlessBatch(
  options: HeadlessBatchOptions,
): HeadlessBatchResult {
  const games = Math.max(0, Math.floor(options.games));
  const outcomes: Record<HeadlessBattleOutcome, number> = {
    player: 0,
    opponent: 0,
    inconclusive: 0,
  };
  const reasons: Record<HeadlessBattleReason, number> = {
    leader_damage: 0,
    deck_out: 0,
    effect_win: 0,
    turn_limit: 0,
    engine_guard: 0,
  };
  const stats = emptyRulesBattleStats();
  for (let index = 0; index < games; index++) {
    const firstPlayer = options.alternateFirstPlayer
      ? index % 2 === 0
        ? "player"
        : "opponent"
      : options.firstPlayer ?? "player";
    const result = runHeadlessBattle({
      ...options,
      seed: options.seed + index * 97,
      firstPlayer,
      traceMode: "none",
    });
    outcomes[result.outcome] += 1;
    reasons[result.reason] += 1;
    for (const key of Object.keys(stats) as Array<keyof RulesBattleStats>) {
      stats[key] += result.stats[key];
    }
  }
  return { games, outcomes, reasons, stats };
}

function runTurn(
  initial: BattleState,
  actor: BattlePlayer,
  context: RunnerContext,
): BattleState {
  let state = resolvePending(initial, context);
  if (state.winner || context.guardReached) return state;
  const policy = context.policies[actor];

  while (!state.pending && !state.winner) {
    const handIndex = policy.choosePlayableCard(state, actor, context.registry);
    if (handIndex === null) break;
    const card = sideOf(state, actor).hand[handIndex];
    if (!card) break;
    const before = state;
    state = performAction(
      state,
      context,
      () => playCard(state, actor, handIndex, context.registry),
    );
    if (state === before) break;
    const played =
      state.sequence > before.sequence ||
      sideOf(state, actor).trash.length > sideOf(before, actor).trash.length ||
      sideOf(state, actor).donRested > sideOf(before, actor).donRested;
    if (!played) break;
    context.stats.cardsPlayed += 1;
    context.stats.donSpent += Math.max(
      0,
      sideOf(state, actor).donRested - sideOf(before, actor).donRested,
    );
    observeEffectEncounter(context, card, card.cardType === "EVENT" ? "main" : "on_play");
    const trigger = card.cardType === "EVENT" ? "main" : "on_play";
    const actions = context.registry
      .get(card.id)
      .effects.find((effect) => effect.trigger === trigger)
      ?.actions.map((action) => action.type)
      .join(",");
    context.trace.push("play_card", state, {
      actor,
      cardId: card.id,
      details: {
        effectStatus: context.registry.get(card.id).status,
        actions: actions ?? "",
      },
    });
    state = resolvePending(state, context);
    if (context.guardReached) return state;
  }

  while (!state.pending && !state.winner) {
    const target = policy.chooseDonTarget(state, actor);
    if (!target) break;
    const before = state;
    state = performAction(state, context, () => attachDon(state, actor, target));
    if (state === before || sideOf(state, actor).donRested === sideOf(before, actor).donRested) {
      break;
    }
    context.stats.donAttached += 1;
    context.trace.push("don_attach", state, { actor, targetId: target });
  }

  const attackers = policy.orderAttackers(state, actor);
  for (const attacker of attackers) {
    if (state.winner || context.guardReached) break;
    const before = state;
    state = performAction(state, context, () =>
      attacker.kind === "leader"
        ? declareLeaderAttack(state, actor, context.registry, policy.skill)
        : declareCharacterAttack(
            state,
            actor,
            attacker.instanceId,
            context.registry,
            policy.skill,
          ),
    );
    if (state === before) continue;
    state = resolvePending(state, context);
  }

  if (state.winner || context.guardReached) return state;
  context.trace.push("turn_end", state, { actor });
  const beforeTurn = state;
  state = performAction(state, context, () => endBattleTurn(state, actor));
  if (state === beforeTurn) {
    context.guardReached = true;
    return state;
  }
  context.trace.push("turn_start", state, { actor: state.activePlayer });
  return state;
}

function resolvePending(
  initial: BattleState,
  context: RunnerContext,
): BattleState {
  let state = initial;
  while (state.pending && !state.winner && !context.guardReached) {
    context.pendingThisTurn += 1;
    if (context.pendingThisTurn > context.maxPendingResolutions) {
      context.guardReached = true;
      break;
    }
    const pending = state.pending;
    const policy = context.policies[pendingActor(pending)];
    if (pending.type === "attack_target") {
      const targetId = policy.chooseAttackTarget(
        state,
        pending.attacker,
        pending.legalTargets,
      );
      const attackerCard =
        pending.attackerKind === "leader"
          ? sideOf(state, pending.attacker).leader
          : sideOf(state, pending.attacker).board.find(
              (zone) => zone.instanceId === pending.attackerInstanceId,
            )?.card;
      state = performAction(state, context, () =>
        chooseAttackTarget(state, targetId, context.registry),
      );
      context.stats.attacksDeclared += 1;
      if (pending.attackerKind === "leader") context.stats.leaderAttacks += 1;
      else context.stats.characterAttacks += 1;
      if (attackerCard) observeEffectEncounter(context, attackerCard, "on_attack");
      context.trace.push("attack_declared", state, {
        actor: pending.attacker,
        cardId: attackerCard?.id,
        targetId,
        details: { attackerKind: pending.attackerKind },
      });
      continue;
    }
    if (pending.type === "effect_target") {
      const targetId = policy.chooseEffectTarget(state, pending);
      const before = state;
      state = performAction(state, context, () =>
        targetId
          ? chooseEffectTarget(state, targetId, context.registry)
          : skipEffectTarget(state, context.registry),
      );
      if (state === before) {
        context.guardReached = true;
        break;
      }
      context.trace.push("effect_target", state, {
        actor: pending.actor,
        cardId: pending.sourceCardId,
        targetId: targetId ?? undefined,
        details: { skipped: targetId === null, action: pending.action.type },
      });
      continue;
    }
    if (pending.type === "search") {
      const lookedIndex = policy.chooseSearch(state, pending);
      const before = state;
      state = performAction(state, context, () =>
        resolveSearchChoice(state, lookedIndex, context.registry),
      );
      if (state === before) {
        context.guardReached = true;
        break;
      }
      context.stats.searchesResolved += 1;
      context.trace.push("search_choice", state, {
        actor: pending.actor,
        cardId: pending.sourceCardId,
        details: { selectedIndex: lookedIndex },
      });
      continue;
    }
    if (pending.type === "trigger") {
      const activate = policy.activateTrigger(state, pending);
      state = performAction(state, context, () =>
        resolveTriggerChoice(state, activate, context.registry),
      );
      if (activate) {
        context.stats.triggersActivated += 1;
        observeEffectEncounter(context, pending.revealedCard, "trigger", true);
      }
      else context.stats.triggersDeclined += 1;
      context.trace.push("trigger_choice", state, {
        actor: pending.defender,
        cardId: pending.revealedCard.id,
        details: { activated: activate },
      });
      continue;
    }
    state = resolveDefense(state, pending, policy, context);
  }
  return state;
}

function resolveDefense(
  state: BattleState,
  pending: PendingDefenseChoice,
  policy: AutoBattlePolicy,
  context: RunnerContext,
): BattleState {
  if (!pending.selectedBlocker) {
    const blockerId = policy.chooseBlocker(state, pending);
    if (blockerId) {
      const before = state;
      const blockerCardId = sideOf(state, pending.defender).board.find(
        (zone) => zone.instanceId === blockerId,
      )?.card.id;
      const next = performAction(state, context, () => chooseBlocker(state, blockerId));
      if (next !== before) {
        context.stats.blockersUsed += 1;
        context.trace.push("blocker_choice", next, {
          actor: pending.defender,
          cardId: blockerCardId,
          targetId: blockerId,
        });
        return next;
      }
    }
  }
  const current = state.pending?.type === "defense" ? state.pending : pending;
  const counterIndex = policy.chooseCounterCard(state, current);
  if (counterIndex !== null) {
    const card = sideOf(state, current.defender).hand[counterIndex];
    const before = state;
    const next = performAction(state, context, () => useCounterCard(state, counterIndex));
    if (next !== before && card) {
      context.stats.counterCardsUsed += 1;
      context.stats.counterPowerUsed += card.counter ?? 0;
      context.trace.push("counter_used", next, {
        actor: current.defender,
        cardId: card.id,
        details: { counter: card.counter ?? 0 },
      });
      return next;
    }
  }
  const before = state;
  const topLife = sideOf(state, current.defender).lifeCards[0];
  const next = performAction(state, context, () => acceptAttack(state, context.registry));
  const lifeDelta = Math.max(
    0,
    sideOf(before, current.defender).lifeCards.length -
      sideOf(next, current.defender).lifeCards.length,
  );
  context.stats.damageDealt += lifeDelta;
  if (lifeDelta > 0 && topLife?.triggerText) {
    context.stats.triggersRevealed += 1;
    observeEffectEncounter(context, topLife, "trigger", false);
  }
  context.trace.push("attack_resolved", next, {
    actor: current.attacker,
    targetId: current.target.instanceId,
    details: { damage: lifeDelta },
  });
  return next;
}

function performAction(
  state: BattleState,
  context: RunnerContext,
  action: () => BattleState,
): BattleState {
  context.actionsThisTurn += 1;
  if (context.actionsThisTurn > context.maxActionsPerTurn) {
    context.guardReached = true;
    return state;
  }
  const next = action();
  if (!cardsAreConserved(next, context.initialTotals)) {
    context.guardReached = true;
  }
  return next;
}

function observeEffectEncounter(
  context: RunnerContext,
  card: CardListItem,
  trigger: EffectTrigger,
  resolved = true,
): void {
  const definition = context.registry.get(card.id);
  const hasEffect = definition.effects.some((effect) => effect.trigger === trigger);
  const hasPrintedTrigger = trigger === "trigger" && Boolean(card.triggerText);
  const hasMechanic = card.mechanics.some((mechanic) =>
    triggerMechanics(trigger).includes(mechanic),
  );
  if (!hasEffect && !hasPrintedTrigger && !hasMechanic) return;
  if (definition.status === "supported" && hasEffect && resolved) {
    context.stats.supportedEffectsResolved += 1;
  } else if (definition.status === "partial") {
    context.stats.partialEffectsEncountered += 1;
  } else {
    context.stats.unsupportedEffectsEncountered += 1;
  }
}

function cardsAreConserved(
  state: BattleState,
  initialTotals: Record<BattlePlayer, number>,
): boolean {
  return (
    totalCardsInSide(state, "player") === initialTotals.player &&
    totalCardsInSide(state, "opponent") === initialTotals.opponent
  );
}

function pendingActor(
  pending: NonNullable<BattleState["pending"]>,
): BattlePlayer {
  if (pending.type === "defense") return pending.defender;
  if (pending.type === "trigger") return pending.defender;
  if (pending.type === "attack_target") return pending.attacker;
  return pending.actor;
}

function triggerMechanics(trigger: EffectTrigger): string[] {
  switch (trigger) {
    case "on_play":
      return ["OnPlay"];
    case "on_attack":
    case "when_attacking":
      return ["OnAttack"];
    case "trigger":
      return ["Trigger"];
    case "activate_main":
      return ["ActivateMain"];
    case "main":
      return ["MainPhase"];
  }
}
