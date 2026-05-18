/**
 * Rules engine: action dispatch, phase progression, combat resolution.
 *
 * Public API
 * ──────────
 *   - `applyAction(state, action, registry) → { state, events }`
 *   - `getLegalActions(state, registry) → GameAction[]`
 *   - `isGameOver(state) → boolean`
 *
 * Determinism
 * ───────────
 * `applyAction` is pure. Any randomness it consumes (e.g. draw is
 * deterministic since the deck order is set, but trigger reveal from
 * life would consume RNG) flows through a `Rng` derived from
 * `state.rngSeed + state.eventSeq`. Same state + same action ⇒ same
 * result.
 *
 * Phase A-2 scope
 * ───────────────
 * Implements: setup, mulligan, REFRESH → DRAW → DON → MAIN, card play
 * (vanilla path: pay cost, place on field), DON attach, attack
 * declaration, counter step, block step, damage resolution, KO, life
 * loss, END phase, turn handoff, game-over detection.
 *
 * NOT YET implemented (Phase B):
 *   - DSL effect resolution (ON_PLAY, TRIGGER, ACTIVATE_MAIN, etc.)
 *   - Trigger reveal from life cards
 *   - Effect-driven card-from-trash / search actions
 *   - Counter cards in hand contribute their `counter` value but
 *     trigger-on-counter effects don't fire yet.
 *
 * What "Phase A-2 complete" means
 * ───────────────────────────────
 * Two vanilla decks (cards with no triggered effects) can be played to
 * completion. Combat, life loss, KO, and game-over all work to spec.
 * That establishes a fixed point we can layer effect resolution on top
 * of without rewriting the flow.
 */

import { createRng } from "./rng";
import { ENGINE_VERSION } from "./version";
import {
  EMPTY_TURN_LOG,
  type ActiveAttack,
  type CardInstance,
  type CardRegistry,
  type CharacterOnField,
  type EngineEvent,
  type EngineEventType,
  type GameState,
  type PlayerState,
  type TurnLog,
} from "./state";

/* ──────────────────────────────────────────────────────────────────────── */
/* Action types — the universe of legal player decisions.                   */
/* ──────────────────────────────────────────────────────────────────────── */

export type AttackTarget =
  | { readonly kind: "leader"; readonly controller: "A" | "B" }
  | {
      readonly kind: "character";
      readonly controller: "A" | "B";
      readonly instanceId: string;
    };

export type GameAction =
  | { readonly type: "MULLIGAN_DECIDE"; readonly player: "A" | "B"; readonly redraw: boolean }
  | { readonly type: "PLAY_CHARACTER"; readonly handInstanceId: string }
  | { readonly type: "PLAY_EVENT"; readonly handInstanceId: string }
  | { readonly type: "PLAY_STAGE"; readonly handInstanceId: string }
  | { readonly type: "ATTACH_DON"; readonly target: "leader" | { readonly instanceId: string } }
  | {
      readonly type: "DECLARE_ATTACK";
      readonly attackerInstanceId: string;
      readonly target: AttackTarget;
    }
  | { readonly type: "DECLARE_BLOCK"; readonly blockerInstanceId: string | null }
  | {
      readonly type: "PLAY_COUNTER";
      readonly counterHandInstanceId: string | null;
    }
  | { readonly type: "PASS_PHASE" }
  | { readonly type: "END_TURN" };

export interface ApplyResult {
  readonly state: GameState;
  readonly events: ReadonlyArray<EngineEvent>;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Event helpers                                                            */
/* ──────────────────────────────────────────────────────────────────────── */

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
  return {
    state: { ...state, eventSeq: state.eventSeq + 1 },
    event,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Small structural helpers                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

function updatePlayer(
  state: GameState,
  who: "A" | "B",
  patch: Partial<PlayerState>,
): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [who]: { ...state.players[who], ...patch },
    },
  };
}

function updateTurnLog(state: GameState, patch: Partial<TurnLog>): GameState {
  return { ...state, turnLog: { ...state.turnLog, ...patch } };
}

function opponentOf(p: "A" | "B"): "A" | "B" {
  return p === "A" ? "B" : "A";
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Card find / movement helpers                                             */
/* ──────────────────────────────────────────────────────────────────────── */

function findInHand(
  p: PlayerState,
  instanceId: string,
): { card: CardInstance; index: number } | null {
  const idx = p.hand.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) return null;
  return { card: p.hand[idx]!, index: idx };
}

function drawN(p: PlayerState, n: number): { p: PlayerState; drawn: CardInstance[] } {
  const drawn = p.deck.slice(0, n);
  return {
    p: { ...p, deck: p.deck.slice(n), hand: [...p.hand, ...drawn] },
    drawn,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Setup-time: deck-out detection (used during drawing).                    */
/* ──────────────────────────────────────────────────────────────────────── */

function checkDeckOut(state: GameState, who: "A" | "B"): GameState {
  const player = state.players[who];
  if (player.deck.length > 0) return state;
  // Per OPTCG rules, a player who must draw but has 0 cards in deck loses.
  return {
    ...state,
    winner: opponentOf(who),
    endCondition: "DECK_OUT",
    phase: "GAME_OVER",
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* MULLIGAN — both players decide once; then turn 1 starts.                 */
/* ──────────────────────────────────────────────────────────────────────── */

function applyMulligan(
  state: GameState,
  action: Extract<GameAction, { type: "MULLIGAN_DECIDE" }>,
): ApplyResult {
  if (state.phase !== "MULLIGAN") {
    throw new Error("MULLIGAN_DECIDE only valid in MULLIGAN phase");
  }
  const p = state.players[action.player];
  if (p.didMulligan) {
    throw new Error(`${action.player} already mulliganed`);
  }

  let next: GameState = state;
  const events: EngineEvent[] = [];

  if (action.redraw) {
    // Shuffle hand back into deck and draw a new 5.
    const shuffleRng = createRng(
      `${state.rngSeed}:${action.player}-mulligan-shuffle`,
    );
    const recombined: CardInstance[] = [...p.deck, ...p.hand];
    shuffleRng.shuffle(recombined);
    const newHand = recombined.slice(0, 5);
    const newDeck = recombined.slice(5);
    next = updatePlayer(next, action.player, {
      hand: newHand,
      deck: newDeck,
      didMulligan: true,
    });
  } else {
    next = updatePlayer(next, action.player, { didMulligan: true });
  }

  const e1 = emit(next, "MULLIGAN_DECIDE", action.player, {
    redraw: action.redraw,
  });
  next = e1.state;
  events.push(e1.event);

  // If both players have decided, start turn 1.
  const bothDecided =
    next.players.A.didMulligan && next.players.B.didMulligan;
  if (bothDecided) {
    next = startTurn(next, next.goFirst, events);
  }
  return { state: next, events };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* TURN flow: TURN_START → REFRESH → DRAW → DON → MAIN.                     */
/* END phase wraps and hands off to the other player.                       */
/* ──────────────────────────────────────────────────────────────────────── */

function startTurn(
  state: GameState,
  who: "A" | "B",
  events: EngineEvent[],
): GameState {
  let next: GameState = {
    ...state,
    turn: state.turn + 1,
    activePlayer: who,
    phase: "REFRESH",
    turnLog: EMPTY_TURN_LOG,
  };
  const eStart = emit(next, "TURN_START", who, { turn: next.turn });
  next = eStart.state;
  events.push(eStart.event);

  // REFRESH: leader, characters, attached DON, DON area all activate.
  const p = next.players[who];
  const refreshedChars = p.characters.map((c) => ({ ...c, state: "active" as const }));
  const refreshedLeader = { ...p.leader, state: "active" as const };
  const refreshedDon = {
    active: p.donArea.active + p.donArea.rested,
    rested: 0,
  };
  next = updatePlayer(next, who, {
    leader: refreshedLeader,
    characters: refreshedChars,
    donArea: refreshedDon,
    didAttachDonThisTurn: false,
  });
  const eRefresh = emit(next, "PHASE_CHANGE", "SYSTEM", { phase: "REFRESH" });
  next = eRefresh.state;
  events.push(eRefresh.event);

  // DRAW: skip on the go-first player's first turn.
  next = { ...next, phase: "DRAW" };
  const skipDraw = next.turn === 1 && who === next.goFirst;
  if (!skipDraw) {
    next = checkDeckOut(next, who);
    if (next.phase === "GAME_OVER") {
      const eEnd = emit(next, "GAME_END", "SYSTEM", {
        winner: next.winner,
        reason: next.endCondition,
      });
      next = eEnd.state;
      events.push(eEnd.event);
      return next;
    }
    const { p: drawnP, drawn } = drawN(next.players[who], 1);
    next = updatePlayer(next, who, drawnP);
    const eDraw = emit(next, "DRAW", who, {
      cardId: drawn[0]?.cardId,
      instanceId: drawn[0]?.instanceId,
    });
    next = eDraw.state;
    events.push(eDraw.event);
  }

  // DON: gain DON from DON deck.
  next = { ...next, phase: "DON" };
  const donToGain = next.turn === 1 && who === next.goFirst ? 1 : 2;
  const donP = next.players[who];
  const moved = Math.min(donToGain, donP.donDeck.length);
  next = updatePlayer(next, who, {
    donDeck: donP.donDeck.slice(moved),
    donArea: {
      active: donP.donArea.active + moved,
      rested: donP.donArea.rested,
    },
  });
  const eDon = emit(next, "DON_GAIN", who, { count: moved });
  next = eDon.state;
  events.push(eDon.event);

  // Enter MAIN — wait for player actions.
  next = { ...next, phase: "MAIN" };
  const eMain = emit(next, "PHASE_CHANGE", "SYSTEM", { phase: "MAIN" });
  next = eMain.state;
  events.push(eMain.event);

  return next;
}

function endTurn(state: GameState, events: EngineEvent[]): GameState {
  let next: GameState = { ...state, phase: "END" };
  const eEnd = emit(next, "PHASE_CHANGE", "SYSTEM", { phase: "END" });
  next = eEnd.state;
  events.push(eEnd.event);

  // Detach attached DONs (back to DON area, rested) and clear turn-scoped
  // power mods. Per OPTCG rules, attaching DON is a turn-scoped buff: the
  // DONs return to the DON area at end of turn in rested state, then
  // refresh next turn.
  const active = next.activePlayer;
  const p = next.players[active];
  let returnedDon = 0;
  const clearedChars = p.characters.map((c) => {
    returnedDon += c.attachedDon;
    return {
      ...c,
      powerModTurn: 0,
      attachedDon: 0,
      // playedThisTurn flag resets so the char can attack next time around.
      playedThisTurn: false,
    };
  });
  returnedDon += p.leader.attachedDon;
  const clearedLeader = {
    ...p.leader,
    powerModTurn: 0,
    attachedDon: 0,
  };
  next = updatePlayer(next, active, {
    leader: clearedLeader,
    characters: clearedChars,
    donArea: {
      active: p.donArea.active,
      rested: p.donArea.rested + returnedDon,
    },
  });
  if (returnedDon > 0) {
    const eDet = emit(next, "DON_DETACH", "SYSTEM", { count: returnedDon });
    next = eDet.state;
    events.push(eDet.event);
  }

  // Hand off to opponent.
  return startTurn(next, opponentOf(active), events);
}

/* ──────────────────────────────────────────────────────────────────────── */
/* MAIN-phase actions                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

function applyPlayCharacter(
  state: GameState,
  action: Extract<GameAction, { type: "PLAY_CHARACTER" }>,
  registry: CardRegistry,
): ApplyResult {
  if (state.phase !== "MAIN") throw new Error("PLAY_CHARACTER outside MAIN");
  const who = state.activePlayer;
  const p = state.players[who];
  const found = findInHand(p, action.handInstanceId);
  if (!found) throw new Error("card not in hand");
  const data = registry.get(found.card.cardId);
  if (data.cardType !== "CHARACTER") {
    throw new Error("PLAY_CHARACTER requires a CHARACTER card");
  }
  if (data.cost == null) throw new Error("character has no cost");
  if (p.donArea.active < data.cost) {
    throw new Error(
      `not enough active DON: need ${data.cost}, have ${p.donArea.active}`,
    );
  }
  if (p.characters.length >= 5) {
    throw new Error("character area is full (max 5)");
  }

  const newDonArea = {
    active: p.donArea.active - data.cost,
    rested: p.donArea.rested + data.cost,
  };
  const newChar: CharacterOnField = {
    instanceId: found.card.instanceId,
    cardId: found.card.cardId,
    state: "active",
    attachedDon: 0,
    powerModPermanent: 0,
    powerModTurn: 0,
    playedThisTurn: true,
    hasBlockerGranted: false,
    hasRushGranted: false,
  };

  let next = updatePlayer(state, who, {
    hand: p.hand.filter((c) => c.instanceId !== action.handInstanceId),
    characters: [...p.characters, newChar],
    donArea: newDonArea,
  });
  next = updateTurnLog(next, {
    plays: [
      ...next.turnLog.plays,
      {
        controller: who,
        cardId: found.card.cardId,
        instanceId: found.card.instanceId,
      },
    ],
    donUsed: {
      ...next.turnLog.donUsed,
      [who]: next.turnLog.donUsed[who] + data.cost,
    },
  });
  const ev = emit(next, "CARD_PLAYED", who, {
    cardId: found.card.cardId,
    instanceId: found.card.instanceId,
    cost: data.cost,
  });
  next = ev.state;

  // NOTE Phase B: enqueue ON_PLAY triggered effects here.

  return { state: next, events: [ev.event] };
}

function applyAttachDon(
  state: GameState,
  action: Extract<GameAction, { type: "ATTACH_DON" }>,
): ApplyResult {
  if (state.phase !== "MAIN") throw new Error("ATTACH_DON outside MAIN");
  const who = state.activePlayer;
  const p = state.players[who];
  if (p.donArea.active < 1) throw new Error("no active DON to attach");

  // Per official rules, ATTACH_DON is the act of using one DON from your
  // area to buff a character or leader for the rest of the turn. The DON
  // returns to your area "rested" once the buff ends (at end of turn).
  let next = state;
  if (action.target === "leader") {
    next = updatePlayer(next, who, {
      leader: { ...p.leader, attachedDon: p.leader.attachedDon + 1 },
      donArea: { active: p.donArea.active - 1, rested: p.donArea.rested },
    });
  } else {
    const targetId = action.target.instanceId;
    const idx = p.characters.findIndex((c) => c.instanceId === targetId);
    if (idx < 0) throw new Error("attach target not on field");
    const ch = p.characters[idx]!;
    const newChar: CharacterOnField = { ...ch, attachedDon: ch.attachedDon + 1 };
    next = updatePlayer(next, who, {
      characters: [
        ...p.characters.slice(0, idx),
        newChar,
        ...p.characters.slice(idx + 1),
      ],
      donArea: { active: p.donArea.active - 1, rested: p.donArea.rested },
    });
  }
  next = updateTurnLog(next, {
    donUsed: { ...next.turnLog.donUsed, [who]: next.turnLog.donUsed[who] + 1 },
  });
  const ev = emit(next, "DON_ATTACH", who, { target: action.target });
  next = ev.state;
  return { state: next, events: [ev.event] };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Combat: declare → counter step → block step → resolve.                   */
/* ──────────────────────────────────────────────────────────────────────── */

function characterPower(
  p: PlayerState,
  instanceId: string,
  registry: CardRegistry,
): number {
  if (instanceId === p.leader.instanceId) {
    const base = registry.get(p.leader.cardId).power ?? 0;
    return base + p.leader.powerModTurn + p.leader.attachedDon * 1000;
  }
  const ch = p.characters.find((c) => c.instanceId === instanceId);
  if (!ch) throw new Error(`not found on field: ${instanceId}`);
  const base = registry.get(ch.cardId).power ?? 0;
  return base + ch.powerModPermanent + ch.powerModTurn + ch.attachedDon * 1000;
}

function applyDeclareAttack(
  state: GameState,
  action: Extract<GameAction, { type: "DECLARE_ATTACK" }>,
  registry: CardRegistry,
): ApplyResult {
  if (state.phase !== "MAIN") throw new Error("DECLARE_ATTACK outside MAIN");
  if (state.activeAttack) throw new Error("attack already in progress");
  const who = state.activePlayer;
  const p = state.players[who];

  // Validate attacker: must be active, must belong to active player, must
  // not have been played this turn unless it has rush.
  const isLeader = action.attackerInstanceId === p.leader.instanceId;
  let attackerState: "active" | "rested";
  let playedThisTurn = false;
  let hasRush = false;
  if (isLeader) {
    if (state.turn === 1 && who === state.goFirst) {
      throw new Error("first player cannot attack on turn 1");
    }
    attackerState = p.leader.state;
  } else {
    const ch = p.characters.find(
      (c) => c.instanceId === action.attackerInstanceId,
    );
    if (!ch) throw new Error("attacker not on field");
    attackerState = ch.state;
    playedThisTurn = ch.playedThisTurn;
    const data = registry.get(ch.cardId);
    hasRush = ch.hasRushGranted || data.mechanics.includes("ラッシュ");
  }
  if (attackerState !== "active") throw new Error("attacker is rested");
  if (state.turn === 1 && who === state.goFirst && !isLeader) {
    throw new Error("first player cannot attack on turn 1");
  }
  if (playedThisTurn && !hasRush) {
    throw new Error("character with summoning sickness cannot attack");
  }

  // Validate target.
  const oppId = opponentOf(who);
  const opp = state.players[oppId];
  if (action.target.kind === "leader") {
    if (action.target.controller !== oppId) {
      throw new Error("must attack opponent's leader");
    }
  } else {
    const charTarget = action.target;
    if (charTarget.controller !== oppId) {
      throw new Error("must attack opponent's character");
    }
    const targetCh = opp.characters.find(
      (c) => c.instanceId === charTarget.instanceId,
    );
    if (!targetCh) throw new Error("target character not found");
    if (targetCh.state !== "rested") {
      throw new Error("can only attack rested characters");
    }
  }

  // Rest the attacker.
  let next = state;
  if (isLeader) {
    next = updatePlayer(next, who, {
      leader: { ...p.leader, state: "rested" },
    });
  } else {
    next = updatePlayer(next, who, {
      characters: p.characters.map((c) =>
        c.instanceId === action.attackerInstanceId
          ? { ...c, state: "rested" }
          : c,
      ),
    });
  }

  // Compute powers at declaration time.
  const attackerPower = characterPower(
    next.players[who],
    action.attackerInstanceId,
    registry,
  );
  const targetPower =
    action.target.kind === "leader"
      ? characterPower(next.players[oppId], opp.leader.instanceId, registry)
      : characterPower(next.players[oppId], action.target.instanceId, registry);

  const activeAttack: ActiveAttack = {
    attacker: { controller: who, instanceId: action.attackerInstanceId },
    target: action.target,
    attackerPower,
    targetPower,
    counterValue: 0,
    blocker: null,
  };
  next = { ...next, activeAttack, phase: "BATTLE" };

  // Log turn-scoped attack info.
  next = updateTurnLog(next, {
    attacks: [
      ...next.turnLog.attacks,
      {
        attackerController: who,
        attackerInstanceId: action.attackerInstanceId,
        targetKind: action.target.kind,
      },
    ],
    attackCount: {
      ...next.turnLog.attackCount,
      [who]: next.turnLog.attackCount[who] + 1,
    },
    leaderAttacked: isLeader
      ? { ...next.turnLog.leaderAttacked, [who]: true }
      : next.turnLog.leaderAttacked,
  });

  const ev = emit(next, "ATTACK_DECLARED", who, {
    attackerInstanceId: action.attackerInstanceId,
    target: action.target,
    attackerPower,
    targetPower,
  });
  next = ev.state;
  return { state: next, events: [ev.event] };
}

function applyDeclareBlock(
  state: GameState,
  action: Extract<GameAction, { type: "DECLARE_BLOCK" }>,
  registry: CardRegistry,
): ApplyResult {
  if (state.phase !== "BATTLE" || !state.activeAttack) {
    throw new Error("DECLARE_BLOCK outside BATTLE");
  }
  const events: EngineEvent[] = [];
  let next = state;
  if (action.blockerInstanceId) {
    const oppId = opponentOf(state.activeAttack.attacker.controller);
    const opp = next.players[oppId];
    const ch = opp.characters.find(
      (c) => c.instanceId === action.blockerInstanceId,
    );
    if (!ch) throw new Error("blocker not on field");
    if (ch.state !== "active") throw new Error("blocker is rested");
    const data = registry.get(ch.cardId);
    const hasBlocker =
      ch.hasBlockerGranted || data.mechanics.includes("ブロッカー");
    if (!hasBlocker) throw new Error("character is not a blocker");

    next = updatePlayer(next, oppId, {
      characters: opp.characters.map((c) =>
        c.instanceId === action.blockerInstanceId
          ? { ...c, state: "rested" as const }
          : c,
      ),
    });
    next = {
      ...next,
      activeAttack: {
        ...next.activeAttack!,
        blocker: { controller: oppId, instanceId: action.blockerInstanceId },
        // Re-target combat to the blocker.
        target: {
          kind: "character",
          controller: oppId,
          instanceId: action.blockerInstanceId,
        },
        targetPower: characterPower(
          next.players[oppId],
          action.blockerInstanceId,
          registry,
        ),
      },
    };
    const ev = emit(next, "BLOCK_DECLARED", oppId, {
      blockerInstanceId: action.blockerInstanceId,
    });
    next = ev.state;
    events.push(ev.event);
  } else {
    // Defender chose not to block. Skip ahead to damage resolution.
    const ev = emit(next, "BLOCK_DECLARED", "SYSTEM", { blocker: null });
    next = ev.state;
    events.push(ev.event);
  }
  return { state: next, events };
}

function applyPlayCounter(
  state: GameState,
  action: Extract<GameAction, { type: "PLAY_COUNTER" }>,
  registry: CardRegistry,
): ApplyResult {
  if (state.phase !== "BATTLE" || !state.activeAttack) {
    throw new Error("PLAY_COUNTER outside BATTLE");
  }
  const events: EngineEvent[] = [];
  let next = state;
  if (action.counterHandInstanceId) {
    const defenderId = opponentOf(state.activeAttack.attacker.controller);
    const defP = next.players[defenderId];
    const found = findInHand(defP, action.counterHandInstanceId);
    if (!found) throw new Error("counter not in hand");
    const data = registry.get(found.card.cardId);
    const counterValue = data.counter ?? 0;
    if (counterValue <= 0) throw new Error("card has no counter value");

    next = updatePlayer(next, defenderId, {
      hand: defP.hand.filter(
        (c) => c.instanceId !== action.counterHandInstanceId,
      ),
      trash: [...defP.trash, found.card],
    });
    next = {
      ...next,
      activeAttack: {
        ...next.activeAttack!,
        counterValue: next.activeAttack!.counterValue + counterValue,
      },
    };
    const ev = emit(next, "COUNTER_PLAYED", defenderId, {
      cardId: found.card.cardId,
      instanceId: found.card.instanceId,
      counterValue,
    });
    next = ev.state;
    events.push(ev.event);
    // Caller can play multiple counters; resolution is triggered by PASS_PHASE.
  } else {
    // Defender passes — resolve.
    const result = resolveAttack(next, registry);
    return { state: result.state, events: result.events };
  }
  return { state: next, events };
}

function resolveAttack(
  state: GameState,
  registry: CardRegistry,
): ApplyResult {
  if (!state.activeAttack) throw new Error("no active attack to resolve");
  const att = state.activeAttack;
  const events: EngineEvent[] = [];
  let next = state;

  const effectiveTargetPower = att.targetPower + att.counterValue;
  // OPTCG: attacker wins if attackerPower >= effectiveTargetPower.
  const hits = att.attackerPower >= effectiveTargetPower;
  const dmgEv = emit(next, "DAMAGE_DEALT", "SYSTEM", {
    attackerPower: att.attackerPower,
    targetPower: effectiveTargetPower,
    hits,
  });
  next = dmgEv.state;
  events.push(dmgEv.event);

  if (hits) {
    if (att.target.kind === "leader") {
      next = applyLifeLoss(next, att.target.controller, events, registry);
      if (next.phase === "GAME_OVER") {
        next = { ...next, activeAttack: null };
        return { state: next, events };
      }
    } else {
      // KO the targeted character.
      next = koCharacter(
        next,
        att.target.controller,
        att.target.instanceId,
        att.attacker.controller,
        events,
        registry,
      );
    }
  }

  next = { ...next, activeAttack: null, phase: "MAIN" };
  return { state: next, events };
}

function applyLifeLoss(
  state: GameState,
  who: "A" | "B",
  events: EngineEvent[],
  _registry: CardRegistry,
): GameState {
  void _registry;
  let next = state;
  const p = next.players[who];
  if (p.life.length === 0) {
    // No life left → opponent wins on this hit.
    const evWin = emit(next, "GAME_END", "SYSTEM", {
      winner: opponentOf(who),
      reason: "LIFE_OUT",
    });
    next = {
      ...evWin.state,
      winner: opponentOf(who),
      endCondition: "LIFE_OUT",
      phase: "GAME_OVER",
    };
    events.push(evWin.event);
    return next;
  }
  const top = p.life[0]!;
  next = updatePlayer(next, who, {
    life: p.life.slice(1),
    hand: [...p.hand, top],
  });
  const ev = emit(next, "LIFE_LOST", who, {
    cardId: top.cardId,
    instanceId: top.instanceId,
    remainingLife: next.players[who].life.length,
  });
  next = ev.state;
  events.push(ev.event);
  // NOTE Phase B: if the life card has a TRIGGER effect, offer it here.
  return next;
}

function koCharacter(
  state: GameState,
  owner: "A" | "B",
  instanceId: string,
  byController: "A" | "B",
  events: EngineEvent[],
  registry: CardRegistry,
): GameState {
  const p = state.players[owner];
  const ch = p.characters.find((c) => c.instanceId === instanceId);
  if (!ch) return state;
  // Attached DON returns to owner's DON area, rested.
  const newDonArea = {
    active: p.donArea.active,
    rested: p.donArea.rested + ch.attachedDon,
  };
  const removed = p.characters.filter((c) => c.instanceId !== instanceId);
  let next = updatePlayer(state, owner, {
    characters: removed,
    trash: [...p.trash, { instanceId: ch.instanceId, cardId: ch.cardId }],
    donArea: newDonArea,
  });
  next = updateTurnLog(next, {
    kos: [
      ...next.turnLog.kos,
      {
        owner,
        byController,
        cardId: ch.cardId,
        instanceId: ch.instanceId,
      },
    ],
  });
  const ev = emit(next, "CHARACTER_KO", "SYSTEM", {
    owner,
    cardId: ch.cardId,
    instanceId: ch.instanceId,
  });
  next = ev.state;
  events.push(ev.event);
  // NOTE Phase B: enqueue ON_KO effects here.
  void registry;
  return next;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* PASS_PHASE — defender passes counter / blocker windows.                  */
/* ──────────────────────────────────────────────────────────────────────── */

function applyPassPhase(state: GameState, registry: CardRegistry): ApplyResult {
  if (state.phase === "BATTLE" && state.activeAttack) {
    return resolveAttack(state, registry);
  }
  throw new Error("PASS_PHASE only valid during BATTLE");
}

/* ──────────────────────────────────────────────────────────────────────── */
/* End turn.                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

function applyEndTurn(state: GameState): ApplyResult {
  if (state.phase !== "MAIN") {
    throw new Error("END_TURN only valid from MAIN");
  }
  const events: EngineEvent[] = [];
  const next = endTurn(state, events);
  return { state: next, events };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Dispatcher                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

export function applyAction(
  state: GameState,
  action: GameAction,
  registry: CardRegistry,
): ApplyResult {
  if (state.phase === "GAME_OVER") {
    throw new Error("game is over");
  }
  if (state.engineVersion !== ENGINE_VERSION) {
    throw new Error(
      `engine version mismatch: state=${state.engineVersion}, runtime=${ENGINE_VERSION}`,
    );
  }
  switch (action.type) {
    case "MULLIGAN_DECIDE":
      return applyMulligan(state, action);
    case "PLAY_CHARACTER":
      return applyPlayCharacter(state, action, registry);
    case "PLAY_EVENT":
    case "PLAY_STAGE":
      // Phase B will resolve these via the DSL interpreter.
      throw new Error(`${action.type} not yet implemented (Phase B)`);
    case "ATTACH_DON":
      return applyAttachDon(state, action);
    case "DECLARE_ATTACK":
      return applyDeclareAttack(state, action, registry);
    case "DECLARE_BLOCK":
      return applyDeclareBlock(state, action, registry);
    case "PLAY_COUNTER":
      return applyPlayCounter(state, action, registry);
    case "PASS_PHASE":
      return applyPassPhase(state, registry);
    case "END_TURN":
      return applyEndTurn(state);
  }
  // exhaustiveness check — TS will flag if a case is missed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  throw new Error(`unhandled action: ${(action as any).type}`);
}

export function isGameOver(state: GameState): boolean {
  return state.phase === "GAME_OVER" || state.winner != null;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Legal action enumeration (basic; CPU layer will refine in Phase C).      */
/* ──────────────────────────────────────────────────────────────────────── */

export function getLegalActions(
  state: GameState,
  registry: CardRegistry,
): GameAction[] {
  if (isGameOver(state)) return [];
  if (state.phase === "MULLIGAN") {
    const out: GameAction[] = [];
    for (const who of ["A", "B"] as const) {
      if (!state.players[who].didMulligan) {
        out.push(
          { type: "MULLIGAN_DECIDE", player: who, redraw: true },
          { type: "MULLIGAN_DECIDE", player: who, redraw: false },
        );
      }
    }
    return out;
  }
  if (state.phase === "MAIN") {
    return mainPhaseActions(state, registry);
  }
  if (state.phase === "BATTLE") {
    return battlePhaseActions(state, registry);
  }
  return [];
}

function mainPhaseActions(
  state: GameState,
  registry: CardRegistry,
): GameAction[] {
  const who = state.activePlayer;
  const p = state.players[who];
  const out: GameAction[] = [];

  // Play characters from hand if affordable and there's room.
  if (p.characters.length < 5) {
    for (const card of p.hand) {
      const d = registry.get(card.cardId);
      if (
        d.cardType === "CHARACTER" &&
        d.cost != null &&
        p.donArea.active >= d.cost
      ) {
        out.push({ type: "PLAY_CHARACTER", handInstanceId: card.instanceId });
      }
    }
  }

  // Attach DON: leader, or each character on field.
  if (p.donArea.active >= 1) {
    out.push({ type: "ATTACH_DON", target: "leader" });
    for (const ch of p.characters) {
      out.push({
        type: "ATTACH_DON",
        target: { instanceId: ch.instanceId },
      });
    }
  }

  // Declare attacks from active characters / leader (except first turn for goFirst).
  const firstTurnGoFirst = state.turn === 1 && who === state.goFirst;
  if (!firstTurnGoFirst) {
    const oppId = opponentOf(who);
    const opp = state.players[oppId];
    const restedTargets: AttackTarget[] = [
      { kind: "leader", controller: oppId },
      ...opp.characters
        .filter((c) => c.state === "rested")
        .map((c) => ({
          kind: "character" as const,
          controller: oppId,
          instanceId: c.instanceId,
        })),
    ];
    const attackers: { id: string; isLeader: boolean }[] = [];
    if (p.leader.state === "active") {
      attackers.push({ id: p.leader.instanceId, isLeader: true });
    }
    for (const ch of p.characters) {
      if (ch.state !== "active") continue;
      const d = registry.get(ch.cardId);
      const canRush = ch.hasRushGranted || d.mechanics.includes("ラッシュ");
      if (ch.playedThisTurn && !canRush) continue;
      attackers.push({ id: ch.instanceId, isLeader: false });
    }
    for (const a of attackers) {
      for (const t of restedTargets) {
        out.push({
          type: "DECLARE_ATTACK",
          attackerInstanceId: a.id,
          target: t,
        });
      }
    }
  }

  out.push({ type: "END_TURN" });
  return out;
}

function battlePhaseActions(
  state: GameState,
  registry: CardRegistry,
): GameAction[] {
  const att = state.activeAttack;
  if (!att) return [];
  const defenderId = opponentOf(att.attacker.controller);
  const def = state.players[defenderId];
  const out: GameAction[] = [];

  // Defender may play counter cards from hand.
  for (const card of def.hand) {
    const d = registry.get(card.cardId);
    if (d.counter && d.counter > 0) {
      out.push({
        type: "PLAY_COUNTER",
        counterHandInstanceId: card.instanceId,
      });
    }
  }

  // Defender may declare a blocker (only if attack hasn't been re-targeted).
  if (!att.blocker && att.target.kind === "leader") {
    for (const ch of def.characters) {
      if (ch.state !== "active") continue;
      const d = registry.get(ch.cardId);
      const hasBlocker =
        ch.hasBlockerGranted || d.mechanics.includes("ブロッカー");
      if (hasBlocker) {
        out.push({
          type: "DECLARE_BLOCK",
          blockerInstanceId: ch.instanceId,
        });
      }
    }
  }

  // Pass (defender finalizes — engine resolves the attack).
  out.push({ type: "PASS_PHASE" });
  return out;
}
