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
Optimizer             ✅ Rules Kernel Optimizer v2
    ↓
Practice              pending
```

The user-facing Deck Intelligence Battle Benchmark and Deck Optimizer use the
Rules Headless Runner. The old `deck-battle-benchmark.ts` runner remains only
for unmigrated Practice-era callers and regressions; Optimizer does not import
or call it. `practice-training.ts` and the Practice UI remain on their existing
paths until a dedicated migration.

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
- `compact`: every event keeps actor, turn, type, card id, instance id, effect,
  target, and message metadata but omits battle-state snapshots. Optimizer uses
  this only for its baseline observation pass and discards each game after it is
  aggregated.
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

## Rules Kernel Optimizer v2

Optimizer candidate generation is still deterministic and preserves the
existing legal 1/2-copy swaps, active restrictions, color legality, verified
candidate ranking, Main Style, Feature Tags, and structural deck deltas. Only
the evaluation engine changed.

One optimizer request compiles one `BattleEffectRegistry`, computes Opponent
coverage once, and builds separate Player coverage for the baseline and every
candidate. Baseline and candidates run the same immutable opponent, base seed,
seed step, first-player alternation, CPU level, and maximum-turn schedule.

Paired results are tri-state: win, loss, or inconclusive. A pair contributes to
`candidateOnlyWins`, `baselineOnlyWins`, `bothWin`, or `bothLose` only when both
matches resolved. Any pair containing an inconclusive result is excluded and
reported separately. Candidate metrics use `RulesBenchmarkDeckMetrics`, so the
UI presents resolved win rate with Wilson 95% CI, resolution rate, first/second
splits, average resolved turns, Rules statistics, and effect coverage.

The baseline compact trace is aggregated into per-card observations such as
plays, attacks, Counter use, Trigger activation, Search, and effect targeting.
No replay or full state history is retained. A candidate run uses `none`. An
unobserved card is not classified as weak: removal order combines observation
with structural role and shared Leader features, and partial/unsupported
coverage status is reported without becoming a negative card score.

`improvement_signal` is fail-closed. It requires enough both-resolved pairs, no
engine guard, non-degraded coverage, positive resolved-win-rate change, no
material resolution-rate regression, and more candidate-only than
baseline-only wins. Otherwise the UI says `差は小さい`, `改善確認できず`, or
`判定保留`. These labels describe only the current Rules Kernel evidence; they
do not claim tournament strength, a best deck, or a statistically conclusive
causal improvement.

## Known boundaries

Coverage remains intentionally conservative. Partial or unsupported effect
families identified by the existing compiler remain unexecuted. Rules Benchmark
v2 and Rules Kernel Optimizer v2 are not tournament or meta win-rate models.
Practice still uses its existing path pending a dedicated migration.
