# Rules Kernel Headless Simulation v1

## Purpose

Rules Headless Runner executes deterministic, UI-free matches through the same
Rules Kernel used by `/battle`. It does not call the legacy heuristic simulator,
React, the DOM, AI, or the database.

```text
Rules Kernel
    ↓
Headless Runner       ✅
    ↓
Battle Benchmark      ✅ Rules Benchmark v2
    ↓
Optimizer             pending
    ↓
Practice              pending
```

The user-facing Deck Intelligence Battle Benchmark now uses the Rules Headless
Runner. `deck-battle-benchmark.ts` keeps the legacy heuristic runner temporarily
for Optimizer compatibility; `deck-optimizer.ts`, `practice-training.ts`, and
the Practice UI remain on their existing paths until later migrations.

## Architecture

- `engine.ts` remains the only rule-resolution source. The runner calls public
  Kernel APIs for playing cards, attaching DON!!, declaring attacks, resolving
  targets, Search, Trigger, Blocker, Counter, attack resolution, and turn
  transitions.
- `auto-policy.ts` chooses among legal actions. A policy never changes zones or
  resolves effects itself. `CpuSkill` changes choice quality, not legality.
- `headless-runner.ts` orchestrates both policies, guards execution, validates
  card conservation, collects deterministic statistics, and reports the result.
- `battle-trace.ts` owns compact statistics, state summaries, and optional trace
  retention.

Unsupported rules text is never approximated. A card with an unsupported effect
may still be played and attack as an ordinary Character because those are base
rules, but its unsupported text is not executed.

## First player and turn rules

`createBattleState` accepts an explicit `firstPlayer`. Both sides receive five
opening cards and Life from their own shuffled deck. The first player skips only
their first draw and receives one DON!!; the second player draws on their first
turn and receives two DON!!. Each side is prevented from attacking on its own
first turn. Subsequent turns refresh and add up to two DON!! through the Kernel.

The interactive default remains `player`, so `/battle` keeps its existing flow.

## Side-isolated deterministic RNG

Initial zones use independent deterministic streams derived from `(seed,
"player")` and `(seed, "opponent")`. Changing the Player deck therefore cannot
consume randomness that changes the Opponent opening hand, Life, or deck order,
and the inverse is also true. This is the common-randomness foundation intended
for paired Benchmark runs.

## Results and inconclusive games

A result is won only when the Rules Kernel declares a winner. Reaching
`maxTurns` returns `outcome: "inconclusive"` with `reason: "turn_limit"`; no
board, hand, Life, or composite heuristic is used to invent a winner. Reaching
`maxActionsPerTurn` or `maxPendingResolutions`, or detecting card-conservation
failure, returns `reason: "engine_guard"`.

`reason` also distinguishes `leader_damage`, immediate official `deck_out`, and
future Kernel-driven `effect_win` outcomes.

Rules Benchmark v2 reports `resolvedGames` separately from `inconclusiveGames`.
Its resolved win rate and Wilson 95% interval use only games where the Kernel
declared a winner. Turn-limit and engine-guard results never become losses or
score-based winners. Same-seed paired and pairwise comparisons exclude an
inconclusive schedule index from resolved win/loss classifications.

## Coverage and statistics

Each result carries the existing deterministic `DeckEffectCoverage` for both
decks, including the separate Leader status. It also records structured rule
counts such as plays, Leader/Character attacks, damage, Blocker and real Counter
consumption, Trigger decisions, Search, DON!! use, deck-out, and
supported/partial/unsupported effect encounters. No contribution or
score-at-limit heuristic is generated.

Each variant exposes Main-deck copy coverage and the Leader status separately.
`complete` is true only when the Main 50 and Leader are supported, so the UI does
not present a Main-deck ratio alone as complete reproduction. The shared
Opponent coverage is compiled once per request alongside one request-wide
effect registry; each variant receives its own Player coverage environment.

## Trace modes and batch memory

- `none`: no event array; intended for Benchmark and Optimizer batches.
- `summary`: battle/turn/end/guard snapshots only.
- `full`: every policy-to-Kernel transition; intended for sampled replay and
  correctness tests.

`runHeadlessBatch` aggregates outcomes, reasons, and statistics while discarding
individual matches and always using `none`, so memory does not grow with a full
event stream. Before the game loop it builds one `HeadlessBattleEnvironment`
containing the compiled effect registry and both deck coverage reports. Every
game reads that shared environment while keeping all mutable battle state local
to the match. Single-match callers may also precompile and pass the same
environment explicitly.

During a pending Trigger decision, the revealed Life card is counted in an
explicit `resolving` transit slot. After resolution it returns to hand, field, or
trash. This keeps conservation checks exact across every intermediate state.

Effect metrics distinguish an occurrence from a completed resolution. Partial
and unsupported text is counted once when encountered. A supported effect is
counted only when its Kernel resolution is reached; revealing and then
activating one Trigger never records two encounters.

## Known boundaries

Coverage remains intentionally conservative. Partial or unsupported effect
families identified by the existing compiler remain unexecuted. Rules Benchmark
v2 is not a tournament or meta win-rate model. Optimizer and Practice still use
their existing heuristic paths pending their dedicated migrations.
