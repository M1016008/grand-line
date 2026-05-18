/**
 * DSL effect interpreter.
 *
 * The interpreter is a stack-driven state machine:
 *
 *   1. Triggers (ON_PLAY etc.) push a ResolutionFrame onto
 *      `state.pendingEffects`.
 *   2. `processPendingEffects` repeatedly examines the top frame and
 *      advances `actionIndex` by one action at a time.
 *   3. If an action needs a choice (multiple legal targets, modal
 *      selection, optional yes/no), the interpreter sets
 *      `state.pendingChoice` and returns. Caller (CPU policy / UI)
 *      provides a `RESOLVE_CHOICE` action; the rules layer feeds the
 *      choice back through `resolveChoice` here, which clears
 *      `pendingChoice` and re-enters `processPendingEffects`.
 *   4. Nested actions (`if` body, chosen `choose_one` mode,
 *      `for_each` iteration body) are realized by *pushing new frames*
 *      on top of the stack — the engine never resolves nested actions
 *      inline. This keeps the suspend/resume contract uniform.
 *
 * Coverage in Phase B-1
 * ─────────────────────
 *  - Atomic: draw, discard, ko, power_buff, cost_mod, rest, activate,
 *    life_damage, give_keyword, move (limited zones), reveal.
 *  - Recursive: if, choose_one, for_each.
 *  - Auto-resolve when uniquely determined (no spurious choice prompts).
 *
 * Deferred to Phase B-2
 * ─────────────────────
 *  - search (deck/trash search with reveal-of-N, take-K)
 *  - attach_don during effect resolution
 *  - play_from_trash (puts a character back on field at reduced cost)
 *  - chained triggers (ON_KO → fires another ON_KO etc. — works in
 *    principle via the stack; needs hookup in rules.ts)
 */

import type {
  ActionCondition,
  CardFilterAtom,
  EffectAction,
  IntOrScaled,
  TriggerEventName,
  TriggeredEffect,
} from "./effect-dsl";
import { enumeratePlayer, evaluateFilter, type LocatedInstance } from "./filters";
import type {
  CardInstance,
  CardRegistry,
  ChoiceRequest,
  EngineEvent,
  EngineEventType,
  GameState,
  PlayerState,
  ResolutionFrame,
} from "./state";

/* ──────────────────────────────────────────────────────────────────────── */
/* Public API                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

export interface EffectResult {
  readonly state: GameState;
  readonly events: ReadonlyArray<EngineEvent>;
}

/**
 * Push a fresh frame onto the resolution stack for a triggered effect.
 *
 * The caller (typically rules.ts after a PLAY_CARD or KO event) wires
 * the (`triggerKind`, `sourceInstanceId`, `controller`) tuple from the
 * game-flow context.
 */
export function enqueueTriggeredEffect(
  state: GameState,
  effect: TriggeredEffect,
  context: {
    triggerKind: TriggerEventName;
    sourceInstanceId: string;
    controller: "A" | "B";
    label?: string;
  },
): GameState {
  if (effect.on !== context.triggerKind) {
    // We tolerate mismatch — controller might be queuing an "ACTIVATE_MAIN"
    // for a card whose DSL declares its primary on as different. Keep the
    // requested triggerKind so logs reflect the actual game event.
  }
  const frame: ResolutionFrame = {
    triggerKind: context.triggerKind,
    sourceInstanceId: context.sourceInstanceId,
    controller: context.controller,
    actions: effect.actions,
    actionIndex: 0,
    label: context.label,
  };
  return { ...state, pendingEffects: [...state.pendingEffects, frame] };
}

/**
 * Drive the resolution stack as far as possible. Stops when:
 *   - stack is empty, or
 *   - a choice is required (sets state.pendingChoice and returns), or
 *   - the game has ended.
 */
export function processPendingEffects(
  state: GameState,
  registry: CardRegistry,
): EffectResult {
  let next = state;
  const events: EngineEvent[] = [];
  // Hard cap to prevent runaway loops if a card definition mis-stacks itself.
  const MAX_STEPS = 1000;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (next.pendingChoice) return { state: next, events };
    if (next.winner != null) return { state: next, events };
    if (next.pendingEffects.length === 0) return { state: next, events };
    const top = next.pendingEffects[next.pendingEffects.length - 1]!;
    if (top.actionIndex >= top.actions.length) {
      // Frame is done — pop it.
      next = popFrame(next);
      const ev = emit(next, "EFFECT_RESOLVED", top.controller, {
        triggerKind: top.triggerKind,
        sourceInstanceId: top.sourceInstanceId,
      });
      next = ev.state;
      events.push(ev.event);
      continue;
    }
    const r = stepFrame(next, top, registry);
    next = r.state;
    events.push(...r.events);
  }
  throw new Error("effect resolution exceeded MAX_STEPS — likely a stack-explosion bug");
}

/**
 * Re-enter the interpreter after the rules layer has received a
 * RESOLVE_CHOICE action. The caller has already cleared
 * `state.pendingChoice` and applied the choice's effect.
 */
export function resumeAfterChoice(
  state: GameState,
  registry: CardRegistry,
): EffectResult {
  if (state.pendingChoice) {
    throw new Error("resumeAfterChoice called while pendingChoice still set");
  }
  return processPendingEffects(state, registry);
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Choice resolution dispatch from rules layer                              */
/* ──────────────────────────────────────────────────────────────────────── */

export interface TargetPickResolution {
  readonly kind: "TARGET_PICK";
  readonly picked: readonly string[];
}
export interface ModalPickResolution {
  readonly kind: "MODAL_PICK";
  readonly modeId: string;
}
export interface YesNoResolution {
  readonly kind: "YES_NO";
  readonly accept: boolean;
}
export type ChoiceResolution =
  | TargetPickResolution
  | ModalPickResolution
  | YesNoResolution;

/**
 * Apply a player choice to the current state. Validates the resolution
 * against the active `pendingChoice`, then mutates the top frame to
 * reflect the decision (e.g. for choose_one, pushes the selected mode's
 * action list as a new frame).
 *
 * Returns the new state; caller follows up with `processPendingEffects`.
 */
export function applyChoiceResolution(
  state: GameState,
  resolution: ChoiceResolution,
  registry: CardRegistry,
): EffectResult {
  const choice = state.pendingChoice;
  if (!choice) throw new Error("no pendingChoice to resolve");
  if (choice.kind !== resolution.kind) {
    throw new Error(`choice kind mismatch: ${choice.kind} vs ${resolution.kind}`);
  }
  const top = state.pendingEffects[state.pendingEffects.length - 1];
  if (!top) throw new Error("no resolution frame for choice");
  const action = top.actions[top.actionIndex];
  if (!action) throw new Error("frame has no current action");

  let next: GameState = { ...state, pendingChoice: null };
  const events: EngineEvent[] = [];

  if (resolution.kind === "TARGET_PICK") {
    // The current action must consume targets. We dispatch by op.
    const r = executeWithTargets(next, top, action, resolution.picked, registry);
    next = r.state;
    events.push(...r.events);
    next = advanceTopFrame(next);
  } else if (resolution.kind === "MODAL_PICK") {
    if (action.op !== "choose_one") {
      throw new Error("MODAL_PICK on a non-choose_one action");
    }
    const mode = action.modes.find((m) => m.id === resolution.modeId);
    if (!mode) throw new Error(`unknown modeId: ${resolution.modeId}`);
    next = advanceTopFrame(next);
    next = pushFrame(next, {
      triggerKind: top.triggerKind,
      sourceInstanceId: top.sourceInstanceId,
      controller: top.controller,
      actions: mode.actions,
      actionIndex: 0,
      label: `mode:${mode.id}`,
    });
  } else if (resolution.kind === "YES_NO") {
    // For now, YES_NO is consumed by trigger-from-life acceptance.
    // No action in the action list to advance — caller handles upstream.
    if (resolution.accept) {
      // No-op here; rules layer enqueued the effect frame already.
    } else {
      // Decline: pop the just-queued frame.
      next = popFrame(next);
    }
  }

  const ev = emit(next, "CHOICE_RESOLVED", choice.chooser, {
    kind: resolution.kind,
    detail: resolution,
  });
  next = ev.state;
  events.push(ev.event);

  const cont = processPendingEffects(next, registry);
  return { state: cont.state, events: [...events, ...cont.events] };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Stack / frame manipulation                                               */
/* ──────────────────────────────────────────────────────────────────────── */

function pushFrame(state: GameState, frame: ResolutionFrame): GameState {
  return { ...state, pendingEffects: [...state.pendingEffects, frame] };
}

function popFrame(state: GameState): GameState {
  return {
    ...state,
    pendingEffects: state.pendingEffects.slice(0, -1),
  };
}

function advanceTopFrame(state: GameState): GameState {
  if (state.pendingEffects.length === 0) return state;
  const top = state.pendingEffects[state.pendingEffects.length - 1]!;
  const updated: ResolutionFrame = { ...top, actionIndex: top.actionIndex + 1 };
  return {
    ...state,
    pendingEffects: [...state.pendingEffects.slice(0, -1), updated],
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Stepping: handle one action from the top frame                           */
/* ──────────────────────────────────────────────────────────────────────── */

function stepFrame(
  state: GameState,
  frame: ResolutionFrame,
  registry: CardRegistry,
): EffectResult {
  const action = frame.actions[frame.actionIndex]!;
  const events: EngineEvent[] = [];

  // Recursive actions never resolve in-place; they push frames / set choices.
  switch (action.op) {
    case "if":
      return stepIf(state, frame, action, registry);
    case "choose_one":
      return stepChooseOne(state, frame, action);
    case "for_each":
      return stepForEach(state, frame, action, registry);
    case "draw":
    case "life_damage":
    case "reveal":
      return stepZeroTarget(state, frame, action, registry, events);
    case "discard":
      return stepDiscard(state, frame, action, registry);
    case "ko":
    case "rest":
    case "activate":
    case "power_buff":
    case "cost_mod":
    case "give_keyword":
    case "move":
      return stepFilteredTarget(state, frame, action, registry);
    case "search":
    case "attach_don":
    case "play_from_trash":
      // Phase B-2: not yet implemented in interpreter. Skip silently for
      // now (advance past), but emit an event so analytics can flag it.
      {
        const ev = emit(state, "EFFECT_ACTION", frame.controller, {
          unimplemented: action.op,
        });
        const next = advanceTopFrame(ev.state);
        return { state: next, events: [ev.event] };
      }
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Zero-target / global actions                                             */
/* ──────────────────────────────────────────────────────────────────────── */

function stepZeroTarget(
  state: GameState,
  frame: ResolutionFrame,
  action: Extract<EffectAction, { op: "draw" | "life_damage" | "reveal" }>,
  registry: CardRegistry,
  events: EngineEvent[],
): EffectResult {
  let next = state;
  if (action.op === "draw") {
    const target = sideToPlayer(action.target ?? "self", frame.controller);
    const r = drawCards(next, target, action.count);
    next = r.state;
    events.push(...r.events);
  } else if (action.op === "life_damage") {
    const target = sideToPlayer(action.target, frame.controller);
    for (let i = 0; i < action.count; i++) {
      const r = damageLifeOnce(next, target);
      next = r.state;
      events.push(...r.events);
      if (next.winner != null) break;
    }
  } else if (action.op === "reveal") {
    const target = sideToPlayer(action.target, frame.controller);
    const ev = emit(next, "EFFECT_ACTION", frame.controller, {
      op: "reveal",
      zone: action.zone,
      count: action.count,
      target,
    });
    next = ev.state;
    events.push(ev.event);
  }
  next = advanceTopFrame(next);
  void registry;
  return { state: next, events };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Discard                                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

function stepDiscard(
  state: GameState,
  frame: ResolutionFrame,
  action: Extract<EffectAction, { op: "discard" }>,
  registry: CardRegistry,
): EffectResult {
  const fromSide = sideToPlayer(action.from, frame.controller);
  const fromP = state.players[fromSide];

  const eligibleIdx: number[] = fromP.hand
    .map((card, idx) => {
      if (!action.filter) return idx;
      const data = registry.get(card.cardId);
      return matchesAtomLocal(
        data,
        action.filter,
        fromSide,
        frame.controller,
        frame.sourceInstanceId,
      )
        ? idx
        : -1;
    })
    .filter((i) => i >= 0);

  if (eligibleIdx.length === 0) {
    // No legal discards. Advance silently — the action does nothing.
    return { state: advanceTopFrame(state), events: [] };
  }
  const count = Math.min(action.count, eligibleIdx.length);
  const chooserSide =
    action.chooser === "opponent"
      ? oppOf(frame.controller)
      : action.chooser === "random"
      ? "random"
      : frame.controller;

  // Auto-resolve if uniquely determined or random.
  if (eligibleIdx.length === count || chooserSide === "random") {
    const picked: CardInstance[] = eligibleIdx
      .slice(0, count)
      .map((i) => fromP.hand[i]!);
    return performDiscard(state, fromSide, picked, frame.controller);
  }

  const options = eligibleIdx.map((i) => fromP.hand[i]!.instanceId);
  const choice: ChoiceRequest = {
    kind: "TARGET_PICK",
    chooser: chooserSide as "A" | "B",
    options,
    minPick: count,
    maxPick: count,
    prompt: `discard ${count} from ${fromSide}'s hand`,
  };
  const ev = emit(state, "CHOICE_REQUIRED", chooserSide as "A" | "B", {
    op: "discard",
    options,
    count,
  });
  return {
    state: { ...ev.state, pendingChoice: choice },
    events: [ev.event],
  };
}

function performDiscard(
  state: GameState,
  fromSide: "A" | "B",
  cards: readonly CardInstance[],
  effectController: "A" | "B",
): EffectResult {
  let next = state;
  const events: EngineEvent[] = [];
  const fromP = next.players[fromSide];
  const cardSet = new Set(cards.map((c) => c.instanceId));
  next = updatePlayer(next, fromSide, {
    hand: fromP.hand.filter((c) => !cardSet.has(c.instanceId)),
    trash: [...fromP.trash, ...cards],
  });
  for (const c of cards) {
    const ev = emit(next, "EFFECT_ACTION", effectController, {
      op: "discard",
      cardId: c.cardId,
      instanceId: c.instanceId,
      from: fromSide,
    });
    next = ev.state;
    events.push(ev.event);
  }
  next = advanceTopFrame(next);
  return { state: next, events };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Filtered-target actions                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

function stepFilteredTarget(
  state: GameState,
  frame: ResolutionFrame,
  action: Extract<
    EffectAction,
    {
      op:
        | "ko"
        | "rest"
        | "activate"
        | "power_buff"
        | "cost_mod"
        | "give_keyword"
        | "move";
    }
  >,
  registry: CardRegistry,
): EffectResult {
  const filter =
    action.op === "move"
      ? action.source
      : action.target;
  const matches = evaluateFilter(state, registry, filter, {
    controller: frame.controller,
    selfInstanceId: frame.sourceInstanceId,
  });
  const { min, max } = resolveTargetBounds(action, matches.length);

  if (matches.length === 0 || max === 0) {
    return { state: advanceTopFrame(state), events: [] };
  }

  const chooser = action.chooser ?? "controller";
  const chooserSide =
    chooser === "opponent" ? oppOf(frame.controller) : chooser === "controller" ? frame.controller : "random";

  // Auto-resolve when target count is forced (all matches must be selected
  // — only happens when min === max === matches.length).
  if (min === max && matches.length === min) {
    return executeWithTargets(
      state,
      frame,
      action,
      matches.map((m) => m.instance.instanceId),
      registry,
    );
  }
  // Auto-resolve when the filter already collapses to N candidates we need.
  if (matches.length <= max && min <= matches.length && chooserSide === "random") {
    return executeWithTargets(
      state,
      frame,
      action,
      matches.slice(0, max).map((m) => m.instance.instanceId),
      registry,
    );
  }
  // If unique target and minPick is met, just pick it.
  if (matches.length === 1 && min <= 1) {
    return executeWithTargets(
      state,
      frame,
      action,
      [matches[0]!.instance.instanceId],
      registry,
    );
  }

  const options = matches.map((m) => m.instance.instanceId);
  const choice: ChoiceRequest = {
    kind: "TARGET_PICK",
    chooser: chooserSide as "A" | "B",
    options,
    minPick: min,
    maxPick: max,
    prompt: `${action.op}: pick ${min === max ? min : `${min}-${max}`}`,
  };
  const ev = emit(state, "CHOICE_REQUIRED", chooserSide as "A" | "B", {
    op: action.op,
    options,
    minPick: min,
    maxPick: max,
  });
  return {
    state: { ...ev.state, pendingChoice: choice },
    events: [ev.event],
  };
}

function resolveTargetBounds(
  action: { count?: number | { upTo: number; min?: number } | "all" },
  matchCount: number,
): { min: number; max: number } {
  const raw = action.count;
  if (raw == null) return { min: 1, max: 1 };
  if (raw === "all") return { min: matchCount, max: matchCount };
  if (typeof raw === "number") return { min: raw, max: raw };
  return { min: raw.min ?? 0, max: raw.upTo };
}

function executeWithTargets(
  state: GameState,
  frame: ResolutionFrame,
  action: EffectAction,
  pickedInstanceIds: readonly string[],
  registry: CardRegistry,
): EffectResult {
  let next = state;
  const events: EngineEvent[] = [];

  const targets = pickedInstanceIds.map((id) => locateById(next, id, registry));

  switch (action.op) {
    case "ko": {
      for (const t of targets) {
        if (!t) continue;
        if (t.zone !== "character_area") continue;
        const r = koInstance(
          next,
          t.controller,
          t.instance.instanceId,
          frame.controller,
        );
        next = r.state;
        events.push(...r.events);
      }
      break;
    }
    case "rest": {
      for (const t of targets) {
        if (!t) continue;
        next = setCharacterState(next, t.controller, t.instance.instanceId, "rested");
        const ev = emit(next, "EFFECT_ACTION", frame.controller, {
          op: "rest",
          cardId: t.data.id,
          instanceId: t.instance.instanceId,
        });
        next = ev.state;
        events.push(ev.event);
      }
      break;
    }
    case "activate": {
      for (const t of targets) {
        if (!t) continue;
        next = setCharacterState(next, t.controller, t.instance.instanceId, "active");
        const ev = emit(next, "EFFECT_ACTION", frame.controller, {
          op: "activate",
          cardId: t.data.id,
          instanceId: t.instance.instanceId,
        });
        next = ev.state;
        events.push(ev.event);
      }
      break;
    }
    case "power_buff": {
      const delta = evalIntOrScaled(
        action.delta,
        next,
        registry,
        frame.controller,
      );
      for (const t of targets) {
        if (!t) continue;
        next = applyPowerBuff(next, t, delta, action.duration);
        const ev = emit(next, "EFFECT_ACTION", frame.controller, {
          op: "power_buff",
          cardId: t.data.id,
          instanceId: t.instance.instanceId,
          delta,
          duration: action.duration,
        });
        next = ev.state;
        events.push(ev.event);
      }
      break;
    }
    case "cost_mod": {
      // Cost mods affect future plays — we model them as transient on the
      // *registered* card cost via a turn-scoped overlay. For Phase B-1
      // we track this as a turn-scoped reduction stored on the target.
      // (Full implementation: requires a costMod overlay per instance —
      // deferred to Phase B-2 when cost reduction matters for KO-by-cost.)
      const ev = emit(next, "EFFECT_ACTION", frame.controller, {
        op: "cost_mod",
        delta: action.delta,
        duration: action.duration,
        targetInstanceIds: targets.filter(Boolean).map((t) => t!.instance.instanceId),
      });
      next = ev.state;
      events.push(ev.event);
      break;
    }
    case "give_keyword": {
      for (const t of targets) {
        if (!t) continue;
        next = grantKeyword(next, t, action.keyword, action.duration);
        const ev = emit(next, "EFFECT_ACTION", frame.controller, {
          op: "give_keyword",
          keyword: action.keyword,
          cardId: t.data.id,
          instanceId: t.instance.instanceId,
        });
        next = ev.state;
        events.push(ev.event);
      }
      break;
    }
    case "move": {
      // Limited support: only "trash" destination implemented in B-1.
      if (action.destination !== "trash") {
        const ev = emit(next, "EFFECT_ACTION", frame.controller, {
          op: "move",
          unimplementedDest: action.destination,
        });
        next = ev.state;
        events.push(ev.event);
        break;
      }
      for (const t of targets) {
        if (!t) continue;
        // Only character→trash currently. Hand/deck/etc. moves arrive in B-2.
        if (t.zone === "character_area") {
          const r = koInstance(
            next,
            t.controller,
            t.instance.instanceId,
            frame.controller,
          );
          next = r.state;
          events.push(...r.events);
        }
      }
      break;
    }
    default:
      throw new Error(`executeWithTargets unsupported op: ${action.op}`);
  }

  next = advanceTopFrame(next);
  return { state: next, events };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* if / choose_one / for_each                                               */
/* ──────────────────────────────────────────────────────────────────────── */

function stepIf(
  state: GameState,
  frame: ResolutionFrame,
  action: Extract<EffectAction, { op: "if" }>,
  registry: CardRegistry,
): EffectResult {
  const passed = evaluateCondition(state, action.condition, frame.controller, registry);
  let next = advanceTopFrame(state);
  if (passed) {
    next = pushFrame(next, {
      triggerKind: frame.triggerKind,
      sourceInstanceId: frame.sourceInstanceId,
      controller: frame.controller,
      actions: action.then,
      actionIndex: 0,
      label: "if:then",
    });
  } else if (action.else) {
    next = pushFrame(next, {
      triggerKind: frame.triggerKind,
      sourceInstanceId: frame.sourceInstanceId,
      controller: frame.controller,
      actions: action.else,
      actionIndex: 0,
      label: "if:else",
    });
  }
  return { state: next, events: [] };
}

function stepChooseOne(
  state: GameState,
  frame: ResolutionFrame,
  action: Extract<EffectAction, { op: "choose_one" }>,
): EffectResult {
  const chooser = action.chooser ?? "controller";
  const chooserSide =
    chooser === "opponent" ? oppOf(frame.controller) : frame.controller;
  // Random chooser auto-picks the first mode (deterministic given seed).
  if (action.chooser === "random") {
    const next = advanceTopFrame(state);
    const mode = action.modes[0]!;
    return {
      state: pushFrame(next, {
        triggerKind: frame.triggerKind,
        sourceInstanceId: frame.sourceInstanceId,
        controller: frame.controller,
        actions: mode.actions,
        actionIndex: 0,
        label: `mode:${mode.id}`,
      }),
      events: [],
    };
  }
  const choice: ChoiceRequest = {
    kind: "MODAL_PICK",
    chooser: chooserSide,
    modeIds: action.modes.map((m) => m.id),
    prompt: "choose one",
  };
  const ev = emit(state, "CHOICE_REQUIRED", chooserSide, {
    op: "choose_one",
    modeIds: choice.modeIds,
  });
  return {
    state: { ...ev.state, pendingChoice: choice },
    events: [ev.event],
  };
}

function stepForEach(
  state: GameState,
  frame: ResolutionFrame,
  action: Extract<EffectAction, { op: "for_each" }>,
  registry: CardRegistry,
): EffectResult {
  const side = action.side ?? "self";
  const targetSide = side === "self" ? frame.controller : side === "opponent" ? oppOf(frame.controller) : null;
  let count = 0;
  for (const who of (["A", "B"] as const)) {
    if (targetSide && who !== targetSide) continue;
    const locs = enumeratePlayer(state.players[who], registry).filter((l) => {
      if (l.zone !== action.zone) return false;
      return matchesAtomLocal(
        l.data,
        action.filter,
        l.controller,
        frame.controller,
        frame.sourceInstanceId,
      );
    });
    count += locs.length;
  }
  if (action.cap != null) count = Math.min(count, action.cap);
  let next = advanceTopFrame(state);
  // Push N copies of the body, top-down so they resolve in declared order.
  for (let i = 0; i < count; i++) {
    next = pushFrame(next, {
      triggerKind: frame.triggerKind,
      sourceInstanceId: frame.sourceInstanceId,
      controller: frame.controller,
      actions: action.actions,
      actionIndex: 0,
      label: `for_each#${i}`,
    });
  }
  return { state: next, events: [] };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Conditions                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

export function evaluateCondition(
  state: GameState,
  cond: ActionCondition | undefined,
  controller: "A" | "B",
  registry: CardRegistry,
): boolean {
  if (!cond) return true;
  const p = state.players[controller];
  if (cond.minDonInArea != null) {
    if (p.donArea.active + p.donArea.rested < cond.minDonInArea) return false;
  }
  if (cond.lifeBetween) {
    const [lo, hi] = cond.lifeBetween;
    if (p.life.length < lo || p.life.length > hi) return false;
  }
  if (cond.trashCount) {
    const count = p.trash.filter((c) => {
      const data = registry.get(c.cardId);
      return matchesAtomLocal(data, cond.trashCount!.filter, controller, controller, "");
    }).length;
    if (count < cond.trashCount.gte) return false;
  }
  if (cond.controllerPlayedThisTurn) {
    const plays = state.turnLog.plays.filter(
      (p2) =>
        p2.controller === controller &&
        registryMatch(registry, p2.cardId, cond.controllerPlayedThisTurn!.filter),
    );
    if (plays.length < cond.controllerPlayedThisTurn.gte) return false;
  }
  if (cond.koOccurredThisTurn) {
    const side = cond.koOccurredThisTurn.side ?? "any";
    const kos = state.turnLog.kos.filter((k) => {
      if (side === "self" && k.byController !== controller) return false;
      if (side === "opponent" && k.byController === controller) return false;
      return registryMatch(registry, k.cardId, cond.koOccurredThisTurn!.filter);
    });
    if (kos.length < cond.koOccurredThisTurn.gte) return false;
  }
  if (cond.leaderAttackedThisTurn != null) {
    const did = state.turnLog.leaderAttacked[controller];
    if (cond.leaderAttackedThisTurn !== did) return false;
  }
  // `custom` is engine-opaque; treated as true unless a TS handler intervenes.
  return true;
}

function registryMatch(
  registry: CardRegistry,
  cardId: string,
  atom: CardFilterAtom,
): boolean {
  if (!registry.has(cardId)) return false;
  const data = registry.get(cardId);
  return matchesAtomLocal(data, atom, "A", "A", "");
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

function sideToPlayer(side: "self" | "opponent" | "any", controller: "A" | "B"): "A" | "B" {
  if (side === "self") return controller;
  if (side === "opponent") return oppOf(controller);
  return controller; // "any" → default to controller (rare for zero-target ops)
}

function oppOf(p: "A" | "B"): "A" | "B" {
  return p === "A" ? "B" : "A";
}

function updatePlayer(
  state: GameState,
  who: "A" | "B",
  patch: Partial<PlayerState>,
): GameState {
  return {
    ...state,
    players: { ...state.players, [who]: { ...state.players[who], ...patch } },
  };
}

function emit(
  state: GameState,
  type: EngineEventType,
  actor: "A" | "B" | "SYSTEM",
  payload?: Record<string, unknown>,
): { state: GameState; event: EngineEvent } {
  const event: EngineEvent = {
    seq: state.eventSeq,
    turn: state.turn,
    phase: state.phase,
    actor,
    type,
    payload,
  };
  return { state: { ...state, eventSeq: state.eventSeq + 1 }, event };
}

function drawCards(
  state: GameState,
  who: "A" | "B",
  n: number,
): EffectResult {
  const p = state.players[who];
  if (p.deck.length < n) {
    // Deck-out triggered during effect-driven draw.
    const evWin = emit(state, "GAME_END", "SYSTEM", {
      winner: oppOf(who),
      reason: "DECK_OUT",
    });
    const next: GameState = {
      ...evWin.state,
      winner: oppOf(who),
      endCondition: "DECK_OUT",
      phase: "GAME_OVER",
    };
    return { state: next, events: [evWin.event] };
  }
  const drawn = p.deck.slice(0, n);
  let next = updatePlayer(state, who, {
    deck: p.deck.slice(n),
    hand: [...p.hand, ...drawn],
  });
  const events: EngineEvent[] = [];
  for (const c of drawn) {
    const ev = emit(next, "DRAW", who, { cardId: c.cardId, instanceId: c.instanceId });
    next = ev.state;
    events.push(ev.event);
  }
  return { state: next, events };
}

function damageLifeOnce(state: GameState, who: "A" | "B"): EffectResult {
  const p = state.players[who];
  if (p.life.length === 0) {
    const evWin = emit(state, "GAME_END", "SYSTEM", {
      winner: oppOf(who),
      reason: "LIFE_OUT",
    });
    const next: GameState = {
      ...evWin.state,
      winner: oppOf(who),
      endCondition: "LIFE_OUT",
      phase: "GAME_OVER",
    };
    return { state: next, events: [evWin.event] };
  }
  const top = p.life[0]!;
  const next = updatePlayer(state, who, {
    life: p.life.slice(1),
    hand: [...p.hand, top],
  });
  const ev = emit(next, "LIFE_LOST", who, {
    cardId: top.cardId,
    instanceId: top.instanceId,
    remainingLife: next.players[who].life.length,
  });
  return { state: ev.state, events: [ev.event] };
}

function koInstance(
  state: GameState,
  owner: "A" | "B",
  instanceId: string,
  byController: "A" | "B",
): EffectResult {
  const p = state.players[owner];
  const ch = p.characters.find((c) => c.instanceId === instanceId);
  if (!ch) return { state, events: [] };
  const newDonArea = {
    active: p.donArea.active,
    rested: p.donArea.rested + ch.attachedDon,
  };
  let next = updatePlayer(state, owner, {
    characters: p.characters.filter((c) => c.instanceId !== instanceId),
    trash: [...p.trash, { instanceId: ch.instanceId, cardId: ch.cardId }],
    donArea: newDonArea,
  });
  next = {
    ...next,
    turnLog: {
      ...next.turnLog,
      kos: [
        ...next.turnLog.kos,
        {
          owner,
          byController,
          cardId: ch.cardId,
          instanceId: ch.instanceId,
        },
      ],
    },
  };
  const ev = emit(next, "CHARACTER_KO", "SYSTEM", {
    owner,
    cardId: ch.cardId,
    instanceId: ch.instanceId,
  });
  return { state: ev.state, events: [ev.event] };
}

function setCharacterState(
  state: GameState,
  owner: "A" | "B",
  instanceId: string,
  to: "active" | "rested",
): GameState {
  const p = state.players[owner];
  if (instanceId === p.leader.instanceId) {
    return updatePlayer(state, owner, {
      leader: { ...p.leader, state: to },
    });
  }
  return updatePlayer(state, owner, {
    characters: p.characters.map((c) =>
      c.instanceId === instanceId ? { ...c, state: to } : c,
    ),
  });
}

function applyPowerBuff(
  state: GameState,
  target: LocatedInstance,
  delta: number,
  duration: "turn" | "permanent",
): GameState {
  const owner = target.controller;
  const p = state.players[owner];
  const id = target.instance.instanceId;
  if (id === p.leader.instanceId) {
    // Leaders can only take turn-scoped buffs in our model; permanent on
    // leader is rare and effectively turn-scoped too because the field
    // resets every game.
    return updatePlayer(state, owner, {
      leader: {
        ...p.leader,
        powerModTurn: p.leader.powerModTurn + delta,
      },
    });
  }
  return updatePlayer(state, owner, {
    characters: p.characters.map((c) =>
      c.instanceId === id
        ? {
            ...c,
            powerModTurn:
              duration === "turn" ? c.powerModTurn + delta : c.powerModTurn,
            powerModPermanent:
              duration === "permanent"
                ? c.powerModPermanent + delta
                : c.powerModPermanent,
          }
        : c,
    ),
  });
}

function grantKeyword(
  state: GameState,
  target: LocatedInstance,
  keyword: "blocker" | "rush" | "double_attack" | "banish",
  duration: "turn" | "permanent",
): GameState {
  // Phase B-1 supports blocker/rush as boolean flags; double_attack/banish
  // are no-ops in the interpreter for now (logged, no rule effect yet).
  void duration; // turn-scoped reset is handled at endTurn for both flags
  if (keyword !== "blocker" && keyword !== "rush") return state;
  const owner = target.controller;
  const p = state.players[owner];
  const id = target.instance.instanceId;
  return updatePlayer(state, owner, {
    characters: p.characters.map((c) =>
      c.instanceId === id
        ? {
            ...c,
            hasBlockerGranted: keyword === "blocker" ? true : c.hasBlockerGranted,
            hasRushGranted: keyword === "rush" ? true : c.hasRushGranted,
          }
        : c,
    ),
  });
}

function evalIntOrScaled(
  v: IntOrScaled,
  state: GameState,
  registry: CardRegistry,
  controller: "A" | "B",
): number {
  if (typeof v === "number") return v;
  const targetSide = v.side ?? "self";
  let count = 0;
  for (const who of (["A", "B"] as const)) {
    if (targetSide === "self" && who !== controller) continue;
    if (targetSide === "opponent" && who === controller) continue;
    const locs = enumeratePlayer(state.players[who], registry).filter((l) => {
      if (l.zone !== v.in) return false;
      return matchesAtomLocal(l.data, v.perCardMatching, l.controller, controller, "");
    });
    count += locs.length;
  }
  let contribution = count * (v.multiplier ?? 1);
  if (v.cap != null) contribution = Math.min(contribution, v.cap);
  return v.base + contribution;
}

function locateById(
  state: GameState,
  instanceId: string,
  registry: CardRegistry,
): LocatedInstance | null {
  for (const who of (["A", "B"] as const)) {
    const all = enumeratePlayer(state.players[who], registry);
    const hit = all.find((l) => l.instance.instanceId === instanceId);
    if (hit) return hit;
  }
  return null;
}

/**
 * Stripped-down atom matcher used by interpreter helpers that don't go
 * through the full `evaluateFilter` (e.g. filter atoms in conditions
 * and ScaledInt). Kept local to avoid circular dependency on filters.ts
 * — that module's atom matcher is identical in spirit but tied to
 * LocatedInstance.
 */
function matchesAtomLocal(
  data: { id: string; cardType: string; colors: readonly string[]; features: readonly string[]; mechanics: readonly string[]; cost: number | null; power: number | null },
  atom: CardFilterAtom,
  ownerSide: "A" | "B",
  controller: "A" | "B",
  selfInstanceId: string,
): boolean {
  if (atom.side) {
    const wanted = atom.side === "self" ? controller : atom.side === "opponent" ? oppOf(controller) : null;
    if (wanted !== null && ownerSide !== wanted) return false;
  }
  if (atom.cardType && data.cardType !== atom.cardType) return false;
  if (atom.cardId && data.id !== atom.cardId) return false;
  if (atom.color && !data.colors.includes(atom.color)) return false;
  if (atom.feature && !data.features.includes(atom.feature)) return false;
  if (atom.mechanic && !data.mechanics.includes(atom.mechanic)) return false;
  if (atom.costLte != null && (data.cost == null || data.cost > atom.costLte)) return false;
  if (atom.costGte != null && (data.cost == null || data.cost < atom.costGte)) return false;
  if (atom.costEq != null && (data.cost == null || data.cost !== atom.costEq)) return false;
  if (atom.powerLte != null && (data.power == null || data.power > atom.powerLte)) return false;
  if (atom.powerGte != null && (data.power == null || data.power < atom.powerGte)) return false;
  if (atom.isSelf === true) {
    // Without an instance reference here (we're matching CardData), we
    // assume false unless caller is iterating with selfInstanceId in scope.
    // The `evaluateFilter` path is the authoritative one for isSelf.
    void selfInstanceId;
    return false;
  }
  // `zone` is not enforced at this layer (we don't know the zone of a
  // bare CardData). Callers wanting zone-aware matching go through
  // evaluateFilter.
  return true;
}
